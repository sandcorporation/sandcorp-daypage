import { useEffect, useMemo, useState } from 'react'
import * as Y from 'yjs'
import { createUndoManager } from './undo'

export function useUndo(doc: Y.Doc, origin: unknown) {
  const [manager, setManager] = useState<Y.UndoManager | null>(null)
  const [state, setState] = useState({ canUndo: false, canRedo: false })

  // 매니저는 이펙트 안에서 만들고 정리한다(StrictMode의 재실행에도 안전).
  useEffect(() => {
    const m = createUndoManager(doc, origin)
    const sync = () => setState({ canUndo: m.canUndo(), canRedo: m.canRedo() })
    m.on('stack-item-added', sync)
    m.on('stack-item-popped', sync)
    m.on('stack-cleared', sync)
    setManager(m)
    sync()
    return () => {
      m.destroy()
      setManager(null)
    }
  }, [doc, origin])

  return useMemo(
    () => ({
      ...state,
      undo: () => manager?.undo(),
      redo: () => manager?.redo(),
      stopCapturing: () => manager?.stopCapturing(),
    }),
    [state, manager],
  )
}

/** 입력 중인 요소(글 상자, 이름 입력 등)에서는 편집기의 단축키를 존중한다. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
}
