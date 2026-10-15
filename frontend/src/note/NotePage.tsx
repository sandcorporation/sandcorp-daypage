import { useCallback, useState } from 'react'
import { api } from '../api/client'
import { useToast } from '../components/Toast'
import { NoteHeader } from './NoteHeader'
import type { NoteDetail } from './types'
import './note.css'

type Props = { initial: NoteDetail }

export function NotePage({ initial }: Props) {
  const [note, setNote] = useState(initial)
  const [clockOffset] = useState(() => new Date(initial.serverNow).getTime() - Date.now())
  const { toast, show } = useToast()

  const rename = useCallback(
    async (name: string) => {
      const res = await api<{ name: string }>(`/api/notes/${note.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      })
      setNote((n) => ({ ...n, name: res.name }))
    },
    [note.id],
  )

  const share = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(note.url)
      show('링크 복사됨')
    } catch {
      window.prompt('이 링크를 복사해 건네주세요', note.url)
    }
  }, [note.url, show])

  return (
    <div className="note-screen">
      <NoteHeader
        note={note}
        pageDate={note.today}
        clockOffset={clockOffset}
        peers={[]}
        onRename={rename}
        onShare={share}
      />
      <div className="note-body">
        <div className="page-viewport" />
      </div>
      {toast}
    </div>
  )
}
