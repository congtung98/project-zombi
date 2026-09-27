import { useEffect, useState } from 'react'
import { findRecord, type MapDocument } from '../map/editor/document'
import { PROFILES } from '../map/layout/plan'
import { layoutPreviewSvg } from '../map/layout/preview'
import type { LayoutIssue, LayoutParcel, WorldLayout, WorldMode } from '../map/layout/schema'
import { documentLayout, generatorStatus, layoutIssues, parcelChunk, prefabChoices, stateLabel, type GeneratorStatus, type ParcelState } from '../map/layout/worldSync'
import { generatorBlocked, generatorCatalog, isDirty, useEditorStore, type LayoutView } from './editorStore'
import { downloadText } from './interaction'
import { DENSITY_CHOICES, ENVIRONMENT_LABEL, PARCEL_COLORS, PROFILE_LABEL } from '../map/editor/generator'
import { DEFAULT_ENVIRONMENT, ENVIRONMENT_KINDS } from '../map/layout/environment'
import type { EnvironmentParams } from '../map/layout/schema'

/**
 * World generator in the editor (WG4): the Generator tab. Preview of the layout (source roads,
 * snapped network, blocks, parcels, unbuildable land), regenerate the world (seed, profile, mode;
 * previewed, then applied as one undoable command), selective regeneration of a parcel or a chunk,
 * replace or clear a parcel's prefab, lock / unlock, restore hand-edited records. Owner decision Q2:
 * generated, modified and locked are shown apart; Q3: published worlds are read-only here.
 */

const store = useEditorStore.getState

const PARCEL_LABEL: Record<ParcelState, string> = { generated: 'sinh tự động', modified: 'sửa tay', locked: 'khóa', empty: 'lô trống', open: 'đất trống / bên trong' }
const VIEW_LABEL: [keyof LayoutView, string][] = [
  ['network', 'Mạng đường đã nắn'],
  ['source', 'Đường gốc (trước khi nắn)'],
  ['parcels', 'Ranh giới lô'],
  ['blocks', 'Khối'],
  ['restricted', 'Nước / đường sắt / cấm xây'],
]
const ZONE_LABEL: Record<string, string> = { residential: 'dân cư', commercial: 'thương mại', industrial: 'công nghiệp', public: 'công cộng', empty: 'đất trống', forest: 'rừng', farmland: 'ruộng' }

function focusAt(at: { x: number; z: number }, r = 12) {
  store().requestFocus({ minX: at.x - r, minZ: at.z - r, maxX: at.x + r, maxZ: at.z + r })
}

function IssueLines({ issues }: { issues: readonly LayoutIssue[] }) {
  if (!issues.length) return <p className="hint">Không có.</p>
  return (
    <ul className="gen-issues">
      {issues.map((i, n) => (
        <li key={n} className={i.severity}>
          <button disabled={!i.at} onClick={() => i.at && focusAt(i.at)} title={i.at ? 'Tới chỗ đó' : ''}>
            <b>{i.severity === 'error' ? '✕' : i.severity === 'warning' ? '!' : 'i'}</b> {i.code}: {i.message}
          </button>
        </li>
      ))}
    </ul>
  )
}

function Summary({ layout, status, doc }: { layout: WorldLayout; status: GeneratorStatus; doc: MapDocument }) {
  const man = layout.generated
  const c = status.counts
  return (
    <div className="gen-summary">
      <p>
        <b>{layout.name}</b> <small>({layout.source.file ?? 'GeoJSON'}, {layout.source.hash.slice(7, 15)})</small>
      </p>
      <p className="hint">
        {layout.network.edges.length} cạnh đường, {layout.plan?.blocks.length ?? 0} khối, {layout.plan?.parcels.length ?? 0} lô · chế độ {man?.mode === 'full' ? 'FULL' : 'LAYOUT_ONLY'}
        {man?.catalog && man.catalog !== 'none' ? ` · thư viện ${man.catalog}` : ''} · seed {layout.plan?.params.seed ?? '—'}
        {layout.source.attribution ? ` · ${layout.source.attribution}` : ''}
      </p>
      <p className="gen-counts" data-gen-counts>
        <span className="generated">{c.generated} sinh tự động</span> · <span className="modified">{c.modified + c.deleted} sửa tay{c.deleted ? ` (${c.deleted} đã xóa)` : ''}</span> · <span className="locked">{c.locked} khóa</span> · <span>{c.manual} thủ công</span>
      </p>
      {!man && <p className="error">Layout chưa có manifest của generator: mọi record coi là đặt tay.</p>}
      {doc.world.playArea && man && JSON.stringify(doc.world.playArea) !== JSON.stringify(man.playArea) && <p className="hint">Vùng chơi đã sửa tay: sinh lại giữ nguyên.</p>}
    </div>
  )
}

function WorldRegen({ layout, blocked }: { layout: WorldLayout; blocked: string | null }) {
  const pending = useEditorStore((s) => s.genPending)
  const base = useEditorStore((s) => s.edit?.doc)
  const plan = layout.plan
  const [seed, setSeed] = useState(String(plan?.params.seed ?? 1))
  const [profile, setProfile] = useState(plan?.params.profile ?? 'default')
  const [mode, setMode] = useState<WorldMode>(layout.generated?.mode ?? 'full')
  const [overwrite, setOverwrite] = useState(false)
  const [env, setEnv] = useState<EnvironmentParams>(plan?.environment ?? DEFAULT_ENVIRONMENT)
  const valid = Number.isInteger(Number(seed))
  const stale = pending && pending.base !== base
  return (
    <details open className="gen-block">
      <summary>Sinh lại world</summary>
      <label className="field">
        <span>Seed</span>
        <input type="number" value={seed} onChange={(e) => setSeed(e.target.value)} data-gen-world-seed />
      </label>
      <label className="field">
        <span>Kiểu lô</span>
        <select value={profile} onChange={(e) => setProfile(e.target.value)} data-gen-world-profile>
          {Object.keys(PROFILES).map((p) => (
            <option key={p} value={p}>
              {PROFILE_LABEL[p] ?? p}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Chế độ</span>
        <select value={mode} onChange={(e) => setMode(e.target.value as WorldMode)} data-gen-world-mode>
          <option value="full">FULL (đường + công trình + zombie)</option>
          <option value="layout-only">LAYOUT_ONLY (chỉ đường)</option>
        </select>
      </label>
      {mode === 'full' && <EnvironmentFields env={env} onChange={setEnv} />}
      <label className="field check">
        <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} data-gen-overwrite />
        <span>Ghi đè cả object đã sửa tay (không bao giờ đụng object khóa hay đặt tay)</span>
      </label>
      <button
        disabled={!!blocked || !valid}
        title={blocked ?? 'Tính kết quả và hiện trong viewport; document chỉ đổi khi bấm Áp dụng'}
        onClick={() => store().generate(`Sinh lại world (seed ${seed})`, { kind: 'world', params: { seed: Number(seed), profile }, mode, overwrite, environment: env }, { preview: true })}
        data-gen-preview
      >
        Xem trước
      </button>
      {pending && (
        <div className={`gen-pending${stale ? ' stale' : ''}`} data-gen-pending>
          <p>
            <b>{pending.label}</b>: {pending.summary}
          </p>
          {pending.report.keptModified.length > 0 && <p className="hint">Giữ {pending.report.keptModified.length} object sửa tay (viền lô màu hồng).</p>}
          {pending.report.keptLocked.length > 0 && <p className="hint">Giữ {pending.report.keptLocked.length} object khóa.</p>}
          {pending.report.conflicts.length > 0 && <p className="error">{pending.report.conflicts.length} record đặt tay giữ ID generator cần: bỏ qua ({pending.report.conflicts.slice(0, 3).join(', ')}).</p>}
          {stale && <p className="error">Document đã đổi sau khi xem trước: xem trước lại.</p>}
          <div className="row">
            <button disabled={!!stale} onClick={() => store().applyPending()} data-gen-apply>
              Áp dụng
            </button>
            <button onClick={() => store().cancelPending()} data-gen-cancel>
              Hủy
            </button>
          </div>
        </div>
      )}
    </details>
  )
}

function ParcelSection({ layout, status, parcel, blocked, doc }: { layout: WorldLayout; status: GeneratorStatus; parcel: LayoutParcel; blocked: string | null; doc: MapDocument }) {
  const [overwrite, setOverwrite] = useState(false)
  const catalog = generatorCatalog()
  const state = status.parcels.get(parcel.id) ?? 'empty'
  const inst = status.instances.get(parcel.id)
  const rec = inst ? status.records.get(inst) : undefined
  const b = parcel.build
  const full = layout.generated?.mode === 'full'
  const choices = catalog && full ? prefabChoices(layout, parcel.id, catalog) : []
  const current = b && b.prefabId !== null ? b.prefabId : ''
  const chunk = parcelChunk(parcel)
  const canBuild = !blocked && full && parcel.kind === 'lot' && !parcel.locked
  const why = blocked ?? (!full ? 'World LAYOUT_ONLY: sinh lại world ở chế độ FULL trước' : parcel.locked ? 'Lô đã khóa' : parcel.kind !== 'lot' ? 'Lô không giáp đường' : '')
  const r = parcel.polygon
  const w = Math.max(...r.map((p) => p.x)) - Math.min(...r.map((p) => p.x))
  const d = Math.max(...r.map((p) => p.z)) - Math.min(...r.map((p) => p.z))
  return (
    <details open className="gen-block" data-gen-parcel={parcel.id}>
      <summary>
        Lô <code>{parcel.id}</code>
      </summary>
      <p>
        <span className="gen-dot" style={{ background: PARCEL_COLORS[state] }} /> <b data-gen-parcel-state>{PARCEL_LABEL[state]}</b>
        {rec && (rec.modified === 'deleted' || rec.modified === 'chosen') && ` — ${stateLabel(rec)}`}
      </p>
      <p className="hint">
        {parcel.kind === 'lot' ? 'Lô mặt tiền' : parcel.kind === 'open' ? 'Đất trống' : 'Đất bên trong'} · zone {ZONE_LABEL[parcel.zone] ?? parcel.zone} · {w.toFixed(1)} × {d.toFixed(1)} m
        {parcel.access ? ` · mặt tiền ${parcel.access.frontage.toFixed(1)} m hướng ${parcel.access.side}` : ''} · chunk {chunk}
      </p>
      <p>
        {b && b.prefabId !== null ? (
          <>
            Công trình: <code>{b.prefabId}</code> ({b.source === 'manual' ? 'chọn tay' : 'generator'}){' '}
            {inst && findRecord(doc, inst) && (
              <button onClick={() => store().select([inst])} data-gen-select-building>
                Chọn
              </button>
            )}
          </>
        ) : b ? (
          `Không có công trình (${b.reason === 'vacant' ? 'cố ý để trống' : b.reason === 'no-fit' ? 'không prefab nào vừa' : b.reason === 'no-prefab' ? 'không có prefab cho zone' : 'đã bỏ bằng tay'})`
        ) : (
          'Chưa có công trình'
        )}
      </p>
      <div className="row">
        <button disabled={!canBuild} title={why || 'Chọn lại công trình cho lô này (thay cả chỉnh sửa tay trên lô)'} onClick={() => store().generate('Sinh lại lô', { kind: 'parcels', parcels: [parcel.id] })} data-gen-regen-parcel>
          Sinh lại lô
        </button>
        <button
          onClick={() => store().generate(parcel.locked ? 'Mở khóa lô' : 'Khóa lô', { kind: 'lock', ids: [parcel.id], locked: !parcel.locked })}
          title="Lô khóa: không lần sinh lại nào đụng tới (kể cả khi ghi đè)"
          data-gen-lock-parcel
        >
          {parcel.locked ? 'Mở khóa lô' : 'Khóa lô'}
        </button>
        {rec && (rec.modified === 'edited' || rec.modified === 'deleted') && (
          <button disabled={!!blocked || rec.locked} title={blocked ?? 'Đưa công trình về đúng như generator đã sinh'} onClick={() => store().generate('Khôi phục bản sinh', { kind: 'revert', ids: [rec.id] })} data-gen-revert>
            Khôi phục bản sinh
          </button>
        )}
      </div>
      {full && parcel.kind === 'lot' && (
        <label className="field">
          <span>Thay prefab</span>
          <select
            disabled={!canBuild}
            value={current}
            onChange={(e) => store().generate('Thay prefab', { kind: 'prefab', parcel: parcel.id, prefabId: e.target.value || null })}
            data-gen-prefab
          >
            <option value="">(không có công trình)</option>
            {current && !choices.some((c) => c.prefabId === current) && <option value={current}>{current}</option>}
            {choices.map((c) => (
              <option key={c.prefabId} value={c.prefabId}>
                {c.prefabId}
                {c.zoneOk ? '' : ' (không dành cho zone này)'}
              </option>
            ))}
          </select>
        </label>
      )}
      {full && (
        <>
          <label className="field check">
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
            <span>Ghi đè lô sửa tay trong chunk</span>
          </label>
          <button disabled={!!blocked} title={blocked ?? `Chọn lại công trình mọi lô có tâm trong ${chunk} (lô khóa không bao giờ; lô sửa tay chỉ khi ghi đè)`} onClick={() => store().generate(`Sinh lại chunk ${chunk}`, { kind: 'chunks', chunks: [chunk], overwrite })} data-gen-regen-chunk>
            Sinh lại chunk {chunk}
          </button>
        </>
      )}
    </details>
  )
}

/** WG5: environment density and kinds (FULL worlds). */
export function EnvironmentFields({ env, onChange }: { env: EnvironmentParams; onChange: (env: EnvironmentParams) => void }) {
  return (
    <details className="gen-env">
      <summary>Môi trường: {DENSITY_CHOICES.find(([d]) => d === env.density)?.[1] ?? env.density}</summary>
      <label className="field">
        <span>Mật độ</span>
        <select value={env.density} onChange={(e) => onChange({ ...env, density: Number(e.target.value) })} data-gen-env-density>
          {DENSITY_CHOICES.map(([d, label]) => (
            <option key={d} value={d}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {ENVIRONMENT_KINDS.map((k) => (
        <label key={k} className="field check">
          <input type="checkbox" checked={env[k]} onChange={(e) => onChange({ ...env, [k]: e.target.checked })} data-gen-env={k} />
          <span>{ENVIRONMENT_LABEL[k]}</span>
        </label>
      ))}
    </details>
  )
}

/** WG5: the running worker job, with its time and a Hủy button. */
function Busy() {
  const busy = useEditorStore((s) => s.genBusy)
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [busy])
  if (!busy) return null
  return (
    <div className="gen-busy" data-gen-busy>
      <span>
        Đang {busy.label.toLowerCase()}… {(Math.max(0, now - busy.started) / 1000).toFixed(1)} s
      </span>
      <button onClick={() => store().cancelGenerator()} data-gen-cancel-job>
        Hủy
      </button>
    </div>
  )
}

export function GeneratorPanel() {
  const edit = useEditorStore((s) => s.edit)
  const view = useEditorStore((s) => s.layoutView)
  const picked = useEditorStore((s) => s.selectedParcel)
  const report = useEditorStore((s) => s.genReport)
  const busy = useEditorStore((s) => s.genBusy)
  if (!edit) return null
  const doc = edit.doc
  const { layout, issues } = documentLayout(doc)
  if (!layout) {
    return (
      <div className="gen">
        <p className="hint">World này không sinh từ layout địa lý. Tạo world mới từ GeoJSON (overpass-turbo, QGIS, vẽ tay): Mới → Từ GeoJSON. File đọc tại máy, editor không gọi mạng.</p>
        {issues.length > 0 && (
          <>
            <p className="error">layout/world-layout.json hỏng:</p>
            <IssueLines issues={issues} />
          </>
        )}
        <button onClick={() => (!isDirty(store()) || window.confirm('Document có thay đổi chưa lưu. Bỏ các thay đổi đó?')) && store().set({ dialog: 'new' })} data-gen-new>
          Tạo world từ GeoJSON…
        </button>
      </div>
    )
  }
  const status = generatorStatus(doc, layout)
  const published = generatorBlocked(doc)
  // While a job runs every action waits (the result lands on the document it started from).
  const blocked = published ?? (busy ? `Đang chạy ${busy.label}` : null)
  const parcel = picked ? layout.plan?.parcels.find((q) => q.id === picked) : undefined
  return (
    <div className="gen">
      <Summary layout={layout} status={status} doc={doc} />
      <Busy />
      {published && (
        <p className="error" data-gen-blocked>
          {published}
        </p>
      )}
      <details open className="gen-block">
        <summary>Hiển thị</summary>
        {VIEW_LABEL.map(([k, label]) => (
          <label key={k} className="field check">
            <input type="checkbox" checked={view[k]} onChange={(e) => store().setLayoutView({ [k]: e.target.checked })} data-gen-view={k} />
            <span>{label}</span>
          </label>
        ))}
        <p className="gen-legend">
          {(Object.keys(PARCEL_COLORS) as ParcelState[]).map((k) => (
            <span key={k}>
              <span className="gen-dot" style={{ background: PARCEL_COLORS[k] }} /> {PARCEL_LABEL[k]}
            </span>
          ))}
        </p>
        <button onClick={() => downloadText(`${doc.world.worldId}.layout.svg`, layoutPreviewSvg(layout), 'image/svg+xml')}>Tải preview SVG</button>
      </details>
      {parcel ? <ParcelSection key={parcel.id} layout={layout} status={status} parcel={parcel} blocked={blocked} doc={doc} /> : <p className="hint">Click một lô trong viewport để xem, khóa, thay prefab hay sinh lại.</p>}
      <WorldRegen key={doc.world.worldId} layout={layout} blocked={blocked} />
      {report && (
        <details open className="gen-block" data-gen-report>
          <summary>Lần chạy gần nhất: {report.label}</summary>
          <p className="hint">{report.summary}</p>
          <IssueLines issues={report.issues.filter((i) => i.severity !== 'info' || i.code === 'buildings')} />
        </details>
      )}
      <details className="gen-block">
        <summary>Cảnh báo của layout ({layoutIssues(layout).filter((i) => i.severity !== 'info').length})</summary>
        <IssueLines issues={layoutIssues(layout)} />
      </details>
    </div>
  )
}

/** Inspector rows for a record of a generated world: its generator state and the actions that fit it. */
export function RecordGeneratorInfo({ doc, id }: { doc: MapDocument; id: string }) {
  const { layout } = documentLayout(doc)
  if (!layout) return null
  const s = generatorStatus(doc, layout).records.get(id)
  if (!s) return null
  const blocked = generatorBlocked(doc)
  const openParcel = () => {
    store().set({ paletteTab: 'generator' })
    store().setTool('parcel')
    store().selectParcel(s.parcel)
  }
  return (
    <div className="gen-record" data-gen-record-state={s.state}>
      <label className="field">
        <span>Generator</span>
        <b className={s.state}>{stateLabel(s)}</b>
      </label>
      {s.state !== 'manual' && (
        <div className="row">
          {s.parcel && (
            <button onClick={openParcel} data-gen-open-parcel>
              Lô {s.parcel.slice(0, 12)}…
            </button>
          )}
          <button onClick={() => store().generate(s.locked ? 'Mở khóa' : 'Khóa', { kind: 'lock', ids: [id], locked: !s.locked })} title="Khóa: không lần sinh lại nào thay hay xóa (với công trình: khóa cả lô)" data-gen-lock-record>
            {s.locked ? 'Mở khóa' : 'Khóa'}
          </button>
          {s.modified === 'edited' && (
            <button disabled={!!blocked || s.locked} title={blocked ?? 'Đưa về đúng như generator đã sinh'} onClick={() => store().generate('Khôi phục bản sinh', { kind: 'revert', ids: [id] })} data-gen-revert-record>
              Khôi phục bản sinh
            </button>
          )}
        </div>
      )}
      {s.state === 'manual' && <p className="hint">Đặt tay: generator không bao giờ thay hay xóa.</p>}
    </div>
  )
}
