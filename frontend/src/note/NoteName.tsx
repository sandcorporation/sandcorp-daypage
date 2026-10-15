import { useState, type KeyboardEvent } from 'react'

type Props = {
  name: string
  editable: boolean
  onRename: (name: string) => Promise<void>
}

/** 노트 이름. 만든 사람은 눌러서 바로 고칠 수 있다. */
export function NoteName({ name, editable, onRename }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)

  if (!editable) return <p className="note-name">{name}</p>

  if (!editing) {
    return (
      <button
        type="button"
        className="note-name note-name-btn"
        onClick={() => {
          setDraft(name)
          setEditing(true)
        }}
        aria-label={`노트 이름 바꾸기: ${name}`}
      >
        {name}
      </button>
    )
  }

  async function commit() {
    setEditing(false)
    if (draft.trim() !== name) await onRename(draft)
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) void commit()
    if (e.key === 'Escape') setEditing(false)
  }

  return (
    <input
      className="note-name note-name-input"
      aria-label="노트 이름"
      value={draft}
      maxLength={60}
      autoFocus
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={onKeyDown}
    />
  )
}
