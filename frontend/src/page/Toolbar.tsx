import { useRef, useState } from 'react'
import { ToolPopover } from '../components/ToolPopover'
import { BrushPicker } from './BrushPicker'
import { FontPicker } from './FontPicker'
import { BRUSHES, INKS, WIDTH_NAMES, type Brush, type ToolKind, type WidthLevel } from './tools'

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
  font: string
  onFont: (id: string) => void
  /** 글씨 도구이거나 글 상자를 편집 중일 때 글꼴 선택을 보인다 */
  showFont: boolean
  brush: Brush
  onBrush: (brush: Brush) => void
  pressure: boolean
  onPressure: (on: boolean) => void
}

const TOOLS: { kind: ToolKind; label: string; icon: string }[] = [
  { kind: 'pen', label: '펜', icon: 'M4 18l1-4L15 4l3 3L8 17z' },
  { kind: 'highlighter', label: '형광펜', icon: 'M6 14l7-9 4 3-7 9H6zM4 19h14' },
  { kind: 'text', label: '글씨', icon: 'M5 5h12M11 5v13M8 18h6' },
  { kind: 'eraser', label: '지우개', icon: 'M8 18l-4-4 9-9 5 5-8 8zM8 18h10' },
  { kind: 'select', label: '선택·이동', icon: 'M5 4l12 6-5 1.5L10 17z' },
]

export function Toolbar(props: Props) {
  const { tool, ink, widthLevel, canUndo, canRedo, onTool, onInk, onWidth, onUndo, onRedo, font, onFont, showFont } = props
  const { brush, onBrush, pressure, onPressure } = props
  const [brushOpen, setBrushOpen] = useState(false)
  const penRef = useRef<HTMLButtonElement>(null)
  const brushName = BRUSHES.find((b) => b.id === brush)?.name ?? BRUSHES[0].name
  return (
    <nav aria-label="도구" className="toolbar">
      {TOOLS.map((t) =>
        t.kind === 'pen' ? (
          <div key={t.kind} className="tool-anchor">
            <button
              ref={penRef}
              type="button"
              className="tool-btn"
              aria-label={`펜 (${brushName})`}
              title={`펜 (${brushName}) · 다시 누르면 펜 종류`}
              aria-pressed={tool === 'pen'}
              aria-haspopup="dialog"
              aria-expanded={brushOpen}
              onClick={() => (tool === 'pen' ? setBrushOpen((v) => !v) : onTool('pen'))}
            >
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                <path d={t.icon} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
              <span className="tool-corner" aria-hidden="true" />
            </button>
            {brushOpen && (
              <ToolPopover title="펜 종류" anchor={penRef} onClose={() => setBrushOpen(false)}>
                <BrushPicker
                  brush={brush}
                  onBrush={(b) => {
                    onBrush(b)
                    setBrushOpen(false)
                  }}
                >
                  <label className="pressure-toggle">
                    필압 따라 굵기 바꾸기
                    <input type="checkbox" checked={pressure} onChange={(e) => onPressure(e.target.checked)} />
                  </label>
                  <p className="tool-pop-caption">펜슬·태블릿은 누르는 세기로, 마우스·손가락은 쓰는 속도로 굵기가 바뀌어요.</p>
                </BrushPicker>
              </ToolPopover>
            )}
          </div>
        ) : (
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
        ),
      )}
      {showFont && <FontPicker font={font} onFont={onFont} />}
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
