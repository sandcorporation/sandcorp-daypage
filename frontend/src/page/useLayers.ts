import { useEffect, useMemo, useReducer } from 'react'
import * as Y from 'yjs'
import { layerStats, observeLayers, readLayers, type Layer, type LayerStats } from './layers'

/** 레이어 목록과 레이어별 획 수·그린 사람. 문서가 바뀌면(다른 사람 포함) 다시 읽는다. */
export function useLayers(doc: Y.Doc): { layers: Layer[]; stats: Map<string, LayerStats>; version: number } {
  const [version, bump] = useReducer((v: number) => v + 1, 0)
  useEffect(() => observeLayers(doc, bump), [doc])
  return useMemo(() => {
    const layers = readLayers(doc)
    return { layers, stats: layerStats(doc, layers), version }
  }, [doc, version])
}
