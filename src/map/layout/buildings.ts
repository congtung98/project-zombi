import type { PrefabDocument, PrefabEntry, PrefabPlacement, QuarterTurns, Rect, XZ } from '../schema.ts'
import { chunkIdOf, chunkIndex, quantize, rotateRect, rotateXZ } from '../transform.ts'
import { byString } from './geometry.ts'
import { hashSeed, parcelRect, rng } from './parcels.ts'
import { rectCentre, rectsOverlap } from './rects.ts'
import type { LandUseZone, LayoutIssue, LayoutParcel, LayoutPlan, ParcelBuild, Side } from './schema.ts'

/**
 * PrefabPlacementGenerator (world generator WG3): buildings from the prefab library on the planned
 * parcels, following the plan of `docs/writing-block.md` §8:
 *
 * 1. parcel (a lot with a street); 2. prefabs whose `placement.allowedZones` hold its zone (and whose
 * `frontage` range, if any, holds its frontage); 3. footprint check: turned so the entrance faces the
 * street, the footprint must fit between the front setback, the side gaps and a rear gap — never
 * scaled; 4. position: centred along the frontage, front at the setback; 5. collision: the footprint
 * stays inside the parcel, which is clear of streets, unbuildable land and other parcels; 6. road access:
 * the entrance faces the street across the front yard; 7–8. the choice (weighted by `placement.weight`,
 * seeded per parcel) is recorded on the parcel as `build`.
 *
 * Some lots stay empty on purpose (vacancy per zone). Locked parcels are never touched; parcels whose
 * building was chosen by hand (`source: manual`) are skipped by bulk regeneration.
 */

export const BUILD_VERSION = 1
/** Clear strip kept behind a building (m). */
export const REAR_GAP = 1
/** Buildings stand on this grid when the lot leaves room (the navigation cell size). */
export const PLACEMENT_GRID = 0.5

/** Chance that a lot of the zone stays empty. */
export const DEFAULT_VACANCY: Record<LandUseZone, number> = { residential: 0.12, commercial: 0.1, industrial: 0.2, public: 0.25, forest: 1, farmland: 1, empty: 1 }

export interface LibraryPrefab {
  entry: PrefabEntry
  doc: PrefabDocument
  placement: PrefabPlacement
  /** Footprint side the entrance is on (prefab coordinates, before turning). */
  entrance: Side
  /** Footprint relative to the pivot. */
  local: Rect
}

export interface PrefabCatalog {
  /** Label recorded on the plan and the world, e.g. `prefab-library@1`. */
  id: string
  prefabs: LibraryPrefab[]
}

const SIDE_VEC: Record<Side, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }

/** Quarter turns that bring side `from` to side `to`. */
export function turnsBetween(from: Side, to: Side): QuarterTurns {
  const [vx, vz] = SIDE_VEC[from]
  const [wx, wz] = SIDE_VEC[to]
  for (let q = 0; q < 4; q++) {
    const [x, z] = rotateXZ(vx, vz, q)
    if (x === wx && z === wz) return q as QuarterTurns
  }
  return 0
}

/** Side of the footprint a point is nearest to (relative to the footprint centre, normalised). */
function sideOf(f: Rect, p: XZ): Side {
  const dx = (p.x - (f.minX + f.maxX) / 2) / ((f.maxX - f.minX) / 2)
  const dz = (p.z - (f.minZ + f.maxZ) / 2) / ((f.maxZ - f.minZ) / 2)
  if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? 'E' : 'W'
  return dz >= 0 ? 'S' : 'N'
}

/** Entrance side: `placement.entrance`, else the first ground-floor door. */
export function entranceSide(doc: PrefabDocument): Side | null {
  if (doc.placement?.entrance) return sideOf(doc.footprint, doc.placement.entrance)
  const door = doc.objects.find((o) => o.kind === 'door' && !o.level)
  return door && door.kind === 'door' ? sideOf(doc.footprint, door.position) : null
}

/** The prefabs of a library that the generator may place: those with placement metadata and an entrance. */
export function prefabCatalog(id: string, prefabs: readonly { entry: PrefabEntry; doc: PrefabDocument }[]): PrefabCatalog {
  const out: LibraryPrefab[] = []
  for (const { entry, doc } of prefabs) {
    if (!doc.placement || !doc.building) continue
    const side = entranceSide(doc)
    if (!side) continue
    const f = doc.footprint
    out.push({ entry, doc, placement: doc.placement, entrance: side, local: { minX: f.minX - doc.pivot.x, minZ: f.minZ - doc.pivot.z, maxX: f.maxX - doc.pivot.x, maxZ: f.maxZ - doc.pivot.z } })
  }
  return { id, prefabs: out.sort((a, b) => byString(a.entry.prefabId, b.entry.prefabId)) }
}

export interface Fit {
  quarterTurns: QuarterTurns
  position: XZ
  footprint: Rect
}

/** Where a prefab stands on a lot (entrance to the street, setbacks kept, never scaled), or null if it does not fit. */
export function fitPrefab(parcel: LayoutParcel, p: LibraryPrefab, placement: PrefabPlacement = p.placement): Fit | null {
  if (!parcel.access) return null
  const side = parcel.access.side
  const r = parcelRect(parcel)
  const alongX = side === 'N' || side === 'S'
  const frontLen = alongX ? r.maxX - r.minX : r.maxZ - r.minZ
  const depthLen = alongX ? r.maxZ - r.minZ : r.maxX - r.minX
  const eps = 1e-6
  if (placement.frontage && (frontLen < placement.frontage[0] - eps || frontLen > placement.frontage[1] + eps)) return null
  const turns: QuarterTurns[] = placement.roadFacing ? [turnsBetween(p.entrance, side)] : [0, 1, 2, 3]
  for (const q of turns) {
    const rr = rotateRect(p.local, q)
    const w = rr.maxX - rr.minX
    const d = rr.maxZ - rr.minZ
    const along = alongX ? w : d
    const deep = alongX ? d : w
    if (along > frontLen - 2 * placement.sideGap + eps) continue
    if (deep > depthLen - placement.setback - REAR_GAP + eps) continue
    const centre: XZ =
      side === 'N'
        ? { x: (r.minX + r.maxX) / 2, z: r.minZ + placement.setback + deep / 2 }
        : side === 'S'
          ? { x: (r.minX + r.maxX) / 2, z: r.maxZ - placement.setback - deep / 2 }
          : side === 'W'
            ? { x: r.minX + placement.setback + deep / 2, z: (r.minZ + r.maxZ) / 2 }
            : { x: r.maxX - placement.setback - deep / 2, z: (r.minZ + r.maxZ) / 2 }
    // Pivot on the placement grid within the slack the setbacks leave (towards the street, else centred):
    // walls and door gaps then line up with the 0.5 m navigation cells like hand-placed buildings.
    const allowed = {
      x: alongX ? [r.minX + placement.sideGap - rr.minX, r.maxX - placement.sideGap - rr.maxX] : side === 'W' ? [r.minX + placement.setback - rr.minX, r.maxX - REAR_GAP - rr.maxX] : [r.minX + REAR_GAP - rr.minX, r.maxX - placement.setback - rr.maxX],
      z: !alongX ? [r.minZ + placement.sideGap - rr.minZ, r.maxZ - placement.sideGap - rr.maxZ] : side === 'N' ? [r.minZ + placement.setback - rr.minZ, r.maxZ - REAR_GAP - rr.maxZ] : [r.minZ + REAR_GAP - rr.minZ, r.maxZ - placement.setback - rr.maxZ],
    }
    const want = { x: centre.x - (rr.minX + rr.maxX) / 2, z: centre.z - (rr.minZ + rr.maxZ) / 2 }
    const snap = (v: number, [lo, hi]: number[]) => {
      const g = Math.min(Math.max(Math.round(v / PLACEMENT_GRID) * PLACEMENT_GRID, Math.ceil((lo - eps) / PLACEMENT_GRID) * PLACEMENT_GRID), Math.floor((hi + eps) / PLACEMENT_GRID) * PLACEMENT_GRID)
      return g >= lo - eps && g <= hi + eps ? g : null
    }
    const sx = snap(want.x, allowed.x)
    const sz = snap(want.z, allowed.z)
    // Off the grid a door gap may miss the navigation cells: treat as not fitting.
    if (sx === null || sz === null) continue
    const position = { x: quantize(sx), z: quantize(sz) }
    const footprint = { minX: quantize(position.x + rr.minX), minZ: quantize(position.z + rr.minZ), maxX: quantize(position.x + rr.maxX), maxZ: quantize(position.z + rr.maxZ) }
    return { quarterTurns: q, position, footprint }
  }
  return null
}

export interface BuildOptions {
  /** Only these parcels (explicit: hand-chosen buildings are regenerated too; locked ones never). */
  parcels?: readonly string[]
  /** Only parcels whose centre lies in these chunks (bulk: hand-chosen and locked ones are skipped). */
  chunks?: readonly string[]
  chunkSize?: number
  /** Varies the choice without changing the parcels (0 = the parcel's own seed). */
  salt?: number
  vacancy?: Partial<Record<LandUseZone, number>>
}

/**
 * Decide the buildings of the plan's parcels. Without a selection: every parcel not decided yet
 * (`build` absent). With a selection (SELECTIVE_REGENERATION): those parcels again. Returns a new plan.
 */
export function placeBuildings(plan: LayoutPlan, catalog: PrefabCatalog, opts: BuildOptions = {}): { plan: LayoutPlan; issues: LayoutIssue[] } {
  const issues: LayoutIssue[] = []
  const vacancy = { ...DEFAULT_VACANCY, ...opts.vacancy }
  const explicit = opts.parcels ? new Set(opts.parcels) : null
  const chunks = opts.chunks ? new Set(opts.chunks) : null
  const S = opts.chunkSize ?? 32
  if (explicit) for (const id of explicit) if (!plan.parcels.some((q) => q.id === id)) issues.push({ severity: 'warning', code: 'unknown-parcel', message: `không có lô ${id}`, ids: [id] })
  const counts = { built: 0, vacant: 0, 'no-prefab': 0, 'no-fit': 0, skippedLocked: 0, skippedManual: 0 }
  const parcels = plan.parcels.map((q): LayoutParcel => {
    const c = rectCentre(parcelRect(q))
    const inChunks = chunks !== null && chunks.has(chunkIdOf(chunkIndex(c.x, S), chunkIndex(c.z, S)))
    const selected = explicit ? explicit.has(q.id) : chunks ? inChunks : q.build === undefined
    if (!selected) return q
    if (q.locked) {
      counts.skippedLocked++
      if (explicit || chunks) issues.push({ severity: 'info', code: 'parcel-locked', message: `lô ${q.id} đã khóa: giữ nguyên`, ids: [q.id] })
      return q
    }
    if (!explicit && q.build?.source === 'manual') {
      counts.skippedManual++
      return q
    }
    return { ...q, build: decide(q, catalog, vacancy, opts.salt ?? 0, counts) }
  })
  const n = counts
  issues.push({ severity: 'info', code: 'buildings', message: `${n.built} công trình, ${n.vacant} lô bỏ trống, ${n['no-fit']} lô không vừa prefab nào, ${n['no-prefab']} lô không có prefab cho zone${n.skippedLocked ? `, giữ ${n.skippedLocked} lô khóa` : ''}${n.skippedManual ? `, giữ ${n.skippedManual} lô chọn tay` : ''}` })
  return { plan: { ...plan, parcels, catalog: catalog.id }, issues }
}

function decide(q: LayoutParcel, catalog: PrefabCatalog, vacancy: Record<LandUseZone, number>, salt: number, counts: Record<string, number>): ParcelBuild | null {
  if (q.kind !== 'lot' || !q.access) return null
  const random = rng(hashSeed(q.seed, `build:${salt}`))
  if (random() < vacancy[q.zone]) {
    counts.vacant++
    return { prefabId: null, reason: 'vacant', source: 'generated' }
  }
  const candidates = catalog.prefabs.filter((p) => p.placement.allowedZones.includes(q.zone))
  if (!candidates.length) {
    counts['no-prefab']++
    return { prefabId: null, reason: 'no-prefab', source: 'generated' }
  }
  const fits = candidates.map((p) => ({ p, fit: fitPrefab(q, p) })).filter((x): x is { p: LibraryPrefab; fit: Fit } => x.fit !== null)
  if (!fits.length) {
    counts['no-fit']++
    return { prefabId: null, reason: 'no-fit', source: 'generated' }
  }
  let roll = random() * fits.reduce((a, x) => a + x.p.placement.weight, 0)
  let pick = fits[fits.length - 1]
  for (const x of fits) {
    roll -= x.p.placement.weight
    if (roll <= 0) {
      pick = x
      break
    }
  }
  counts.built++
  return { prefabId: pick.p.entry.prefabId, quarterTurns: pick.fit.quarterTurns, position: pick.fit.position, footprint: pick.fit.footprint, source: 'generated' }
}

/**
 * Replace (or clear, with null) the building of one parcel by hand. The prefab must fit the lot
 * without scaling; a zone the prefab does not list is allowed with a warning. Streets never change.
 */
export function setParcelPrefab(plan: LayoutPlan, catalog: PrefabCatalog, parcelId: string, prefabId: string | null): { plan: LayoutPlan; issues: LayoutIssue[] } {
  const issues: LayoutIssue[] = []
  const q = plan.parcels.find((x) => x.id === parcelId)
  if (!q) return { plan, issues: [{ severity: 'error', code: 'unknown-parcel', message: `không có lô ${parcelId}`, ids: [parcelId] }] }
  if (q.locked) return { plan, issues: [{ severity: 'error', code: 'parcel-locked', message: `lô ${parcelId} đã khóa: mở khóa trước khi thay công trình`, ids: [parcelId] }] }
  let build: ParcelBuild
  if (prefabId === null) build = { prefabId: null, reason: 'cleared', source: 'manual' }
  else {
    const p = catalog.prefabs.find((x) => x.entry.prefabId === prefabId)
    if (!p) return { plan, issues: [{ severity: 'error', code: 'unknown-prefab', message: `thư viện không có prefab ${prefabId} (có metadata placement)`, ids: [prefabId] }] }
    if (q.kind !== 'lot') return { plan, issues: [{ severity: 'error', code: 'not-a-lot', message: `lô ${parcelId} không giáp đường (${q.kind})`, ids: [parcelId] }] }
    // The frontage range is advice for the generator; a hand choice only has to fit.
    const fit = fitPrefab(q, p, { ...p.placement, frontage: undefined })
    if (!fit) return { plan, issues: [{ severity: 'error', code: 'prefab-does-not-fit', message: `${prefabId} không vừa lô ${parcelId} với khoảng lùi của nó (không co giãn prefab)`, ids: [parcelId, prefabId] }] }
    if (!p.placement.allowedZones.includes(q.zone)) issues.push({ severity: 'warning', code: 'zone-mismatch', message: `${prefabId} không dành cho zone ${q.zone} của lô ${parcelId}`, ids: [parcelId, prefabId] })
    build = { prefabId, quarterTurns: fit.quarterTurns, position: fit.position, footprint: fit.footprint, source: 'manual' }
  }
  return { plan: { ...plan, parcels: plan.parcels.map((x) => (x.id === parcelId ? { ...x, build } : x)), catalog: plan.catalog ?? catalog.id }, issues }
}

/**
 * Invariants of the buildings (tests and callers): footprints inside their parcel, clear of every
 * street surface and of each other; each entrance on the side facing the parcel's street.
 */
export function checkBuildings(plan: LayoutPlan, catalog: PrefabCatalog): LayoutIssue[] {
  const issues: LayoutIssue[] = []
  const built = plan.parcels.filter((q): q is LayoutParcel & { build: Extract<ParcelBuild, { prefabId: string }> } => !!q.build && q.build.prefabId !== null)
  for (const q of built) {
    const r = parcelRect(q)
    const f = q.build.footprint
    if (f.minX < r.minX - 1e-6 || f.maxX > r.maxX + 1e-6 || f.minZ < r.minZ - 1e-6 || f.maxZ > r.maxZ + 1e-6) issues.push({ severity: 'error', code: 'building-outside-parcel', message: `công trình trên ${q.id} ra ngoài lô`, ids: [q.id] })
    const s = plan.surfaces.find((x) => rectsOverlap(x.rect, f))
    if (s) issues.push({ severity: 'error', code: 'building-on-street', message: `công trình trên ${q.id} chồng lên ${s.id}`, ids: [q.id, s.id] })
    const p = catalog.prefabs.find((x) => x.entry.prefabId === q.build.prefabId)
    if (!p) issues.push({ severity: 'error', code: 'unknown-prefab', message: `lô ${q.id} dùng ${q.build.prefabId} không có trong thư viện`, ids: [q.id] })
    else if (q.access && p.placement.roadFacing) {
      const [x, z] = rotateXZ(SIDE_VEC[p.entrance][0], SIDE_VEC[p.entrance][1], q.build.quarterTurns)
      const faces = (Object.keys(SIDE_VEC) as Side[]).find((k) => SIDE_VEC[k][0] === x && SIDE_VEC[k][1] === z)
      if (faces !== q.access.side) issues.push({ severity: 'error', code: 'entrance-not-facing-street', message: `cửa chính trên ${q.id} quay ${faces}, đường ở ${q.access.side}`, ids: [q.id] })
    }
  }
  for (let i = 0; i < built.length; i++) for (let j = i + 1; j < built.length; j++) if (rectsOverlap(built[i].build.footprint, built[j].build.footprint)) issues.push({ severity: 'error', code: 'building-overlap', message: `công trình trên ${built[i].id} và ${built[j].id} chồng nhau`, ids: [built[i].id, built[j].id] })
  return issues
}
