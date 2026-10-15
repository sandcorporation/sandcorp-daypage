import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { api, ApiError } from '../api/client'
import { useMe } from '../auth/me'
import { NotePage } from '../note/NotePage'
import type { NoteDetail } from '../note/types'
import { ErrorScreen } from './ErrorScreen'
import { InvitePage } from './InvitePage'

type Preview = { name: string; online: number; isFull: boolean }

type State =
  | { kind: 'loading' }
  | { kind: 'invite'; preview: Preview; loggedIn: boolean }
  | { kind: 'note'; note: NoteDetail }
  | { kind: 'missing' }
  | { kind: 'error' }

export function NoteRoute() {
  const { noteId = '' } = useParams()
  const { me, error: meError } = useMe()
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    if (!me) return
    let cancelled = false
    const set = (s: State) => !cancelled && setState(s)

    async function load() {
      try {
        if (!me!.authenticated) {
          set({ kind: 'invite', preview: await api<Preview>(`/api/notes/${noteId}/preview`), loggedIn: false })
          return
        }
        set({ kind: 'note', note: await api<NoteDetail>(`/api/notes/${noteId}`) })
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return set({ kind: 'missing' })
        if (e instanceof ApiError && e.code === 'note_full') {
          const preview = await api<Preview>(`/api/notes/${noteId}/preview`).catch(() => null)
          return set({
            kind: 'invite',
            preview: preview ?? { name: '노트', online: 0, isFull: true },
            loggedIn: true,
          })
        }
        set({ kind: 'error' })
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [me, noteId])

  if (meError) return <ErrorScreen kind="server" />
  switch (state.kind) {
    case 'loading':
      return <div className="grid-bg" />
    case 'missing':
      return <ErrorScreen kind="missing" />
    case 'error':
      return <ErrorScreen kind="server" />
    case 'invite':
      return (
        <InvitePage
          noteId={noteId}
          noteName={state.preview.name}
          online={state.preview.online}
          isFull={state.preview.isFull}
          loggedIn={state.loggedIn}
        />
      )
    case 'note':
      return <NotePage key={state.note.id} initial={state.note} />
  }
}
