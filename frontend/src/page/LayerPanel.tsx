import { useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import * as Y from 'yjs'
import { readStrokes } from './doc'
import { PAGE_HEIGHT, PAGE_WIDTH } from './geometry'
import {
  addLayer,
  layerPlan,
  layerStats,
  MAX_LAYER_NAME,
  MAX_LAYERS,
  moveLayer,
  observeLayers,
  readLayers,
  renameLayer,
  setLayerOpacity,
  type Layer,
  type LayerStats,
} from './layers'
import { paintLayers } from './render'

/** 레이어 목록과 레이어별 획 수·그린 사람. 문서가 바뀌면(다른 사람 포함) 다시 읽는다. */
export function useLayers(doc: Y.Doc): { layers: Layer[]; stats: Map<string, LayerStats>; version: number } {
  const [version, bump] = useReducer((v: number) => v + 1, 0)
  useEffect(() => observeLayers(doc, bump), [doc])
  return useMemo(() => {
    const layers = readLayers(doc)
    return { layers, stats: layerStats(doc, layers), version }
  }, [doc, version])
}

const THUMB_W = 40
const THUMB_H = Math.round((THUMB_W * PAGE_HEIGHT) / PAGE_WIDTH)

function Thumbnail({ doc, layer, version }: { doc: Y.Doc; layer: Layer; version: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, THUMB_W * 2, THUMB_H * 2)
    const plan = layerPlan(readStrokes(doc), readLayers(doc)).filter((p) => p.layer.id === layer.id)
    paintLayers(ctx, plan.map((p) => ({ ...p, layer: { ...p.layer, opacity: 1 } })), (THUMB_W * 2) / PAGE_WIDTH)
  }, [doc, layer.id, version])
  return <canvas ref={ref} className="layer-thumb" width={THUMB_W * 2} height={THUMB_H * 2} aria-hidden="true" />
}

const EYE = 'M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z'
const EYE_OFF = 'M2 10s3-6 8-6c2 0 3.6.8 4.9 1.8M18 10s-3 6-8 6c-2 0-3.6-.8-4.9-1.8M3 17L17 3'
const PENCIL = 'M4 16l1-4 8-8 3 3-8 8z'

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
  /** 지금 그리는 레이어 */
  current: string
  onCurrent: (id: string) => void
  /** 내 화면에서만 숨긴 레이어 */
  hidden: ReadonlySet<string>
  onToggleHidden: (id: string) => void
}

export function LayerPanel({ doc, origin, current, onCurrent, hidden, onToggleHidden }: Props) {
  const { layers, stats, version } = useLayers(doc)
  const full = layers.length >= MAX_LAYERS
  const [editing, setEditing] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  // 놓을 때는 렌더를 기다리지 않고 바로 읽는다
  const dragRef = useRef<string | null>(null)
  const active = layers.find((l) => l.id === current)

  const indexOf = (id: string) => layers.findIndex((l) => l.id === id)

  function onPickKey(e: KeyboardEvent, layer: Layer) {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    e.preventDefault()
    // 목록은 위가 앞(높은 순서)이다
    moveLayer(doc, layer.id, indexOf(layer.id) + (e.key === 'ArrowUp' ? 1 : -1), origin)
  }

  return (
    <div className="layer-panel">
      <ul className="layer-list">
        {[...layers].reverse().map((layer) => {
          const st = stats.get(layer.id) ?? { count: 0, authors: [] }
          const isActive = layer.id === current
          const isHidden = hidden.has(layer.id)
          const rowClass = ['layer-row', isActive && 'active', isHidden && 'hidden-layer', dragging === layer.id && 'dragging']
            .filter(Boolean)
            .join(' ')
          return (
            <li
              key={layer.id}
              className={rowClass}
              draggable={editing === null}
              onDragStart={(e) => {
                dragRef.current = layer.id
                setDragging(layer.id)
                e.dataTransfer?.setData('text/plain', layer.id)
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const from = dragRef.current
                if (from && from !== layer.id) moveLayer(doc, from, indexOf(layer.id), origin)
                dragRef.current = null
                setDragging(null)
              }}
              onDragEnd={() => {
                dragRef.current = null
                setDragging(null)
              }}
            >
              {editing === layer.id ? (
                <span className="layer-pick">
                  <Thumbnail doc={doc} layer={layer} version={version} />
                  <input
                    className="layer-rename"
                    aria-label="레이어 이름"
                    defaultValue={layer.name}
                    maxLength={MAX_LAYER_NAME}
                    autoFocus
                    onFocus={(e) => e.currentTarget.select()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        renameLayer(doc, layer.id, e.currentTarget.value, origin)
                        setEditing(null)
                      } else if (e.key === 'Escape') {
                        // 창까지 닫히지 않게 여기서 멈춘다
                        e.stopPropagation()
                        e.nativeEvent.stopImmediatePropagation()
                        setEditing(null)
                      }
                    }}
                    onBlur={(e) => {
                      renameLayer(doc, layer.id, e.currentTarget.value, origin)
                      setEditing(null)
                    }}
                  />
                </span>
              ) : (
                <button
                  type="button"
                  className="layer-pick"
                  aria-pressed={isActive}
                  aria-label={`${layer.name}${isActive ? ' (지금 그리는 레이어)' : ''}`}
                  title="끌거나 Alt+↑/↓로 순서 바꾸기"
                  onClick={() => onCurrent(layer.id)}
                  onKeyDown={(e) => onPickKey(e, layer)}
                >
                  <Thumbnail doc={doc} layer={layer} version={version} />
                  <span className="layer-text">
                    <span className="layer-name">{layer.name}</span>
                    <span className="layer-meta">
                      획 {st.count}개{st.authors.length > 0 && ` · ${st.authors.join(', ')}`}
                      {isHidden ? ' · 내 화면에서 숨김' : isActive ? ' · 지금 그리는 곳' : ''}
                    </span>
                  </span>
                </button>
              )}
              <button
                type="button"
                className="layer-icon-btn"
                aria-label={`${layer.name} 이름 바꾸기`}
                title="이름 바꾸기"
                onClick={() => setEditing(layer.id)}
              >
                <Icon d={PENCIL} />
              </button>
              <button
                type="button"
                className="layer-icon-btn"
                aria-label={`${layer.name} ${isHidden ? '보이기' : '숨기기'}`}
                title={isHidden ? '보이기' : '내 화면에서만 숨기기'}
                aria-pressed={!isHidden}
                onClick={() => onToggleHidden(layer.id)}
              >
                <Icon d={isHidden ? EYE_OFF : EYE}>
                  {!isHidden && <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.7" />}
                </Icon>
              </button>
            </li>
          )
        })}
      </ul>
      {active && (
        <label className="layer-opacity">
          불투명도
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            value={Math.round(active.opacity * 100)}
            onChange={(e) => setLayerOpacity(doc, active.id, Number(e.target.value) / 100, origin)}
          />
          <span aria-hidden="true">{Math.round(active.opacity * 100)}%</span>
        </label>
      )}
      <div className="layer-foot">
        <button
          type="button"
          className="btn"
          disabled={full}
          onClick={() => {
            const id = addLayer(doc, origin)
            if (id) onCurrent(id)
          }}
        >
          + 새 레이어
        </button>
        <p className="tool-pop-caption">
          {full && `레이어는 ${MAX_LAYERS}개까지예요. `}위에 있는 레이어가 앞에 보여요. 글 상자는 항상 맨 위예요.
        </p>
        <p className="tool-pop-caption">눈은 내 화면에서만 숨기고, 이름·순서·불투명도는 모두에게 적용돼요.</p>
      </div>
    </div>
  )
}
