import { useRef, useState } from 'react'
import { documentReference, tracingGeoJson, PROFILE_LABEL } from '../map/editor/generator'
import { RESTRICTED_LABEL, ROAD_CLASS_LABEL, TRACE_COLORS, ZONE_LABEL } from '../map/editor/tracing'
import { DEFAULT_ENVIRONMENT } from '../map/layout/environment'
import { PROFILES } from '../map/layout/plan'
import { calibrationError, measureScale, metresPerPixel, referenceImage, referenceTransform, removeFeatures, ROAD_DEFAULTS, updateFeature, type ReferenceTracing, type TracedFeature } from '../map/layout/reference'
import { LAND_USE_ZONES, RESTRICTED_KINDS, ROAD_CLASSES, SIDEWALKS, type EnvironmentParams, type LandUseZone, type RestrictedKind, type RoadClass, type Sidewalk, type WorldMode } from '../map/layout/schema'
import { documentLayout } from '../map/layout/worldSync'
import { SLUG } from '../map/transform'
import { generatorBlocked, isDirty, useEditorStore, type TraceMode } from './editorStore'
import { EnvironmentFields } from './GeneratorPanel'
import { downloadText } from './interaction'

/**
 * WG6: the Bản vẽ tab — reference picture (a map the author may use), calibration (control points,
 * measured scale), hand tracing (roads, junctions, land-use zones, unbuildable areas), and the way out
 * to a world: a new world from the tracing, or an update of this world from its changed tracing.
 */

const store = useEditorStore.getState

const MODES: { id: TraceMode; label: string; hint: string }[] = [
  { id: 'select', label: 'Chọn', hint: 'Click chọn nét vẽ; kéo một đỉnh để dời (giao lộ dời theo)' },
  { id: 'road', label: 'Đường', hint: 'Click từng điểm; Enter hoặc click lại điểm cuối để xong. Điểm gần đường khác tự bắt vào (giao lộ); đường cắt nhau tự thành giao lộ' },
  { id: 'junction', label: 'Giao lộ', hint: 'Click chỗ các đường gần gặp nhau: gộp các đầu đường trong tầm thành một giao lộ' },
  { id: 'zone', label: 'Vùng đất', hint: 'Click các góc; Enter hoặc click lại điểm đầu để khép vùng' },
  { id: 'restricted', label: 'Vùng cấm', hint: 'Nước, đường sắt, đất cấm xây: không có lô nào trên đó' },
  { id: 'calibrate', label: 'Điểm hiệu chỉnh', hint: 'Click một điểm trên ảnh rồi nhập tọa độ thật (m) của nó bên dưới' },
  { id: 'measure', label: 'Đo tỷ lệ', hint: 'Click hai điểm trên ảnh rồi nhập khoảng cách thật giữa chúng' },
]

async function loadImage(file: File): Promise<ReturnType<typeof referenceImage>> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error ?? new Error('không đọc được file'))
    r.readAsDataURL(file)
  })
  const size = await new Promise<{ w: number; h: number }>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => reject(new Error('không giải mã được ảnh'))
    img.src = dataUrl
  })
  return referenceImage(file.name, file.type || 'image/png', dataUrl, size.w, size.h)
}

function Num({ value, onCommit, step = 0.1, label }: { value: number; onCommit: (v: number) => void; step?: number; label: string }) {
  return <input type="number" aria-label={label} step={step} defaultValue={value} key={value} onBlur={(e) => Number.isFinite(Number(e.target.value)) && Number(e.target.value) !== value && onCommit(Number(e.target.value))} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
}

function ImageSection({ tracing: ref }: { tracing: ReferenceTracing | null }) {
  const file = useRef<HTMLInputElement>(null)
  const trace = useEditorStore((s) => s.trace)
  const onFile = async (f: File) => {
    try {
      const image = await loadImage(f)
      store().editReference(ref?.image ? 'Thay ảnh tham chiếu' : 'Nhập ảnh tham chiếu', (r) => ({ ...r, image }))
      store().requestFocus(null)
    } catch (e) {
      store().setStatus(`Không nhập được ảnh: ${e instanceof Error ? e.message : String(e)}`, 'error')
    }
  }
  return (
    <details open className="gen-block">
      <summary>Ảnh tham chiếu</summary>
      {ref?.image ? (
        <p className="hint">
          {ref.image.name} · {ref.image.width} × {ref.image.height} px · {(ref.image.dataUrl.length / 1.37 / 1024).toFixed(0)} KB
        </p>
      ) : (
        <p className="hint">Chưa có ảnh: có thể vẽ tay trên lưới (1 m mỗi đơn vị) hoặc nhập ảnh bản đồ. Chỉ dùng ảnh bạn có quyền sử dụng; editor không tải gì từ mạng.</p>
      )}
      <div className="row">
        <button onClick={() => file.current?.click()} data-ref-import>
          {ref?.image ? 'Thay ảnh…' : 'Nhập ảnh…'}
        </button>
        {ref?.image && (
          <button onClick={() => store().editReference('Bỏ ảnh tham chiếu', (r) => ({ ...r, image: null }))} title="Giữ nguyên nét vẽ và hiệu chỉnh">
            Bỏ ảnh
          </button>
        )}
      </div>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        data-ref-file
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void onFile(f)
        }}
      />
      {ref?.image && (
        <>
          <label className="field">
            <span>Độ mờ</span>
            <input type="range" min={0.1} max={1} step={0.05} value={trace.opacity} onChange={(e) => store().setTrace({ opacity: Number(e.target.value) })} data-ref-opacity />
          </label>
          <label className="field check">
            <input type="checkbox" checked={trace.showImage} onChange={(e) => store().setTrace({ showImage: e.target.checked })} />
            <span>Hiện ảnh</span>
          </label>
        </>
      )}
    </details>
  )
}

function CalibrationSection({ tracing: ref }: { tracing: ReferenceTracing }) {
  const trace = useEditorStore((s) => s.trace)
  const [distance, setDistance] = useState('50')
  const t = referenceTransform(ref)
  const err = calibrationError(ref)
  const pts = ref.calibration.points
  const setPoint = (i: number, axis: 'x' | 'z', v: number) =>
    store().editReference('Sửa điểm hiệu chỉnh', (r) => ({ ...r, calibration: { ...r.calibration, points: r.calibration.points.map((p, k) => (k === i ? { ...p, world: { ...p.world, [axis]: v } } : p)) } }))
  return (
    <details open className="gen-block">
      <summary>Hiệu chỉnh</summary>
      <p className="hint" data-ref-scale>
        {metresPerPixel(t).toFixed(3)} m/pixel · {pts.length < 2 ? (ref.image ? 'tỷ lệ mặc định (chưa hiệu chỉnh)' : 'vẽ tay: 1 m/đơn vị') : `${pts.length} điểm, ${ref.calibration.method === 'affine' && pts.length >= 3 ? 'affine' : 'đồng dạng'}`}
        {err ? ` · sai số RMS ${err.rms.toFixed(2)} m, lớn nhất ${err.max.toFixed(2)} m` : ''}
      </p>
      {pts.length > 0 && (
        <table className="ref-points">
          <tbody>
            {pts.map((p, i) => (
              <tr key={i}>
                <td>#{i + 1}</td>
                <td>
                  X <Num label={`X điểm ${i + 1}`} value={p.world.x} onCommit={(v) => setPoint(i, 'x', v)} />
                </td>
                <td>
                  Z <Num label={`Z điểm ${i + 1}`} value={p.world.z} onCommit={(v) => setPoint(i, 'z', v)} />
                </td>
                <td>
                  <button className="bad" onClick={() => store().editReference('Xóa điểm hiệu chỉnh', (r) => ({ ...r, calibration: { ...r.calibration, points: r.calibration.points.filter((_, k) => k !== i) } }))}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pts.length >= 3 && (
        <label className="field check">
          <input type="checkbox" checked={ref.calibration.method === 'affine'} onChange={(e) => store().editReference('Đổi kiểu hiệu chỉnh', (r) => ({ ...r, calibration: { ...r.calibration, method: e.target.checked ? 'affine' : 'similarity' } }))} />
          <span>Affine (ảnh scan lệch, tỷ lệ hai trục khác nhau)</span>
        </label>
      )}
      {trace.mode === 'measure' && (
        <div className="gen-pending" data-ref-measure>
          <p className="hint">{trace.measure.length < 2 ? `Click điểm ${trace.measure.length + 1}/2 trên ảnh` : 'Hai điểm đã chọn: nhập khoảng cách thật'}</p>
          <label className="field">
            <span>Khoảng cách (m)</span>
            <input type="number" min={0.1} value={distance} onChange={(e) => setDistance(e.target.value)} data-ref-distance />
          </label>
          <button
            disabled={trace.measure.length < 2 || !(Number(distance) > 0)}
            onClick={() => {
              const [a, b] = trace.measure
              if (store().editReference('Đo tỷ lệ', (r) => measureScale(r, a, b, Number(distance)))) store().setTrace({ measure: [] })
            }}
            data-ref-apply-scale
          >
            Áp dụng tỷ lệ
          </button>
        </div>
      )}
    </details>
  )
}

function FeatureSection({ tracing: ref, id }: { tracing: ReferenceTracing; id: string }) {
  const f = ref.features.find((x) => x.id === id)
  if (!f) return null
  const patch = (label: string, p: Partial<TracedFeature>) => store().editReference(label, (r) => updateFeature(r, id, p))
  return (
    <details open className="gen-block" data-ref-selected={id}>
      <summary>
        {f.kind === 'road' ? 'Đường' : f.kind === 'zone' ? 'Vùng đất' : 'Vùng cấm'} <code>{id}</code> · {f.points.length} điểm
      </summary>
      {f.kind === 'road' && f.road && (
        <>
          <label className="field">
            <span>Loại</span>
            <select value={f.road.class} onChange={(e) => patch('Đổi loại đường', { road: { ...ROAD_DEFAULTS[e.target.value as RoadClass], name: f.road!.name } })}>
              {ROAD_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {ROAD_CLASS_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Số làn</span>
            <Num label="Số làn" step={1} value={f.road.lanes} onCommit={(v) => patch('Đổi số làn', { road: { ...f.road!, lanes: Math.max(1, Math.min(8, Math.round(v))) } })} />
          </label>
          <label className="field">
            <span>Vỉa hè</span>
            <select value={f.road.sidewalk} onChange={(e) => patch('Đổi vỉa hè', { road: { ...f.road!, sidewalk: e.target.value as Sidewalk } })}>
              {SIDEWALKS.map((s) => (
                <option key={s} value={s}>
                  {s === 'both' ? 'Hai bên' : s === 'left' ? 'Bên trái' : s === 'right' ? 'Bên phải' : 'Không'}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Tên</span>
            <input defaultValue={f.road.name ?? ''} key={f.road.name ?? ''} onBlur={(e) => e.target.value !== (f.road!.name ?? '') && patch('Đổi tên đường', { road: { ...f.road!, name: e.target.value || undefined } })} />
          </label>
        </>
      )}
      {f.kind === 'zone' && (
        <label className="field">
          <span>Zone</span>
          <select value={f.zone} onChange={(e) => patch('Đổi zone', { zone: e.target.value as LandUseZone })}>
            {LAND_USE_ZONES.map((z) => (
              <option key={z} value={z}>
                {ZONE_LABEL[z]}
              </option>
            ))}
          </select>
        </label>
      )}
      {f.kind === 'restricted' && (
        <label className="field">
          <span>Loại</span>
          <select value={f.restricted} onChange={(e) => patch('Đổi vùng cấm', { restricted: e.target.value as RestrictedKind })}>
            {RESTRICTED_KINDS.map((k) => (
              <option key={k} value={k}>
                {RESTRICTED_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
      )}
      <button className="bad" onClick={() => store().editReference('Xóa nét vẽ', (r) => removeFeatures(r, [id])) && store().setTrace({ selected: null })} data-ref-delete>
        Xóa
      </button>
    </details>
  )
}

function Tools() {
  const trace = useEditorStore((s) => s.trace)
  const set = (mode: TraceMode) => store().setTrace({ mode, draft: [], measure: [] })
  const hint = MODES.find((m) => m.id === trace.mode)!.hint
  return (
    <details open className="gen-block">
      <summary>Công cụ vẽ</summary>
      <div className="row ref-modes">
        {MODES.map((m) => (
          <button key={m.id} className={trace.mode === m.id ? 'active' : ''} onClick={() => set(m.id)} data-ref-mode={m.id}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="hint">{hint}</p>
      {trace.mode === 'road' && (
        <>
          <label className="field">
            <span>Loại đường</span>
            <select value={trace.road.class} onChange={(e) => store().setTrace({ road: { ...ROAD_DEFAULTS[e.target.value as RoadClass] } })} data-ref-road-class>
              {ROAD_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {ROAD_CLASS_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="field check">
            <input type="checkbox" checked={trace.autoJunctions} onChange={(e) => store().setTrace({ autoJunctions: e.target.checked })} />
            <span>Đường cắt nhau thành giao lộ (bỏ tick cho cầu vượt)</span>
          </label>
        </>
      )}
      {trace.mode === 'zone' && (
        <label className="field">
          <span>Zone</span>
          <select value={trace.zone} onChange={(e) => store().setTrace({ zone: e.target.value as LandUseZone })} data-ref-zone>
            {LAND_USE_ZONES.map((z) => (
              <option key={z} value={z}>
                {ZONE_LABEL[z]}
              </option>
            ))}
          </select>
        </label>
      )}
      {trace.mode === 'restricted' && (
        <label className="field">
          <span>Loại</span>
          <select value={trace.restricted} onChange={(e) => store().setTrace({ restricted: e.target.value as RestrictedKind })}>
            {RESTRICTED_KINDS.map((k) => (
              <option key={k} value={k}>
                {RESTRICTED_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
      )}
      {trace.draft.length > 0 && (
        <div className="row" data-ref-draft>
          <span className="hint">{trace.draft.length} điểm</span>
          <button onClick={() => store().traceFinish()}>Xong (Enter)</button>
          <button onClick={() => store().traceBackspace()}>Bỏ điểm cuối</button>
          <button onClick={() => store().traceCancel()}>Hủy (Esc)</button>
        </div>
      )}
    </details>
  )
}

function Output({ tracing: ref }: { tracing: ReferenceTracing }) {
  const edit = useEditorStore((s) => s.edit)!
  const busy = useEditorStore((s) => s.genBusy)
  const [worldId, setWorldId] = useState('ban-ve-1')
  const [name, setName] = useState('World từ bản vẽ')
  const [mode, setMode] = useState<WorldMode>('full')
  const [profile, setProfile] = useState('default')
  const [seed, setSeed] = useState('1')
  const [env, setEnv] = useState<EnvironmentParams>(DEFAULT_ENVIRONMENT)
  const [overwrite, setOverwrite] = useState(false)
  const { layout } = documentLayout(edit.doc)
  const fromTracing = layout?.projection.method === 'local-metres'
  const extracted = tracingGeoJson(ref)
  const problems = extracted.issues.filter((i) => i.severity !== 'info')
  const blocked = generatorBlocked(edit.doc)
  const valid = SLUG.test(worldId) && name.trim() && Number.isInteger(Number(seed)) && !busy && !extracted.issues.some((i) => i.severity === 'error')
  return (
    <details open className="gen-block">
      <summary>Sinh world</summary>
      {problems.map((i, n) => (
        <p key={n} className={i.severity === 'error' ? 'error' : 'hint'}>
          {i.message}
        </p>
      ))}
      {layout && fromTracing && (
        <div className="gen-pending">
          <p className="hint">World này sinh từ bản vẽ: cập nhật lại sau khi sửa nét vẽ (xem trước ở tab Generator). Phần không đổi giữ nguyên; công trình sửa tay và lô khóa được giữ.</p>
          <label className="field check">
            <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
            <span>Ghi đè cả object đã sửa tay</span>
          </label>
          <button disabled={!!blocked || !!busy || !valid} title={blocked ?? ''} onClick={() => store().updateWorldFromReference(null, undefined, overwrite)} data-ref-update>
            Cập nhật world từ bản vẽ
          </button>
        </div>
      )}
      <p className="hint">Tạo world mới từ bản vẽ (world mới mang theo ảnh và nét vẽ để sửa và cập nhật tiếp):</p>
      <label className="field">
        <span>worldId</span>
        <input value={worldId} onChange={(e) => setWorldId(e.target.value)} data-ref-world-id />
      </label>
      <label className="field">
        <span>Tên</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>Chế độ</span>
        <select value={mode} onChange={(e) => setMode(e.target.value as WorldMode)}>
          <option value="full">FULL</option>
          <option value="layout-only">LAYOUT_ONLY</option>
        </select>
      </label>
      <label className="field">
        <span>Kiểu lô</span>
        <select value={profile} onChange={(e) => setProfile(e.target.value)}>
          {Object.keys(PROFILES).map((p) => (
            <option key={p} value={p}>
              {PROFILE_LABEL[p] ?? p}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Seed</span>
        <input type="number" value={seed} onChange={(e) => setSeed(e.target.value)} />
      </label>
      {mode === 'full' && <EnvironmentFields env={env} onChange={setEnv} />}
      <div className="row">
        <button
          disabled={!valid}
          onClick={() => (!isDirty(store()) || window.confirm('Document có thay đổi chưa lưu. Bỏ các thay đổi đó?')) && store().createWorldFromTracing({ worldId, name: name.trim(), file: `bản vẽ${ref.image ? `: ${ref.image.name}` : ''}`, mode, seed: Number(seed), profile, environment: env })}
          data-ref-create
        >
          Tạo world từ bản vẽ
        </button>
        <button disabled={!!extracted.issues.some((i) => i.severity === 'error')} onClick={() => downloadText(`${edit.doc.world.worldId}-ban-ve.geojson`, extracted.text, 'application/geo+json')} title="Dùng với npm run layout:import, hoặc để lưu trữ">
          Xuất GeoJSON
        </button>
      </div>
    </details>
  )
}

export function ReferencePanel() {
  const edit = useEditorStore((s) => s.edit)
  const selected = useEditorStore((s) => s.trace.selected)
  if (!edit) return null
  const { ref, issues } = documentReference(edit.doc)
  if (!ref && issues.length) return <p className="error">layout/reference.json hỏng: {issues[0].message}</p>
  const counts = ref ? { road: ref.features.filter((f) => f.kind === 'road').length, zone: ref.features.filter((f) => f.kind === 'zone').length, area: ref.features.filter((f) => f.kind === 'restricted').length } : null
  return (
    <div className="gen ref">
      <ImageSection tracing={ref} />
      {ref && <CalibrationSection tracing={ref} />}
      <Tools />
      {ref && selected && <FeatureSection tracing={ref} id={selected} />}
      {ref && counts && (
        <p className="hint" data-ref-counts>
          {counts.road} đường · {counts.zone} vùng đất · {counts.area} vùng cấm
          <span className="gen-legend">
            {(['arterial', 'collector', 'local', 'service', 'track'] as RoadClass[]).map((c) => (
              <span key={c}>
                <span className="gen-dot" style={{ background: TRACE_COLORS.road[c] }} /> {ROAD_CLASS_LABEL[c]}
              </span>
            ))}
          </span>
        </p>
      )}
      {ref && ref.features.length > 0 && <Output tracing={ref} />}
    </div>
  )
}
