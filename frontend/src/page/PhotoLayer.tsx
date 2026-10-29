import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import * as Y from 'yjs'
import { PAGE_HEIGHT, PAGE_WIDTH } from './geometry'
import { usePageViewTransform } from './viewContext'
import { pageDeltaOf } from './viewTransform'
import { deletePhoto, photosMap, PHOTO_MIN_SIDE, photoUrl, readPhotos, updatePhoto, type Photo } from './photos'
import { PAN_START_EVENT } from './touchPan'

/** 장의 사진 목록(보이는 것만). 사진 맵이 바뀔 때마다 다시 읽는다. */
export function usePhotos(doc: Y.Doc): Photo[] {
  const [photos, setPhotos] = useState<Photo[]>(() => readPhotos(doc))
  useEffect(() => {
    const map = photosMap(doc)
    const read = () => setPhotos(readPhotos(doc))
    read()
    map.observeDeep(read)
    return () => map.unobserveDeep(read)
  }, [doc])
  return photos
}

type ImagesProps = {
  doc: Y.Doc
  /** 사진 주소 앞부분(photoBase) */
  base: string
  preview?: PhotoDrag | null
  /** 내 화면에서만 숨긴 사진 */
  hidden?: ReadonlySet<string>
  /** 사진 패널에서 올려 둔 사진: 테두리로 표시 */
  highlight?: string | null
}

/** 종이 위·채색 아래에 깔리는 사진들(PageView의 underlay). 포인터는 받지 않는다. */
export function PhotoImages({ doc, base, preview, hidden, highlight }: ImagesProps) {
  const photos = usePhotos(doc)
  return (
    <>
      {photos.filter((p) => !hidden?.has(p.id)).map((p) => {
        const r = preview?.id === p.id ? preview : p
        return (
          <img
            key={p.id}
            data-photo-id={p.id}
            className={`photo${highlight === p.id ? ' is-highlighted' : ''}`}
            src={photoUrl(base, p.src)}
            alt=""
            draggable={false}
            style={{ left: r.x, top: r.y, width: r.width, height: r.height }}
          />
        )
      })}
    </>
  )
}

export type PhotoDrag = { id: string; x: number; y: number; width: number; height: number }

type ControlsProps = {
  doc: Y.Doc
  scale: number
  origin: unknown
  /** 끄는 동안의 자리(놓을 때 한 번만 문서에 쓴다) */
  onPreview: (drag: PhotoDrag | null) => void
  /** 내 화면에서만 숨긴 사진(손잡이도 숨긴다) */
  hidden?: ReadonlySet<string>
}

/** 끄는 결과: 옮기면 장 안에, 키우면 가로세로 비율을 지키며 장 안에 */
export function dragResult(kind: 'move' | 'resize', p: Photo, dx: number, dy: number): PhotoDrag {
  if (kind === 'move') {
    return {
      id: p.id,
      x: Math.round(Math.min(Math.max(0, p.x + dx), PAGE_WIDTH - p.width)),
      y: Math.round(Math.min(Math.max(0, p.y + dy), PAGE_HEIGHT - p.height)),
      width: p.width,
      height: p.height,
    }
  }
  const ratio = p.height / p.width
  const maxW = Math.min(PAGE_WIDTH - p.x, (PAGE_HEIGHT - p.y) / ratio)
  const minW = PHOTO_MIN_SIDE / Math.min(1, ratio)
  // 손잡이를 더 많이 끈 쪽(가로 또는 세로를 폭으로 바꾼 값)을 따른다
  const grow = Math.abs(dx) >= Math.abs(dy / ratio) ? dx : dy / ratio
  const width = Math.round(Math.min(maxW, Math.max(minW, p.width + grow)))
  return { id: p.id, x: p.x, y: p.y, width, height: Math.round(width * ratio) }
}

/**
 * 선택·이동 도구일 때 사진마다 옮기기 손잡이·크기 손잡이·빼기 단추를 보인다(장 맨 위 레이어).
 * 사진 몸통은 누르지 않아 사진 위에 쓴 획을 그대로 고를 수 있다.
 */
export function PhotoControls({ doc, scale, origin, onPreview, hidden }: ControlsProps) {
  const photos = usePhotos(doc)
  return (
    <>
      {photos.filter((p) => !hidden?.has(p.id)).map((p) => (
        <PhotoControl key={p.id} photo={p} doc={doc} scale={scale} origin={origin} onPreview={onPreview} />
      ))}
    </>
  )
}

function PhotoControl({ photo, doc, scale, origin, onPreview }: ControlsProps & { photo: Photo }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<PhotoDrag | null>(null)
  const start = useRef<{
    kind: 'move' | 'resize'
    client: { x: number; y: number }
    rect: { left: number; top: number }
    last: { x: number; y: number }
    target: HTMLElement
    pointerId: number
  } | null>(null)
  const r = drag ?? photo
  const ui = useMemo(() => ({ transform: `scale(${1 / scale})` }), [scale])

  const view = usePageViewTransform()

  function frameRect() {
    const box = rootRef.current?.closest('.page-frame')?.getBoundingClientRect()
    return { left: box?.left ?? 0, top: box?.top ?? 0 }
  }

  function apply(): PhotoDrag | null {
    const s = start.current
    if (!s) return null
    const { dx, dy } = pageDeltaOf(view, s.client, s.rect, s.last, frameRect(), scale)
    const next = dragResult(s.kind, photo, dx, dy)
    setDrag(next)
    onPreview(next)
    return next
  }

  // 끄는 중 스크롤해도 따라가고, 손가락 스크롤·핀치가 시작되면 거둔다(TextLayer와 같다).
  useEffect(() => {
    if (!drag) return
    const onScroll = () => void apply()
    const frame = rootRef.current?.closest('.page-frame')
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    frame?.addEventListener(PAN_START_EVENT, cancel)
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true })
      frame?.removeEventListener(PAN_START_EVENT, cancel)
    }
  })

  function begin(kind: 'move' | 'resize', e: ReactPointerEvent<HTMLElement>) {
    e.preventDefault()
    if (e.pointerType !== 'touch') e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const client = { x: e.clientX, y: e.clientY }
    start.current = { kind, client, rect: frameRect(), last: client, target: e.currentTarget, pointerId: e.pointerId }
    apply()
  }

  function move(e: ReactPointerEvent<HTMLElement>) {
    if (!start.current) return
    start.current.last = { x: e.clientX, y: e.clientY }
    apply()
  }

  function end(e: ReactPointerEvent<HTMLElement>) {
    if (!start.current) return
    start.current.last = { x: e.clientX, y: e.clientY }
    const next = apply()
    start.current = null
    setDrag(null)
    onPreview(null)
    if (!next) return
    const { x, y, width, height } = next
    if (x !== photo.x || y !== photo.y || width !== photo.width || height !== photo.height) {
      updatePhoto(doc, photo.id, { x, y, width, height }, origin)
    }
  }

  function cancel() {
    const s = start.current
    start.current = null
    setDrag(null)
    onPreview(null)
    try {
      s?.target.releasePointerCapture(s.pointerId)
    } catch {
      // 이미 놓였으면 그만
    }
  }

  return (
    <div
      ref={rootRef}
      className={`photo-frame${drag ? ' is-dragging' : ''}`}
      data-photo-id={photo.id}
      style={{ left: r.x, top: r.y, width: r.width, height: r.height, borderWidth: 2 / scale }}
    >
      <button
        type="button"
        data-page-ui=""
        className="photo-grip"
        style={ui}
        aria-label="사진 옮기기"
        title="끌어서 옮기기"
        onPointerDown={(e) => begin('move', e)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={cancel}
      >
        <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
          {[3, 8, 13].flatMap((cy) => [2, 8].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.6" fill="currentColor" />))}
        </svg>
      </button>
      <button
        type="button"
        data-page-ui=""
        className="photo-remove"
        style={ui}
        aria-label="사진 빼기"
        title="사진 빼기"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => deletePhoto(doc, photo.id, origin)}
      >
        ×
      </button>
      <span
        data-page-ui=""
        className="photo-handle"
        style={ui}
        role="separator"
        aria-label="사진 크기 조절"
        onPointerDown={(e) => begin('resize', e)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={cancel}
      />
    </div>
  )
}
