import { useEffect, useRef, useState } from 'react'
import { bundledWorldIds } from '../map/content'
import { fittedPlayArea, samePlayArea, updateWorld } from '../map/editor/commands'
import { chunkStatuses, instancesOf, prefabItemAtPath, recordAtPath, recordForEntity, resolvedRecords } from '../map/editor/document'
import { createPrefab, deletePrefab, duplicatePrefab } from '../map/editor/prefabCommands'
import { PREFAB_PRESETS } from '../map/editor/prefabPresets'
import { LAYERS } from '../map/editor/layers'
import { RECORD_PRESETS, type PresetCategory } from '../map/editor/presets'
import type { Rect } from '../map/schema'
import { playAreaRect, SLUG } from '../map/transform'
import { DEFAULT_TREES, type Layout } from '../map/tools/generator'
import { deleteDraft } from './drafts'
import { editableSelection, isDirty, layerLabel, SNAP_STEPS, useEditorStore, type PaletteTab, type PrefabTab } from './editorStore'
import { deleteChunk, downloadText, focusChunk, placeLabel } from './interaction'
import { PrefabThumbnail } from './Thumbnail'

const confirmDiscard = () => !isDirty(useEditorStore.getState()) || window.confirm('Document có thay đổi chưa lưu. Bỏ các thay đổi đó?')

const TABS: { id: PaletteTab; label: string }[] = [
  { id: 'prefabs', label: 'Prefab' },
  { id: 'objects', label: 'Object' },
  { id: 'roads', label: 'Nền' },
  { id: 'zones', label: 'Zone' },
  { id: 'spawns', label: 'Spawn' },
  { id: 'chunks', label: 'Chunk' },
]

const DRAG_HINT = { point: 'click', line: 'click hoặc kéo (dài)', rect: 'click hoặc kéo (khung)', radius: 'click hoặc kéo (bán kính)' } as const

function PrefabList() {
  const edit = useEditorStore((s) => s.edit)!
  const savedDoc = useEditorStore((s) => s.savedDoc)
  const tool = useEditorStore((s) => s.tool)
  const place = useEditorStore((s) => s.place)
  const setTool = useEditorStore((s) => s.setTool)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const prefabs = edit.doc.world.prefabs
    .map((e) => edit.doc.prefabs.get(e.prefabId)!)
    .filter((p) => !q || p.prefabId.includes(q) || p.name.toLowerCase().includes(q))
  const store = useEditorStore.getState
  return (
    <>
      <input className="search" placeholder="Tìm prefab…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <ul className="palette">
        {prefabs.map((p) => {
          const f = p.footprint
          const active = tool === 'place' && place?.kind === 'prefab' && place.prefabId === p.prefabId
          const uses = instancesOf(edit.doc, p.prefabId).length
          const modified = savedDoc?.prefabs.get(p.prefabId) !== p
          return (
            <li key={p.prefabId}>
              <button className={`with-thumb${active ? ' active' : ''}`} onClick={() => setTool(active ? 'select' : 'place', active ? null : { kind: 'prefab', prefabId: p.prefabId })} data-prefab={p.prefabId}>
                <PrefabThumbnail prefab={p} />
                <span>
                  <strong>
                    {p.name}
                    {modified ? ' ●' : ''}
                  </strong>
                  <small>
                    {p.prefabId} · {f.maxX - f.minX}×{f.maxZ - f.minZ} m · {uses} instance
                  </small>
                </span>
              </button>
              <div className="row tight">
                <button onClick={() => store().enterPrefab(p.prefabId)} data-edit-prefab={p.prefabId} title="Sửa prefab gốc (mọi instance đổi theo)">
                  Sửa
                </button>
                <button onClick={() => store().set({ dialog: 'duplicatePrefab', dialogPrefab: p.prefabId })}>Nhân bản</button>
                <button className="bad" disabled={uses > 0} title={uses ? 'Còn instance dùng prefab này' : ''} onClick={() => store().run(`Xóa prefab ${p.prefabId}`, (d) => deletePrefab(d, p.prefabId))}>
                  Xóa
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      <button onClick={() => store().set({ dialog: 'newPrefab' })} data-new-prefab>
        Prefab mới…
      </button>
      <p className="hint">Click một prefab rồi click viewport để đặt, R xoay 90°, Esc thoát. "Sửa" mở prefab gốc: mọi instance của nó đổi theo.</p>
    </>
  )
}

const PREFAB_TABS: { id: PrefabTab; label: string }[] = [
  { id: 'structure', label: 'Tường' },
  { id: 'openings', label: 'Cửa' },
  { id: 'furniture', label: 'Nội thất' },
  { id: 'containers', label: 'Tủ' },
  { id: 'rooms', label: 'Phòng' },
]

const PREFAB_HINTS: Record<PrefabTab, string> = {
  structure: 'Tường: nhấn rồi kéo theo trục X hoặc Z. Cửa/cửa sổ đặt lên tường sẽ tự khoét khe (lanh tô, bệ cửa sổ do game dựng).',
  openings: 'Click sát một bức tường: cửa/cửa sổ bám vào tường và quay vào phía trong nhà (cửa mở vào trong). Xa tường: đặt theo góc R.',
  furniture: 'Nội thất là vật cản (collider, chặn đường đi). Click để đặt; quầy/khối: kéo để định kích thước.',
  containers: 'Tủ có loot: bảng loot chọn ở Inspector. Vòng xanh = tầm tương tác trong game.',
  rooms: 'Kéo khung phòng trên đường tâm tường. Phòng có đèn kèm công tắc (ô vàng, kéo để dời). Ánh sáng: cửa sổ và cửa nối các phòng.',
}

/** Palette of the prefab editor (M5): what goes inside the prefab being edited. */
function PrefabPalette({ prefabId }: { prefabId: string }) {
  const edit = useEditorStore((s) => s.edit)!
  const tab = useEditorStore((s) => s.prefabTab)
  const tool = useEditorStore((s) => s.tool)
  const place = useEditorStore((s) => s.place)
  const store = useEditorStore.getState
  const prefab = edit.doc.prefabs.get(prefabId)
  if (!prefab) return null
  const uses = instancesOf(edit.doc, prefabId)
  return (
    <>
      <div className="banner" data-prefab-banner>
        <strong>Sửa PREFAB GỐC</strong>
        <div>
          {prefab.name} <code>{prefabId}</code>
        </div>
        <small>
          Ảnh hưởng {uses.length} instance{uses.length ? `: ${uses.slice(0, 4).join(', ')}${uses.length > 4 ? ' …' : ''}` : ''}
        </small>
        <button onClick={() => store().exitPrefab()} data-exit-prefab>
          ← Về world
        </button>
      </div>
      <nav className="tabs">
        {PREFAB_TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? 'active' : ''}
            onClick={() => {
              store().set({ prefabTab: t.id })
              if (store().tool !== 'select') store().setTool('select')
            }}
            data-prefab-tab={t.id}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <ul className="palette">
        {PREFAB_PRESETS.filter((p) => p.group === tab).map((p) => {
          const active = tool === 'place' && place?.kind === 'prefabItem' && place.presetId === p.id
          return (
            <li key={p.id}>
              <button className={active ? 'active' : ''} onClick={() => store().setTool(active ? 'select' : 'place', active ? null : { kind: 'prefabItem', presetId: p.id })} data-prefab-preset={p.id}>
                <strong>{p.label}</strong>
                <small>{DRAG_HINT[p.drag]}</small>
              </button>
            </li>
          )
        })}
      </ul>
      <p className="hint">{PREFAB_HINTS[tab]}</p>
      <p className="hint">R xoay, Delete xóa, Ctrl+D nhân bản, mũi tên dịch, Esc thoát công cụ.</p>
    </>
  )
}

function PresetList({ category }: { category: PresetCategory }) {
  const tool = useEditorStore((s) => s.tool)
  const place = useEditorStore((s) => s.place)
  const setTool = useEditorStore((s) => s.setTool)
  return (
    <>
      <ul className="palette">
        {RECORD_PRESETS.filter((p) => p.category === category).map((p) => {
          const active = tool === 'place' && place?.kind === 'record' && place.presetId === p.id
          return (
            <li key={p.id}>
              <button className={active ? 'active' : ''} onClick={() => setTool(active ? 'select' : 'place', active ? null : { kind: 'record', presetId: p.id })} data-preset={p.id}>
                <strong>{p.label}</strong>
                <small>{DRAG_HINT[p.drag]}</small>
              </button>
            </li>
          )
        })}
      </ul>
      {category === 'zones' && (
        <p className="hint">
          Zone zombie (horde): zombie lang thang trong zone của mình, đạo diễn di cư chuyển cả nhóm giữa các zone. Điểm nằm trong zone chữ nhật thuộc zone nhỏ nhất chứa nó, nếu
          không thì thuộc zone có tâm gần nhất. Chọn zone bằng viền hoặc tâm.
        </p>
      )}
      {category === 'spawns' && <p className="hint">Spawn zombie: nơi zombie xuất hiện lúc đầu và respawn (ngoài nhà). Spawn người chơi: đặt làm điểm xuất phát ở Inspector.</p>}
      {category === 'roads' && <p className="hint">Mặt nền chỉ để hiển thị (không collider). Hai mặt khác màu chồng nhau sẽ nhấp nháy trong game (cảnh báo surface-overlap).</p>}
      <p className="hint">R xoay 90° vùng chọn, Esc thoát.</p>
    </>
  )
}

function ChunkPanel() {
  const edit = useEditorStore((s) => s.edit)!
  const savedDoc = useEditorStore((s) => s.savedDoc)
  const issues = useEditorStore((s) => s.issues)
  const picked = useEditorStore((s) => s.selectedChunk)
  const run = useEditorStore((s) => s.run)
  const statuses = chunkStatuses(edit.doc, savedDoc, issues)
  const w = edit.doc.world
  const fit = fittedPlayArea(w)
  const r = playAreaRect(w.playArea)
  const f = playAreaRect(fit)
  const describe = (a: Rect) => `${a.maxX - a.minX} × ${a.maxZ - a.minZ} m, x ${a.minX}…${a.maxX}, z ${a.minZ}…${a.maxZ}`
  return (
    <>
      <p className="hint">Click ô trống viền xám quanh world để thêm chunk {w.chunkSize} m; click chunk có sẵn để chọn. Viền: xanh = đã lưu, cam ● = đã sửa, đỏ ✕ = có lỗi.</p>
      <ul className="chunks">
        {statuses.map((c) => (
          <li key={c.chunkId} className={c.chunkId === picked ? 'active' : ''}>
            <button onClick={() => focusChunk(c.chunkId)} data-chunk={c.chunkId}>
              <code>{c.chunkId}</code>
              <small>
                {c.records} record · {c.refs} ref{c.modified ? ' · ● sửa' : ''}
                {c.errors ? ` · ✕ ${c.errors} lỗi` : ''}
                {c.warnings ? ` · ${c.warnings} cảnh báo` : ''}
              </small>
            </button>
            {c.chunkId === picked && (
              <button className="bad" disabled={c.records > 0 || statuses.length === 1} title={c.records > 0 ? 'Chunk còn record: di chuyển hoặc xóa trước' : ''} onClick={() => deleteChunk(c.chunkId)}>
                Xóa chunk
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="hint">
        Vùng chơi (đỏ): {describe(r)}. Vừa với các chunk: {describe(f)}.
      </p>
      <button disabled={samePlayArea(fit, w.playArea)} onClick={() => run('Khớp vùng chơi', (d, sel) => updateWorld(d, { playArea: fittedPlayArea(d.world) }, sel))} data-fit-play>
        Khớp vùng chơi với chunk
      </button>
    </>
  )
}

function LayersPanel() {
  const layers = useEditorStore((s) => s.layers)
  const setLayer = useEditorStore((s) => s.setLayer)
  return (
    <details className="layers" open>
      <summary>Layer (chỉ trong editor)</summary>
      <table>
        <thead>
          <tr>
            <th />
            <th>Hiện</th>
            <th>Khóa</th>
          </tr>
        </thead>
        <tbody>
          {LAYERS.map((l) => (
            <tr key={l.id} data-layer={l.id}>
              <td>{l.label}</td>
              <td>
                <input type="checkbox" aria-label={`Hiện ${l.label}`} checked={!layers[l.id].hidden} onChange={(e) => setLayer(l.id, { hidden: !e.target.checked })} />
              </td>
              <td>
                <input type="checkbox" aria-label={`Khóa ${l.label}`} checked={layers[l.id].locked} onChange={(e) => setLayer(l.id, { locked: e.target.checked })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">Ẩn/khóa chỉ ảnh hưởng chọn và hiển thị trong editor, không bao giờ vào file export hay game.</p>
    </details>
  )
}

export function Palette() {
  const edit = useEditorStore((s) => s.edit)
  const tab = useEditorStore((s) => s.paletteTab)
  const prefabMode = useEditorStore((s) => s.prefabMode)
  if (!edit) return <aside className="panel left" />
  if (prefabMode) {
    return (
      <aside className="panel left prefab-mode">
        <PrefabPalette prefabId={prefabMode} />
      </aside>
    )
  }
  const choose = (id: PaletteTab) => {
    const s = useEditorStore.getState()
    s.set({ paletteTab: id })
    if (id === 'chunks') s.setTool('chunk')
    else if (s.tool !== 'select') s.setTool('select')
  }
  return (
    <aside className="panel left">
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => choose(t.id)} data-tab={t.id}>
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'prefabs' && <PrefabList />}
      {tab !== 'prefabs' && tab !== 'chunks' && <PresetList category={tab} />}
      {tab === 'chunks' && <ChunkPanel />}
      <LayersPanel />
    </aside>
  )
}

/** Play From Here (M6): pick a start point in the viewport, or start at the world's player spawn. */
function PlayControls() {
  const edit = useEditorStore((s) => s.edit)
  const tool = useEditorStore((s) => s.tool)
  const prefabMode = useEditorStore((s) => s.prefabMode)
  const playHour = useEditorStore((s) => s.playHour)
  const store = useEditorStore.getState
  const disabled = !edit || !!prefabMode
  const title = prefabMode ? 'Về world trước (chơi thử chạy cả world)' : ''
  const fromSpawn = () => {
    const s = store()
    if (!s.edit) return
    const r = resolvedRecords(s.edit.doc).find((x) => x.id === s.edit!.doc.world.playerSpawn)
    const p = r?.parts.playerSpawns?.[0]?.position
    if (p) s.startPlaytest({ x: p.x, z: p.z })
  }
  return (
    <>
      <button className={tool === 'play' ? 'active' : ''} disabled={disabled} title={title || 'Click một điểm trong viewport để bắt đầu ở đó'} onClick={() => store().setTool(tool === 'play' ? 'select' : 'play')} data-play-here>
        ▶ Chơi từ đây
      </button>
      <button disabled={disabled} title={title} onClick={fromSpawn} data-play-spawn>
        ▶ Từ spawn
      </button>
      <label title="Giờ bắt đầu (kiểm tra ngày/đêm, đèn)">
        <select value={playHour} onChange={(e) => store().set({ playHour: Number(e.target.value) })} data-play-hour>
          {[6, 9, 12, 18, 21, 0].map((h) => (
            <option key={h} value={h}>
              {String(h).padStart(2, '0')}:00
            </option>
          ))}
        </select>
      </label>
    </>
  )
}

export function TopBar({ onImport }: { onImport: () => void }) {
  const edit = useEditorStore((s) => s.edit)
  const savedDoc = useEditorStore((s) => s.savedDoc)
  const issues = useEditorStore((s) => s.issues)
  const snapStep = useEditorStore((s) => s.snapStep)
  const view = useEditorStore((s) => s.view)
  const showIssues = useEditorStore((s) => s.showIssues)
  const store = useEditorStore.getState
  const dirty = isDirty({ edit, savedDoc })
  const errors = issues.filter((i) => i.severity === 'error').length
  const warnings = issues.length - errors
  return (
    <header className="topbar">
      <strong className="title">
        Map Editor{edit ? ` — ${edit.doc.world.name} (${edit.doc.world.worldId})` : ''}
        {dirty && <span className="dirty" title="Có thay đổi chưa lưu nháp/export"> ●</span>}
      </strong>
      <button onClick={() => confirmDiscard() && store().set({ dialog: 'new' })}>Mới</button>
      <button
        onClick={() => {
          if (!confirmDiscard()) return
          void store().refreshDrafts()
          store().set({ dialog: 'open' })
        }}
      >
        Mở…
      </button>
      <button onClick={() => void store().saveDraft()} disabled={!edit} title="Ctrl+S">
        Lưu nháp
      </button>
      <button onClick={() => store().set({ dialog: 'saveAs' })} disabled={!edit} title="Ctrl+Shift+S — bản sao với worldId mới, world đang mở không đổi" data-save-as>
        Lưu thành…
      </button>
      <button onClick={onImport}>Import…</button>
      <button
        onClick={() => {
          const f = store().exportFile()
          if (f) downloadText(f.name, f.text)
        }}
        disabled={!edit}
      >
        Export
      </button>
      <span className="sep" />
      <button onClick={() => store().undo()} disabled={!edit?.past.length} title="Ctrl+Z">
        Hoàn tác
      </button>
      <button onClick={() => store().redo()} disabled={!edit?.future.length} title="Ctrl+Y / Ctrl+Shift+Z">
        Làm lại
      </button>
      <span className="sep" />
      <label>
        Snap{' '}
        <select value={snapStep} onChange={(e) => store().set({ snapStep: Number(e.target.value) })}>
          {SNAP_STEPS.map((s) => (
            <option key={s} value={s}>
              {s ? `${s} m` : 'OFF'}
            </option>
          ))}
        </select>
      </label>
      <button onClick={() => store().set({ view: view === 'top' ? 'iso' : 'top' })} title="Tab">
        {view === 'top' ? 'Nhìn: trên xuống' : 'Nhìn: isometric'}
      </button>
      <span className="sep" />
      <PlayControls />
      <span className="sep" />
      <button className={errors ? 'bad' : warnings ? 'warn' : 'good'} onClick={() => store().set({ showIssues: !showIssues })}>
        Validate: {errors} lỗi, {warnings} cảnh báo
      </button>
    </header>
  )
}

export function IssuesPanel() {
  const show = useEditorStore((s) => s.showIssues)
  const issues = useEditorStore((s) => s.issues)
  const rejected = useEditorStore((s) => s.rejected)
  const edit = useEditorStore((s) => s.edit)
  const deep = useEditorStore((s) => s.deep)
  if (!show) return null
  const pick = (entityId: string | undefined, path: string) => {
    const s = useEditorStore.getState()
    if (!s.edit) return
    // An issue in a prefab file opens that prefab and selects the item (M5).
    const inPrefab = prefabItemAtPath(s.edit.doc, path)
    if (inPrefab) {
      if (s.prefabMode !== inPrefab.prefabId) s.enterPrefab(inPrefab.prefabId)
      if (inPrefab.localId) useEditorStore.getState().select([inPrefab.localId])
      return
    }
    const id = (entityId && recordForEntity(s.edit.doc, entityId)) || recordAtPath(s.edit.doc, path)
    if (!id) return
    if (s.prefabMode) s.exitPrefab()
    if (editableSelection(s.edit.doc, [id], s.layers).length === 0) {
      s.setStatus(`${id} thuộc layer "${layerLabel(s.edit.doc, id)}" đang ẩn hoặc khóa — mở layer đó để chọn`, 'error')
      return
    }
    s.select([id])
    s.requestFocus()
  }
  return (
    <section className="issues">
      <header>
        <strong>Validate</strong>
        <span>
          <button onClick={() => useEditorStore.getState().runDeepCheck()} data-deep-check title="Đi tới được (mọi cửa mở), tầm tương tác + tầm nhìn, collider chồng, tủ ngoài phòng, spawn trong nhà — dùng chính NavGrid/tương tác của game">
            Kiểm tra sâu
          </button>{' '}
          <button onClick={() => useEditorStore.setState({ showIssues: false, rejected: null })}>Đóng</button>
        </span>
      </header>
      {rejected && (
        <div className="rejected">
          <strong>{rejected.title}</strong> (document đang mở giữ nguyên)
          <IssueList issues={rejected.issues} />
        </div>
      )}
      {edit && issues.length === 0 && <p className="good">Không có lỗi hay cảnh báo.</p>}
      <IssueList issues={issues} onPick={pick} />
      {deep && (
        <div className="deep" data-deep-results>
          <strong>
            Kiểm tra sâu{deep.doc !== edit?.doc ? ' (cũ — document đã đổi, chạy lại)' : ''}: {deep.issues.length} cảnh báo, {deep.ms.toFixed(0)} ms
          </strong>
          {deep.issues.length === 0 && <p className="good">Mọi điểm tương tác, spawn và zone đều đi tới được; không có collider chồng.</p>}
          <IssueList issues={deep.issues} onPick={pick} />
        </div>
      )}
    </section>
  )
}

function IssueList({ issues, onPick }: { issues: { severity: string; code: string; message: string; path: string; entityId?: string }[]; onPick?: (entityId: string | undefined, path: string) => void }) {
  return (
    <ul>
      {issues.map((i, k) => (
        <li key={k} className={i.severity} onClick={() => onPick?.(i.entityId, i.path)}>
          <b>{i.severity === 'error' ? 'LỖI' : 'CẢNH BÁO'}</b> <code>{i.code}</code> {i.message} <small>{i.path}</small>
        </li>
      ))}
    </ul>
  )
}

export function StatusBar() {
  const status = useEditorStore((s) => s.status)
  const cursor = useEditorStore((s) => s.cursor)
  const tool = useEditorStore((s) => s.tool)
  const place = useEditorStore((s) => s.place)
  const placeTurns = useEditorStore((s) => s.placeTurns)
  const selection = useEditorStore((s) => s.edit?.selection.length ?? 0)
  const chunkSize = useEditorStore((s) => s.edit?.doc.world.chunkSize ?? 32)
  const chunk = cursor ? `c${Math.floor(cursor.x / chunkSize) + 0}_${Math.floor(cursor.z / chunkSize) + 0}` : ''
  return (
    <footer className="statusbar">
      <span className={status?.kind === 'error' ? 'error' : ''} data-status>
        {status?.text ?? ''}
      </span>
      <span>
        {tool === 'place' && place ? `${placeLabel(place)}${place.kind === 'prefab' ? ` (${placeTurns * 90}°)` : ''}` : tool === 'chunk' ? 'Công cụ chunk' : tool === 'play' ? 'Chơi thử: click điểm xuất phát (Esc hủy)' : `Chọn: ${selection}`}
        {cursor ? ` · (${cursor.x.toFixed(2)}, ${cursor.z.toFixed(2)}) ${chunk}` : ''}
      </span>
    </footer>
  )
}

export function OpenDialog() {
  const dialog = useEditorStore((s) => s.dialog)
  const drafts = useEditorStore((s) => s.drafts)
  const store = useEditorStore.getState
  if (dialog !== 'open') return null
  return (
    <div className="modal" role="dialog">
      <div className="box">
        <h3>Mở world</h3>
        <h4>Content trong repo (content/maps)</h4>
        <ul>
          {bundledWorldIds().map((id) => (
            <li key={id}>
              <button onClick={() => store().openBundled(id)}>{id}</button>
            </li>
          ))}
        </ul>
        <h4>Bản nháp (IndexedDB của editor)</h4>
        {drafts.length === 0 && <p className="hint">Chưa có bản nháp.</p>}
        <ul>
          {drafts.map((d) => (
            <li key={d.worldId}>
              <button onClick={() => store().openPack(d.pack, `nháp ${d.worldId}`, true)}>
                {d.name} ({d.worldId})
              </button>{' '}
              <small>{new Date(d.savedAt).toLocaleString()}</small>{' '}
              <button
                className="bad"
                onClick={() => {
                  if (window.confirm(`Xóa bản nháp ${d.worldId}?`)) void deleteDraft(d.worldId).then(() => store().refreshDrafts())
                }}
              >
                Xóa nháp
              </button>
            </li>
          ))}
        </ul>
        <div className="row">
          <button onClick={() => store().set({ dialog: null })}>Hủy</button>
        </div>
      </div>
    </div>
  )
}

export function NewDialog() {
  const dialog = useEditorStore((s) => s.dialog)
  const [worldId, setWorldId] = useState('new-world')
  const [name, setName] = useState('World mới')
  const [mode, setMode] = useState<'blank' | 'generate'>('blank')
  const [seed, setSeed] = useState('1')
  const [blocks, setBlocks] = useState('2x2')
  const [layout, setLayout] = useState<Layout>('grid')
  const [trees, setTrees] = useState(String(DEFAULT_TREES))
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (dialog === 'new') input.current?.focus()
  }, [dialog])
  if (dialog !== 'new') return null
  const valid = SLUG.test(worldId) && name.trim().length > 0 && (mode === 'blank' || Number.isInteger(Number(seed)))
  return (
    <div className="modal" role="dialog">
      <div className="box">
        <h3>World mới</h3>
        <label className="field">
          <span>Kiểu</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as 'blank' | 'generate')} data-new-mode>
            <option value="blank">Trống</option>
            <option value="generate">Sinh bằng generator</option>
          </select>
        </label>
        {mode === 'blank' ? (
          <p className="hint">2 × 2 chunk 32 m quanh gốc tọa độ, hàng rào, spawn người chơi + 1 spawn zombie; thư viện prefab lấy từ neighborhood-50.</p>
        ) : (
          <>
            <p className="hint">Thị trấn: đường quanh mỗi khối, lô với prefab của neighborhood-50 quay cửa ra đường, hàng rào, thùng, đống phế liệu, xe, cây, zone chữ nhật + spawn zombie mỗi khối. Cùng thông số → cùng kết quả (giống npm run map:generate).</p>
            <label className="field">
              <span>Bố cục</span>
              <select value={layout} onChange={(e) => setLayout(e.target.value as Layout)} data-gen-layout>
                <option value="grid">Lưới đều (khối 28 m, 4 lô)</option>
                <option value="varied">Đa dạng (khối 22–34 m, lô không đều, công viên)</option>
              </select>
            </label>
            <label className="field">
              <span>Cây</span>
              <select value={trees} onChange={(e) => setTrees(e.target.value)} data-gen-trees>
                <option value="0">Không có</option>
                <option value="0.25">Ít</option>
                <option value="0.5">Vừa</option>
                <option value="1">Nhiều</option>
              </select>
            </label>
            <label className="field">
              <span>Seed</span>
              <input type="number" value={seed} onChange={(e) => setSeed(e.target.value)} data-gen-seed />
            </label>
            <label className="field">
              <span>Khối</span>
              <select value={blocks} onChange={(e) => setBlocks(e.target.value)} data-gen-blocks>
                {['1x1', '2x1', '2x2', '3x2', '3x3', '4x4'].map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <label className="field">
          <span>worldId</span>
          <input ref={input} value={worldId} onChange={(e) => setWorldId(e.target.value)} />
        </label>
        <label className="field">
          <span>Tên</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {!SLUG.test(worldId) && <p className="error">worldId: chữ thường, số, gạch nối.</p>}
        <div className="row">
          <button
            disabled={!valid}
            onClick={() => {
              const [bx, bz] = blocks.split('x').map(Number)
              useEditorStore.getState().newWorld(worldId, name.trim(), mode === 'generate' ? { seed: Number(seed), blocksX: bx, blocksZ: bz, layout, trees: Number(trees) } : undefined)
            }}
          >
            Tạo
          </button>
          <button onClick={() => useEditorStore.getState().set({ dialog: null })}>Hủy</button>
        </div>
      </div>
    </div>
  )
}

/** New prefab (M5): a starter house (four walls, a door, one room with a lamp), opened for editing. */
export function SaveAsDialog() {
  const dialog = useEditorStore((s) => s.dialog)
  const world = useEditorStore((s) => s.edit?.doc.world)
  if (dialog !== 'saveAs' || !world) return null
  return <SaveAsForm key={world.worldId} fromId={world.worldId} fromName={world.name} />
}

function SaveAsForm({ fromId, fromName }: { fromId: string; fromName: string }) {
  const [worldId, setWorldId] = useState(`${fromId}-copy`)
  const [name, setName] = useState(`${fromName} (bản sao)`)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.select(), [])
  const taken = worldId === fromId || bundledWorldIds().includes(worldId)
  const valid = SLUG.test(worldId) && !taken && name.trim().length > 0 && !busy
  const submit = () => {
    if (!valid) return
    setBusy(true)
    setError(null)
    void useEditorStore
      .getState()
      .saveAsWorld(worldId, name.trim())
      .then((ok) => ok || setError(useEditorStore.getState().status?.text ?? null))
      .finally(() => setBusy(false))
  }
  return (
    <div className="modal" role="dialog">
      <div className="box">
        <h3>Lưu thành world mới</h3>
        <p className="hint">
          Bản sao của {fromId} kể cả phần chưa lưu, với worldId mới: chunk, prefab và ID giữ nguyên, contentVersion về 1, không kèm migration save của world gốc. {fromId} không đổi. Bản sao được lưu
          nháp ngay và mở để sửa tiếp (lịch sử hoàn tác bắt đầu lại). Đưa vào repo: Export rồi npm run map:unpack (không cần --force); chơi bằng ?world=&lt;worldId&gt; với slot save riêng.
        </p>
        <label className="field">
          <span>worldId</span>
          <input ref={input} value={worldId} onChange={(e) => setWorldId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} data-save-as-id />
        </label>
        <label className="field">
          <span>Tên</span>
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} data-save-as-name />
        </label>
        {!SLUG.test(worldId) && <p className="error">worldId: chữ thường, số, gạch nối.</p>}
        {taken && <p className="error">{worldId === fromId ? 'worldId phải khác world đang mở.' : `content/maps/${worldId} đã có trong repo.`}</p>}
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button disabled={!valid} onClick={submit} data-save-as-ok>
            Lưu thành
          </button>
          <button onClick={() => useEditorStore.getState().set({ dialog: null })}>Hủy</button>
        </div>
      </div>
    </div>
  )
}

export function NewPrefabDialog() {
  const dialog = useEditorStore((s) => s.dialog)
  const [prefabId, setPrefabId] = useState('building/new-house')
  const [name, setName] = useState('Nhà mới')
  const [width, setWidth] = useState('8')
  const [depth, setDepth] = useState('6')
  if (dialog !== 'newPrefab') return null
  const create = () => {
    const s = useEditorStore.getState()
    if (s.run(`Tạo prefab ${prefabId}`, (d) => createPrefab(d, { prefabId, name, width: Number(width), depth: Number(depth) }))) {
      s.set({ dialog: null })
      s.enterPrefab(prefabId)
    }
  }
  return (
    <div className="modal" role="dialog">
      <div className="box">
        <h3>Prefab mới</h3>
        <p className="hint">Nhà mẫu: 4 bức tường, cửa ở tường nam (mở vào trong), một phòng có đèn. Sau đó mở chế độ sửa prefab.</p>
        <label className="field">
          <span>prefabId</span>
          <input value={prefabId} onChange={(e) => setPrefabId(e.target.value)} />
        </label>
        <label className="field">
          <span>Tên</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Rộng X (m)</span>
          <input type="number" value={width} onChange={(e) => setWidth(e.target.value)} />
        </label>
        <label className="field">
          <span>Sâu Z (m)</span>
          <input type="number" value={depth} onChange={(e) => setDepth(e.target.value)} />
        </label>
        <div className="row">
          <button onClick={create}>Tạo</button>
          <button onClick={() => useEditorStore.getState().set({ dialog: null })}>Hủy</button>
        </div>
      </div>
    </div>
  )
}

/** Duplicate a prefab under a new ID (a variant; placed instances keep the original). */
export function DuplicatePrefabDialog() {
  const dialog = useEditorStore((s) => s.dialog)
  const source = useEditorStore((s) => s.dialogPrefab)
  const [prefabId, setPrefabId] = useState('')
  const [name, setName] = useState('')
  const [shown, setShown] = useState<string | null>(null)
  if (dialog !== 'duplicatePrefab' || !source) return null
  if (shown !== source) {
    setShown(source)
    setPrefabId(`${source}-b`)
    setName(`${useEditorStore.getState().edit?.doc.prefabs.get(source)?.name ?? source} (biến thể)`)
  }
  const create = () => {
    const s = useEditorStore.getState()
    if (s.run(`Nhân bản prefab ${source}`, (d) => duplicatePrefab(d, source, prefabId, name))) s.set({ dialog: null, dialogPrefab: null })
  }
  return (
    <div className="modal" role="dialog">
      <div className="box">
        <h3>Nhân bản prefab {source}</h3>
        <p className="hint">Tạo prefabId mới (biến thể). Instance đã đặt vẫn dùng prefab gốc.</p>
        <label className="field">
          <span>prefabId mới</span>
          <input value={prefabId} onChange={(e) => setPrefabId(e.target.value)} />
        </label>
        <label className="field">
          <span>Tên</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="row">
          <button onClick={create}>Nhân bản</button>
          <button onClick={() => useEditorStore.getState().set({ dialog: null, dialogPrefab: null })}>Hủy</button>
        </div>
      </div>
    </div>
  )
}
