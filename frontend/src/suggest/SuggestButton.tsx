import { useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import { ToolPopover } from '../components/ToolPopover'

const MAX = 1000

type Props = {
  /** 건의를 보낸 노트(운영자만 본다) */
  noteId?: string
}

/** 아래 왼쪽 '건의' 버튼. 바라는 기능이나 불편한 점을 글로 남긴다. */
export function SuggestButton({ noteId }: Props) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLButtonElement>(null)

  function close() {
    setOpen(false)
    // 보낸 뒤 닫으면 다음엔 빈 칸으로, 보내기 전에 닫으면 쓰던 글을 남겨 둔다
    if (state === 'sent') {
      setText('')
      setState('idle')
    }
  }

  async function send() {
    if (!text.trim() || state === 'sending') return
    setState('sending')
    setError(null)
    try {
      await api('/api/suggestions', { method: 'POST', body: JSON.stringify({ text: text.trim(), noteId }) })
      setState('sent')
    } catch (e) {
      setState('idle')
      setError(e instanceof ApiError ? e.message : '보내지 못했어요. 잠시 뒤 다시 보내 주세요.')
    }
  }

  return (
    <div className="tool-anchor">
      <button
        ref={ref}
        type="button"
        className="news-btn"
        aria-label="기능 건의"
        title="기능 건의"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M4 4h12v9H9l-4 3v-3H4z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
        <span className="news-btn-label">건의</span>
      </button>
      {open && (
        <ToolPopover title="기능 건의" anchor={ref} align="bottom" className="suggest-pop" onClose={close}>
          {state === 'sent' ? (
            <div className="suggest-done" role="status">
              <p>보내 주셔서 고마워요!</p>
              <p className="tool-pop-caption">하나하나 읽어 보고, 반영되면 ‘새 소식’에서 알려 드릴게요.</p>
              <button type="button" className="btn" onClick={close}>
                닫기
              </button>
            </div>
          ) : (
            <form
              className="suggest-form"
              onSubmit={(e) => {
                e.preventDefault()
                void send()
              }}
            >
              <p className="tool-pop-caption">있었으면 하는 기능이나 불편했던 점을 적어 주세요.</p>
              <textarea
                aria-label="건의 내용"
                value={text}
                maxLength={MAX}
                rows={5}
                placeholder="예: 지우개 크기를 고를 수 있으면 좋겠어요"
                onChange={(e) => setText(e.target.value)}
              />
              <div className="suggest-foot">
                <span className="suggest-count">
                  {text.length}/{MAX}
                </span>
                <button type="submit" className="btn btn-primary" disabled={!text.trim() || state === 'sending'}>
                  {state === 'sending' ? '보내는 중…' : '보내기'}
                </button>
              </div>
              {error && (
                <p className="suggest-error" role="alert">
                  {error}
                </p>
              )}
            </form>
          )}
        </ToolPopover>
      )}
    </div>
  )
}
