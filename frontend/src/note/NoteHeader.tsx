import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Logo } from '../components/Brand'
import { Countdown } from './Countdown'
import { NoteName } from './NoteName'
import { formatPageDate } from './time'
import type { NoteDetail, Peer } from './types'

type Props = {
  note: NoteDetail
  pageDate: string
  clockOffset: number
  peers: Peer[]
  onRename: (name: string) => Promise<void>
  onShare: () => void
  settings?: ReactNode
}

export function NoteHeader({ note, pageDate, clockOffset, peers, onRename, onShare, settings }: Props) {
  const shown = [{ nickname: note.me.nickname, color: note.me.color, isMe: true }, ...peers]
  return (
    <header className="note-header">
      <div className="note-header-left">
        <Link to="/" aria-label="Daypage 홈" className="icon-link">
          <Logo size={28} />
        </Link>
        <div className="note-title">
          <NoteName name={note.name} editable={note.isOwner} onRename={onRename} />
          <p className="note-sub">
            {formatPageDate(pageDate)} 장 · <Countdown nextMidnight={note.nextMidnight} clockOffset={clockOffset} />
          </p>
        </div>
      </div>

      <div className="note-header-right">
        <div className="avatars" aria-label={`함께 있는 사람 ${shown.length}명`}>
          {shown.slice(0, 6).map((p, i) => (
            <span
              key={`${p.nickname}-${i}`}
              className="avatar"
              title={p.isMe ? `${p.nickname} (나)` : p.nickname}
              style={{ background: p.color }}
            >
              {initial(p.nickname)}
            </span>
          ))}
          {shown.length > 6 && <span className="avatar avatar-more">+{shown.length - 6}</span>}
        </div>
        <span className="me-label">
          나: <b>{note.me.nickname}</b>
        </span>
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

/** 닉네임의 이름씨 첫 글자(졸린 수달 → 수). */
export function initial(nickname: string): string {
  const parts = nickname.split(' ')
  const noun = parts.length >= 2 ? parts[1] : parts[0]
  return noun.charAt(0)
}
