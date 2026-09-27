// Prefab library P3: services. A bank, a two-storey bookstore, an auto-repair garage, a double
// garage and a machine workshop, with the place loot tables of lootTables.ts (existing items only, D5).
import type { CompoundDocument, PrefabDocument } from '../../../src/map/schema.ts'
import { Building, box, buildAll, preset, rect, VARIANTS } from './builder.ts'

const desk = preset('furniture/desk')
const chair = preset('furniture/chair')
const table = preset('furniture/table')
const sofa = preset('furniture/sofa')
const counter = preset('furniture/counter')
const officeDesk = box('container', [1.4, 0.75, 0.7], '#7b6a58', { name: 'Bàn làm việc', loot: 'office-desk', asset: 'furniture/desk' })
const filing = box('container', [0.8, 1.4, 0.6], '#8a8f94', { name: 'Tủ hồ sơ', loot: 'office-desk', asset: 'furniture/cabinet' })
const vault = box('container', [1.6, 1.8, 0.7], '#6e7479', { name: 'Két sắt', loot: 'bank-vault', asset: 'furniture/cabinet' })
const books = box('container', [1.2, 2, 0.4], '#6f5a45', { name: 'Kệ sách', loot: 'bookstore-shelf', asset: 'furniture/bookshelf' })
const garageShelf = box('container', [2, 1.8, 0.6], '#7c7f82', { name: 'Kệ phụ tùng', loot: 'garage-shelf', asset: 'furniture/shelving' })
const bench = box('container', [2, 0.9, 0.8], '#6d5a44', { name: 'Bàn thợ', loot: 'workshop-bench', asset: 'furniture/workbench' })
const toolShelf = box('container', [2, 1.8, 0.6], '#7c7f82', { name: 'Kệ dụng cụ', loot: 'tool-shelf', asset: 'furniture/shelving' })
const hardware = box('container', [2, 1.8, 0.6], '#80776a', { name: 'Kệ vật tư', loot: 'hardware-shelf', asset: 'furniture/shelving' })
const car = box('prop', [4.2, 1.4, 1.9], '#8c2f2f', { asset: 'outdoor/car' })
const machine = box('prop', [2, 1.5, 1.2], '#4f6f5a', { asset: 'furniture/machine' })
const atm = box('prop', [0.9, 1.9, 0.7], '#3f4a52', { asset: 'furniture/atm' })

/** Ngân hàng, 18 × 14: lobby with the teller counters, staff room, vault, archive, manager's office. */
function bank(): PrefabDocument {
  const h = new Building({ prefabId: 'service/bank', name: 'Ngân hàng', footprint: rect(-9, -7, 9, 7), height: 3.6, wallColor: '#d8d4cc', roofColor: '#4a4d52', floorColor: '#b9b2a6', catalog: { group: 'commercial', tags: ['ngan-hang', 'dich-vu'] }, placement: { category: 'shop', allowedZones: ['commercial'], weight: 0.4, setback: 3, sideGap: 2, roadFacing: true, frontage: [18, 32] }, variants: VARIANTS })
  h.outerWalls()
  h.door(0, { x: -1, z: 7 }, { x: -1, z: 6 }, { width: 1.6, name: 'Cửa chính' })
  h.wallX(0, 1, -9, 9).wallX(0, -3, -9, 9).wallZ(0, -3, -7, -3).wallZ(0, 3, -7, -3)
  h.door(0, { x: 6.5, z: 1 }, { x: 6.5, z: 0 }, { width: 1, name: 'Cửa nhân viên' })
  h.door(0, { x: -6, z: -3 }, { x: -6, z: -2 }, { width: 1.2, name: 'Cửa kho tiền' }).door(0, { x: 0, z: -3 }, { x: 0, z: -2 }, { width: 1 }).door(0, { x: 6, z: -3 }, { x: 6, z: -2 }, { width: 1 })
  h.windows(0, 'S', 6, 1.4, [2]).window(0, { x: -9, z: 4 }, { x: 0, z: 4 }).window(0, { x: 9, z: 4 }, { x: 0, z: 4 }).window(0, { x: -9, z: -1 }, { x: 0, z: -1 }).window(0, { x: 9, z: -1 }, { x: 0, z: -1 }).window(0, { x: 6, z: -7 }, { x: 6, z: 0 })
  const lobby = rect(-9, 1, 9, 7)
  const staff = rect(-9, -3, 9, 1)
  const vaultRoom = rect(-9, -7, -3, -3)
  const archive = rect(-3, -7, 3, -3)
  const office = rect(3, -7, 9, -3)
  h.room(0, 'Sảnh giao dịch', lobby, { floor: 'tile' }).room(0, 'Khu nhân viên', staff).room(0, 'Kho tiền', vaultRoom, { floor: 'concrete' }).room(0, 'Kho hồ sơ', archive).room(0, 'Phòng giám đốc', office)
  // Teller counters along the staff wall, a waiting sofa, an ATM.
  for (const x of [-6.5, -3.5, -0.5, 2.5]) h.against(0, lobby, 'N', x + 9, counter)
  h.against(0, lobby, 'W', 3, atm).against(0, lobby, 'E', 3.5, sofa)
  for (const x of [-6.5, -3.5, -0.5, 2.5]) h.put(0, officeDesk, { x, z: -0.6 })
  h.against(0, staff, 'N', 16.5, filing)
  h.against(0, vaultRoom, 'N', 1.4, vault).against(0, vaultRoom, 'N', 4.6, vault).against(0, vaultRoom, 'W', 2, preset('container/shelf', { name: 'Kệ kho tiền', loot: 'bank-vault', size: [1.6, 1.6, 0.6] }))
  h.against(0, archive, 'N', 1.3, filing).against(0, archive, 'N', 3, filing).against(0, archive, 'N', 4.7, filing)
  h.against(0, office, 'E', 2, officeDesk).against(0, office, 'N', 2, preset('container/bookshelf', { name: 'Kệ tài liệu', loot: 'office-desk' })).put(0, chair, { x: 7.2, z: -3.9 })
  return h.doc()
}

/** Nhà sách hai tầng, 14 × 12: sales floor with shelf rows, stock room; reading room and office upstairs. */
function bookstore(): PrefabDocument {
  const h = new Building({ prefabId: 'service/bookstore', name: 'Nhà sách', footprint: rect(-7, -6, 7, 6), storeys: 2, height: 3.2, wallColor: '#e6dcc6', roofColor: '#6d3527', floorColor: '#a88b67', catalog: { group: 'commercial', architectureStyle: 'vietnamese', tags: ['nha-sach', 'cua-hang'] }, placement: { category: 'shop', allowedZones: ['commercial'], weight: 0.6, setback: 2, sideGap: 1, roadFacing: true, frontage: [14, 24] }, variants: VARIANTS })
  h.outerWalls()
  h.stairs(0, { x: 6.2, z: 3 }, 'N', 4, 1)
  h.door(0, { x: -4, z: 6 }, { x: -4, z: 5 }, { width: 1.4, name: 'Cửa chính' })
  for (const level of [0, 1]) {
    h.wallX(level, -2.5, -7, 7)
    h.door(level, { x: -3, z: -2.5 }, { x: -3, z: -1.5 }, { width: 1 })
    h.windows(level, 'W', 3, 1.2).windows(level, 'N', 4, 1.2)
  }
  h.windows(0, 'S', 5, 1.4, [1]).windows(1, 'S', 5, 1.4)
  const floor = rect(-7, -2.5, 7, 6)
  const stock = rect(-7, -6, 7, -2.5)
  h.room(0, 'Gian bán sách', floor, { floor: 'tile' }).room(0, 'Kho sách', stock, { floor: 'concrete' })
  for (const z of [-0.6, 2.1]) for (let i = 0; i < 5; i++) h.put(0, books, { x: -4.8 + i * 1.2, z })
  h.put(0, counter, { x: 3.5, z: 4.4 })
  h.against(0, stock, 'N', 2, preset('container/shelf', { name: 'Kệ kho', loot: 'bookstore-shelf', size: [2, 1.6, 0.6] })).against(0, stock, 'N', 5, preset('container/shelf', { name: 'Kệ kho', loot: 'bookstore-shelf', size: [2, 1.6, 0.6] })).against(0, stock, 'N', 8, box('container', [1, 1, 1], '#a67c52', { name: 'Thùng sách', loot: 'bookstore-shelf', asset: 'furniture/crate' }))
  const reading = rect(-7, -2.5, 7, 6)
  const office = rect(-7, -6, 7, -2.5)
  h.room(1, 'Phòng đọc', reading).room(1, 'Văn phòng', office)
  for (const x of [-4.5, -1]) h.put(1, table, { x, z: 2 }).put(1, chair, { x, z: 2.9 }).put(1, chair, { x, z: 1.1 })
  h.against(1, reading, 'W', 6.5, books).against(1, reading, 'S', 3, books)
  h.against(1, office, 'N', 2, officeDesk).against(1, office, 'N', 5, filing).against(1, office, 'N', 9, officeDesk)
  return h.doc()
}

/** Gara sửa xe, 16 × 12: a workshop hall behind a wide door with a car in it, an office and a parts store. */
function autoRepair(): PrefabDocument {
  const h = new Building({ prefabId: 'service/auto-repair', name: 'Gara sửa xe', footprint: rect(-8, -6, 8, 6), height: 4, wallColor: '#bfb7a6', roofColor: '#56595e', floorColor: '#8d8a84', catalog: { group: 'industrial', tags: ['garage', 'sua-xe'] }, placement: { category: 'industrial', allowedZones: ['industrial', 'commercial'], weight: 0.8, setback: 4, sideGap: 1.5, roadFacing: true, frontage: [16, 30] }, variants: VARIANTS })
  h.outerWalls()
  h.door(0, { x: -2.5, z: 6 }, { x: -2.5, z: 5 }, { width: 3, name: 'Cửa xe' })
  h.wallZ(0, 3, -6, 6).wallX(0, 0, 3, 8)
  h.door(0, { x: 3, z: 3 }, { x: 2, z: 3 }, { width: 1 }).door(0, { x: 3, z: -3 }, { x: 2, z: -3 }, { width: 1 })
  h.door(0, { x: 5.5, z: 6 }, { x: 5.5, z: 5 }, { width: 1.2, name: 'Cửa văn phòng' })
  h.window(0, { x: -8, z: 0 }, { x: 0, z: 0 }).window(0, { x: -4, z: -6 }, { x: 0, z: 0 }).window(0, { x: 8, z: 3 }, { x: 0, z: 3 }).window(0, { x: 8, z: -3 }, { x: 0, z: -3 })
  const hall = rect(-8, -6, 3, 6)
  const office = rect(3, 0, 8, 6)
  const store = rect(3, -6, 8, 0)
  h.room(0, 'Xưởng', hall, { floor: 'concrete' }).room(0, 'Văn phòng', office).room(0, 'Kho phụ tùng', store, { floor: 'concrete' })
  h.put(0, car, { x: -3, z: -1.2 }, { turn: true })
  h.against(0, hall, 'N', 2.5, bench).against(0, hall, 'W', 6, garageShelf).against(0, hall, 'N', 8.5, garageShelf)
  h.decor(0, 'decor/tires', { x: 1.5, z: 3.5 }).decor(0, 'decor/oil-stain', { x: -2.5, z: 0.5 })
  h.against(0, office, 'E', 2.5, officeDesk).against(0, office, 'N', 1.5, filing)
  h.against(0, store, 'E', 3, garageShelf).against(0, store, 'N', 1.5, preset('container/shelf', { name: 'Kệ vật tư', loot: 'hardware-shelf', size: [1.6, 1.6, 0.6] }))
  return h.doc()
}

/** Garage đôi, 10 × 7: two car doors, one car, shelves along the back. */
function doubleGarage(): PrefabDocument {
  const h = new Building({ prefabId: 'service/garage-double', name: 'Garage đôi', footprint: rect(-5, -3.5, 5, 3.5), height: 3, wallColor: '#cfc6b4', roofColor: '#4f5256', floorColor: '#8d8a84', catalog: { group: 'residential', tags: ['garage'] }, placement: { category: 'outbuilding', allowedZones: ['residential'], weight: 0.3, setback: 3, sideGap: 1, roadFacing: true, frontage: [10, 20] }, variants: VARIANTS })
  h.outerWalls()
  // Car doors swing out (the car stands right behind the east one).
  h.door(0, { x: -2.5, z: 3.5 }, { x: -2.5, z: 4.5 }, { width: 2.4, name: 'Cửa xe' }).door(0, { x: 2.5, z: 3.5 }, { x: 2.5, z: 4.5 }, { width: 2.4, name: 'Cửa xe' })
  h.window(0, { x: -5, z: 0 }, { x: 0, z: 0 }, 1)
  const r = rect(-5, -3.5, 5, 3.5)
  h.room(0, 'Garage', r, { floor: 'concrete' })
  h.put(0, box('prop', [1.9, 1.4, 4.2], '#2f4f7a', { asset: 'outdoor/car' }), { x: 2.5, z: 0.1 })
  h.against(0, r, 'N', 1.5, garageShelf).against(0, r, 'N', 4, toolShelf)
  h.decor(0, 'decor/tires', { x: -4, z: 1.5 }).decor(0, 'decor/jerrycan', { x: -1, z: -2.6 })
  return h.doc()
}

/** Xưởng cơ khí, 22 × 16: a machine hall with benches, a storeroom, an office, a restroom. */
function machineShop(): PrefabDocument {
  const h = new Building({ prefabId: 'service/machine-shop', name: 'Xưởng cơ khí', footprint: rect(-11, -8, 11, 8), height: 4.5, wallColor: '#b3aea3', roofColor: '#5a5e63', floorColor: '#85827c', catalog: { group: 'industrial', tags: ['xuong', 'co-khi'] }, placement: { category: 'industrial', allowedZones: ['industrial'], weight: 1, setback: 4, sideGap: 2, roadFacing: true, frontage: [22, 40] }, variants: VARIANTS })
  h.outerWalls()
  h.door(0, { x: -3, z: 8 }, { x: -3, z: 7 }, { width: 3.5, name: 'Cửa xưởng' }).door(0, { x: -9, z: 8 }, { x: -9, z: 7 }, { width: 1.2 })
  h.wallZ(0, 5, -8, 8).wallX(0, 0, 5, 11).wallX(0, 5, 5, 11)
  h.door(0, { x: 5, z: -4 }, { x: 4, z: -4 }, { width: 1.2 }).door(0, { x: 5, z: 2.5 }, { x: 4, z: 2.5 }, { width: 1 }).door(0, { x: 5, z: 6.5 }, { x: 4, z: 6.5 }, { width: 1 })
  h.windows(0, 'N', 5, 1.6).window(0, { x: -11, z: 0 }, { x: 0, z: 0 }, 1.6).window(0, { x: -11, z: -5 }, { x: 0, z: -5 }, 1.6).window(0, { x: 11, z: 2.5 }, { x: 0, z: 2.5 })
  const hall = rect(-11, -8, 5, 8)
  const store = rect(5, -8, 11, 0)
  const office = rect(5, 0, 11, 5)
  const wc = rect(5, 5, 11, 8)
  h.room(0, 'Xưởng máy', hall, { floor: 'concrete' }).room(0, 'Kho', store, { floor: 'concrete' }).room(0, 'Văn phòng xưởng', office).room(0, 'Vệ sinh', wc, { floor: 'tile' })
  for (const [x, z] of [[-7, -3], [-3, -3], [1, -3], [-7, 1.5], [1, 1.5]]) h.put(0, machine, { x, z })
  h.against(0, hall, 'N', 3, bench).against(0, hall, 'N', 7, bench).against(0, hall, 'N', 11, bench).against(0, hall, 'W', 12, toolShelf)
  h.decor(0, 'decor/oil-stain', { x: -3, z: 1 }).decor(0, 'decor/toolbox', { x: 2.5, z: 5 })
  h.against(0, store, 'N', 1.5, hardware).against(0, store, 'N', 4.5, toolShelf).against(0, store, 'E', 5, garageShelf)
  h.against(0, office, 'E', 2.5, officeDesk).against(0, office, 'N', 4.5, filing)
  h.against(0, wc, 'E', 1.5, box('container', [0.6, 1, 0.4], '#d8dde0', { name: 'Tủ y tế', loot: 'medical-cabinet', asset: 'furniture/cabinet' }))
  void desk
  return h.doc()
}

export function p3(): { prefabs: PrefabDocument[]; compounds: CompoundDocument[] } {
  return { prefabs: buildAll([bank, bookstore, autoRepair, doubleGarage, machineShop]), compounds: [] }
}
