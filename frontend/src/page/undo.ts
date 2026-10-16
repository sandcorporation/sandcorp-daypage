import * as Y from 'yjs'
import { strokesMap, textboxesMap } from './doc'
import { layersMap } from './layers'

/**
 * 내 작업만 되돌리는 UndoManager. `origin`을 붙인 변경만 추적하므로
 * 다른 사람이 동시에 그린 획은 되돌려지지 않는다.
 * 글 상자 안의 글자 입력은 편집기 자체의 되돌리기가 맡는다.
 */
export function createUndoManager(doc: Y.Doc, origin: unknown): Y.UndoManager {
  return new Y.UndoManager([strokesMap(doc), textboxesMap(doc), layersMap(doc)], {
    trackedOrigins: new Set([origin]),
    captureTimeout: 300,
  })
}
