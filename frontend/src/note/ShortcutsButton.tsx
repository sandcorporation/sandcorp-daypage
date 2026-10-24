import { useEffect, useRef, useState } from 'react'
import { ToolPopover } from '../components/ToolPopover'
import {
  assign,
  comboLabel,
  comboOf,
  DEFAULT_KEYMAP,
  isDefault,
  isReserved,
  resetAction,
  setKeymap,
  SHORTCUT_GROUPS,
  useKeymap,
  type ShortcutAction,
} from '../page/shortcuts'

type Props = {
  open: boolean
  onOpen: (open: boolean) => void
}

const LABELS = Object.fromEntries(SHORTCUT_GROUPS.flatMap((g) => g.actions.map((a) => [a.id, a.label]))) as Record<
  ShortcutAction,
  string
>

/** 바꿀 수 없는 키(설명만) */
const FIXED: { keys: string; label: string }[] = [
  { keys: 'Esc', label: '하던 것 취소·집중 모드 나가기' },
  { keys: 'Space + 끌기', label: '화면 옮기기' },
  { keys: 'Shift + 끌기', label: '직선 긋기' },
  { keys: 'Enter', label: '곡선 끝내기' },
]

/**
 * 아래 왼쪽 '단축키' 버튼과 단축키 창. 단축키를 누르고 새 키를 누르면 바뀐다.
 * 다른 동작이 쓰던 키면 그쪽에서 빼서 옮기고 알린다. 이 브라우저에만 기억한다.
 */
export function ShortcutsButton({ open, onOpen }: Props) {
  const keymap = useKeymap()
  const ref = useRef<HTMLButtonElement>(null)
  const [recording, setRecording] = useState<ShortcutAction | null>(null)
  // 키를 옮겼거나 못 쓰는 키일 때 그 줄 바로 밑에 띄우는 알림(창이 길어 맨 위·아래에 두면 안 보인다)
  const [notice, setNotice] = useState<{ at: ShortcutAction; text: string } | null>(null)

  function close() {
    onOpen(false)
    setRecording(null)
    setNotice(null)
  }

  // 새 키 받기: 캡처 단계에서 먼저 잡아 노트의 단축키·창 닫기(Esc)가 돌지 않게 한다
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(null)
        return
      }
      const combo = comboOf(e)
      if (!combo) return // 보조키만 눌렀으면 다음 키를 기다린다
      if (isReserved(combo)) {
        setNotice({ at: recording, text: `${comboLabel(combo)}는 정해 둔 쓰임이 있어 쓸 수 없어요.` })
        return
      }
      const { keymap: next, taken } = assign(keymap, recording, combo)
      setKeymap(next)
      setNotice(
        taken ? { at: recording, text: `${comboLabel(combo)}를 ‘${LABELS[taken]}’에서 빼서 ‘${LABELS[recording]}’에 붙였어요.` } : null,
      )
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, keymap])

  const changed = SHORTCUT_GROUPS.some((g) => g.actions.some((a) => !isDefault(keymap, a.id)))

  return (
    <div className="tool-anchor keys-anchor">
      <button
        ref={ref}
        type="button"
        className="news-btn"
        aria-label="단축키"
        title={`단축키${keymap.help[0] ? ` (${comboLabel(keymap.help[0])})` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : onOpen(true))}
      >
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="2.5" y="5" width="15" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M5.5 8h1M9.5 8h1M13.5 8h1M7 12h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span className="news-btn-label">단축키</span>
      </button>
      {open && (
        <ToolPopover title="단축키" anchor={ref} align="bottom" className="keys-pop" onClose={close}>
          <p className="tool-pop-caption">바꿀 단축키를 누른 뒤 새 키를 누르세요. 글 상자에 쓰는 동안에는 단축키가 쉬어요.</p>
          {SHORTCUT_GROUPS.map((g) => (
            <section key={g.name} className="keys-group" aria-label={g.name}>
              <h3>{g.name}</h3>
              <ul>
                {g.actions.map((a) => (
                  <li key={a.id}>
                    <span className="keys-label">{a.label}</span>
                    {recording === a.id ? (
                      <span className="keys-recording">
                        <span role="status">새 키를 누르세요</span>
                        <button
                          type="button"
                          className="keys-small"
                          onClick={() => {
                            setKeymap(assign(keymap, a.id, null).keymap)
                            setRecording(null)
                          }}
                        >
                          끄기
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="keys-combo"
                        aria-label={`${a.label} 단축키 바꾸기: ${keymap[a.id].map((c) => comboLabel(c)).join(', ') || '없음'}`}
                        onClick={() => {
                          setNotice(null)
                          setRecording(a.id)
                        }}
                      >
                        {keymap[a.id].length ? (
                          keymap[a.id].map((c) => <kbd key={c}>{comboLabel(c)}</kbd>)
                        ) : (
                          <span className="keys-none">없음</span>
                        )}
                      </button>
                    )}
                    {!isDefault(keymap, a.id) && recording !== a.id && (
                      <button
                        type="button"
                        className="keys-small"
                        aria-label={`${a.label} 기본값으로`}
                        title={`기본값: ${DEFAULT_KEYMAP[a.id].map((c) => comboLabel(c)).join(', ')}`}
                        onClick={() => setKeymap(resetAction(keymap, a.id))}
                      >
                        기본값
                      </button>
                    )}
                    {notice?.at === a.id && (
                      <p className="keys-notice" role="status">
                        {notice.text}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <section className="keys-group" aria-label="정해진 키">
            <h3>정해진 키</h3>
            <ul>
              {FIXED.map((f) => (
                <li key={f.keys}>
                  <span className="keys-label">{f.label}</span>
                  <span className="keys-fixed">
                    <kbd>{f.keys}</kbd>
                  </span>
                </li>
              ))}
            </ul>
          </section>
          {changed && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setKeymap(DEFAULT_KEYMAP)
                setNotice(null)
                setRecording(null)
              }}
            >
              모두 기본값으로
            </button>
          )}
        </ToolPopover>
      )}
    </div>
  )
}
