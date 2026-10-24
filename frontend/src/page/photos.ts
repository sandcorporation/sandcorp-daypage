import * as Y from 'yjs'
import { api } from '../api/client'
import { PAGE_HEIGHT, PAGE_WIDTH } from './geometry'

/**
 * 사진(Photo): 지면에 붙인 사진 한 장. 브라우저에서 작게 줄인 WebP(또는 JPEG)를 서버에 올리면 서버가 오브젝트 저장소
 * (Oracle Object Storage)에 두고, 장 문서에는 사진 id(src)와 자리만 남는다(backend/daypage/photos.py).
 * 종이 위·채색과 잉크 아래에 놓여, 사진 위에 펜으로 쓸 수 있다. 레이어에 속하지 않는다.
 *
 * photos: Y.Map<photoId, Y.Map{ x, y, width, height, src, author, createdAt, order? }>
 *
 * 어느 사진이 보이는지는 넣은 순(createdAt)으로 정하고, 보이는 사진끼리 겹치는 순서는 order로 정한다(사진 패널에서 바꾼다).
 *
 * 서버 비용 때문에 한 장에 PHOTO_LIMIT장, 한 장당 PHOTO_MAX_BYTES까지. 동시에 붙여 한도를 넘은 사진은 보이지 않고,
 * 봉인할 때 서버가 문서와 저장소에서 지운다(같은 규칙: visible_photo_ids).
 */
export const PHOTOS = 'photos'
export const PHOTO_LIMIT = 3
export const PHOTO_MAX_BYTES = 150_000
/** 줄인 사진의 긴 변(px). 넘치면 더 줄인다 */
export const PHOTO_MAX_SIDE = 1024
/** 처음 붙일 때의 긴 변(장 좌표) */
export const PHOTO_PLACE_SIDE = 600
/** 끌어 줄일 때의 가장 짧은 변(장 좌표) */
export const PHOTO_MIN_SIDE = 60

export type Photo = {
  id: string
  x: number
  y: number
  width: number
  height: number
  /** 서버의 사진 id */
  src: string
  author: string
  createdAt: number
  /** 겹치는 순서(클수록 앞). 없으면 넣은 순 */
  order?: number
}

export function photosMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(PHOTOS)
}

export function readPhoto(id: string, m: Y.Map<unknown>): Photo | null {
  const src = m.get('src')
  if (typeof src !== 'string') return null
  return {
    id,
    x: m.get('x') as number,
    y: m.get('y') as number,
    width: m.get('width') as number,
    height: m.get('height') as number,
    src,
    author: m.get('author') as string,
    createdAt: (m.get('createdAt') as number | undefined) ?? 0,
    ...(typeof m.get('order') === 'number' ? { order: m.get('order') as number } : {}),
  }
}

/** 보이는 사진: 넣은 순으로 한도 안의 것만 골라, 겹치는 순서(아래 것부터)로 돌려준다. */
export function readPhotos(doc: Y.Doc): Photo[] {
  const all: Photo[] = []
  for (const [id, m] of photosMap(doc).entries()) {
    const p = readPhoto(id, m)
    if (p) all.push(p)
  }
  all.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  const visible = all.slice(0, PHOTO_LIMIT)
  // order가 없는 사진은 넣은 순서 자리(index)를 order로 본다
  const key = (p: Photo, i: number) => p.order ?? i
  return visible
    .map((p, i) => ({ p, k: key(p, i), i }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map(({ p }) => p)
}

/** 새로 붙이는 사진의 순서: 맨 앞 */
export function nextPhotoOrder(doc: Y.Doc): number {
  return readPhotos(doc).reduce((top, p, i) => Math.max(top, p.order ?? i), -1) + 1
}

/** 사진을 겹치는 순서의 to번째(0이 맨 아래)로 옮긴다. 보이는 사진 모두에 순서를 다시 매긴다(많아야 PHOTO_LIMIT장). */
export function movePhoto(doc: Y.Doc, id: string, to: number, origin?: unknown): void {
  const photos = readPhotos(doc)
  const from = photos.findIndex((p) => p.id === id)
  if (from < 0) return
  const target = Math.min(Math.max(0, to), photos.length - 1)
  if (target === from) return
  const [moved] = photos.splice(from, 1)
  photos.splice(target, 0, moved)
  doc.transact(() => {
    photos.forEach((p, i) => {
      const m = photosMap(doc).get(p.id)
      if (m && m.get('order') !== i) m.set('order', i)
    })
  }, origin)
}

/** 이 장에 사진을 더 붙일 수 있는지 */
export function canAddPhoto(doc: Y.Doc): boolean {
  return readPhotos(doc).length < PHOTO_LIMIT
}

export function addPhoto(doc: Y.Doc, photo: Photo, origin?: unknown): void {
  doc.transact(() => {
    const m = new Y.Map<unknown>()
    m.set('x', photo.x)
    m.set('y', photo.y)
    m.set('width', photo.width)
    m.set('height', photo.height)
    m.set('src', photo.src)
    m.set('author', photo.author)
    m.set('createdAt', photo.createdAt)
    if (typeof photo.order === 'number') m.set('order', photo.order)
    photosMap(doc).set(photo.id, m)
  }, origin)
}

export function updatePhoto(
  doc: Y.Doc,
  id: string,
  patch: Partial<Pick<Photo, 'x' | 'y' | 'width' | 'height'>>,
  origin?: unknown,
): void {
  const m = photosMap(doc).get(id)
  if (!m) return
  doc.transact(() => {
    for (const [k, v] of Object.entries(patch)) m.set(k, Math.round(v * 10) / 10)
  }, origin)
}

export function deletePhoto(doc: Y.Doc, id: string, origin?: unknown): void {
  doc.transact(() => photosMap(doc).delete(id), origin)
}

/** 사진 원본 크기(w×h)를 긴 변 side에 맞춘 크기. 원본이 더 작으면 그대로 */
export function fitSide(w: number, h: number, side: number): { width: number; height: number } {
  const k = Math.min(1, side / Math.max(w, h, 1))
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) }
}

/** 처음 붙일 자리: 가운데가 (cx, cy)이고 장 밖으로 나가지 않게 */
export function placePhoto(w: number, h: number, cx: number, cy: number): { x: number; y: number; width: number; height: number } {
  const { width, height } = fitSide(w, h, PHOTO_PLACE_SIDE)
  const x = Math.min(Math.max(0, cx - width / 2), PAGE_WIDTH - width)
  const y = Math.min(Math.max(0, cy - height / 2), PAGE_HEIGHT - height)
  return { x: Math.round(x), y: Math.round(y), width, height }
}

/** 고를 수 있는 사진 형식(움직이는 GIF는 첫 장면만 남는다) */
export const PHOTO_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif'

export class PhotoTooBig extends Error {}

/**
 * 고른 그림 파일을 줄여 바이트로. 긴 변 PHOTO_MAX_SIDE·WebP로 줄이고, 그래도 크면 품질과 크기를 낮춰 가며
 * PHOTO_MAX_BYTES 안에 맞춘다. WebP를 못 만드는 브라우저(옛 Safari)는 JPEG로.
 */
export async function shrinkPhoto(file: Blob): Promise<{ data: Uint8Array; mime: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file)
  try {
    for (const side of [PHOTO_MAX_SIDE, 800, 640, 480]) {
      const { width, height } = fitSide(bitmap.width, bitmap.height, side)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('canvas를 쓸 수 없어요')
      ctx.drawImage(bitmap, 0, 0, width, height)
      for (const quality of [0.8, 0.65, 0.5]) {
        const blob = await encode(canvas, 'image/webp', quality)
        const out = blob && blob.type === 'image/webp' ? blob : await encode(canvas, 'image/jpeg', quality)
        if (out && out.size <= PHOTO_MAX_BYTES) {
          return { data: new Uint8Array(await out.arrayBuffer()), mime: out.type, width, height }
        }
      }
    }
    throw new PhotoTooBig()
  } finally {
    bitmap.close()
  }
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/** 노트 사진 주소의 앞부분. 운영자 화면은 /api/admin 쪽으로 받는다 */
export function photoBase(noteId: string, staff = false): string {
  return `/api/${staff ? 'admin/' : ''}notes/${encodeURIComponent(noteId)}/photos`
}

/** 사진 주소(같은 출처라 PNG·책 저장 캔버스가 더럽혀지지 않는다) */
export function photoUrl(base: string, src: string): string {
  return `${base}/${encodeURIComponent(src)}`
}

/** 줄인 사진을 올리고 사진 id를 받는다 */
export async function uploadPhoto(noteId: string, data: Uint8Array, mime: string): Promise<string> {
  const res = await api<{ id: string }>(`/api/notes/${encodeURIComponent(noteId)}/photos`, {
    method: 'POST',
    body: new Blob([data as BlobPart], { type: mime }),
    headers: { 'Content-Type': mime },
  })
  return res.id
}

/** 사진을 받아 그림으로 푼다(PNG·책 저장용). 받거나 풀지 못하면 null(그 사진만 빠진다) */
export async function decodePhoto(base: string, photo: Photo): Promise<ImageBitmap | null> {
  try {
    const res = await fetch(photoUrl(base, photo.src), { credentials: 'same-origin' })
    if (!res.ok) return null
    return await createImageBitmap(await res.blob())
  } catch {
    return null
  }
}

let enabled: Promise<boolean> | null = null

/** 서버에 사진 저장소가 설정돼 있는지(/api/client-config). 한 번만 묻는다 */
export function photosEnabled(): Promise<boolean> {
  enabled ??= api<{ photos?: boolean }>('/api/client-config')
    .then((c) => c.photos === true)
    .catch(() => {
      enabled = null
      return false
    })
  return enabled
}
