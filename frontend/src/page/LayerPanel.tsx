import { useEffect, useMemo, useReducer, useRef } from 'react'
import * as Y from 'yjs'
import { readStrokes } from './doc'
import { PAGE_HEIGHT, PAGE_WIDTH } from './geometry'
import { addLayer, layerPlan, layerStats, MAX_LAYERS, observeLayers, readLayers, type Layer, type LayerStats } from './layers'
import { paintLayers } from './render'

/** 레이어 목록과 레이어별 획 수·그린 사람. 문서가 바뀌면(다른 사람 포함) 다시 읽는다. */
export function useLayers(doc: Y.Doc): { layers: Layer[]; stats: Map<string, LayerStats> } {
  const [version, bump] = useReducer((v: number) => v + 1, 0)
  useEffect(() => observeLayers(doc, bump), [doc])
  return useMemo(() => {
    const layers = readLayers(doc)
    return { layers, stats: layerStats(doc, layers) }
    // version: 문서가 바뀌었다는 신호
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

export function LayerPanel({ doc, origin, current, onCurrent }: Props) {
  const { layers, stats } = useLayers(doc)
  // 미리보기는 획이 바뀔 때 다시 그린다
  const version = Array.from(stats.values()).reduce((n, s) => n + s.count, 0)
  const full = layers.length >= MAX_LAYERS

  return (
    <div className="layer-panel">
      <ul className="layer-list">
        {[...layers].reverse().map((layer) => {
          const st = stats.get(layer.id) ?? { count: 0, authors: [] }
          const active = layer.id === current
          return (
            <li key={layer.id} className={`layer-row${active ? ' active' : ''}`}>
              <button
                type="button"
                className="layer-pick"
                aria-pressed={active}
                aria-label={`${layer.name}${active ? ' (지금 그리는 레이어)' : ''}`}
                onClick={() => onCurrent(layer.id)}
              >
                <Thumbnail doc={doc} layer={layer} version={version} />
                <span className="layer-text">
                  <span className="layer-name">{layer.name}</span>
                  <span className="layer-meta">
                    획 {st.count}개{st.authors.length > 0 && ` · ${st.authors.join(', ')}`}
                    {active && ' · 지금 그리는 곳'}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
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
          {full ? `레이어는 ${MAX_LAYERS}개까지예요.` : '위에 있는 레이어가 앞에 보여요. 글 상자는 항상 맨 위예요.'}
        </p>
      </div>
    </div>
  )
}
