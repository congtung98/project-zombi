import { useState } from 'react'
import { ARCHITECTURE_STYLES, LIBRARY_GROUPS, type ArchitectureStyle, type LibraryGroup, type LibraryInfo, type PrefabDocument } from '../map/schema'
import { findRecord, type MapDocument } from '../map/editor/document'
import { documentGroups, fullGroups, groupOf, liveMembers, slugify, type CompoundGroup } from '../map/editor/groups'
import {
  compoundGroupOutdated,
  freePrefabId,
  groupMemberStates,
  importPrefab,
  libraryGroupOf,
  LIBRARY_WORLD,
  linkPrefab,
  planCompoundUpdate,
  planPrefabUpdate,
  prefabStatus,
  saveCompound,
  type CompoundUpdatePlan,
  type LibraryState,
  type PrefabUpdatePlan,
  type SharedLibrary,
} from '../map/editor/library'
import { updatePrefab } from '../map/editor/prefabCommands'
import { sharedLibrary, useEditorStore } from './editorStore'
import { ReadField, TextField } from './fields'
import { deleteSelection, duplicateSelection, groupSelection, rotateSelection, ungroupSelection } from './interaction'
import { CompoundThumbnail, PrefabThumbnail } from './Thumbnail'
import { GROUP_LABEL, STYLE_LABEL } from './libraryLabels'

/**
 * Prefab library P1 in the editor: the shared library (building prefabs and compounds of the repo
 * world `prefab-library`) in the Prefab tab, copy-on-import with its status, the previewed update of
 * a world's copy or placed compound, saving a group as a compound, and the Inspector of a group.
 */

const STATE_LABEL: Record<LibraryState, string> = {
  absent: 'Chưa có trong world',
  current: 'Đã nhập, mới nhất',
  outdated: 'Thư viện có bản mới',
  modified: 'Đã sửa trong world',
  'modified-outdated': 'Đã sửa trong world, thư viện có bản mới',
  'id-taken': 'Trùng ID với prefab khác của world',
}

type Kind = 'all' | 'prefab' | 'compound'

function matches(text: string, q: string): boolean {
  return !q || slugify(text).includes(slugify(q)) || text.toLowerCase().includes(q.toLowerCase())
}

function chips(info: { group: LibraryGroup; style?: ArchitectureStyle }): string {
  return `${GROUP_LABEL[info.group]} · ${STYLE_LABEL[info.style ?? 'generic']}`
}

/** The shared library section of the Prefab tab. */
export function LibraryPanel() {
  const edit = useEditorStore((s) => s.edit)!
  const tool = useEditorStore((s) => s.tool)
  const place = useEditorStore((s) => s.place)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<Kind>('all')
  const [group, setGroup] = useState<LibraryGroup | ''>('')
  const [style, setStyle] = useState<ArchitectureStyle | ''>('')
  const lib = sharedLibrary(edit.doc)
  if (!lib) return <p className="hint">Không có thư viện chung (content/maps/{LIBRARY_WORLD}).</p>
  const doc = edit.doc
  const isLibrary = doc.world.worldId === lib.worldId
  const store = useEditorStore.getState
  const keep = (info: { group: LibraryGroup; style?: ArchitectureStyle }, text: string) => (!group || info.group === group) && (!style || (info.style ?? 'generic') === style) && matches(text, query)
  const prefabs = kind === 'compound' ? [] : [...lib.prefabs.values()].filter((p) => keep({ group: libraryGroupOf(p), style: p.catalog?.architectureStyle }, `${p.name} ${p.prefabId} ${p.catalog?.tags?.join(' ') ?? ''}`))
  const compounds = kind === 'prefab' ? [] : [...lib.compounds.values()].filter((c) => keep({ group: c.catalog?.group ?? 'public', style: c.catalog?.architectureStyle }, `${c.name} ${c.compoundId} ${c.catalog?.tags?.join(' ') ?? ''}`))
  return (
    <div data-library>
      <p className="hint">
        {isLibrary
          ? 'Đang mở chính world thư viện: sửa prefab ở đây rồi xuất và map:unpack để các world khác thấy bản mới. Chọn các record rồi "Lưu thành compound…" ở Inspector để tạo compound.'
          : `Thư viện chung ${lib.worldId} v${lib.contentVersion}: "Thêm vào world" chép một bản vào world này (không tự đổi theo thư viện). Có bản mới thì xem trước rồi mới cập nhật.`}
      </p>
      <input className="search" placeholder="Tìm trong thư viện…" value={query} onChange={(e) => setQuery(e.target.value)} data-library-search />
      <div className="row tight">
        <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} data-library-kind>
          <option value="all">Tất cả</option>
          <option value="prefab">Công trình</option>
          <option value="compound">Compound</option>
        </select>
        <select value={group} onChange={(e) => setGroup(e.target.value as LibraryGroup | '')} data-library-group>
          <option value="">Mọi nhóm</option>
          {LIBRARY_GROUPS.map((g) => (
            <option key={g} value={g}>
              {GROUP_LABEL[g]}
            </option>
          ))}
        </select>
        <select value={style} onChange={(e) => setStyle(e.target.value as ArchitectureStyle | '')} data-library-style>
          <option value="">Mọi phong cách</option>
          {ARCHITECTURE_STYLES.map((s) => (
            <option key={s} value={s}>
              {STYLE_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      <ul className="palette">
        {prefabs.map((p) => (
          <LibraryPrefabItem key={p.prefabId} doc={doc} lib={lib} prefab={p} isLibrary={isLibrary} active={tool === 'place' && place?.kind === 'prefab'} placing={place?.kind === 'prefab' ? place.prefabId : null} />
        ))}
        {compounds.map((c) => {
          const active = tool === 'place' && place?.kind === 'compound' && place.compoundId === c.compoundId
          const f = c.footprint
          return (
            <li key={c.compoundId} data-library-compound={c.compoundId}>
              <button className={`with-thumb${active ? ' active' : ''}`} onClick={() => store().setTool(active ? 'select' : 'place', active ? null : { kind: 'compound', compoundId: c.compoundId })}>
                <CompoundThumbnail compound={c} library={lib} />
                <span>
                  <strong>{c.name}</strong>
                  <small>
                    Compound {c.compoundId} v{c.contentVersion} · {Math.round(f.maxX - f.minX)}×{Math.round(f.maxZ - f.minZ)} m · {c.instances.length} công trình, {c.objects.length} object
                  </small>
                  <small>{chips({ group: c.catalog?.group ?? 'public', style: c.catalog?.architectureStyle })}</small>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {!prefabs.length && !compounds.length && <p className="hint">Không có mục nào khớp.</p>}
      {lib.issues.length > 0 && <p className="hint bad">{lib.issues.length} vấn đề trong file compound của thư viện (xem Validate khi mở world thư viện).</p>}
      <p className="hint">Compound: click rồi click viewport để đặt (R xoay trước khi đặt). Nó thành các record thường cộng một nhóm: click chọn cả nhóm, Alt+click chọn một phần để sửa riêng.</p>
    </div>
  )
}

function LibraryPrefabItem({ doc, lib, prefab: p, isLibrary, active, placing }: { doc: MapDocument; lib: SharedLibrary; prefab: PrefabDocument; isLibrary: boolean; active: boolean; placing: string | null }) {
  const store = useEditorStore.getState
  const st = isLibrary ? null : prefabStatus(doc, lib, p.prefabId)
  const worldId = isLibrary ? p.prefabId : st?.worldPrefabId
  const inWorld = isLibrary || (st && st.state !== 'absent' && st.state !== 'id-taken')
  const f = p.footprint
  const storeys = p.building?.storeys ?? 1
  const place = () => worldId && store().setTool(active && placing === worldId ? 'select' : 'place', active && placing === worldId ? null : { kind: 'prefab', prefabId: worldId })
  return (
    <li data-library-prefab={p.prefabId} data-library-state={st?.state ?? 'library'}>
      <button className={`with-thumb${active && placing === worldId ? ' active' : ''}`} onClick={() => (inWorld ? place() : undefined)} title={inWorld ? 'Đặt vào world' : 'Thêm vào world trước'}>
        <PrefabThumbnail prefab={p} />
        <span>
          <strong>{p.name}</strong>
          <small>
            {p.prefabId} v{p.contentVersion} · {f.maxX - f.minX}×{f.maxZ - f.minZ} m{storeys > 1 ? ` · ${storeys} tầng` : ''}
          </small>
          <small>{chips({ group: libraryGroupOf(p), style: p.catalog?.architectureStyle })}</small>
          {st && (
            <small className={st.state === 'current' ? '' : 'warn'} data-library-status>
              {STATE_LABEL[st.state]}
              {st.worldPrefabId && st.worldPrefabId !== p.prefabId && st.state !== 'id-taken' ? ` (${st.worldPrefabId})` : ''}
              {st.importedVersion !== undefined && st.importedVersion !== st.libVersion ? ` · world v${st.importedVersion}, thư viện v${st.libVersion}` : ''}
            </small>
          )}
        </span>
      </button>
      {st && (
        <div className="row tight">
          {st.state === 'absent' && (
            <button onClick={() => store().run(`Nhập ${p.prefabId} từ thư viện`, (d) => importPrefab(d, lib, p.prefabId))} data-library-import>
              Thêm vào world
            </button>
          )}
          {st.state === 'id-taken' && st.identical && (
            <button onClick={() => store().run(`Liên kết ${p.prefabId}`, (d) => linkPrefab(d, lib, p.prefabId))} title="Prefab của world giống hệt bản thư viện: ghi nguồn để nhận cập nhật" data-library-link>
              Liên kết
            </button>
          )}
          {st.state === 'id-taken' && !st.identical && (
            <button
              onClick={() => store().run(`Nhập ${p.prefabId} với ID mới`, (d) => importPrefab(d, lib, p.prefabId, freePrefabId(d, p.prefabId)))}
              title={`World đã có ${p.prefabId} khác: nhập bản thư viện thành ${freePrefabId(doc, p.prefabId)}, không đụng prefab cũ`}
              data-library-import-as
            >
              Nhập với ID mới
            </button>
          )}
          {(st.state === 'outdated' || st.state === 'modified-outdated') && (
            <button onClick={() => store().set({ dialog: 'libraryUpdate', libraryUpdate: { kind: 'prefab', id: st.worldPrefabId! } })} data-library-update>
              Xem cập nhật…
            </button>
          )}
          {inWorld && <button onClick={place}>Đặt</button>}
        </div>
      )}
    </li>
  )
}

/** Library section of the prefab Inspector: provenance of a world copy, or the catalog of a library prefab. */
export function PrefabLibraryFields({ doc, prefab }: { doc: MapDocument; prefab: PrefabDocument }) {
  const run = useEditorStore((s) => s.run)
  const lib = sharedLibrary(doc)
  const id = prefab.prefabId
  const catalog: LibraryInfo = prefab.catalog ?? { group: libraryGroupOf(prefab) }
  const patch = (label: string, c: LibraryInfo | null) => run(label, (d, sel) => updatePrefab(d, id, { catalog: c }, sel))
  const st = lib && prefab.source?.library === lib.worldId ? prefabStatus(doc, lib, prefab.source.id) : null
  return (
    <>
      <h4>Thư viện chung</h4>
      {prefab.source ? (
        <>
          <ReadField label="Nguồn" value={`${prefab.source.library}: ${prefab.source.id} v${prefab.source.version}`} />
          {st && <ReadField label="Trạng thái" value={STATE_LABEL[st.state]} />}
          {st && (st.state === 'outdated' || st.state === 'modified-outdated') && (
            <button onClick={() => useEditorStore.getState().set({ dialog: 'libraryUpdate', libraryUpdate: { kind: 'prefab', id } })} data-prefab-library-update>
              Xem cập nhật từ thư viện…
            </button>
          )}
          <p className="hint">Bản chép của world: sửa ở đây không đổi thư viện; thư viện đổi cũng không tự đổi bản này.</p>
        </>
      ) : (
        <ReadField label="Nguồn" value={doc.world.worldId === LIBRARY_WORLD ? 'chính thư viện' : 'tạo trong world này'} />
      )}
      <label className="field">
        <span>Nhóm</span>
        <select value={catalog.group} onChange={(e) => patch('Đổi nhóm thư viện', { ...catalog, group: e.target.value as LibraryGroup })} data-prefab-library-group>
          {LIBRARY_GROUPS.map((g) => (
            <option key={g} value={g}>
              {GROUP_LABEL[g]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Phong cách</span>
        <select value={catalog.architectureStyle ?? 'generic'} onChange={(e) => patch('Đổi phong cách', { ...catalog, architectureStyle: e.target.value === 'generic' ? undefined : (e.target.value as ArchitectureStyle) })} data-prefab-library-style>
          {ARCHITECTURE_STYLES.map((s) => (
            <option key={s} value={s}>
              {STYLE_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <TextField label="Tag (cách nhau dấu phẩy)" value={catalog.tags?.join(', ') ?? '-'} onCommit={(t) => patch('Đổi tag', { ...catalog, tags: t.split(',').map((x) => slugify(x)).filter(Boolean) })} />
      <TextField label="Mô tả" value={catalog.description ?? '-'} onCommit={(t) => patch('Đổi mô tả', { ...catalog, description: t === '-' ? undefined : t })} />
    </>
  )
}

/** The previewed update of a world copy (prefab) or a placed compound (group). */
export function LibraryUpdateDialog() {
  const dialog = useEditorStore((s) => s.dialog)
  const target = useEditorStore((s) => s.libraryUpdate)
  const edit = useEditorStore((s) => s.edit)
  const [overwriteLocal, setOverwrite] = useState(false)
  const [acceptStateChanges, setAccept] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  if (dialog !== 'libraryUpdate' || !target || !edit) return null
  const lib = sharedLibrary(edit.doc)
  const opts = { overwriteLocal, acceptStateChanges }
  const planned = lib ? (target.kind === 'prefab' ? planPrefabUpdate(edit.doc, lib, target.id, opts) : planCompoundUpdate(edit.doc, lib, target.id, opts)) : 'Không có thư viện chung'
  const close = () => {
    const s = useEditorStore.getState()
    s.setPreview(null)
    setPreviewing(false)
    setOverwrite(false)
    setAccept(false)
    s.set({ dialog: null, libraryUpdate: null })
  }
  const apply = () => {
    const s = useEditorStore.getState()
    s.setPreview(null)
    const ok = s.run(target.kind === 'prefab' ? `Cập nhật ${target.id} từ thư viện` : `Cập nhật compound ${target.id} từ thư viện`, (d) => {
      const p = lib ? (target.kind === 'prefab' ? planPrefabUpdate(d, lib, target.id, opts) : planCompoundUpdate(d, lib, target.id, opts)) : 'Không có thư viện chung'
      if (typeof p === 'string') return { ok: false, error: p }
      if (!p.doc) return { ok: false, error: p.blockers.join(' · ') }
      return { ok: true, doc: p.doc, selection: target.kind === 'compound' ? (documentGroups(p.doc).find((g) => g.groupId === target.id)?.members.map((m) => m.id) ?? []) : [] }
    })
    if (ok) close()
  }
  const list = (label: string, items: readonly string[]) => (items.length ? <ReadField label={label} value={items.join(', ')} /> : null)
  return (
    <div className="modal" role="dialog" data-library-update-dialog>
      <div className="box">
        <h3>{target.kind === 'prefab' ? `Cập nhật prefab ${target.id} từ thư viện` : `Cập nhật compound (nhóm ${target.id}) từ thư viện`}</h3>
        {typeof planned === 'string' ? (
          <p className="hint">{planned}</p>
        ) : (
          <>
            <ReadField label="Phiên bản" value={`v${planned.fromVersion} → v${planned.toVersion}`} />
            {'instances' in planned ? <PrefabPlanRows plan={planned} list={list} /> : <CompoundPlanRows plan={planned} list={list} />}
            {planned.blockers.map((b) => (
              <p key={b} className="hint bad" data-library-blocker>
                {b}
              </p>
            ))}
            <label className="field">
              <span>Ghi đè bản sửa trong world</span>
              <input type="checkbox" checked={overwriteLocal} onChange={(e) => setOverwrite(e.target.checked)} data-library-overwrite />
            </label>
            <label className="field">
              <span>Chấp nhận đổi ID có trạng thái</span>
              <input type="checkbox" checked={acceptStateChanges} onChange={(e) => setAccept(e.target.checked)} data-library-accept />
            </label>
            <p className="hint">Không có gì đổi cho tới khi bấm Áp dụng; Áp dụng là một bước, Ctrl+Z hoàn tác được. ID cửa, tủ, cửa sổ, đèn giữ nguyên ở mọi phần không bị bỏ.</p>
          </>
        )}
        <div className="row">
          {typeof planned !== 'string' && planned.doc && (
            <button
              onClick={() => {
                const s = useEditorStore.getState()
                if (previewing) s.setPreview(null)
                else s.setPreview({ doc: planned.doc!, ghostIds: [] })
                setPreviewing(!previewing)
              }}
              data-library-preview
            >
              {previewing ? 'Tắt xem trước' : 'Xem trước trong viewport'}
            </button>
          )}
          <button disabled={typeof planned === 'string' || !planned.doc} onClick={apply} data-library-apply>
            Áp dụng
          </button>
          <button onClick={close}>Hủy</button>
        </div>
      </div>
    </div>
  )
}

function PrefabPlanRows({ plan, list }: { plan: PrefabUpdatePlan; list: (label: string, items: readonly string[]) => React.ReactNode }) {
  return (
    <>
      <ReadField label="Instance đổi theo" value={String(plan.instances.length)} />
      {list('Thêm', plan.added)}
      {list('Bỏ', plan.removed)}
      {list('Đổi', plan.changed)}
      {list('Bỏ ID có trạng thái', plan.removedStateful)}
      {plan.footprintChanged && <p className="hint warn">Footprint/pivot đổi: kiểm tra instance có chồng lên thứ khác không (Validate).</p>}
      {plan.modifiedInWorld && <p className="hint warn">Bản trong world đã được sửa.</p>}
    </>
  )
}

function CompoundPlanRows({ plan, list }: { plan: CompoundUpdatePlan; list: (label: string, items: readonly string[]) => React.ReactNode }) {
  return (
    <>
      {list('Thay (giữ ID)', plan.replaced)}
      {list('Thêm', plan.added)}
      {list('Bỏ', plan.removed)}
      {list('Giữ bản sửa tay', plan.keptModified)}
      {list('Đã xóa tay (giữ xóa)', plan.missing)}
      {list('Tách khỏi nhóm (đã sửa tay, bản mới bỏ)', plan.detached)}
      {list('Bỏ ID có trạng thái', plan.removedStateful)}
      {plan.notes.map((n) => (
        <p key={n} className="hint">
          {n}
        </p>
      ))}
    </>
  )
}

/** Save the selection (or its group) as a compound of this world's `compounds/` (the library world: the shared library). */
export function SaveCompoundDialog() {
  const dialog = useEditorStore((s) => s.dialog)
  const edit = useEditorStore((s) => s.edit)
  const [form, setForm] = useState<{ key: string; compoundId: string; name: string; group: LibraryGroup; style: ArchitectureStyle } | null>(null)
  if (dialog !== 'saveCompound' || !edit) return null
  const sel = edit.selection
  const g = fullGroups(edit.doc, sel)[0] ?? null
  const key = sel.join('|')
  if (!form || form.key !== key) {
    const linked = g?.compoundId ? { compoundId: g.compoundId, name: g.name } : { compoundId: `compound/${slugify(g?.name ?? 'moi') || 'moi'}`, name: g?.name ?? 'Compound mới' }
    setForm({ key, ...linked, group: 'public', style: 'generic' })
    return null
  }
  const save = () => {
    const s = useEditorStore.getState()
    const catalog: LibraryInfo = { group: form.group, ...(form.style !== 'generic' ? { architectureStyle: form.style } : {}) }
    if (s.run(`Lưu compound ${form.compoundId}`, (d, selection) => saveCompound(d, selection, { compoundId: form.compoundId, name: form.name, catalog }))) s.set({ dialog: null })
  }
  return (
    <div className="modal" role="dialog" data-save-compound-dialog>
      <div className="box">
        <h3>Lưu thành compound</h3>
        <p className="hint">
          {sel.length} record (công trình, tường, rào, cây, trang trí, mặt nền) thành một compound trong compounds/ của world này
          {edit.doc.world.worldId === LIBRARY_WORLD ? ': đây là world thư viện, compound vào thư viện chung khi xuất và map:unpack.' : '. Chỉ compound của world thư viện mới hiện trong thư viện chung.'} Lưu lại cùng ID thì tăng phiên bản; các record thành một nhóm gắn với compound.
        </p>
        <label className="field">
          <span>compoundId</span>
          <input value={form.compoundId} onChange={(e) => setForm({ ...form, compoundId: e.target.value })} data-compound-id />
        </label>
        <label className="field">
          <span>Tên</span>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-compound-name />
        </label>
        <label className="field">
          <span>Nhóm</span>
          <select value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value as LibraryGroup })}>
            {LIBRARY_GROUPS.map((x) => (
              <option key={x} value={x}>
                {GROUP_LABEL[x]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Phong cách</span>
          <select value={form.style} onChange={(e) => setForm({ ...form, style: e.target.value as ArchitectureStyle })}>
            {ARCHITECTURE_STYLES.map((x) => (
              <option key={x} value={x}>
                {STYLE_LABEL[x]}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <button onClick={save} data-compound-save>
            Lưu
          </button>
          <button onClick={() => useEditorStore.getState().set({ dialog: null })}>Hủy</button>
        </div>
      </div>
    </div>
  )
}

/** Inspector of a selected group (a placed compound or a Ctrl+G group). */
export function GroupInspector({ doc, group: g }: { doc: MapDocument; group: CompoundGroup }) {
  const lib = sharedLibrary(doc)
  const states = groupMemberStates(doc, g)
  const outdated = lib ? compoundGroupOutdated(g, lib) : false
  const libVersion = lib && g.compoundId ? lib.compounds.get(g.compoundId)?.contentVersion : undefined
  const store = useEditorStore.getState
  return (
    <div className="inspector" data-group-inspector={g.groupId}>
      <h3>{g.compoundId ? 'Compound (nhóm)' : 'Nhóm'}</h3>
      <ReadField label="Tên" value={g.name} />
      <ReadField label="Nhóm" value={g.groupId} />
      {g.compoundId && <ReadField label="Compound" value={`${g.compoundId}${g.source ? ` v${g.source.version} (${g.source.library})` : ''}`} />}
      {outdated && (
        <>
          <p className="hint warn">Thư viện có bản v{libVersion}. World giữ bản đang có cho tới khi bạn cập nhật.</p>
          <button onClick={() => store().set({ dialog: 'libraryUpdate', libraryUpdate: { kind: 'compound', id: g.groupId } })} data-group-update>
            Xem cập nhật từ thư viện…
          </button>
        </>
      )}
      <ReadField label="Pivot" value={`(${g.pivot.x}, ${g.pivot.z}), xoay ${g.quarterTurns * 90}°`} />
      <h4>Thành phần ({liveMembers(doc, g).length})</h4>
      <ul className="ids" data-group-members>
        {states.map((m) => (
          <li key={m.member}>
            <button className="link" disabled={m.state === 'missing'} onClick={() => store().select([m.id])} title="Chọn riêng phần này để sửa (như Alt+click)">
              {m.member}
            </button>{' '}
            <small className={m.state === 'ok' ? '' : 'warn'}>{m.state === 'ok' ? '' : m.state === 'modified' ? 'đã sửa tay' : 'đã xóa'}</small>
          </li>
        ))}
      </ul>
      <div className="row">
        <button onClick={() => rotateSelection(1)} title="R">
          Xoay 90°
        </button>
        <button onClick={duplicateSelection} title="Ctrl+D">
          Nhân bản
        </button>
        <button onClick={deleteSelection} title="Delete">
          Xóa
        </button>
      </div>
      <div className="row">
        <button onClick={ungroupSelection} title="Ctrl+Shift+G" data-group-ungroup>
          Rã nhóm
        </button>
        <button onClick={() => store().set({ dialog: 'saveCompound' })} data-group-save-compound>
          Lưu thành compound…
        </button>
      </div>
      <p className="hint">Click một phần chọn cả nhóm; Alt+click (hoặc bấm tên ở trên) chọn riêng một phần để sửa. Phần sửa tay được giữ khi cập nhật từ thư viện. Game chỉ thấy các record thường.</p>
    </div>
  )
}

/** Row for a single record that belongs to a group (select the whole group back). */
export function RecordGroupRow({ doc, id }: { doc: MapDocument; id: string }) {
  const g = groupOf(doc, id)
  if (!g) return null
  return (
    <div className="field">
      <span>Thuộc nhóm</span>
      <button className="link" onClick={() => useEditorStore.getState().select(liveMembers(doc, g).map((m) => m.id))} data-select-group>
        {g.name} ({g.groupId})
      </button>
    </div>
  )
}

/** Multi-selection without a whole group: group it or save it as a compound. */
export function SelectionGroupActions({ doc, ids }: { doc: MapDocument; ids: readonly string[] }) {
  const store = useEditorStore.getState
  const allRecords = ids.every((id) => findRecord(doc, id))
  if (!allRecords) return null
  return (
    <div className="row">
      <button onClick={groupSelection} title="Ctrl+G" data-group-create>
        Nhóm lại
      </button>
      <button onClick={() => store().set({ dialog: 'saveCompound' })} data-selection-save-compound>
        Lưu thành compound…
      </button>
    </div>
  )
}
