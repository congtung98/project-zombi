import { useState } from 'react'
import { FACING_LABELS, FURNITURE, FURNITURE_IDS } from '../game/rendering/furniture/catalog'

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

/**
 * G3a: a prop's or container's furniture look (`visual`), shared by the world and prefab inspectors.
 * The box keeps its size and collider; the asset fills it, its front towards the chosen side (automatic:
 * the back against the nearest wall). An asset missing from the registry is kept and shown as such.
 */
export function FurnitureFields({ visual, patch }: { visual: unknown; patch: (label: string, fields: Record<string, unknown>) => void }) {
  const v = visual && typeof visual === 'object' ? (visual as { assetId?: unknown; facing?: unknown }) : undefined
  const asset = typeof v?.assetId === 'string' ? v.assetId : ''
  const known = asset === '' || (FURNITURE_IDS as readonly string[]).includes(asset)
  const facing = typeof v?.facing === 'number' ? String(v.facing) : ''
  return (
    <>
      <label className="field">
        <span>Mẫu hình</span>
        <select value={asset} onChange={(e) => patch('Đổi mẫu hình', { visual: e.target.value ? { assetId: e.target.value, ...(facing ? { facing: Number(facing) } : {}) } : undefined })} data-furniture-asset>
          <option value="">Hộp trơn</option>
          {!known && <option value={asset}>{asset} (không có trong registry)</option>}
          {FURNITURE_IDS.map((id) => (
            <option key={id} value={id}>
              {FURNITURE[id].label}
            </option>
          ))}
        </select>
      </label>
      {asset && (
        <label className="field">
          <span>Mặt trước</span>
          <select value={facing} onChange={(e) => patch('Đổi hướng', { visual: { assetId: asset, ...(e.target.value ? { facing: Number(e.target.value) } : {}) } })} data-furniture-facing>
            <option value="">Tự động (lưng áp tường)</option>
            {FACING_LABELS.map((label, q) => (
              <option key={q} value={q}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
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
