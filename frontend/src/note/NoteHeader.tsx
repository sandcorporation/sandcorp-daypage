import { useLayoutEffect, useRef, type CSSProperties, type ReactNode, type Ref } from 'react'
import { Link } from 'react-router'
import { Logo } from '../components/Brand'
import { useIsPhone, useMediaQuery } from '../components/useIsPhone'
import { Countdown } from './Countdown'
import { NoteName } from './NoteName'
import { PeopleButton } from './PeopleButton'
import { formatPageDate, seqSuffix } from './time'
import type { NoteDetail, OpenPage, Peer } from './types'

type Props = {
  note: NoteDetail
  page: OpenPage
  clockOffset: number
  peers: Peer[]
  onRename: (name: string) => Promise<void>
  onShare: () => void
  settings?: ReactNode
  titleRef?: Ref<HTMLHeadingElement>
}

export function NoteHeader({ note, page, clockOffset, peers, onRename, onShare, settings, titleRef }: Props) {
  const shown = [{ nickname: note.me.nickname, color: note.me.color, isMe: true }, ...peers]
  const isPhone = useIsPhone()
  // 좁은 폭에서는 얼굴을 줄이고 내 닉네임을 남은 시간 옆에 둔다
  const isNarrow = useMediaQuery('(max-width: 1023px)') || isPhone
  const isMedium = useMediaQuery('(max-width: 1279px)')
  const faces = isNarrow ? 2 : isMedium ? 3 : 6
  const me = (
    <span className="me-label">
      나: <b>{note.me.nickname}</b>
    </span>
  )
  const ref = useRef<HTMLElement>(null)
  // 머리글 높이를 --note-header-h로 알린다. 툴바가 이 아래에 붙는다(휴대폰에서는 머리글이 두 줄로 높아진다).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    const update = () => root.style.setProperty('--note-header-h', `${el.offsetHeight}px`)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--note-header-h')
    }
  }, [])
  return (
    <header ref={ref} className="note-header">
      <div className="note-header-left">
        <Link to="/" aria-label="Daypage 홈" className="icon-link">
          <Logo size={28} />
        </Link>
        <div className="note-title">
          <h1 ref={titleRef} className="note-heading" tabIndex={-1} aria-label={note.name}>
            <NoteName name={note.name} editable={note.isOwner} onRename={onRename} />
          </h1>
          <p className="note-sub">
            <span className="note-sub-date">
              {formatPageDate(page.date)}
              {seqSuffix(page.seq)} 페이지 ·{' '}
            </span>
            <Countdown until={page.dueAt} clockOffset={clockOffset} />
            {isNarrow && me}
          </p>
        </div>
      </div>

      <div className="note-header-right">
        {/* 아바타 자리는 가장 많이 보일 때(얼굴 + 「+n」)만큼 늘 잡아 둔다. 접속자 수로 머리글 줄이 바뀌면 그 아래 지면이 긋는 중에 밀린다 */}
        <div
          className="avatars"
          role="group"
          aria-label={`함께 있는 사람 ${shown.length}명`}
          style={{ '--avatar-slots': faces + 1 } as CSSProperties}
        >
          <PeopleButton people={shown} faces={faces} />
        </div>
        {!isNarrow && me}
        {settings}
        <Link to={`/note/${note.id}/history`} className="btn" aria-label="기록">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.8" />
            <path d="M10 6v4l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span className="btn-label">기록</span>
        </Link>
        <button type="button" className="btn btn-primary" onClick={onShare} aria-label="링크 공유">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M8 12l4-4M7 9l-2 2a3 3 0 004 4l2-2M13 11l2-2a3 3 0 00-4-4l-2 2"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
          <span className="btn-label">링크 공유</span>
        </button>
      </div>
    </header>
  )
}
