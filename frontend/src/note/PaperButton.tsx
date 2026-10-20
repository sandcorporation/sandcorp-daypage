import { useRef, useState } from 'react'
import { ToolPopover } from '../components/ToolPopover'
import { PAPER_COLORS, PAPER_PATTERNS, paperStyle, type Paper, type PaperColor } from '../page/paper'

type Props = {
  paper: Paper
  /** 바꾼 항목만 넘긴다 */
  onChange: (change: Partial<Paper>) => void
}

/** 머리글의 '종이' 버튼과 종이 설정 창. 노트 전체 설정이라 참여자 누구나 바꾸고 모두의 화면이 같이 바뀐다. */
export function PaperButton({ paper, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <div className="tool-anchor">
      <button
        ref={ref}
        type="button"
        className="btn paper-btn"
        aria-label="종이"
        title="종이"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="4" y="2.5" width="12" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
          <path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="btn-label">종이</span>
      </button>
      {open && (
        <ToolPopover title="종이" anchor={ref} className="paper-pop" onClose={() => setOpen(false)}>
          <p className="paper-section">모양</p>
          <div className="paper-patterns" role="radiogroup" aria-label="종이 모양">
            {PAPER_PATTERNS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={paper.pattern === p.id}
                aria-label={p.name}
                className="paper-pattern"
                onClick={() => onChange({ pattern: p.id })}
              >
                <span className="paper-thumb" style={paperStyle({ pattern: p.id, margin: false, color: paper.color }, 0.45)} />
                {p.name}
              </button>
            ))}
          </div>
          <label className="paper-margin">
            <span>
              왼쪽 여백 선<span className="paper-hint">빨간 세로줄</span>
            </span>
            <input type="checkbox" checked={paper.margin} onChange={(e) => onChange({ margin: e.target.checked })} />
          </label>
          <p className="paper-section">종이 색</p>
          <div className="paper-colors" role="radiogroup" aria-label="종이 색">
            {(Object.keys(PAPER_COLORS) as PaperColor[]).map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={paper.color === c}
                aria-label={PAPER_COLORS[c].name}
                title={PAPER_COLORS[c].name}
                className="paper-color"
                style={{ background: PAPER_COLORS[c].ground }}
                onClick={() => onChange({ color: c })}
              />
            ))}
          </div>
          <p className="tool-pop-caption paper-note">참여한 모든 사람의 화면이 같이 바뀌어요. 지난 기록은 그날의 종이 그대로 남아요.</p>
        </ToolPopover>
      )}
    </div>
  )
}
