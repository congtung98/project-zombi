import { buildOutlineWalls, fitFootprint, isStatefulItem, updatePrefab, updatePrefabItem, type PrefabPatch } from '../map/editor/prefabCommands'
import { cutOutlineCorner, dragOutlineVertex, notchOutlineEdge } from '../map/editor/outlines'
import { outlineCentre, rectOutline } from '../map/polygon'
import { instancesOf, type AnyRecord, type MapDocument } from '../map/editor/document'
import { wallRunBoxes } from '../map/resolve'
import type { PrefabDocument, PrefabObject, QuarterTurns, Rect, RoomObject, XZ } from '../map/schema'
import { OPTS, useEditorStore } from './editorStore'
import { NumField, ReadField, TextField, TreeFields } from './fields'
import { confirmStateful, deleteSelection, duplicateSelection, rotateSelection } from './interaction'

/**
 * Inspector of the prefab editor (M5). Every change goes through the prefab commands (one history
 * entry each). The local ID is shown with the stable ID it gives every instance; renaming or
 * deleting a stateful item (door, container, window, lamp) asks first, because saves hold state
 * for `<instance>/<localId>`.
 */

const COLOR = /^#[0-9a-f]{6}$/i
const KIND_LABEL: Record<string, string> = {
  wallRun: 'Tường (tự khoét cửa)',
  wall: 'Khối tường',
  prop: 'Nội thất / vật cản',
  container: 'Tủ (container)',
  door: 'Cửa đi',
  window: 'Cửa sổ',
  room: 'Phòng',
  lamp: 'Đèn + công tắc',
}

function Turns({ value, onChange }: { value: number; onChange: (q: QuarterTurns) => void }) {
  return (
    <label className="field">
      <span>Xoay</span>
      <select value={String(value)} onChange={(e) => onChange(Number(e.target.value) as QuarterTurns)}>
        {[0, 1, 2, 3].map((q) => (
          <option key={q} value={q}>
            {q * 90}°
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * M11a: an L/T/U outline (footprint or room). A rectangle converts to 4 vertices; then vertices move
 * by number (their edges follow), a corner becomes a notch ("Khoét góc", again on a notch fills it),
 * an edge gets a notch in its middle third ("Khoét cạnh"). Viewport handles do the same by drag.
 */
function OutlineEditor({ outline, bounds, onChange }: { outline: readonly XZ[] | undefined; bounds: Rect; onChange: (label: string, outline: XZ[] | null) => void }) {
  const setStatus = useEditorStore((s) => s.setStatus)
  const apply = (label: string, next: XZ[] | null) => {
    if (next) onChange(label, next)
    else setStatus(`${label}: hình mới không hợp lệ (cạnh cắt nhau hoặc quá nhỏ)`, 'error')
  }
  if (!outline) {
    return (
      <button onClick={() => onChange('Chuyển thành đa giác', rectOutline(bounds))} data-outline-convert>
        Chuyển thành đa giác (L, T, U…)
      </button>
    )
  }
  return (
    <div className="outline" data-outline={outline.length}>
      {outline.map((p, i) => (
        <div key={i} className="outline-vertex" data-vertex={i}>
          <b>{i + 1}</b>
          <NumField label="X" value={p.x} onCommit={(x) => apply('Dời đỉnh', dragOutlineVertex(outline, i, { x, z: p.z }))} />
          <NumField label="Z" value={p.z} onCommit={(z) => apply('Dời đỉnh', dragOutlineVertex(outline, i, { x: p.x, z }))} />
          <div className="row">
            <button title="Góc này thành chỗ khoét (góc trong của chỗ khoét: lấp lại)" onClick={() => apply('Khoét góc', cutOutlineCorner(outline, i))} data-cut-corner={i}>
              Khoét góc
            </button>
            <button title={`Khoét giữa cạnh ${i + 1}→${((i + 1) % outline.length) + 1}`} onClick={() => apply('Khoét cạnh', notchOutlineEdge(outline, i))} data-notch-edge={i}>
              Khoét cạnh {i + 1}→{((i + 1) % outline.length) + 1}
            </button>
          </div>
        </div>
      ))}
      <button onClick={() => onChange('Về hình chữ nhật', null)} data-outline-clear>
        Về hình chữ nhật (bounding box)
      </button>
    </div>
  )
}

function PrefabProps({ doc, prefab }: { doc: MapDocument; prefab: PrefabDocument }) {
  const run = useEditorStore((s) => s.run)
  const view = useEditorStore((s) => s.prefabView)
  const outlineEdit = useEditorStore((s) => s.outlineEdit)
  const showReach = useEditorStore((s) => s.showReach)
  const set = useEditorStore((s) => s.set)
  const id = prefab.prefabId
  const patch = (label: string, p: PrefabPatch) => run(label, (d, sel) => updatePrefab(d, id, p, sel))
  const f = prefab.footprint
  const b = prefab.building
  const uses = instancesOf(doc, id)
  return (
    <div className="inspector">
      <h3>Prefab gốc</h3>
      <ReadField label="prefabId" value={id} />
      <TextField label="Tên" value={prefab.name} onCommit={(name) => patch('Đổi tên prefab', { name })} />
      <NumField label="contentVersion" value={prefab.contentVersion} step={1} min={1} onCommit={(v) => patch('Đổi contentVersion prefab', { contentVersion: v })} />
      <ReadField label="Instance" value={`${uses.length}${uses.length ? `: ${uses.join(', ')}` : ''}`} />
      <label className="field">
        <span>Xem xoay</span>
        <select value={String(view)} onChange={(e) => set({ prefabView: Number(e.target.value) as QuarterTurns })} data-prefab-view>
          {[0, 1, 2, 3].map((q) => (
            <option key={q} value={q}>
              {q * 90}°{q ? ' (chỉ xem)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Tầm tương tác</span>
        <input type="checkbox" checked={showReach} onChange={(e) => set({ showReach: e.target.checked })} />
      </label>
      <h4>Footprint (mái, sàn, trong nhà)</h4>
      {prefab.outline ? (
        <>
          <ReadField label="Khung bao" value={`${f.minX}…${f.maxX} × ${f.minZ}…${f.maxZ}`} />
          <label className="field">
            <span>Sửa outline</span>
            <input type="checkbox" checked={outlineEdit} onChange={(e) => set({ outlineEdit: e.target.checked })} data-outline-edit />
          </label>
        </>
      ) : (
        (['minX', 'minZ', 'maxX', 'maxZ'] as const).map((k) => <NumField key={k} label={k} value={f[k]} onCommit={(v) => patch('Đổi footprint', { footprint: { ...f, [k]: v } })} />)
      )}
      <OutlineEditor outline={prefab.outline} bounds={f} onChange={(label, outline) => patch(label, { outline })} />
      {prefab.outline && b && (
        <button onClick={() => run('Dựng tường theo outline', (d) => buildOutlineWalls(d, id))} data-outline-walls>
          Dựng tường theo outline
        </button>
      )}
      {!prefab.outline && <button onClick={() => run('Khớp footprint', (d, sel) => fitFootprint(d, id, sel))}>Khớp footprint với tường</button>}
      {prefab.outline && (
        <p className="hint">
          Nhà chữ L/T/U: sàn, mái và phép thử "trong nhà" theo outline. Bật "Sửa outline" rồi kéo đỉnh/cạnh trong khung nhìn (khi không chọn gì). "Dựng tường theo outline" chỉ thêm tường cho
          cạnh chưa có; tường cũ nằm ngoài outline cần xóa tay.
        </p>
      )}
      {b && (
        <>
          <h4>Công trình</h4>
          <NumField label={(b.storeys ?? 1) > 1 ? 'Cao mỗi tầng' : 'Cao (trần)'} value={b.height} min={0.5} onCommit={(height) => patch('Đổi chiều cao', { building: { height } })} />
          <NumField label="Số tầng" value={b.storeys ?? 1} min={1} step={1} onCommit={(storeys) => patch('Đổi số tầng', { building: { storeys: Math.round(storeys) } })} />
          <NumField label="Tường dày" value={b.wallThickness} min={0.05} step={0.05} onCommit={(wallThickness) => patch('Đổi độ dày tường', { building: { wallThickness } })} />
          <TextField label="Màu tường" value={b.wallColor} pattern={COLOR} onCommit={(wallColor) => patch('Đổi màu tường', { building: { wallColor } })} />
          <TextField label="Màu mái" value={b.roofColor} pattern={COLOR} onCommit={(roofColor) => patch('Đổi màu mái', { building: { roofColor } })} />
          <TextField label="Màu sàn" value={b.floorColor} pattern={COLOR} onCommit={(floorColor) => patch('Đổi màu sàn', { building: { floorColor } })} />
          <p className="hint">
            Cao/dày/màu ở đây là mặc định cho tường mới; từng bức tường sửa riêng khi chọn nó. Nhà nhiều tầng: mỗi tầng cao ít nhất 2,6 m, tầng trên có tấm sàn theo footprint (khoét lỗ cầu thang); chọn tầng
            để sửa ở palette. Bớt tầng chỉ được khi tầng đó trống.
          </p>
        </>
      )}
      <ReadField label="Pivot" value={`(${prefab.pivot.x}, ${prefab.pivot.z}) — chấm hồng`} />
      <ReadField label="Local ID đã xóa" value={String(prefab.retiredLocalIds?.length ?? 0)} />
      <p className="hint">
        Sửa hình dạng, vị trí, màu giữ nguyên local ID nên save cũ vẫn giữ trạng thái cửa/loot/đèn. Thêm, xóa hoặc đổi tên cửa, tủ, cửa sổ, đèn làm save cũ không còn khớp: tăng contentVersion
        của world trước khi phát hành.
      </p>
    </div>
  )
}

function ItemFields({ doc, prefab, itemKey }: { doc: MapDocument; prefab: PrefabDocument; itemKey: string }) {
  const run = useEditorStore((s) => s.run)
  const id = prefab.prefabId
  const patch = (label: string, p: AnyRecord) => run(label, (d) => updatePrefabItem(d, id, itemKey, p))
  const object = prefab.objects.find((o) => o.localId === itemKey)
  const room = prefab.rooms.find((r) => r.localId === itemKey)
  const lampRoom = prefab.rooms.find((r) => r.lamp?.localId === itemKey)
  const type = object?.kind ?? (room ? 'room' : lampRoom ? 'lamp' : null)
  if (!type) return null
  const first = instancesOf(doc, id)[0]
  const rename = (localId: string) => {
    if (isStatefulItem(prefab, itemKey) && !confirmStateful(id, [itemKey], 'Đổi tên')) return
    patch('Đổi local ID', { localId })
  }
  return (
    <div className="inspector">
      <h3>{KIND_LABEL[type]}</h3>
      <TextField label="Local ID" value={itemKey} pattern={/^[a-z0-9]+(?:-[a-z0-9]+)*$/} onCommit={rename} />
      {first && <ReadField label="ID trong world" value={`${first}/${itemKey}`} />}
      {(prefab.building?.storeys ?? 1) > 1 && (room || (object && object.kind !== 'tree' && object.kind !== 'stairs')) && (
        <StoreyField prefab={prefab} value={room?.level ?? (object && 'level' in object ? (object.level ?? 0) : 0)} onCommit={(level) => patch('Chuyển tầng', { level: level || undefined })} />
      )}
      {object && <ObjectFields object={object} prefab={prefab} patch={patch} />}
      {room && <RoomFields room={room} prefab={prefab} patch={patch} />}
      {lampRoom?.lamp && (
        <>
          <ReadField label="Phòng" value={lampRoom.localId} />
          <TextField label="Tên" value={lampRoom.lamp.name} onCommit={(name) => patch('Đổi tên đèn', { name })} />
          <NumField label="Cường độ" value={lampRoom.lamp.intensity} step={0.05} min={0} onCommit={(intensity) => patch('Đổi cường độ đèn', { intensity: Math.min(1, intensity) })} />
          <TextField label="Màu" value={lampRoom.lamp.color} pattern={COLOR} onCommit={(color) => patch('Đổi màu đèn', { color })} />
          <label className="field">
            <span>Cần điện</span>
            <input type="checkbox" checked={lampRoom.lamp.requiresElectricity} onChange={(e) => patch('Đổi cần điện', { requiresElectricity: e.target.checked })} />
          </label>
          <NumField label="Công tắc X" value={lampRoom.lamp.switchAt.x} onCommit={(x) => patch('Dời công tắc', { switchAt: { ...lampRoom.lamp!.switchAt, x } })} />
          <NumField label="Công tắc Z" value={lampRoom.lamp.switchAt.z} onCommit={(z) => patch('Dời công tắc', { switchAt: { ...lampRoom.lamp!.switchAt, z } })} />
          <NumField label="Đèn X" value={lampAt(lampRoom).x} onCommit={(x) => patch('Dời đèn', { at: { ...lampAt(lampRoom), x } })} />
          <NumField label="Đèn Z" value={lampAt(lampRoom).z} onCommit={(z) => patch('Dời đèn', { at: { ...lampAt(lampRoom), z } })} />
          {lampRoom.lamp.at ? (
            <button onClick={() => patch('Đèn về tâm phòng', { at: undefined })} data-lamp-centre>
              Đèn về tâm phòng
            </button>
          ) : (
            <p className="hint">Đèn ở tâm phòng (mặc định). Kéo ô vàng trong viewport để dời; ánh sáng vẫn tính theo cả phòng.</p>
          )}
          <p className="hint">Công tắc là điểm tương tác (E) trong game; đặt sát tường, trong phòng.</p>
        </>
      )}
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
    </div>
  )
}

/**
 * M11c-2: an item's storey (1-based on screen). Moving it follows it to that storey in the editor
 * (the selection stays on it); a door or window on another storey then needs a wall there.
 */
function StoreyField({ prefab, value, onCommit }: { prefab: PrefabDocument; value: number; onCommit: (level: number) => void }) {
  const setFloor = useEditorStore((s) => s.setPrefabFloor)
  const setStatus = useEditorStore((s) => s.setStatus)
  const storeys = prefab.building?.storeys ?? 1
  return (
    <NumField
      label="Tầng (1 = trệt)"
      value={value + 1}
      min={1}
      step={1}
      onCommit={(n) => {
        const level = Math.round(n) - 1
        if (level >= storeys) return setStatus(`Prefab chỉ có ${storeys} tầng`, 'error')
        const sel = useEditorStore.getState().edit?.selection ?? []
        onCommit(level)
        setFloor(level)
        useEditorStore.getState().select(sel)
      }}
    />
  )
}

function ObjectFields({ object: o, prefab, patch }: { object: PrefabObject; prefab: PrefabDocument; patch: (label: string, p: AnyRecord) => void }) {
  if (o.kind === 'wallRun') {
    const openings = wallRunBoxes(o, prefab.objects).openings
    return (
      <>
        <NumField label="Từ X" value={o.from.x} onCommit={(x) => patch('Sửa tường', o.from.z === o.to.z ? { from: { ...o.from, x } } : { from: { ...o.from, x }, to: { ...o.to, x } })} />
        <NumField label="Từ Z" value={o.from.z} onCommit={(z) => patch('Sửa tường', o.from.x === o.to.x ? { from: { ...o.from, z } } : { from: { ...o.from, z }, to: { ...o.to, z } })} />
        <NumField label="Đến X" value={o.to.x} onCommit={(x) => patch('Sửa tường', o.from.z === o.to.z ? { to: { ...o.to, x } } : { from: { ...o.from, x }, to: { ...o.to, x } })} />
        <NumField label="Đến Z" value={o.to.z} onCommit={(z) => patch('Sửa tường', o.from.x === o.to.x ? { to: { ...o.to, z } } : { from: { ...o.from, z }, to: { ...o.to, z } })} />
        <NumField label="Cao" value={o.height} min={0.1} onCommit={(height) => patch('Sửa tường', { height })} />
        <NumField label="Dày" value={o.thickness} min={0.05} step={0.05} onCommit={(thickness) => patch('Sửa tường', { thickness })} />
        <TextField label="Màu" value={o.color} pattern={COLOR} onCommit={(color) => patch('Đổi màu', { color })} />
        <ReadField label="Khe" value={openings.length ? openings.map((x) => x.localId).join(', ') : '(không có)'} />
        <p className="hint">Tường luôn song song trục; đổi đầu này theo trục của tường, dời ngang thì cả hai đầu đi theo.</p>
      </>
    )
  }
  if (o.kind === 'door' || o.kind === 'window') {
    return (
      <>
        <TextField label="Tên" value={o.name} onCommit={(name) => patch('Đổi tên', { name })} />
        <NumField label="X" value={o.position.x} onCommit={(x) => patch('Di chuyển', { position: { ...o.position, x } })} />
        <NumField label="Z" value={o.position.z} onCommit={(z) => patch('Di chuyển', { position: { ...o.position, z } })} />
        <Turns value={o.quarterTurns} onChange={(quarterTurns) => patch('Xoay', { quarterTurns })} />
        <NumField label="Rộng" value={o.width} min={0.4} onCommit={(width) => patch('Đổi độ rộng', { width })} />
        {o.kind === 'door' ? (
          <>
            <label className="field">
              <span>Mở về</span>
              <select value={String(o.openTowards)} onChange={(e) => patch('Đổi hướng mở', { openTowards: Number(e.target.value) })}>
                <option value="1">phía trong (+Z khung cửa)</option>
                <option value="-1">phía ngoài (−Z khung cửa)</option>
              </select>
            </label>
            <label className="field">
              <span>Ban đầu</span>
              <select value={o.initialState ?? 'closed'} onChange={(e) => patch('Đổi trạng thái đầu', { initialState: e.target.value === 'open' ? 'open' : undefined })}>
                <option value="closed">đóng</option>
                <option value="open">mở</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <NumField label="Bệ (sill)" value={o.sill} min={0} onCommit={(sill) => patch('Đổi cửa sổ', { sill })} />
            <NumField label="Đầu (head)" value={o.head} min={0.1} onCommit={(head) => patch('Đổi cửa sổ', { head })} />
            <NumField label="Dày" value={o.thickness} min={0.05} step={0.05} onCommit={(thickness) => patch('Đổi cửa sổ', { thickness })} />
            <p className="hint">Phía trong (+Z khung) là phía phòng nhận ánh sáng; rèm kéo ở bên trong.</p>
          </>
        )}
      </>
    )
  }
  if (o.kind === 'tree') {
    return (
      <>
        <NumField label="X" value={o.position.x} onCommit={(x) => patch('Di chuyển', { position: { ...o.position, x } })} />
        <NumField label="Z" value={o.position.z} onCommit={(z) => patch('Di chuyển', { position: { ...o.position, z } })} />
        <TreeFields tree={o} patch={patch} />
      </>
    )
  }
  if (o.kind === 'stairs') {
    return (
      <>
        <NumField label="X" value={o.position.x} onCommit={(x) => patch('Di chuyển', { position: { ...o.position, x } })} />
        <NumField label="Z" value={o.position.z} onCommit={(z) => patch('Di chuyển', { position: { ...o.position, z } })} />
        <Turns value={o.quarterTurns} onChange={(quarterTurns) => patch('Xoay', { quarterTurns })} />
        <NumField label="Rộng" value={o.width} min={1} onCommit={(width) => patch('Đổi cầu thang', { width })} />
        <NumField label="Dài" value={o.length} min={2} onCommit={(length) => patch('Đổi cầu thang', { length })} />
        <NumField label="Từ tầng (0 = trệt)" value={o.level ?? 0} min={0} step={1} onCommit={(level) => patch('Đổi cầu thang', { level: level || undefined })} />
        <p className="hint">
          Cầu thang leo theo +X của khung (xoay 0°), lên một tầng; đầu dưới mở ở tầng dưới, đầu trên mở ra sàn tầng trên. Kéo hai ô vuông ở chân/đỉnh để đổi độ dài; chỗ bước lên/xuống (0,9 m sau mỗi đầu)
          phải trống.
        </p>
      </>
    )
  }
  return (
    <>
      {o.kind === 'container' && <TextField label="Tên" value={o.name} onCommit={(name) => patch('Đổi tên', { name })} />}
      <NumField label="X" value={o.position.x} onCommit={(x) => patch('Di chuyển', { position: { ...o.position, x } })} />
      <NumField label="Z" value={o.position.z} onCommit={(z) => patch('Di chuyển', { position: { ...o.position, z } })} />
      <NumField label="Y (tâm)" value={o.position.y} onCommit={(y) => patch('Đổi độ cao', { position: { ...o.position, y } })} />
      {o.size.map((v, i) => (
        <NumField key={i} label={`Kích thước ${'XYZ'[i]}`} value={v} min={0.05} onCommit={(n) => patch('Đổi kích thước', { size: o.size.map((s, j) => (j === i ? n : s)) })} />
      ))}
      <TextField label="Màu" value={o.color} pattern={COLOR} onCommit={(color) => patch('Đổi màu', { color })} />
      {o.kind === 'container' && (
        <>
          <label className="field">
            <span>Loot table</span>
            <select value={o.lootTableId ?? ''} onChange={(e) => patch('Đổi loot table', { lootTableId: e.target.value || undefined })} data-loot-table>
              <option value="">(trống)</option>
              {[...OPTS.lootTables].sort().map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <ReadField label="Sức chứa" value="8 ô (cố định trong game)" />
        </>
      )}
    </>
  )
}

function RoomFields({ room, prefab, patch }: { room: RoomObject; prefab: PrefabDocument; patch: (label: string, p: AnyRecord) => void }) {
  const b = room.bounds
  return (
    <>
      <TextField label="Tên" value={room.name} onCommit={(name) => patch('Đổi tên phòng', { name })} />
      {room.outline ? (
        <ReadField label="Khung bao" value={`${b.minX}…${b.maxX} × ${b.minZ}…${b.maxZ}`} />
      ) : (
        (['minX', 'minZ', 'maxX', 'maxZ'] as const).map((k) => <NumField key={k} label={k} value={b[k]} onCommit={(v) => patch('Đổi khung phòng', { bounds: { ...b, [k]: v } })} />)
      )}
      <OutlineEditor outline={room.outline} bounds={b} onChange={(label, outline) => patch(label, { outline: outline ?? undefined })} />
      {prefab.outline && (
        <button onClick={() => patch('Phòng theo outline nhà', { outline: prefab.outline!.map((p) => ({ ...p })) })} data-room-fit-outline>
          Theo outline nhà
        </button>
      )}
      <label className="field">
        <span>Có đèn</span>
        <input type="checkbox" checked={!!room.lamp} onChange={(e) => patch(e.target.checked ? 'Thêm đèn' : 'Bỏ đèn', { lamp: e.target.checked ? {} : null })} data-room-lamp />
      </label>
      <p className="hint">Khung phòng nằm trên đường tâm tường. Ánh sáng tính theo phòng: cửa sổ chiếu trực tiếp, cửa mở truyền sang phòng bên.</p>
    </>
  )
}

/** Ceiling fixture of a lamp: `at`, or the room centre by default. */
function lampAt(room: RoomObject): XZ {
  return room.lamp?.at ?? (room.outline ? outlineCentre(room.outline) : { x: (room.bounds.minX + room.bounds.maxX) / 2, z: (room.bounds.minZ + room.bounds.maxZ) / 2 })
}

export function PrefabInspector({ prefabId }: { prefabId: string }) {
  const edit = useEditorStore((s) => s.edit)
  const prefab = edit?.doc.prefabs.get(prefabId)
  if (!edit || !prefab) return <aside className="panel right" />
  const sel = edit.selection
  return (
    <aside className="panel right">
      {sel.length === 0 && <PrefabProps doc={edit.doc} prefab={prefab} />}
      {sel.length === 1 && <ItemFields key={sel[0]} doc={edit.doc} prefab={prefab} itemKey={sel[0]} />}
      {sel.length > 1 && (
        <div className="inspector">
          <h3>{sel.length} mục</h3>
          <ul className="ids">
            {sel.map((id) => (
              <li key={id}>
                <code>{id}</code>
              </li>
            ))}
          </ul>
          <div className="row">
            <button onClick={() => rotateSelection(1)}>Xoay 90°</button>
            <button onClick={duplicateSelection}>Nhân bản</button>
            <button onClick={deleteSelection}>Xóa</button>
          </div>
        </div>
      )}
    </aside>
  )
}
