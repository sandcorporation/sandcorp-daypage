import { useParams } from 'react-router'
import { useMe } from '../auth/me'
import { InvitePage } from './InvitePage'

export function NoteRoute() {
  const { noteId = '' } = useParams()
  const { me } = useMe()

  if (!me) return null
  if (!me.authenticated) return <InvitePage noteId={noteId} noteName={null} online={0} isFull={false} />
  return (
    <main className="grid-bg" style={{ padding: 24 }}>
      <p>노트 {noteId}</p>
    </main>
  )
}
