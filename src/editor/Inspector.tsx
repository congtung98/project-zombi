import { rotateInstances, setRecordAnchor, updateRecord, updateWorld } from '../map/editor/commands'
import { findRecord, worldAnchor, type AnyRecord, type MapDocument } from '../map/editor/document'
import type { QuarterTurns, XYZ } from '../map/schema'
import { useEditorStore, OPTS } from './editorStore'
import { NumField, ReadField, TextField } from './fields'
import { deleteSelection, duplicateSelection } from './interaction'

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
      <ReadField label="Vùng chơi" value={`${w.playArea.size} m`} />
      <ReadField label="Prefab" value={String(w.prefabs.length)} />
      <ReadField label="Record" value={String(counts)} />
      <ReadField label="Spawn người chơi" value={w.playerSpawn} />
      <ReadField label="ID đã xóa" value={String(w.retiredIds?.length ?? 0)} />
      <p className="hint">Click chọn record; Shift+click chọn nhiều. Kéo để di chuyển. Chọn prefab bên trái để đặt.</p>
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
          <label className="field">
            <span>Xoay</span>
            <select
              value={String(r.quarterTurns)}
              onChange={(e) => {
                const q = Number(e.target.value) as QuarterTurns
                run('Xoay', (d) => rotateInstances(d, [id], q - (r.quarterTurns as number)))
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
          {r.kind === 'container' && <TextField label="Tên" value={String(r.name)} onCommit={(name) => patch('Đổi tên', { name })} />}
          {(r.size as number[]).map((v, i) => (
            <NumField
              key={i}
              label={`Kích thước ${'XYZ'[i]}`}
              value={v}
              min={0.05}
              onCommit={(n) => patch('Đổi kích thước', { size: (r.size as number[]).map((s, j) => (j === i ? n : s)) })}
            />
          ))}
          <TextField label="Màu" value={String(r.color)} pattern={COLOR} onCommit={(color) => patch('Đổi màu', { color })} />
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
        </>
      )}

      {loc.category === 'zones' && (
        <>
          <ReadField label="Loại" value={`${String(r.kind)} (${String(r.shape)})`} />
          <TextField label="Tên" value={String(r.name)} onCommit={(name) => patch('Đổi tên', { name })} />
          <NumField label="Bán kính" value={r.radius as number} min={0.5} onCommit={(radius) => patch('Đổi bán kính', { radius })} />
        </>
      )}

      {loc.category === 'spawns' && (
        <>
          <ReadField label="Loại" value={String(r.kind)} />
          {r.kind === 'player' &&
            (doc.world.playerSpawn === id ? (
              <p className="hint">Điểm xuất phát của New Game.</p>
            ) : (
              <button onClick={() => run('Đặt điểm xuất phát', (d, sel) => updateWorld(d, { playerSpawn: id }, sel))}>Đặt làm điểm xuất phát</button>
            ))}
        </>
      )}

      <div className="row">
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
  if (!edit) return <aside className="panel right" />
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
