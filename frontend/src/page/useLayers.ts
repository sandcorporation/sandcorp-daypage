import { useEffect, useMemo, useReducer } from 'react'
import * as Y from 'yjs'
import { strokesMap } from './doc'
import { layersMap, layerStats, readLayers, type Layer, type LayerStats } from './layers'

/** 획이 바뀐 것은 이 간격(ms)에 한 번만 알린다. 1만 획 노트에서 획 하나마다 전부 세고 썸네일을 다시 그리지 않게. */
export const STROKE_CHANGE_THROTTLE_MS = 300

/** 레이어 목록만. 레이어가 바뀔 때만 다시 읽는다(획이 바뀌어도 다시 렌더하지 않는다). */
export function useLayerList(doc: Y.Doc): Layer[] {
  const [version, bump] = useReducer((v: number) => v + 1, 0)
  useEffect(() => {
    const layers = layersMap(doc)
    layers.observe(bump)
    return () => layers.unobserve(bump)
  }, [doc])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- version은 다시 읽을 때를 알린다
  return useMemo(() => readLayers(doc), [doc, version])
}

/**
 * 레이어 목록과 레이어별 획 수·그린 사람. 레이어가 바뀌면 바로, 획이 바뀌면(다른 사람 포함) 잠시 모아 다시 읽는다.
 */
export function useLayers(doc: Y.Doc): { layers: Layer[]; stats: Map<string, LayerStats>; version: number } {
  const [version, bump] = useReducer((v: number) => v + 1, 0)
  useEffect(() => {
    const layers = layersMap(doc)
    const strokes = strokesMap(doc)
    let timer: ReturnType<typeof setTimeout> | undefined
    const onStrokes = () => {
      timer ??= setTimeout(() => {
        timer = undefined
        bump()
      }, STROKE_CHANGE_THROTTLE_MS)
    }
    layers.observe(bump)
    strokes.observeDeep(onStrokes)
    return () => {
      layers.unobserve(bump)
      strokes.unobserveDeep(onStrokes)
      clearTimeout(timer)
    }
  }, [doc])
  return useMemo(() => {
    const layers = readLayers(doc)
    return { layers, stats: layerStats(doc, layers), version }
  }, [doc, version])
}
