import { useRef, useState } from 'react'
import { ToolPopover } from '../components/ToolPopover'
import { ColorPicker } from './ColorPicker'
import { INKS, PAINT_PALETTE } from './tools'

type Props = {
  ink: string
  onInk: (color: string) => void
  /** 노트 색(#rrggbb) */
  noteColors: string[]
  onAddColor: (color: string) => Promise<void>
  onRemoveColor?: (color: string) => void
  /** 최근 쓴 색(최신이 앞). 없거나 비면 보이지 않는다 */
  recentInks?: string[]
  /** 스포이트: 누르면 창이 닫히고 다음 한 번의 지면 터치가 그 자리 색을 집는다. 없으면 버튼을 보이지 않는다 */
  onEyedropper?: () => void
}

/** 지금 고른 잉크 이름: 기본 잉크면 그 이름, 아니면 '노트 색 #rrggbb' */
function inkName(ink: string): string {
  const c = ink.toLowerCase()
  return (
    INKS.find((i) => i.color.toLowerCase() === c)?.name ??
    PAINT_PALETTE.find((i) => i.color.toLowerCase() === c)?.name ??
    `노트 색 ${c}`
  )
}

/**
 * 도구 막대의 잉크 버튼. 지금 고른 색 하나만 보이고, 누르면 기본 잉크·노트 색을 고르는 창이 열린다.
 * 노트 색이 늘어도 도구 막대 길이는 그대로다. 창 안에서 새 색 만들기로 바꿀 수 있다.
 */
export function InkControl({ ink, onInk, noteColors, onAddColor, onRemoveColor, recentInks, onEyedropper }: Props) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const close = () => {
    setOpen(false)
    setCreating(false)
  }
  const pick = (color: string) => {
    onInk(color)
    close()
  }
  const swatch = (label: string, color: string) => (
    <button
      key={color}
      type="button"
      className="ink-option"
      aria-label={label}
      title={label}
      aria-pressed={ink.toLowerCase() === color.toLowerCase()}
      style={{ color }}
      onClick={() => pick(color)}
    >
      <span className="swatch" style={{ background: color }} />
    </button>
  )

  return (
    <div className="tool-anchor">
      <button
        ref={ref}
        type="button"
        className="swatch-btn ink-btn"
        aria-label={`잉크: ${inkName(ink)}`}
        title={`잉크: ${inkName(ink)}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{ color: ink }}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="swatch" style={{ background: ink }} />
        <span className="tool-corner" aria-hidden="true" />
      </button>
      {open && (
        <ToolPopover title={creating ? '새 색 만들기' : '잉크'} anchor={ref} onClose={close}>
          {creating ? (
            <>
              <button type="button" className="ink-back" aria-label="잉크 목록으로" onClick={() => setCreating(false)}>
                ← 잉크 목록
              </button>
              <ColorPicker
                noteColors={noteColors}
                onRemove={onRemoveColor}
                onAdd={async (c) => {
                  await onAddColor(c)
                  pick(c)
                }}
              />
            </>
          ) : (
            <>
              {recentInks && recentInks.length > 0 && (
                <>
                  <p className="tool-pop-caption">최근</p>
                  <div className="ink-grid">{recentInks.map((c) => swatch(`최근 ${inkName(c)}`, c))}</div>
                </>
              )}
              <p className="tool-pop-caption">기본 잉크</p>
              <div className="ink-grid">{INKS.map((i) => swatch(i.name, i.color))}</div>
              <p className="tool-pop-caption">채색 팔레트</p>
              <div className="ink-grid">{PAINT_PALETTE.map((i) => swatch(i.name, i.color))}</div>
              <p className="tool-pop-caption">이 노트의 색</p>
              {noteColors.length > 0 ? (
                <div className="ink-grid">{noteColors.map((c) => swatch(`노트 색 ${c}`, c))}</div>
              ) : (
                <p className="tool-pop-caption">아직 없어요. 새 색을 만들면 함께 쓰는 모두가 쓸 수 있어요.</p>
              )}
              <div className="ink-actions">
                <button type="button" className="btn" onClick={() => setCreating(true)}>
                  + 새 색 만들기
                </button>
                {onEyedropper && (
                  <button
                    type="button"
                    className="btn"
                    aria-label="스포이트: 화면의 색 집기"
                    title="누른 뒤 지면을 한 번 누르면 그 자리 색을 잉크로 삼아요"
                    onClick={() => {
                      close()
                      onEyedropper()
                    }}
                  >
                    스포이트
                  </button>
                )}
              </div>
            </>
          )}
        </ToolPopover>
      )}
    </div>
  )
}
