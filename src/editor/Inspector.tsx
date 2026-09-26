import { rotateRecords, setRecordAnchor, updateRecord, updateWorld } from '../map/editor/commands'
import { findRecord, instancesOf, resolvedRecords, worldAnchor, type AnyRecord, type MapDocument } from '../map/editor/document'
import { SURFACE_LAYER_MAX, type QuarterTurns, type TreeObject, type XYZ, type XZ } from '../map/schema'
import { zoneFor } from '../game/world/zones'
import { useEditorStore, OPTS } from './editorStore'
import { NumField, ReadField, TextField, TreeFields } from './fields'
import { PrefabInspector } from './PrefabInspector'
import { SaveCompat } from './SaveCompat'
import { deleteSelection, duplicateSelection, rotateSelection } from './interaction'

/** Zones of the document as the runtime sees them (`ZoneDef`). */
function zoneDefs(doc: MapDocument) {
  return resolvedRecords(doc).flatMap((r) => r.parts.zones ?? [])
}

/** Zone a zombie spawned at `p` belongs to, by the runtime rule. */
function zoneOfPoint(doc: MapDocument, p: XZ): string | null {
  return zoneFor(p, zoneDefs(doc))?.id ?? null
}

function zombieSpawnsIn(doc: MapDocument, zoneId: string): number {
  const zones = zoneDefs(doc)
  return resolvedRecords(doc)
    .flatMap((r) => r.parts.zombieSpawns ?? [])
    .filter((p) => zoneFor(p, zones)?.id === zoneId).length
}

const CATEGORY_LABEL = { instances: 'Công trình (prefab)', objects: 'Object rời', roads: 'Đường', zones: 'Zone', spawns: 'Spawn' } as const
const COLOR = /^#[0-9a-f]{6}$/i

function WorldInspector({ doc }: { doc: MapDocument }) {
  const run = useEditorStore((s) => s.run)
  const w = doc.world
  const counts = [...doc.chunks.values()].reduce((n, c) => n + c.instances.length + c.objects.length + c.roads.length + c.zones.length + c.spawns.length, 0)
  return (
    <div className="inspector">
      <h3>World</h3>
      <ReadField label="worldId" value={w.worldId} />
      <TextField label="Tên" value={w.name} onCommit={(name) => run('Đổi tên world', (d, sel) => updateWorld(d, { name }, sel))} />
      <NumField label="contentVersion" value={w.contentVersion} step={1} min={1} onCommit={(v) => run('Đổi contentVersion', (d, sel) => updateWorld(d, { contentVersion: v }, sel))} />
      <ReadField label="Chunk" value={`${w.chunks.length} × ${w.chunkSize} m`} />
      <NumField label="Vùng chơi X (m)" value={w.playArea.size} step={1} min={1} onCommit={(size) => run('Đổi vùng chơi', (d, sel) => updateWorld(d, { playArea: { ...d.world.playArea, size } }, sel))} />
      <NumField label="Vùng chơi Z (m)" value={w.playArea.depth ?? w.playArea.size} step={1} min={1} onCommit={(depth) => run('Đổi vùng chơi', (d, sel) => updateWorld(d, { playArea: { ...d.world.playArea, depth } }, sel))} />
      <NumField label="Tâm X" value={w.playArea.center?.x ?? 0} step={1} onCommit={(x) => run('Dời vùng chơi', (d, sel) => updateWorld(d, { playArea: { ...d.world.playArea, center: { x, z: d.world.playArea.center?.z ?? 0 } } }, sel))} />
      <NumField label="Tâm Z" value={w.playArea.center?.z ?? 0} step={1} onCommit={(z) => run('Dời vùng chơi', (d, sel) => updateWorld(d, { playArea: { ...d.world.playArea, center: { x: d.world.playArea.center?.x ?? 0, z } } }, sel))} />
      <label className="field">
        <span>Hàng rào biên</span>
        <input
          type="checkbox"
          checked={w.boundary !== null}
          onChange={(e) => run(e.target.checked ? 'Bật hàng rào biên' : 'Tắt hàng rào biên', (d, sel) => updateWorld(d, { boundary: e.target.checked ? { height: 2, thickness: 1 } : null }, sel))}
        />
      </label>
      {w.boundary && (
        <>
          <NumField label="Rào cao" value={w.boundary.height} min={0.1} onCommit={(height) => run('Đổi hàng rào biên', (d, sel) => updateWorld(d, { boundary: { ...d.world.boundary!, height } }, sel))} />
          <NumField label="Rào dày" value={w.boundary.thickness} min={0.1} onCommit={(thickness) => run('Đổi hàng rào biên', (d, sel) => updateWorld(d, { boundary: { ...d.world.boundary!, thickness } }, sel))} />
        </>
      )}
      <label className="field">
        <span>Hiện trong menu game</span>
        <input
          type="checkbox"
          checked={w.listed !== false}
          onChange={(e) => run(e.target.checked ? 'Hiện world trong menu' : 'Ẩn world khỏi menu', (d, sel) => updateWorld(d, { listed: e.target.checked }, sel))}
          data-world-listed
        />
      </label>
      <p className="hint">Vùng chơi (khung đỏ) là hình chữ nhật đặt tâm tùy ý; lưới nav, mặt đất và hàng rào biên của game theo nó. Tab Chunk có nút khớp với các chunk.</p>
      <ReadField label="Prefab" value={String(w.prefabs.length)} />
      <ReadField label="Record" value={String(counts)} />
      <ReadField label="Spawn người chơi" value={w.playerSpawn} />
      <ReadField label="ID đã xóa" value={String(w.retiredIds?.length ?? 0)} />
      <SaveCompat doc={doc} />
      <p className="hint">
        Click chọn record; Shift+click chọn thêm; kéo từ chỗ trống để chọn theo khung; Ctrl+A chọn hết (trừ layer ẩn/khóa). Kéo để di chuyển. Chọn mục bên trái để đặt; tab
        Chunk để thêm/xóa chunk.
      </p>
    </div>
  )
}

function RecordInspector({ doc, id }: { doc: MapDocument; id: string }) {
  const run = useEditorStore((s) => s.run)
  const loc = findRecord(doc, id)
  if (!loc) return null
  const r = loc.record
  const at = worldAnchor(doc, loc)
  const identity = id.split('/')[0]
  const patch = (label: string, p: AnyRecord) => run(label, (d) => updateRecord(d, id, p))
  const position = r.position as XYZ | undefined
  return (
    <div className="inspector">
      <h3>{CATEGORY_LABEL[loc.category]}</h3>
      <ReadField label="ID" value={id} />
      <ReadField label="Chunk sở hữu" value={loc.chunkId} />
      {identity !== loc.chunkId && <ReadField label="Chunk định danh" value={`${identity} (giữ nguyên khi đổi chunk)`} />}
      <NumField label="X (world)" value={at.x} onCommit={(x) => run('Di chuyển', (d) => setRecordAnchor(d, id, { x, z: at.z }))} />
      <NumField label="Z (world)" value={at.z} onCommit={(z) => run('Di chuyển', (d) => setRecordAnchor(d, id, { x: at.x, z }))} />
      {position && typeof position.y === 'number' && (
        <NumField label="Y" value={position.y} onCommit={(y) => patch('Đổi độ cao', { position: { ...position, y } })} />
      )}

      {loc.category === 'instances' && (
        <>
          <ReadField label="Prefab" value={`${String(r.prefabId)} — ${doc.prefabs.get(String(r.prefabId))?.name ?? '?'}`} />
          <button onClick={() => useEditorStore.getState().enterPrefab(String(r.prefabId))} data-open-prefab title="Sửa bản gốc: mọi instance đổi theo">
            Sửa prefab gốc ({instancesOf(doc, String(r.prefabId)).length} instance)
          </button>
          <label className="field">
            <span>Xoay</span>
            <select
              value={String(r.quarterTurns)}
              onChange={(e) => {
                const q = Number(e.target.value) as QuarterTurns
                run('Xoay', (d) => rotateRecords(d, [id], q - (r.quarterTurns as number)))
              }}
            >
              {[0, 1, 2, 3].map((q) => (
                <option key={q} value={q}>
                  {q * 90}°
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {loc.category === 'objects' && (
        <>
          <ReadField label="Loại" value={String(r.kind)} />
          {r.kind === 'tree' && <TreeFields tree={r as unknown as TreeObject} patch={patch} />}
          {r.kind === 'container' && <TextField label="Tên" value={String(r.name)} onCommit={(name) => patch('Đổi tên', { name })} />}
          {Array.isArray(r.size) && (r.size as number[]).map((v, i) => (
            <NumField
              key={i}
              label={`Kích thước ${'XYZ'[i]}`}
              value={v}
              min={0.05}
              onCommit={(n) => patch('Đổi kích thước', { size: (r.size as number[]).map((s, j) => (j === i ? n : s)) })}
            />
          ))}
          {r.kind !== 'tree' && <TextField label="Màu" value={String(r.color)} pattern={COLOR} onCommit={(color) => patch('Đổi màu', { color })} />}
          {r.kind === 'container' && (
            <label className="field">
              <span>Loot table</span>
              <select value={String(r.lootTableId ?? '')} onChange={(e) => patch('Đổi loot table', { lootTableId: e.target.value || undefined })}>
                <option value="">(trống)</option>
                {[...OPTS.lootTables].sort().map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}

      {loc.category === 'roads' && (
        <>
          {(r.size as number[]).map((v, i) => (
            <NumField key={i} label={`Kích thước ${'XZ'[i]}`} value={v} min={0.1} onCommit={(n) => patch('Đổi kích thước', { size: (r.size as number[]).map((s, j) => (j === i ? n : s)) })} />
          ))}
          <TextField label="Màu" value={String(r.color)} pattern={COLOR} onCommit={(color) => patch('Đổi màu', { color })} />
          <label className="field" title="Chỗ hai mặt nền chồng nhau, lớp cao hơn nằm trên">
            <span>Lớp vẽ</span>
            <select value={String(r.layer ?? 0)} onChange={(e) => patch('Đổi lớp vẽ', { layer: Number(e.target.value) || undefined })} data-road-layer>
              {Array.from({ length: SURFACE_LAYER_MAX + 1 }, (_, i) => (
                <option key={i} value={i}>
                  {i === 0 ? '0 (dưới cùng)' : i}
                </option>
              ))}
            </select>
          </label>
        </>
      )}

      {loc.category === 'zones' && (
        <>
          <ReadField label="Loại" value={`${String(r.kind)} (${r.shape === 'rect' ? 'chữ nhật' : 'tròn'})`} />
          <TextField label="Tên" value={String(r.name)} onCommit={(name) => patch('Đổi tên', { name })} />
          {r.shape === 'rect' ? (
            (r.size as number[]).map((v, i) => (
              <NumField key={i} label={`Kích thước ${'XZ'[i]}`} value={v} min={0.5} onCommit={(n) => patch('Đổi kích thước', { size: (r.size as number[]).map((s, j) => (j === i ? n : s)) })} />
            ))
          ) : (
            <NumField label="Bán kính" value={r.radius as number} min={0.5} onCommit={(radius) => patch('Đổi bán kính', { radius })} />
          )}
          <ReadField label="Spawn zombie thuộc" value={String(zombieSpawnsIn(doc, id))} />
        </>
      )}

      {loc.category === 'spawns' && (
        <>
          <ReadField label="Loại" value={String(r.kind)} />
          {r.kind === 'zombie' && <ReadField label="Thuộc zone" value={zoneOfPoint(doc, at) ?? '(không có zone: lang thang quanh spawn)'} />}
          {r.kind === 'player' &&
            (doc.world.playerSpawn === id ? (
              <p className="hint">Điểm xuất phát của New Game.</p>
            ) : (
              <button onClick={() => run('Đặt điểm xuất phát', (d, sel) => updateWorld(d, { playerSpawn: id }, sel))}>Đặt làm điểm xuất phát</button>
            ))}
        </>
      )}

      <div className="row">
        {loc.category !== 'instances' && Array.isArray(r.size) && (
          <button onClick={() => rotateSelection(1)} title="R">
            Xoay 90°
          </button>
        )}
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

export function Inspector() {
  const edit = useEditorStore((s) => s.edit)
  const prefabMode = useEditorStore((s) => s.prefabMode)
  if (!edit) return <aside className="panel right" />
  if (prefabMode) return <PrefabInspector prefabId={prefabMode} />
  const sel = edit.selection
  return (
    <aside className="panel right">
      {sel.length === 0 && <WorldInspector doc={edit.doc} />}
      {sel.length === 1 && <RecordInspector key={sel[0]} doc={edit.doc} id={sel[0]} />}
      {sel.length > 1 && (
        <div className="inspector">
          <h3>{sel.length} record</h3>
          <ul className="ids">
            {sel.map((id) => (
              <li key={id}>
                <code>{id}</code>
              </li>
            ))}
          </ul>
          <div className="row">
            <button onClick={duplicateSelection}>Nhân bản</button>
            <button onClick={deleteSelection}>Xóa</button>
          </div>
        </div>
      )}
    </aside>
  )
}
