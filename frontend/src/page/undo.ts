import * as Y from 'yjs'
import { strokesMap, textboxesMap } from './doc'
import { layersMap } from './layers'
import { photosMap } from './photos'

/**
 * 내 작업만 되돌리는 UndoManager. `origin`을 붙인 변경만 추적하므로
 * 다른 사람이 동시에 그린 획은 되돌려지지 않는다.
 * 글 상자 안의 글자 입력은 편집기 자체의 되돌리기가 맡는다.
 */
export function createUndoManager(doc: Y.Doc, origin: unknown): Y.UndoManager {
  return new Y.UndoManager([strokesMap(doc), textboxesMap(doc), layersMap(doc), photosMap(doc)], {
    trackedOrigins: new Set([origin]),
    captureTimeout: 300,
  })
}

/** 이어지는 작업 한 묶음의 되돌리기 단계. 첫 작업 전에는 null. */
export type UndoStep = Y.UndoManager['undoStack'][number] | null

/**
 * change를 prev 단계에 잇는다(누른 간격과 상관없이 되돌리기 한 번). prev가 맨 위 단계가 아니면
 * (처음이거나, 그사이 되돌렸거나 다른 작업을 했으면) 새 단계로 시작한다. 뒤의 작업은 합치지 않는다.
 * 이어 갈 단계를 돌려준다.
 */
export function changeInStep(manager: Y.UndoManager, prev: UndoStep, change: () => void): UndoStep {
  if (prev && manager.undoStack.at(-1) === prev) manager.lastChange = Date.now()
  else manager.stopCapturing()
  change()
  manager.stopCapturing()
  return manager.undoStack.at(-1) ?? null
}
