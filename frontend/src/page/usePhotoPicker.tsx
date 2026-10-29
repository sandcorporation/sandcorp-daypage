import { useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { ApiError } from '../api/client'
import { PAGE_HEIGHT, PAGE_WIDTH } from './geometry'
import { newId } from './doc'
import { VIEW_IDENTITY, clientToPage, type ViewTransform } from './viewTransform'
import { usePhotos } from './PhotoLayer'
import {
  addPhoto,
  nextPhotoOrder,
  PHOTO_ACCEPT,
  PHOTO_LIMIT,
  PhotoTooBig,
  photosEnabled,
  placePhoto,
  shrinkPhoto,
  uploadPhoto,
} from './photos'

/** 새 사진을 이미 붙은 장 수만큼 비켜 붙이는 거리(장 좌표) */
const PHOTO_CASCADE = 60

type Options = {
  doc: Y.Doc
  noteId: string
  author: string
  origin: unknown
  scale: number
  /** 이 탭의 보기 변환(화면 가운데를 장 좌표로 바꿀 때) */
  view?: ViewTransform
  /** 붙인 뒤(선택·이동 도구로 바꿔 바로 옮길 수 있게) */
  onPlaced?: () => void
  show: (message: string) => void
}

/** 지금 화면에 보이는 장의 가운데(장 좌표). 장이 화면 밖이면 장 가운데 */
function visibleCenter(scale: number, view: ViewTransform): { x: number; y: number } {
  const rect = document.querySelector('.page-frame')?.getBoundingClientRect()
  if (!rect) return { x: PAGE_WIDTH / 2, y: PAGE_HEIGHT / 2 }
  const left = Math.max(rect.left, 0)
  const right = Math.min(rect.right, window.innerWidth)
  const top = Math.max(rect.top, 0)
  const bottom = Math.min(rect.bottom, window.innerHeight)
  if (right <= left || bottom <= top) return { x: PAGE_WIDTH / 2, y: PAGE_HEIGHT / 2 }
  return clientToPage(view, (left + right) / 2, (top + bottom) / 2, rect, scale)
}

/**
 * 사진 붙이기: 숨은 파일 고르기 칸과, 도구 막대 버튼에 넘길 open·blocked. 서버에 사진 저장소가 없으면 enabled가 false.
 * 고른 사진은 줄여 올리고, 받은 id를 지금 보이는 자리 가운데에 붙인다.
 */
export function usePhotoPicker({ doc, noteId, author, origin, scale, view = VIEW_IDENTITY, onPlaced, show }: Options) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const count = usePhotos(doc).length

  useEffect(() => {
    let alive = true
    void photosEnabled().then((on) => alive && setEnabled(on))
    return () => {
      alive = false
    }
  }, [])

  const blocked = busy
    ? '사진을 올리는 중이에요'
    : count >= PHOTO_LIMIT
      ? `사진은 한 페이지에 ${PHOTO_LIMIT}장까지 붙일 수 있어요`
      : null

  async function onFile(file: File) {
    if (count >= PHOTO_LIMIT) return
    setBusy(true)
    try {
      const shrunk = await shrinkPhoto(file)
      const src = await uploadPhoto(noteId, shrunk.data, shrunk.mime)
      // 이미 붙은 사진과 꼭 겹치지 않게 장 수만큼 조금씩 비켜 붙인다
      const c = visibleCenter(scale, view)
      const shift = PHOTO_CASCADE * count
      c.x += shift
      c.y += shift
      addPhoto(
        doc,
        { id: newId(), src, author, createdAt: Date.now(), order: nextPhotoOrder(doc), ...placePhoto(shrunk.width, shrunk.height, c.x, c.y) },
        origin,
      )
      onPlaced?.()
    } catch (e) {
      if (e instanceof PhotoTooBig) show('사진을 충분히 줄이지 못했어요. 다른 사진으로 해 주세요.')
      else if (e instanceof ApiError) show(e.message)
      else show('사진을 열지 못했어요. JPEG·PNG·WebP 사진으로 해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  const input = enabled ? (
    <input
      ref={inputRef}
      type="file"
      accept={PHOTO_ACCEPT}
      hidden
      onChange={(e) => {
        const file = e.currentTarget.files?.[0]
        e.currentTarget.value = ''
        if (file) void onFile(file)
      }}
    />
  ) : null

  return { enabled, blocked, input, open: () => inputRef.current?.click() }
}
