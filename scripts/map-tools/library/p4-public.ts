// Prefab library P4: large public buildings, placed by hand only (owner decision D6: no generator
// placement, but their compounds carry footprint and placement metadata for later). A hospital, a
// police station, a high-school classroom block, a university lecture hall and a dormitory, all on
// one pattern (a corridor through every storey, rooms on both sides, switchback stair cores), and
// the compounds around them: police station with parking, hospital with forecourt, high school with
// two blocks, schoolyard, court and fence, university campus.
import type { CompoundDocument, PrefabDocument, PrefabPlacement, Rect, SurfaceMaterial } from '../../../src/map/schema.ts'
import { Building, box, buildAll, Compound, compoundDoc, preset, rect, type Box } from './builder.ts'
import { apartment } from './p2-houses.ts'

const table = preset('furniture/table')
const chair = preset('furniture/chair')
const sofa = preset('furniture/sofa')
const counter = preset('furniture/counter')
const bedH = box('prop', [2, 0.7, 1], '#dfe3e6', { asset: 'furniture/bed' })
const officeDesk = box('container', [1.4, 0.75, 0.7], '#7b6a58', { name: 'Bàn làm việc', loot: 'office-desk', asset: 'furniture/desk' })
const filing = box('container', [0.8, 1.4, 0.6], '#8a8f94', { name: 'Tủ hồ sơ', loot: 'office-desk', asset: 'furniture/cabinet' })
const medCab = box('container', [1, 1.8, 0.5], '#e8ecee', { name: 'Tủ thuốc', loot: 'medical-cabinet', asset: 'furniture/cabinet' })
const pharmacy = box('container', [2, 1.8, 0.5], '#e1e6e8', { name: 'Kệ thuốc', loot: 'pharmacy-shelf', asset: 'furniture/shelving' })
const canteen = box('container', [0.8, 1.8, 0.8], '#d8dde0', { name: 'Tủ lạnh căng tin', loot: 'canteen-fridge', asset: 'furniture/fridge' })
const armory = box('container', [1.6, 2, 0.6], '#4f5a4a', { name: 'Tủ vũ khí', loot: 'police-armory', asset: 'furniture/wardrobe' })
const locker = box('container', [0.9, 2, 0.5], '#6c7a86', { name: 'Tủ cá nhân', loot: 'locker', asset: 'furniture/wardrobe' })
const books = box('container', [1.2, 2, 0.4], '#6f5a45', { name: 'Kệ sách', loot: 'bookstore-shelf', asset: 'furniture/bookshelf' })
const opTable = box('prop', [2, 0.9, 0.9], '#b9c4c9')
const cellBed = box('prop', [2, 0.5, 0.8], '#6d6f70', { asset: 'furniture/bed' })

type Kind = 'lobby' | 'clinic' | 'ward' | 'pharmacy' | 'canteen' | 'surgery' | 'office' | 'meeting' | 'armory' | 'lockers' | 'cell' | 'classroom' | 'lecture' | 'library' | 'store' | 'plain'
interface RoomSpec {
  w: number
  name: string
  kind: Kind
  /** Door from the corridor near the room's west end (default) or east end. */
  door?: 'left' | 'right'
  core?: boolean
}

interface CorridorSpec {
  prefabId: string
  name: string
  w: number
  d: number
  /** Corridor walls (z of its north and south wall); rooms north of the first, south of the second. */
  corridor: [number, number]
  storeys: number
  height: number
  colors: [string, string, string]
  tags: string[]
  levels: { north: RoomSpec[]; south: RoomSpec[] }[]
  /** Entrances on the ground floor: outer wall side and x (or z for W/E). */
  entrances: { side: 'N' | 'S' | 'W' | 'E'; at: number; width: number; name?: string }[]
}

/**
 * A building on the corridor pattern: outer walls, the corridor at every storey, rooms north and
 * south with a door onto the corridor, furnished by kind; `core` rooms (7 m, north side) hold a
 * switchback stair, lane A climbing east from even storeys, lane B west from odd ones.
 */
function corridorBuilding(s: CorridorSpec): PrefabDocument {
  const hx = s.w / 2
  const hz = s.d / 2
  const [zN, zS] = s.corridor
  const h = new Building({ prefabId: s.prefabId, name: s.name, footprint: rect(-hx, -hz, hx, hz), storeys: s.storeys, height: s.height, wallColor: s.colors[0], roofColor: s.colors[1], floorColor: s.colors[2], catalog: { group: 'public', tags: s.tags } })
  h.outerWalls()
  const t = h.t
  s.levels.forEach((lv, level) => {
    h.wallX(level, zN, -hx, hx)
    if (zS < hz) h.wallX(level, zS, -hx, hx)
    h.room(level, `Hành lang tầng ${level + 1}`, rect(-hx, zN, hx, zS), { floor: 'tile' })
    // A window at each end of the corridor, unless the ground floor has its side door there.
    for (const side of ['W', 'E'] as const) {
      if (level === 0 && s.entrances.some((e) => e.side === side)) continue
      h.window(level, { x: side === 'W' ? -hx : hx, z: (zN + zS) / 2 }, { x: 0, z: (zN + zS) / 2 }, 1)
    }
    for (const [side, rooms] of [['N', lv.north], ['S', lv.south]] as const) {
      if (side === 'S' && zS >= hz) continue
      let x = -hx
      rooms.forEach((rs, i) => {
        const r = side === 'N' ? rect(x, -hz, x + rs.w, zN) : rect(x, zS, x + rs.w, hz)
        const cz = side === 'N' ? zN : zS
        if (i > 0) h.wallZ(level, x, r.minZ, r.maxZ)
        if (rs.core) {
          const c = x + rs.w / 2
          const laneA = zN - 1.1
          const laneB = laneA - 1.2 - t
          if (level < s.storeys - 1) h.stairs(level, level % 2 === 0 ? { x: c - 2, z: laneA } : { x: c + 2, z: laneB }, level % 2 === 0 ? 'E' : 'W', 4, 1.2)
          const dx = level % 2 === 0 ? c - 3 : c + 3
          h.door(level, { x: dx, z: zN }, { x: dx, z: zN + 1 }, { width: 1, name: 'Cửa cầu thang' })
          h.room(level, `Cầu thang ${level + 1}`, r, { floor: 'concrete', switchAt: { x: c + 3.1, z: zN - 4.5 } })
        } else {
          const dx = rs.door === 'right' ? r.maxX - 1.5 : r.minX + 1.5
          h.door(level, { x: dx, z: cz }, { x: dx, z: cz + (side === 'N' ? -1 : 1) }, { width: 1.2 })
          h.room(level, rs.name, r, rs.kind === 'surgery' || rs.kind === 'clinic' || rs.kind === 'pharmacy' ? { floor: 'tile' } : {})
          furnish(h, level, r, side, rs)
          // Windows on the outer wall of the room.
          const n = Math.max(1, Math.floor(rs.w / 4))
          for (let k = 0; k < n; k++) {
            const wx = r.minX + ((k + 0.5) * rs.w) / n
            h.window(level, { x: wx, z: side === 'N' ? -hz : hz }, { x: wx, z: 0 }, 1.4)
          }
        }
        x += rs.w
      })
    }
  })
  for (const e of s.entrances) {
    const at = e.side === 'N' ? { x: e.at, z: -hz } : e.side === 'S' ? { x: e.at, z: hz } : e.side === 'W' ? { x: -hx, z: e.at } : { x: hx, z: e.at }
    // Doors at the corridor's ends swing out (a leaf swinging in would close the corridor).
    const out = e.side === 'W' || e.side === 'E'
    h.door(0, at, out ? { x: at.x * 1.1, z: at.z } : { x: at.x * 0.9, z: at.z * 0.9 }, { width: e.width, name: e.name ?? 'Cửa chính' })
  }
  return mainFirst(h.doc())
}

/** Main entrance first among the doors (the generator's entrance, later, and a readable file). */
function mainFirst(p: PrefabDocument): PrefabDocument {
  const i = p.objects.findIndex((o) => o.kind === 'door' && o.name === 'Cửa chính')
  if (i <= 0) return p
  const objects = [...p.objects]
  const [main] = objects.splice(i, 1)
  objects.splice(objects.findIndex((o) => o.kind === 'door'), 0, main)
  return { ...p, objects }
}

/** Furniture of a room by kind: against the outer wall and the side wall away from its door. */
function furnish(h: Building, level: number, r: Rect, side: 'N' | 'S', rs: RoomSpec): void {
  const outer = side
  const far = rs.door === 'right' ? 'W' : 'E'
  const w = r.maxX - r.minX
  const d = r.maxZ - r.minZ
  const mid = { x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 }
  const put = (b: Box, dx: number, dz: number, turn = false) => h.put(level, b, { x: mid.x + dx, z: mid.z + dz }, { turn })
  switch (rs.kind) {
    case 'lobby':
      h.against(level, r, outer, w / 2 + 2.5, counter).against(level, r, far, d / 2, sofa)
      break
    case 'clinic':
      h.against(level, r, outer, w - 1.6, bedH).against(level, r, far, d / 2, medCab)
      put(officeDesk, -0.5, 0)
      break
    case 'ward':
      for (let a = 1.8; a + 1 <= w - 0.4; a += 2.6) h.against(level, r, outer, a, bedH)
      h.against(level, r, far, d / 2 + 0.5, medCab)
      break
    case 'pharmacy':
      h.against(level, r, outer, 1.6, pharmacy).against(level, r, outer, 4, pharmacy).against(level, r, far, d / 2, pharmacy)
      put(counter, 0, 0)
      break
    case 'canteen':
      for (const dx of [-w / 4, w / 4]) put(table, dx, 0)
      h.against(level, r, outer, w - 1.2, canteen).against(level, r, outer, w - 2.4, canteen)
      break
    case 'surgery':
      put(opTable, 0, 0)
      h.against(level, r, outer, 1.2, medCab).against(level, r, far, d / 2, medCab)
      break
    case 'office':
      h.against(level, r, outer, w / 2, officeDesk).against(level, r, far, d / 2, filing)
      put(chair, 0, side === 'N' ? -0.2 : 0.2)
      break
    case 'meeting':
      put(table, -0.8, 0)
      put(table, 0.8, 0)
      h.against(level, r, far, d / 2, filing)
      break
    case 'armory':
      h.against(level, r, outer, 1.4, armory).against(level, r, outer, 3.4, armory).against(level, r, far, d / 2, armory)
      break
    case 'lockers':
      for (let a = 1; a + 0.5 <= w - 0.5; a += 1.1) h.against(level, r, outer, a, locker)
      break
    case 'cell':
      h.against(level, r, far, d / 2 + 0.6, cellBed)
      break
    case 'classroom':
    case 'lecture': {
      const cols = Math.max(2, Math.floor((w - 3) / 2.4))
      const rows = Math.max(2, Math.floor((d - 3) / 2.2))
      for (let i = 0; i < cols; i++)
        for (let j = 0; j < rows; j++) h.put(level, table, { x: r.minX + 2.2 + i * 2.4, z: (side === 'N' ? r.minZ + 1.8 : r.maxZ - 1.8) + (side === 'N' ? 1 : -1) * j * 2.2 })
      h.against(level, r, far, d / 2, rs.kind === 'classroom' ? locker : filing)
      break
    }
    case 'library':
      for (let a = 1.2; a + 0.6 <= w - 0.5; a += 1.4) h.against(level, r, outer, a, books)
      put(table, 0, 0)
      break
    case 'store':
      h.against(level, r, outer, 1.4, preset('container/shelf', { name: 'Kệ kho', loot: 'hardware-shelf', size: [2, 1.6, 0.6] })).against(level, r, far, d / 2, filing)
      break
    case 'plain':
      break
  }
}

const core: RoomSpec = { w: 7, name: 'Cầu thang', kind: 'plain', core: true }

/** Bệnh viện, 40 × 24, 3 storeys: two stair cores; emergency, clinics, pharmacy, canteen; wards; surgery. */
function hospital(): PrefabDocument {
  return corridorBuilding({
    prefabId: 'public/hospital',
    name: 'Bệnh viện',
    w: 40,
    d: 24,
    corridor: [-1.5, 1.5],
    storeys: 3,
    height: 3.5,
    colors: ['#eef0ee', '#56606a', '#c9cfd1'],
    tags: ['benh-vien', 'y-te'],
    entrances: [{ side: 'S', at: 0, width: 2 }, { side: 'W', at: 0, width: 1.4, name: 'Cửa phụ' }],
    levels: [
      { north: [core, { w: 8, name: 'Cấp cứu', kind: 'ward' }, { w: 6, name: 'Phòng khám 1', kind: 'clinic' }, { w: 6, name: 'Phòng khám 2', kind: 'clinic' }, { w: 6, name: 'Phòng khám 3', kind: 'clinic' }, core], south: [{ w: 8, name: 'Nhà thuốc', kind: 'pharmacy' }, { w: 6, name: 'Phòng khám 4', kind: 'clinic' }, { w: 12, name: 'Sảnh tiếp đón', kind: 'lobby', door: 'right' }, { w: 6, name: 'Phòng khám 5', kind: 'clinic' }, { w: 8, name: 'Căng tin', kind: 'canteen' }] },
      { north: [core, { w: 8, name: 'Phòng bệnh 1', kind: 'ward' }, { w: 6, name: 'Phòng bệnh 2', kind: 'ward' }, { w: 6, name: 'Trạm y tá', kind: 'clinic' }, { w: 6, name: 'Phòng bệnh 3', kind: 'ward' }, core], south: [{ w: 8, name: 'Phòng bệnh 4', kind: 'ward' }, { w: 8, name: 'Phòng bệnh 5', kind: 'ward' }, { w: 8, name: 'Phòng bệnh 6', kind: 'ward' }, { w: 8, name: 'Phòng bệnh 7', kind: 'ward' }, { w: 8, name: 'Kho thuốc', kind: 'pharmacy' }] },
      { north: [core, { w: 8, name: 'Phòng mổ 1', kind: 'surgery' }, { w: 6, name: 'Phòng hồi sức', kind: 'ward' }, { w: 6, name: 'Phòng mổ 2', kind: 'surgery' }, { w: 6, name: 'Phòng bác sĩ', kind: 'office' }, core], south: [{ w: 10, name: 'Phòng bệnh 8', kind: 'ward' }, { w: 10, name: 'Phòng giám đốc', kind: 'office' }, { w: 10, name: 'Phòng họp', kind: 'meeting' }, { w: 10, name: 'Phòng bệnh 9', kind: 'ward' }] },
    ],
  })
}

/** Đồn cảnh sát, 26 × 18, 2 storeys: front desk, armory, lockers, cells, interview; offices upstairs. */
function policeStation(): PrefabDocument {
  return corridorBuilding({
    prefabId: 'public/police-station',
    name: 'Đồn cảnh sát',
    w: 26,
    d: 18,
    corridor: [-1.5, 1.5],
    storeys: 2,
    height: 3.4,
    colors: ['#d7dde3', '#2f3d52', '#a7aeb3'],
    tags: ['canh-sat', 'don'],
    entrances: [{ side: 'S', at: -8, width: 1.6 }],
    levels: [
      { north: [core, { w: 6, name: 'Kho vũ khí', kind: 'armory' }, { w: 6, name: 'Phòng thay đồ', kind: 'lockers' }, { w: 3.5, name: 'Buồng giam 1', kind: 'cell' }, { w: 3.5, name: 'Buồng giam 2', kind: 'cell' }], south: [{ w: 10, name: 'Phòng trực ban', kind: 'lobby', door: 'right' }, { w: 8, name: 'Văn phòng', kind: 'office' }, { w: 8, name: 'Phòng hỏi cung', kind: 'meeting' }] },
      { north: [core, { w: 6.5, name: 'Văn phòng 2', kind: 'office' }, { w: 6.5, name: 'Văn phòng 3', kind: 'office' }, { w: 6, name: 'Phòng họp', kind: 'meeting' }], south: [{ w: 8, name: 'Phòng trưởng đồn', kind: 'office' }, { w: 9, name: 'Văn phòng 4', kind: 'office' }, { w: 9, name: 'Kho hồ sơ', kind: 'store' }] },
    ],
  })
}

/** Dãy lớp học (trường cấp ba), 44 × 12, 2 storeys: a corridor along the south side, four classrooms a storey. */
function schoolBlock(): PrefabDocument {
  return corridorBuilding({
    prefabId: 'public/school-block',
    name: 'Dãy lớp học',
    w: 44,
    d: 12,
    corridor: [3, 6],
    storeys: 2,
    height: 3.5,
    colors: ['#f0e6c8', '#a3472c', '#b9a58c'],
    tags: ['truong-hoc', 'cap-3'],
    entrances: [{ side: 'S', at: -10, width: 1.6 }, { side: 'S', at: 6, width: 1.6, name: 'Cửa phụ' }, { side: 'W', at: 4.5, width: 1.2, name: 'Cửa hông' }],
    levels: [
      { north: [{ w: 9.25, name: 'Lớp 10A', kind: 'classroom' }, { w: 9.25, name: 'Lớp 10B', kind: 'classroom' }, { w: 9.25, name: 'Lớp 11A', kind: 'classroom' }, { w: 9.25, name: 'Phòng giáo viên', kind: 'office' }, core], south: [] },
      { north: [{ w: 9.25, name: 'Lớp 11B', kind: 'classroom' }, { w: 9.25, name: 'Lớp 12A', kind: 'classroom' }, { w: 9.25, name: 'Lớp 12B', kind: 'classroom' }, { w: 9.25, name: 'Thư viện', kind: 'library' }, core], south: [] },
    ],
  })
}

/** Giảng đường (đại học), 48 × 16, 3 storeys: two stair cores, lecture and seminar rooms, offices. */
function lectureHall(): PrefabDocument {
  return corridorBuilding({
    prefabId: 'public/lecture-hall',
    name: 'Giảng đường',
    w: 48,
    d: 16,
    corridor: [-1.5, 1.5],
    storeys: 3,
    height: 3.8,
    colors: ['#e3ddd2', '#6a3a2c', '#b8ad9b'],
    tags: ['dai-hoc', 'giang-duong'],
    entrances: [{ side: 'S', at: -18, width: 2 }, { side: 'E', at: 0, width: 1.4, name: 'Cửa phụ' }],
    levels: [
      { north: [core, { w: 12, name: 'Giảng đường A', kind: 'lecture' }, { w: 11, name: 'Phòng seminar 1', kind: 'classroom' }, { w: 11, name: 'Phòng seminar 2', kind: 'classroom' }, core], south: [{ w: 12, name: 'Sảnh', kind: 'lobby', door: 'right' }, { w: 18, name: 'Giảng đường B', kind: 'lecture' }, { w: 18, name: 'Giảng đường C', kind: 'lecture' }] },
      { north: [core, { w: 12, name: 'Giảng đường D', kind: 'lecture' }, { w: 11, name: 'Phòng thí nghiệm', kind: 'surgery' }, { w: 11, name: 'Phòng seminar 3', kind: 'classroom' }, core], south: [{ w: 16, name: 'Thư viện', kind: 'library' }, { w: 16, name: 'Giảng đường E', kind: 'lecture' }, { w: 16, name: 'Giảng đường F', kind: 'lecture' }] },
      { north: [core, { w: 12, name: 'Văn phòng khoa', kind: 'office' }, { w: 11, name: 'Phòng họp', kind: 'meeting' }, { w: 11, name: 'Văn phòng 2', kind: 'office' }, core], south: [{ w: 16, name: 'Phòng hội thảo', kind: 'lecture' }, { w: 16, name: 'Căng tin', kind: 'canteen' }, { w: 16, name: 'Kho', kind: 'store' }] },
    ],
  })
}

/** Ký túc xá, 30 × 14, 3 storeys (the apartment pattern). */
function dormitory(): PrefabDocument {
  const p = apartment('public/dormitory', 'Ký túc xá', 3)
  const { placement: _placement, ...rest } = p
  return { ...rest, catalog: { group: 'public', tags: ['dai-hoc', 'ky-tuc-xa'] } }
}

const campus = (frontage: [number, number]): PrefabPlacement => ({ category: 'public', allowedZones: ['public'], weight: 1, setback: 2, sideGap: 2, roadFacing: true, frontage })

/** Compounds (hand-placed in P4; footprint and placement kept for the generator later, D6). */
function compounds(prefabs: ReadonlyMap<string, PrefabDocument>): CompoundDocument[] {
  const police = new Compound('compound/police-station', 'Đồn cảnh sát có bãi xe', { group: 'public', tags: ['canh-sat'] }, campus([30, 60]))
  police.building('public/police-station', { x: 0, z: 0 })
  police.surface('asphalt', { x: 0, z: 15 }, [30, 10], { base: 'parking' }).surface('concrete', { x: -8, z: 10 }, [4, 2], { layer: 1, base: 'steps' })
  police.box(box('prop', [1.9, 1.5, 4.3], '#e8edf2', { asset: 'outdoor/car' }), { x: 4, z: 15 }, { base: 'police-car' }).box(box('prop', [1.9, 1.5, 4.3], '#1f3a66', { asset: 'outdoor/car' }), { x: 8, z: 15 }, { base: 'police-car' })
  police.box(box('prop', [0.3, 4.2, 0.3], '#4a4d51', { asset: 'outdoor/streetlight' }), { x: -14, z: 14 }, { base: 'streetlight' }).box(box('prop', [0.2, 7, 0.2], '#c9ccd0'), { x: 12, z: 11 }, { base: 'flagpole' })

  const hosp = new Compound('compound/hospital', 'Bệnh viện có sân trước', { group: 'public', tags: ['benh-vien'] }, campus([44, 80]))
  hosp.building('public/hospital', { x: 0, z: 0 })
  hosp.surface('concrete', { x: 0, z: 18 }, [40, 12], { base: 'forecourt' }).surface('asphalt', { x: -14, z: 18 }, [10, 10], { layer: 1, base: 'ambulance-bay' })
  hosp.box(box('prop', [1.9, 1.8, 4.6], '#f2f2f0', { asset: 'outdoor/car' }), { x: -14, z: 18 }, { base: 'ambulance' })
  for (const x of [6, 12, 18]) hosp.tree({ x, z: 21 }, 'round', 5, 2)
  for (const x of [4, 10]) hosp.box(box('prop', [1.8, 0.5, 0.5], '#6b5a44'), { x, z: 16 }, { base: 'bench' })

  const school = new Compound('compound/high-school', 'Trường cấp ba', { group: 'public', architectureStyle: 'vietnamese', tags: ['truong-hoc', 'cap-3'] }, campus([70, 110]))
  school.building('public/school-block', { x: 4, z: -18 }, 0, 'block-a').building('public/school-block', { x: -28, z: 4 }, 1, 'block-b')
  school.surface('concrete', { x: 5, z: 10 }, [50, 40], { base: 'schoolyard' }).surface('asphalt', { x: 10, z: 16 }, [28, 15], { layer: 1, base: 'court' })
  for (const x of [-3.5, 23.5]) school.box(box('prop', [0.3, 3, 0.3], '#d0d4d8'), { x, z: 16 }, { base: 'hoop' })
  school.box(box('prop', [0.2, 7, 0.2], '#c9ccd0'), { x: 4, z: -8 }, { base: 'flagpole' })
  school.enclose(rect(-38, -28, 36, 34), 0.15, 1.2, '#7a6a55', 'prop', [['S', 36, 8]], 'outdoor/fence')
  for (const z of [-20, -8, 4, 16, 28]) school.tree({ x: 33, z }, 'round', 6, 2.2)
  for (const x of [-18, -8]) school.box(box('prop', [1.8, 0.5, 0.5], '#6b5a44'), { x, z: 30 }, { base: 'bench' })
  school.box(box('container', [0.8, 1.1, 0.8], '#3f5f3a', { name: 'Thùng rác', loot: 'scrap-pile', asset: 'outdoor/bin' }), { x: 28, z: -6 }, { base: 'bin' })

  const uni = new Compound('compound/university', 'Khuôn viên đại học', { group: 'public', tags: ['dai-hoc'] }, campus([90, 140]))
  uni.building('public/lecture-hall', { x: 0, z: -22 }, 0, 'hall-north').building('public/lecture-hall', { x: 36, z: 12 }, 3, 'hall-east').building('public/dormitory', { x: -34, z: 10 }, 1, 'dormitory')
  const plaza: [SurfaceMaterial, number, number, number, number, number?][] = [
    ['tile', 2, 8, 48, 26],
    ['grass', -12, 8, 14, 18, 1],
    ['grass', 16, 8, 14, 18, 1],
    ['concrete', 2, 8, 4, 26, 1],
  ]
  for (const [m, x, z, sx, sz, layer] of plaza) uni.surface(m, { x, z }, [sx, sz], { layer, base: m === 'grass' ? 'lawn' : m === 'tile' ? 'plaza' : 'path' })
  uni.surface('water', { x: 2, z: 8 }, [6, 6], { shape: 'ellipse', layer: 2, base: 'fountain' })
  for (const [x, z] of [[-12, 2], [-12, 14], [16, 2], [16, 14], [-18, 24], [22, 24]]) uni.tree({ x, z }, 'round', 6, 2.2)
  for (const x of [-4, 8]) uni.box(box('prop', [1.8, 0.5, 0.5], '#6b5a44'), { x, z: 16 }, { base: 'bench' })

  return [police, hosp, school, uni].map((c) => compoundDoc(c, prefabs))
}

export function p4(): { prefabs: PrefabDocument[]; compounds: CompoundDocument[] } {
  const prefabs = buildAll([hospital, policeStation, schoolBlock, lectureHall, dormitory])
  return { prefabs, compounds: compounds(new Map(prefabs.map((p) => [p.prefabId, p]))) }
}
