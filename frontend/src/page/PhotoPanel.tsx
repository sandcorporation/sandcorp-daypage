import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import * as Y from 'yjs'
import { usePhotos } from './PhotoLayer'
import { deletePhoto, movePhoto, PHOTO_LIMIT, photoUrl, type Photo } from './photos'

const EYE = 'M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z'
const EYE_OFF = 'M2 10s3-6 8-6c2 0 3.6.8 4.9 1.8M18 10s-3 6-8 6c-2 0-3.6-.8-4.9-1.8M3 17L17 3'
const TRASH = 'M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11'

function Icon({ d, children }: { d: string; children?: ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      {children}
    </svg>
  )
}

type Props = {
  doc: Y.Doc
  origin?: unknown
  /** 사진 주소 앞부분(photoBase) */
  base: string
  /** 내 화면에서만 숨긴 사진 */
  hidden: ReadonlySet<string>
  onToggleHidden: (id: string) => void
  /** 지면에서 강조할 사진(줄에 올리거나 포커스). null이면 강조를 푼다 */
  onHighlight?: (id: string | null) => void
  /** 사진 붙이기(파일 고르기) */
  onAdd: () => void
  /** 붙일 수 없을 때의 까닭(한도·올리는 중) */
  addBlocked: string | null
}

/** 사진 이름: 넣은 순서로 사진 1, 2, 3 */
function names(photos: Photo[]): Map<string, string> {
  const byAdded = [...photos].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  return new Map(byAdded.map((p, i) => [p.id, `사진 ${i + 1}`]))
}

/**
 * 사진 패널: 이 페이지에 붙은 사진을 레이어 패널처럼 한눈에 보고 붙이기·빼기·겹치는 순서·숨기기를 한다.
 * 줄을 누르면 그 사진이 있는 자리로 지면을 옮긴다.
 */
export function PhotoPanel({ doc, origin, base, hidden, onToggleHidden, onHighlight, onAdd, addBlocked }: Props) {
  // 패널이 닫히면 강조를 푼다
  const highlightRef = useRef(onHighlight)
  useEffect(() => {
    highlightRef.current = onHighlight
  })
  useEffect(() => () => highlightRef.current?.(null), [])
  const photos = usePhotos(doc)
  const label = names(photos)
  const [dragging, setDragging] = useState<string | null>(null)
  const dragRef = useRef<string | null>(null)
  const indexOf = (id: string) => photos.findIndex((p) => p.id === id)

  function onPickKey(e: KeyboardEvent, p: Photo) {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    e.preventDefault()
    // 목록은 위가 앞(높은 순서)이다
    movePhoto(doc, p.id, indexOf(p.id) + (e.key === 'ArrowUp' ? 1 : -1), origin)
  }

  function reveal(id: string) {
    document.querySelector(`img.photo[data-photo-id="${id}"]`)?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
  }

  return (
    <div className="layer-panel photo-panel">
      {photos.length === 0 ? (
        <p className="tool-pop-caption photo-empty">이 페이지에는 아직 사진이 없어요.</p>
      ) : (
        <ul className="layer-list">
          {[...photos].reverse().map((p) => {
            const name = label.get(p.id) ?? '사진'
            const isHidden = hidden.has(p.id)
            const rowClass = ['layer-row', isHidden && 'hidden-layer', dragging === p.id && 'dragging'].filter(Boolean).join(' ')
            return (
              <li
                key={p.id}
                className={rowClass}
                draggable
                onDragStart={(e) => {
                  dragRef.current = p.id
                  setDragging(p.id)
                  e.dataTransfer?.setData('text/plain', p.id)
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const from = dragRef.current
                  if (from && from !== p.id) movePhoto(doc, from, indexOf(p.id), origin)
                  dragRef.current = null
                  setDragging(null)
                }}
                onDragEnd={() => {
                  dragRef.current = null
                  setDragging(null)
                }}
                onPointerEnter={() => onHighlight?.(p.id)}
                onPointerLeave={() => onHighlight?.(null)}
                onFocus={() => onHighlight?.(p.id)}
                onBlur={() => onHighlight?.(null)}
              >
                <button
                  type="button"
                  className="layer-pick"
                  aria-label={`${name}, 붙인 사람 ${p.author}`}
                  title="눌러서 사진 자리로 · 끌거나 Alt+↑/↓로 순서 바꾸기"
                  onClick={() => reveal(p.id)}
                  onKeyDown={(e) => onPickKey(e, p)}
                >
                  <img className="photo-thumb" src={photoUrl(base, p.src)} alt="" draggable={false} />
                  <span className="layer-text">
                    <span className="layer-name">{name}</span>
                    <span className="layer-meta">
                      {p.author}
                      {isHidden && ' · 내 화면에서 숨김'}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="layer-icon-btn"
                  aria-label={`${name} 빼기`}
                  title="사진 빼기(되돌리기로 다시 살아나요)"
                  onClick={() => {
                    onHighlight?.(null)
                    deletePhoto(doc, p.id, origin)
                  }}
                >
                  <Icon d={TRASH} />
                </button>
                <button
                  type="button"
                  className="layer-icon-btn"
                  aria-label={`${name} ${isHidden ? '보이기' : '숨기기'}`}
                  title={isHidden ? '보이기' : '내 화면에서만 숨기기'}
                  aria-pressed={!isHidden}
                  onClick={() => onToggleHidden(p.id)}
                >
                  <Icon d={isHidden ? EYE_OFF : EYE}>
                    {!isHidden && <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.7" />}
                  </Icon>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="layer-foot">
        <button type="button" className="btn" disabled={!!addBlocked} title={addBlocked ?? undefined} onClick={onAdd}>
          + 사진 붙이기
        </button>
        <p className="tool-pop-caption">
          {photos.length}/{PHOTO_LIMIT}장 · 서버 비용 때문에 한 페이지에 {PHOTO_LIMIT}장까지, 작게 줄여서 붙여요.
        </p>
        <p className="tool-pop-caption">
          위에 있는 사진이 앞에 보여요. 사진은 종이 위, 그림과 글씨 아래에 깔려요. 옮기기·크기 바꾸기는 선택·이동 도구로 해요.
        </p>
        <p className="tool-pop-caption">눈은 내 화면에서만 숨기고, 빼기와 순서는 모두에게 적용돼요.</p>
      </div>
    </div>
  )
}
