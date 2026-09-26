import { useMemo, useState } from 'react'
import { STATEFUL_KINDS, type StatefulKind } from '../map/contentMigration'
import type { MapDocument } from '../map/editor/document'
import { contentChanges, migrationOf, setMigrationRename, suggestRenames, writeContentMigration } from '../map/editor/migration'
import { useEditorStore } from './editorStore'

/**
 * Save compatibility of the open world (M8), in the World inspector: what changed in the IDs
 * saves hold state for since the published revision, which removed ID continues as which new one,
 * and the content migration that lets saves of that revision load into this one.
 */

const KIND_LABEL: Record<StatefulKind, string> = { doors: 'Cửa', containers: 'Tủ/container', windows: 'Cửa sổ (rèm)', lamps: 'Đèn', zones: 'Zone' }

export function SaveCompat({ doc }: { doc: MapDocument }) {
  const baseline = useEditorStore((s) => s.baseline)
  const run = useEditorStore((s) => s.run)
  const diff = useMemo(() => (baseline ? contentChanges(baseline, doc) : null), [baseline, doc])
  const suggested = useMemo(() => (diff ? suggestRenames(diff) : {}), [diff])
  const [pending, setPending] = useState<Record<string, string> | null>(null)
  if (!baseline || !diff) {
    return (
      <section className="save-compat" data-save-compat>
        <h4>Tương thích save</h4>
        <p className="hint">World chưa phát hành (mới, sinh bằng generator hoặc lưu thành world mới): chưa có save nào cần giữ.</p>
      </section>
    )
  }
  const base = baseline.world.contentVersion
  const file = migrationOf(doc, base)
  // Pending choices (no file yet) only for pairs that still exist after later edits.
  const fits = ([from, to]: [string, string]) => STATEFUL_KINDS.some((k) => diff.removed[k].includes(from) && diff.added[k].includes(to))
  const renamed = file ? file.renamed : Object.fromEntries(Object.entries(pending ?? suggested).filter(fits))
  const changed = STATEFUL_KINDS.some((k) => diff.removed[k].length || diff.added[k].length)
  const version = doc.world.contentVersion
  const setRename = (from: string, to: string | null) => {
    if (file) {
      run(to ? 'Đổi tên trong migration' : 'Bỏ đổi tên trong migration', (d, sel) => setMigrationRename(d, base, from, to, sel))
      return
    }
    const next = { ...renamed }
    if (to) next[from] = to
    else delete next[from]
    setPending(next)
  }
  return (
    <section className="save-compat" data-save-compat>
      <h4>Tương thích save</h4>
      <p className="hint">
        Bản đã phát hành: content v{base}. Đang sửa: v{version}.
      </p>
      {!changed && !file && version === base && <p className="hint">Không thêm/bỏ ID có trạng thái (cửa, tủ, cửa sổ, đèn, zone): save cũ nạp bình thường, giữ trạng thái.</p>}
      {changed && (
        <ul className="compat-diff">
          {STATEFUL_KINDS.filter((k) => diff.removed[k].length || diff.added[k].length).map((k) => (
            <li key={k}>
              <b>{KIND_LABEL[k]}</b>
              {diff.added[k].map((id) => (
                <div key={id} className="added" data-compat-added={id}>
                  + <code>{id}</code>
                  {Object.values(renamed).includes(id) ? ' (tiếp nối ID cũ)' : ' (trạng thái ban đầu)'}
                </div>
              ))}
              {diff.removed[k].map((id) => (
                <div key={id} className="removed">
                  − <code>{id}</code> →{' '}
                  <select value={renamed[id] ?? ''} onChange={(e) => setRename(id, e.target.value || null)} data-compat-rename={id}>
                    <option value="">bỏ ({k === 'containers' ? 'đồ bên trong rơi xuống đất' : 'mất trạng thái'})</option>
                    {diff.added[k].map((to) => (
                      <option key={to} value={to} disabled={Object.entries(renamed).some(([f, t]) => t === to && f !== id)}>
                        đổi tên thành {to}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
      {file ? (
        <p className="hint" data-compat-file>
          ✓ <code>migrations/content-v{base}.json</code>: save của v{base} được chuyển sang v{base + 1} (ID giữ/đổi tên giữ trạng thái; cửa, đèn, tủ mới ở trạng thái ban đầu; đồ trong tủ bị bỏ rơi xuống đất).
        </p>
      ) : (
        (changed || version !== base) && (
          <button
            onClick={() => {
              if (run(`Tạo migration v${base} → v${base + 1}`, (d, sel) => writeContentMigration(d, baseline, renamed, sel))) setPending(null)
            }}
            data-create-migration
          >
            Tạo migration v{base} → v{base + 1}
          </button>
        )
      )}
    </section>
  )
}
