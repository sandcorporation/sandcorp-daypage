import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

type Props = {
  name: string
  editable: boolean
  onRename: (name: string) => Promise<void>
}

/** 노트 이름. 만든 사람은 눌러서 바로 고칠 수 있다. */
export function NoteName({ name, editable, onRename }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const buttonRef = useRef<HTMLButtonElement>(null)
  // 키보드로 닫았을 때만 이름 단추로 돌아간다(다른 곳을 눌러 닫으면 누른 자리에 둔다).
  const refocus = useRef(false)
  useEffect(() => {
    if (editing || !refocus.current) return
    refocus.current = false
    buttonRef.current?.focus()
  }, [editing])

  if (!editable) return <span className="note-name">{name}</span>

  if (!editing) {
    return (
      <button
        ref={buttonRef}
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
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      refocus.current = true
      void commit()
    }
    if (e.key === 'Escape') {
      refocus.current = true
      setEditing(false)
    }
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
