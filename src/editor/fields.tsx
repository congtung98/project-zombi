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

/** Tree fields (M9), shared by the world and prefab inspectors; `patch` commits one change. */
export function TreeFields({ tree, patch }: { tree: { height: number; canopy: number; trunk: number; color: string; style: string }; patch: (label: string, fields: Record<string, unknown>) => void }) {
  return (
    <>
      <label className="field">
        <span>Kiểu cây</span>
        <select value={tree.style} onChange={(e) => patch('Đổi kiểu cây', { style: e.target.value })} data-tree-style>
          <option value="round">Cây tán tròn</option>
          <option value="pine">Cây thông</option>
        </select>
      </label>
      <NumField label="Cao (m)" value={tree.height} step={0.5} min={2} onCommit={(height) => patch('Đổi chiều cao cây', { height: Math.min(20, height) })} />
      <NumField label="Bán kính tán" value={tree.canopy} step={0.25} min={0.5} onCommit={(canopy) => patch('Đổi tán cây', { canopy: Math.min(8, canopy) })} />
      <NumField label="Bán kính thân" value={tree.trunk} step={0.05} min={0.1} onCommit={(trunk) => patch('Đổi thân cây', { trunk: Math.min(1, trunk) })} />
      <TextField label="Màu tán" value={tree.color} pattern={/^#[0-9a-f]{6}$/i} onCommit={(color) => patch('Đổi màu cây', { color })} />
      <p className="hint">Thân cây chặn đường đi và tầm nhìn zombie như một cái cột; tán chỉ để nhìn và mờ đi khi che người chơi.</p>
    </>
  )
}
