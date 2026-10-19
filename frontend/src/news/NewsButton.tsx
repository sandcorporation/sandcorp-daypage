import { useRef, useState } from 'react'
import { ToolPopover } from '../components/ToolPopover'
import { KIND_LABEL, NEWS, loadSeen, markSeen, unreadIds, type NewsEntry } from './news'

type Props = {
  entries?: NewsEntry[]
}

/**
 * 아래 왼쪽 연결 표시 옆의 '새 소식' 버튼. 안 본 소식이 있으면 점을 달고, 누르면 업데이트 내역을 연다
 * (데스크톱은 팝오버, 휴대폰은 아래에서 올라오는 시트). 연 순간 맨 위 소식까지 본 것으로 둔다.
 */
export function NewsButton({ entries = NEWS }: Props) {
  const [open, setOpen] = useState(false)
  // 연 뒤에도 이번에 처음 본 소식에는 표시를 남겨 둔다(닫을 때까지)
  const [unread, setUnread] = useState(() => new Set(unreadIds(entries, loadSeen())))
  const [shownUnread, setShownUnread] = useState<Set<string>>(new Set())
  const ref = useRef<HTMLButtonElement>(null)
  const hasUnread = unread.size > 0

  function toggle() {
    if (open) return setOpen(false)
    setShownUnread(unread)
    setUnread(new Set())
    markSeen(entries)
    setOpen(true)
  }

  return (
    <div className="tool-anchor news-anchor">
      <button
        ref={ref}
        type="button"
        className="news-btn"
        aria-label={hasUnread ? '새 소식 (읽지 않은 소식 있음)' : '새 소식'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M10 2.5l1.8 4.7 4.7 1.8-4.7 1.8L10 15.5l-1.8-4.7L3.5 9l4.7-1.8z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
        <span className="news-btn-label">새 소식</span>
        {hasUnread && <span className="news-dot" aria-hidden="true" />}
      </button>
      {open && (
        <ToolPopover title="새 소식" anchor={ref} align="bottom" className="news-pop" onClose={() => setOpen(false)}>
          <div className="news-list">
            {entries.map((entry) => (
              <article key={entry.id} className="news-entry">
                <h3>
                  {entry.date}
                  {shownUnread.has(entry.id) && <span className="news-fresh">처음 보는 소식</span>}
                </h3>
                <ul>
                  {entry.items.map((item, i) => (
                    <li key={i}>
                      <span className={`news-kind news-kind-${item.kind}`}>{KIND_LABEL[item.kind]}</span>
                      <span>
                        {item.title && <b>{item.title}</b>}
                        {item.title && ' — '}
                        {item.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </ToolPopover>
      )}
    </div>
  )
}
