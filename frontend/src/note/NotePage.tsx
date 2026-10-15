import { useCallback, useMemo, useState } from 'react'
import { api } from '../api/client'
import { useToast } from '../components/Toast'
import { createPageDoc } from '../page/doc'
import { PageView } from '../page/PageView'
import { Toolbar } from '../page/Toolbar'
import { INKS, type ToolKind, type WidthLevel } from '../page/tools'
import { NoteHeader } from './NoteHeader'
import type { NoteDetail } from './types'
import './note.css'

type Props = { initial: NoteDetail }

export function NotePage({ initial }: Props) {
  const [note, setNote] = useState(initial)
  const [clockOffset] = useState(() => new Date(initial.serverNow).getTime() - Date.now())
  const [tool, setTool] = useState<ToolKind>('pen')
  const [ink, setInk] = useState<string>(INKS[0].color)
  const [widthLevel, setWidthLevel] = useState<WidthLevel>(1)
  const doc = useMemo(() => createPageDoc(note.today), [note.today])
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
        <Toolbar
          tool={tool}
          ink={ink}
          widthLevel={widthLevel}
          canUndo={false}
          canRedo={false}
          onTool={setTool}
          onInk={setInk}
          onWidth={setWidthLevel}
          onUndo={() => {}}
          onRedo={() => {}}
        />
        <PageView doc={doc} tool={tool} ink={ink} widthLevel={widthLevel} author={note.me.nickname} />
      </div>
      {toast}
    </div>
  )
}
