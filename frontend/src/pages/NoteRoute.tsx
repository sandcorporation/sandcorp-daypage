import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { api, ApiError } from '../api/client'
import { useMe } from '../auth/me'
import { InvitePage } from './InvitePage'

type Preview = { name: string; online: number; isFull: boolean }

export function NoteRoute() {
  const { noteId = '' } = useParams()
  const { me } = useMe()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    if (!me || me.authenticated) return
    api<Preview>(`/api/notes/${noteId}/preview`)
      .then(setPreview)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) setMissing(true)
      })
  }, [me, noteId])

  if (!me) return null
  if (!me.authenticated) {
    if (missing) return <p style={{ padding: 24 }}>노트를 찾을 수 없어요.</p>
    if (!preview) return null
    return <InvitePage noteId={noteId} noteName={preview.name} online={preview.online} isFull={preview.isFull} />
  }
  return (
    <main className="grid-bg" style={{ padding: 24 }}>
      <p>노트 {noteId}</p>
    </main>
  )
}
