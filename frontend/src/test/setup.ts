import '@testing-library/jest-dom/vitest'

// jsdom에는 ClipboardEvent가 없다. 편집기의 붙여넣기(view.pasteText)를 시험할 때 필요하다.
if (typeof globalThis.ClipboardEvent === 'undefined') {
  class ClipboardEventShim extends Event {
    clipboardData: DataTransfer | null = null
  }
  ;(globalThis as unknown as { ClipboardEvent: typeof ClipboardEventShim }).ClipboardEvent = ClipboardEventShim
}
