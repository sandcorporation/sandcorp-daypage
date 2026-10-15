import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { useToast } from '../components/Toast'
import * as Y from 'yjs'
import { PageView, type PointerTool } from '../page/PageView'
import { TextLayer } from '../page/TextLayer'
import { createTextBoxAt } from '../page/textbox'
import { Toolbar } from '../page/Toolbar'
import { INKS, type ToolKind, type WidthLevel } from '../page/tools'
import { useEditTools } from '../page/useEditTools'
import { isTypingTarget, useUndo } from '../page/useUndo'
import { ErrorScreen } from '../pages/ErrorScreen'
import { ConnectionPill } from './ConnectionPill'
import { NoteHeader } from './NoteHeader'
import { Cursors } from './Cursors'
import { uniquePeople, usePresence } from './usePresence'
import { useRealtime, type FatalReason } from './useRealtime'
import type { NoteDetail } from './types'
import './note.css'

type Props = { initial: NoteDetail }

export function NotePage({ initial }: Props) {
  const [note, setNote] = useState(initial)
  const [clockOffset] = useState(() => new Date(initial.serverNow).getTime() - Date.now())
  const [tool, setTool] = useState<ToolKind>('pen')
  const [ink, setInk] = useState<string>(INKS[0].color)
  const [widthLevel, setWidthLevel] = useState<WidthLevel>(1)
  // 장(날짜)마다 새 문서. 자정 교체 때 날짜가 바뀌면 새 방으로 옮겨 간다.
  const doc = useMemo(() => new Y.Doc(), [note.today]) // eslint-disable-line react-hooks/exhaustive-deps
  const [fatal, setFatal] = useState<FatalReason | null>(null)

  const refreshToday = useCallback(async () => {
    try {
      const fresh = await api<NoteDetail>(`/api/notes/${note.id}`)
      setNote((n) => (fresh.today === n.today ? n : fresh))
    } catch {
      setFatal('notFound')
    }
  }, [note.id])

  const { provider, status, synced } = useRealtime({
    noteId: note.id,
    date: note.today,
    doc,
    onNotToday: refreshToday,
    onFatal: setFatal,
  })
  const presence = usePresence(provider, note.me)

  // 서버 알림을 놓쳐도 자정이 지나면 스스로 오늘 장을 다시 확인한다.
  useEffect(() => {
    const wait = new Date(note.nextMidnight).getTime() - (Date.now() + clockOffset) + 3000
    const timer = window.setTimeout(refreshToday, Math.max(1000, wait))
    return () => window.clearTimeout(timer)
  }, [note.nextMidnight, clockOffset, refreshToday])
  const { toast, show } = useToast()
  const origin = useMemo(() => ({ local: true }), [])
  const history = useUndo(doc, origin)
  const edit = useEditTools(doc, tool, origin)
  const [scale, setScale] = useState(0.5)
  const [focusId, setFocusId] = useState<string | null>(null)
  const clearFocus = useCallback(() => setFocusId(null), [])

  const textTool = useMemo<PointerTool>(
    () => ({
      down(p) {
        const id = createTextBoxAt(doc, p, { color: ink, author: note.me.nickname }, origin)
        setFocusId(id)
        return true
      },
    }),
    [doc, ink, note.me.nickname, origin],
  )

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) history.redo()
        else history.undo()
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        history.redo()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && edit.selected.length) {
        e.preventDefault()
        edit.deleteSelected()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [history, edit])

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

  if (fatal === 'crowded') return <ErrorScreen kind="crowded" />
  if (fatal) return <ErrorScreen kind={fatal === 'notFound' ? 'missing' : 'server'} />

  return (
    <div className="note-screen">
      <NoteHeader
        note={note}
        pageDate={note.today}
        clockOffset={clockOffset}
        peers={uniquePeople(presence.peers)}
        onRename={rename}
        onShare={share}
      />
      <div className="note-body">
        <Toolbar
          tool={tool}
          ink={ink}
          widthLevel={widthLevel}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          onTool={setTool}
          onInk={setInk}
          onWidth={setWidthLevel}
          onUndo={history.undo}
          onRedo={history.redo}
        />
        <PageView
          doc={doc}
          tool={tool}
          ink={ink}
          widthLevel={widthLevel}
          author={note.me.nickname}
          origin={origin}
          pointerTool={tool === 'text' ? textTool : edit.pointerTool}
          onScale={setScale}
          onPointerMove={presence.setCursor}
          overlay={edit.overlay}
          overlayVersion={edit.overlayVersion}
          onGestureStart={history.stopCapturing}
        >
          <TextLayer
            doc={doc}
            tool={tool}
            scale={scale}
            readOnly={false}
            origin={origin}
            focusId={focusId}
            onFocusHandled={clearFocus}
            onEditing={presence.setEditing}
            editors={presence.editors}
          />
          <Cursors peers={presence.peers} scale={scale} />
        </PageView>
      </div>
      <ConnectionPill status={status} synced={synced} />
      {toast}
    </div>
  )
}
