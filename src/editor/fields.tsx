import { useState } from 'react'

/**
 * Inspector inputs that commit once (Enter or blur), so typing is not a stream of commands and
 * each change is one history entry. They resync when the document value changes (undo/redo).
 */

export function NumField({ label, value, onCommit, step = 0.25, min }: { label: string; value: number; onCommit: (v: number) => void; step?: number; min?: number }) {
  const [text, setText] = useState(String(value))
  const [shown, setShown] = useState(value)
  if (shown !== value) {
    setShown(value)
    setText(String(value))
  }
  const commit = () => {
    const v = Number(text)
    if (text.trim() === '' || !Number.isFinite(v) || (min !== undefined && v < min)) {
      setText(String(value))
      return
    }
    if (v !== value) onCommit(v)
  }
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setText(String(value))
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
    </label>
  )
}

export function TextField({ label, value, onCommit, pattern }: { label: string; value: string; onCommit: (v: string) => void; pattern?: RegExp }) {
  const [text, setText] = useState(value)
  const [shown, setShown] = useState(value)
  if (shown !== value) {
    setShown(value)
    setText(value)
  }
  const commit = () => {
    if (!text.trim() || (pattern && !pattern.test(text))) {
      setText(value)
      return
    }
    if (text !== value) onCommit(text)
  }
  return (
    <label className="field">
      <span>{label}</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setText(value)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
    </label>
  )
}

export function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <div className="field read">
      <span>{label}</span>
      <code title={value}>{value}</code>
    </div>
  )
}
