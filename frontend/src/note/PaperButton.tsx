import { useRef, useState } from 'react'
import { ToolPopover } from '../components/ToolPopover'
import { ColorField, useColorField } from '../page/ColorField'
import {
  isCustomPaperColor,
  PAPER_COLORS,
  PAPER_PATTERNS,
  paperStyle,
  type Paper,
  type PaperColor,
  type PaperPreset,
} from '../page/paper'

type Props = {
  paper: Paper
  /** 바꾼 항목만 넘긴다 */
  onChange: (change: Partial<Paper>) => void
}

/** 종이 색 만들기에서 보여 줄 추천 색(글씨가 잘 보이는 옅은 색) */
const RECOMMENDED_PAPER_COLORS = ['#fdf2f8', '#eef6ff', '#ecfdf3', '#fffbe6', '#f3efff', '#f6f1ea']

/** 머리글의 '종이' 버튼과 종이 설정 창. 노트 전체 설정이라 참여자 누구나 바꾸고 모두의 화면이 같이 바뀐다. */
export function PaperButton({ paper, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const custom = isCustomPaperColor(paper.color) ? paper.color : null
  const close = () => {
    setOpen(false)
    setCreating(false)
  }
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
        onClick={() => (open ? close() : setOpen(true))}
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="4" y="2.5" width="12" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
          <path d="M7 7h6M7 10h6M7 13h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="btn-label">종이</span>
      </button>
      {open && (
        <ToolPopover title={creating ? '종이 색 만들기' : '종이'} anchor={ref} className="paper-pop" onClose={close}>
          {creating ? (
            <PaperColorMaker
              initial={custom ?? RECOMMENDED_PAPER_COLORS[0]}
              onCancel={() => setCreating(false)}
              onPick={(color) => {
                onChange({ color })
                setCreating(false)
              }}
            />
          ) : (
            <>
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
                {(Object.keys(PAPER_COLORS) as PaperPreset[]).map((c) => (
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
                <button
                  type="button"
                  role="radio"
                  aria-checked={custom !== null}
                  aria-label="직접 고른 색"
                  title={custom ? `직접 고른 색 ${custom} · 다시 고르기` : '색 직접 고르기'}
                  className={`paper-color paper-color-custom${custom ? '' : ' empty'}`}
                  style={custom ? { background: custom } : undefined}
                  onClick={() => setCreating(true)}
                >
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <p className="tool-pop-caption paper-note">참여한 모든 사람의 화면이 같이 바뀌어요. 지난 기록은 그날의 종이 그대로 남아요.</p>
            </>
          )}
        </ToolPopover>
      )}
    </div>
  )
}

/** 종이 색 만들기: 색판·색상 띠·색 코드·추천 색에서 고른다. 고른 색으로 그린 줄 노트 견본을 함께 보인다. */
function PaperColorMaker({ initial, onPick, onCancel }: { initial: string; onPick: (color: PaperColor) => void; onCancel: () => void }) {
  const field = useColorField(initial)
  const { color, setFromText } = field
  const picked = color && isCustomPaperColor(color) ? color : null
  return (
    <div className="color-picker">
      <ColorField
        field={field}
        sample={
          <span
            className="paper-sample"
            aria-hidden="true"
            style={picked ? paperStyle({ pattern: 'lined', margin: true, color: picked }, 0.45) : undefined}
          />
        }
      />
      <p className="tool-pop-caption">추천 색</p>
      <div className="color-chips">
        {RECOMMENDED_PAPER_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className="color-chip paper-chip"
            aria-label={`추천 종이 색 ${c}`}
            aria-pressed={c === color}
            style={{ background: c }}
            onClick={() => setFromText(c)}
          />
        ))}
      </div>
      <p className="tool-pop-caption">줄과 여백 선 색은 고른 색에 맞춰 정해져요. 글씨가 잘 보이게 옅은 색을 권해요.</p>
      <div className="paper-maker-actions">
        <button type="button" className="btn" onClick={onCancel}>
          취소
        </button>
        <button type="button" className="btn btn-primary" disabled={!picked} onClick={() => picked && onPick(picked)}>
          이 색으로
        </button>
      </div>
    </div>
  )
}
