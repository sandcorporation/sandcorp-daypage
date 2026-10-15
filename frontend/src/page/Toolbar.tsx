import { INKS, WIDTH_NAMES, type ToolKind, type WidthLevel } from './tools'

type Props = {
  tool: ToolKind
  ink: string
  widthLevel: WidthLevel
  canUndo: boolean
  canRedo: boolean
  onTool: (tool: ToolKind) => void
  onInk: (color: string) => void
  onWidth: (level: WidthLevel) => void
  onUndo: () => void
  onRedo: () => void
}

const TOOLS: { kind: ToolKind; label: string; icon: string }[] = [
  { kind: 'pen', label: '펜', icon: 'M4 18l1-4L15 4l3 3L8 17z' },
  { kind: 'highlighter', label: '형광펜', icon: 'M6 14l7-9 4 3-7 9H6zM4 19h14' },
  { kind: 'text', label: '글씨', icon: 'M5 5h12M11 5v13M8 18h6' },
  { kind: 'eraser', label: '지우개', icon: 'M8 18l-4-4 9-9 5 5-8 8zM8 18h10' },
  { kind: 'select', label: '선택·이동', icon: 'M5 4l12 6-5 1.5L10 17z' },
]

export function Toolbar(props: Props) {
  const { tool, ink, widthLevel, canUndo, canRedo, onTool, onInk, onWidth, onUndo, onRedo } = props
  return (
    <nav aria-label="도구" className="toolbar">
      {TOOLS.map((t) => (
        <button
          key={t.kind}
          type="button"
          className="tool-btn"
          aria-label={t.label}
          title={t.label}
          aria-pressed={tool === t.kind}
          onClick={() => onTool(t.kind)}
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
            <path d={t.icon} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        </button>
      ))}
      <div className="tool-sep" />
      {INKS.map((c) => (
        <button
          key={c.color}
          type="button"
          className="swatch-btn"
          aria-label={c.name}
          title={c.name}
          aria-pressed={ink === c.color}
          style={{ color: c.color }}
          onClick={() => onInk(c.color)}
        >
          <span className="swatch" style={{ background: c.color }} />
        </button>
      ))}
      <div className="tool-sep" />
      {WIDTH_NAMES.map((name, i) => (
        <button
          key={name}
          type="button"
          className="swatch-btn"
          aria-label={`굵기 ${name}`}
          title={`굵기 ${name}`}
          aria-pressed={widthLevel === i}
          style={{ color: 'var(--ink-soft)' }}
          onClick={() => onWidth(i as WidthLevel)}
        >
          <span className="width-dot" style={{ width: 6 + i * 6, height: 6 + i * 6 }} />
        </button>
      ))}
      <div className="tool-sep" />
      <button type="button" className="tool-btn" aria-label="되돌리기" title="되돌리기 (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M7 5L3 9l4 4M3 9h9a5 5 0 010 10h-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button type="button" className="tool-btn" aria-label="다시하기" title="다시하기 (Ctrl+Shift+Z)" disabled={!canRedo} onClick={onRedo}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M13 5l4 4-4 4M17 9H8a5 5 0 000 10h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </nav>
  )
}
