// DOM 매처(toBeInTheDocument 등)는 jsdom 환경에서만 필요하다. node 환경(순수 로직 테스트)에서는 건너뛰어 시작을 빠르게 한다.
if (typeof document !== 'undefined') await import('@testing-library/jest-dom/vitest')

// jsdom에는 ClipboardEvent가 없다. 편집기의 붙여넣기(view.pasteText)를 시험할 때 필요하다.
if (typeof globalThis.ClipboardEvent === 'undefined' && typeof Event !== 'undefined') {
  class ClipboardEventShim extends Event {
    clipboardData: DataTransfer | null = null
  }
  ;(globalThis as unknown as { ClipboardEvent: typeof ClipboardEventShim }).ClipboardEvent = ClipboardEventShim
}
