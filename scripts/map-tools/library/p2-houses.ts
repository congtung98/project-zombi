// Prefab library P2: houses. Six one-storey and six multi-storey houses (Vietnamese first, D7) and a
// four-storey apartment block (MAX_STOREYS stays 4, D4). Only existing items and loot tables (D5).
import type { PrefabDocument, PrefabPlacement } from '../../../src/map/schema.ts'
import { Building, buildAll, preset, rect, VARIANTS, box } from './builder.ts'

const home = (frontage: [number, number], weight = 2, setback = 3, sideGap = 0.5): PrefabPlacement => ({ category: 'house', allowedZones: ['residential'], weight, setback, sideGap, roadFacing: true, frontage })

const sofa = preset('furniture/sofa')
const armchair = preset('furniture/armchair')
const table = preset('furniture/table')
const chair = preset('furniture/chair')
const desk = preset('furniture/desk')
const bed = preset('furniture/bed')
const smallBed = preset('furniture/bed', { size: [2, 0.6, 1] })
const wardrobe = preset('container/wardrobe')
const nightstand = preset('container/nightstand')
const kitchen = preset('container/kitchen')
const fridge = preset('container/fridge', { loot: 'house-kitchen' })
const bookshelf = preset('container/bookshelf')
const counter = preset('furniture/counter')
const altar = box('prop', [1.2, 1.1, 0.5], '#6b2e22', { asset: 'furniture/cabinet' })

/** 1. Nhà cấp 4 (VN), 6 × 12: living room at the front, bedroom and kitchen behind. */
function cap4(): PrefabDocument {
  const h = new Building({ prefabId: 'house/cap4', name: 'Nhà cấp 4', footprint: rect(-3, -6, 3, 6), wallColor: '#e2d3a8', roofColor: '#9b4a2c', catalog: { group: 'residential', architectureStyle: 'vietnamese', tags: ['1-tang', 'nha-cap-4'] }, placement: home([6, 12]), variants: VARIANTS })
  h.outerWalls()
  h.door(0, { x: -1.2, z: 6 }, { x: -1.2, z: 5 }, { width: 1.2, name: 'Cửa chính' })
  h.wallX(0, 1, -3, 3).wallZ(0, 0.5, -6, 1)
  h.door(0, { x: -1.5, z: 1 }, { x: -1.5, z: 0 }, { width: 1 }).door(0, { x: 1.75, z: 1 }, { x: 1.75, z: 2 }, { width: 1 })
  h.window(0, { x: 1.5, z: 6 }, { x: 1.5, z: 5 }).window(0, { x: -3, z: 3.5 }, { x: 0, z: 3.5 }).window(0, { x: -3, z: -2.5 }, { x: 0, z: -2.5 }).window(0, { x: 3, z: -2.5 }, { x: 0, z: -2.5 }, 1).window(0, { x: -1.25, z: -6 }, { x: -1.25, z: 0 }, 1)
  const living = rect(-3, 1, 3, 6)
  const bedroom = rect(-3, -6, 0.5, 1)
  const kit = rect(0.5, -6, 3, 1)
  h.room(0, 'Phòng khách', living).room(0, 'Phòng ngủ', bedroom).room(0, 'Bếp', kit, { floor: 'tile' })
  h.against(0, living, 'W', 2.5, sofa).put(0, table, { x: 0.3, z: 4.3 }).against(0, living, 'E', 2.5, altar)
  h.against(0, bedroom, 'W', 3, bed).against(0, bedroom, 'N', 2.4, wardrobe).against(0, bedroom, 'W', 1.1, nightstand)
  h.against(0, kit, 'N', 1.25, kitchen).against(0, kit, 'E', 5, fridge)
  h.decor(0, 'decor/rug', { x: -0.8, z: 3.4 })
  return h.doc()
}

/** 2. Nhà nhỏ 8 × 8: one room and a kitchen corner, a bedroom. */
function cottage(): PrefabDocument {
  const h = new Building({ prefabId: 'house/cottage', name: 'Nhà nhỏ', footprint: rect(-4, -4, 4, 4), wallColor: '#c9b99a', roofColor: '#5b4636', catalog: { group: 'residential', tags: ['1-tang', 'nha-nho'] }, placement: home([8, 14], 2), variants: VARIANTS })
  h.outerWalls()
  h.door(0, { x: -2, z: 4 }, { x: -2, z: 3 }, { width: 1.1, name: 'Cửa chính' })
  h.wallZ(0, 1, -4, 4)
  h.door(0, { x: 1, z: 1.5 }, { x: 2, z: 1.5 }, { width: 1 })
  h.windows(0, 'S', 4, 1, [0]).window(0, { x: -4, z: 0 }, { x: 0, z: 0 }).window(0, { x: 4, z: -1 }, { x: 0, z: -1 }).window(0, { x: -1.5, z: -4 }, { x: 0, z: 0 })
  const main = rect(-4, -4, 1, 4)
  const bedroom = rect(1, -4, 4, 4)
  h.room(0, 'Phòng chính', main).room(0, 'Phòng ngủ', bedroom)
  h.against(0, main, 'N', 1.2, kitchen).against(0, main, 'N', 2.5, fridge).put(0, table, { x: -2, z: -1.2 }).against(0, main, 'W', 6.3, armchair)
  h.against(0, bedroom, 'E', 2, smallBed).against(0, bedroom, 'N', 1.5, preset('container/wardrobe', { size: [1.2, 2, 0.6] })).against(0, bedroom, 'E', 3.4, nightstand)
  return h.doc()
}

/** 3. Bungalow chữ L (Mỹ), 12 × 10: living wing, bedroom wing, kitchen in the corner. */
function bungalowL(): PrefabDocument {
  const outline = [
    { x: -6, z: -5 },
    { x: 1, z: -5 },
    { x: 1, z: 0 },
    { x: 6, z: 0 },
    { x: 6, z: 5 },
    { x: -6, z: 5 },
  ]
  const h = new Building({ prefabId: 'house/bungalow-l', name: 'Bungalow chữ L', footprint: rect(-6, -5, 6, 5), outline, wallColor: '#d9d2c3', roofColor: '#4d4f55', floorColor: '#9a7b5c', catalog: { group: 'residential', architectureStyle: 'american', tags: ['1-tang', 'chu-l'] }, placement: home([12, 20], 1.5, 4, 1), variants: VARIANTS })
  h.outerWalls()
  h.door(0, { x: 3.5, z: 5 }, { x: 3.5, z: 4 }, { width: 1.2, name: 'Cửa chính' })
  h.wallZ(0, 1, 0, 5).wallX(0, 0, -6, 1).wallZ(0, -2.5, -5, 0)
  h.door(0, { x: 1, z: 1.5 }, { x: 0, z: 1.5 }, { width: 1 }).door(0, { x: -4.2, z: 0 }, { x: -4.2, z: 1 }, { width: 1 }).door(0, { x: -0.8, z: 0 }, { x: -0.8, z: 1 }, { width: 1 })
  h.window(0, { x: 5, z: 5 }, { x: 5, z: 4 }).window(0, { x: 6, z: 2.5 }, { x: 4, z: 2.5 }).window(0, { x: -3, z: 5 }, { x: -3, z: 4 }).window(0, { x: -6, z: 2.5 }, { x: -4, z: 2.5 }).window(0, { x: -4.2, z: -5 }, { x: -4.2, z: -3 }).window(0, { x: -0.8, z: -5 }, { x: -0.8, z: -3 }).window(0, { x: 3.5, z: 0 }, { x: 3.5, z: 2 })
  const living = rect(1, 0, 6, 5)
  const hall = rect(-6, 0, 1, 5)
  const bed1 = rect(-6, -5, -2.5, 0)
  const bed2 = rect(-2.5, -5, 1, 0)
  h.room(0, 'Phòng khách', living).room(0, 'Bếp ăn', hall, { floor: 'tile' }).room(0, 'Phòng ngủ chính', bed1).room(0, 'Phòng ngủ phụ', bed2)
  h.against(0, living, 'E', 2.5, sofa).put(0, table, { x: 3, z: 2.2 }).against(0, living, 'N', 2.6, bookshelf)
  h.against(0, hall, 'W', 2.5, kitchen).against(0, hall, 'W', 4.2, fridge).put(0, table, { x: -2.5, z: 2.8 }).put(0, chair, { x: -2.5, z: 3.6 }).put(0, chair, { x: -2.5, z: 2 })
  h.against(0, bed1, 'W', 2.5, bed).against(0, bed1, 'W', 4.4, nightstand).against(0, bed1, 'N', 3, preset('container/wardrobe', { size: [1.2, 2, 0.6] }))
  h.against(0, bed2, 'E', 2.5, smallBed).against(0, bed2, 'N', 0.8, nightstand).against(0, bed2, 'W', 2.8, desk)
  return h.doc()
}

/** 4. Nhà vườn (VN), 10 × 9: a front veranda room, central hall with the altar, two bedrooms. */
function garden(): PrefabDocument {
  const h = new Building({ prefabId: 'house/garden', name: 'Nhà vườn', footprint: rect(-5, -4.5, 5, 4.5), wallColor: '#e8dcb5', roofColor: '#a0452a', floorColor: '#a8845c', catalog: { group: 'residential', architectureStyle: 'vietnamese', tags: ['1-tang', 'nha-vuon'] }, placement: home([10, 18], 1.5, 4, 1), variants: VARIANTS })
  h.outerWalls()
  h.door(0, { x: 0, z: 4.5 }, { x: 0, z: 3.5 }, { width: 1.4, name: 'Cửa chính' })
  h.wallZ(0, -2, -4.5, 4.5).wallZ(0, 2, -4.5, 4.5).wallX(0, -1, 2, 5)
  h.door(0, { x: -2, z: 2.5 }, { x: -1, z: 2.5 }, { width: 1 }).door(0, { x: 2, z: 2.5 }, { x: 1, z: 2.5 }, { width: 1 }).door(0, { x: 3.5, z: -1 }, { x: 3.5, z: -2 }, { width: 1 })
  h.window(0, { x: -3.5, z: 4.5 }, { x: -3.5, z: 3 }).window(0, { x: 3.5, z: 4.5 }, { x: 3.5, z: 3 }).window(0, { x: -5, z: 0 }, { x: -3, z: 0 }).window(0, { x: 5, z: 2 }, { x: 3, z: 2 }).window(0, { x: 0, z: -4.5 }, { x: 0, z: 0 }).window(0, { x: 3.5, z: -4.5 }, { x: 3.5, z: -3 })
  const hall = rect(-2, -4.5, 2, 4.5)
  const west = rect(-5, -4.5, -2, 4.5)
  const eastFront = rect(2, -1, 5, 4.5)
  const kit = rect(2, -4.5, 5, -1)
  h.room(0, 'Gian giữa', hall).room(0, 'Buồng trái', west).room(0, 'Buồng phải', eastFront).room(0, 'Bếp', kit, { floor: 'tile' })
  h.against(0, hall, 'N', 2, altar).put(0, table, { x: 0, z: 0.5 })
  h.against(0, west, 'W', 5.5, smallBed).against(0, west, 'N', 1.5, preset('container/wardrobe', { size: [1.4, 2, 0.6] })).against(0, west, 'W', 3.6, nightstand)
  h.against(0, eastFront, 'E', 3.2, smallBed).against(0, eastFront, 'E', 1.6, nightstand)
  h.against(0, kit, 'N', 1.5, kitchen).against(0, kit, 'E', 2.6, fridge)
  return h.doc()
}

/** 5. Nhà dài nông thôn (VN), 14 × 7: a row of rooms opening onto the front. */
function longhouse(): PrefabDocument {
  const h = new Building({ prefabId: 'house/longhouse', name: 'Nhà dài nông thôn', footprint: rect(-7, -3.5, 7, 3.5), wallColor: '#d8c49a', roofColor: '#8c3b24', floorColor: '#8a6a45', catalog: { group: 'residential', architectureStyle: 'vietnamese', tags: ['1-tang', 'nong-thon'] }, placement: { category: 'house', allowedZones: ['residential', 'farmland'], weight: 1.5, setback: 4, sideGap: 1, roadFacing: true, frontage: [14, 24] }, variants: VARIANTS })
  h.outerWalls()
  h.wallZ(0, -2.5, -3.5, 3.5).wallZ(0, 2.5, -3.5, 3.5)
  h.door(0, { x: 0, z: 3.5 }, { x: 0, z: 2.5 }, { width: 1.4, name: 'Cửa chính' })
  h.door(0, { x: -4.75, z: 3.5 }, { x: -4.75, z: 2.5 }, { width: 1 }).door(0, { x: 4.75, z: 3.5 }, { x: 4.75, z: 2.5 }, { width: 1 })
  h.door(0, { x: -2.5, z: 1.5 }, { x: -3.5, z: 1.5 }, { width: 1 })
  h.window(0, { x: -1.5, z: 3.5 }, { x: 0, z: 0 }).window(0, { x: 1.5, z: 3.5 }, { x: 0, z: 0 }).window(0, { x: -7, z: 0 }, { x: -5, z: 0 }).window(0, { x: 7, z: 0 }, { x: 5, z: 0 }).window(0, { x: -4.75, z: -3.5 }, { x: -4.75, z: 0 }).window(0, { x: 0, z: -3.5 }, { x: 0, z: 0 }).window(0, { x: 4.75, z: -3.5 }, { x: 4.75, z: 0 })
  const west = rect(-7, -3.5, -2.5, 3.5)
  const mid = rect(-2.5, -3.5, 2.5, 3.5)
  const east = rect(2.5, -3.5, 7, 3.5)
  h.room(0, 'Buồng ngủ', west).room(0, 'Gian thờ', mid).room(0, 'Bếp, kho', east, { floor: 'concrete' })
  h.against(0, west, 'W', 2, bed).against(0, west, 'N', 3, preset('container/wardrobe', { size: [1.4, 2, 0.6] })).against(0, west, 'W', 4.6, nightstand)
  h.against(0, mid, 'N', 2.5, altar).put(0, table, { x: 0, z: 0 }).put(0, chair, { x: -0.9, z: 0 })
  h.against(0, east, 'N', 1.3, kitchen).against(0, east, 'N', 3.2, preset('container/shelf', { name: 'Kệ kho', loot: 'hardware-shelf', size: [1.6, 1.6, 0.6] })).against(0, east, 'E', 4.5, box('container', [0.9, 0.7, 0.6], '#6f5a45', { name: 'Hòm đồ nghề', loot: 'tool-shelf', asset: 'furniture/crate' }))
  h.decor(0, 'decor/jerrycan', { x: 5.8, z: 1.8 })
  return h.doc()
}

/** 6. Nhà Mỹ một tầng (ranch), 12 × 9: open living/kitchen, two bedrooms along a hall. */
function ranch(): PrefabDocument {
  const h = new Building({ prefabId: 'house/ranch', name: 'Nhà Mỹ một tầng', footprint: rect(-6, -4.5, 6, 4.5), wallColor: '#b8c2c8', roofColor: '#3f4247', floorColor: '#a38263', catalog: { group: 'residential', architectureStyle: 'american', tags: ['1-tang', 'ranch'] }, placement: home([12, 20], 1.5, 5, 1.5), variants: VARIANTS })
  h.outerWalls()
  h.door(0, { x: -2, z: 4.5 }, { x: -2, z: 3.5 }, { width: 1.2, name: 'Cửa chính' })
  h.wallZ(0, 1, -4.5, 4.5).wallX(0, 0, 1, 6)
  h.door(0, { x: 1, z: 2.5 }, { x: 2, z: 2.5 }, { width: 1 }).door(0, { x: 1, z: -2.5 }, { x: 2, z: -2.5 }, { width: 1 })
  h.window(0, { x: -4.5, z: 4.5 }, { x: -4.5, z: 3 }).window(0, { x: 3.5, z: 4.5 }, { x: 3.5, z: 3 }).window(0, { x: -6, z: 1 }, { x: -4, z: 1 }).window(0, { x: 6, z: 2.5 }, { x: 4, z: 2.5 }).window(0, { x: 6, z: -2.5 }, { x: 4, z: -2.5 }).window(0, { x: -3, z: -4.5 }, { x: -3, z: -3 }).window(0, { x: 3.5, z: -4.5 }, { x: 3.5, z: -3 })
  const living = rect(-6, -4.5, 1, 4.5)
  const bedA = rect(1, 0, 6, 4.5)
  const bedB = rect(1, -4.5, 6, 0)
  h.room(0, 'Phòng khách, bếp', living).room(0, 'Phòng ngủ 1', bedA).room(0, 'Phòng ngủ 2', bedB)
  h.against(0, living, 'N', 1.5, kitchen).against(0, living, 'N', 3.1, fridge).against(0, living, 'W', 6, sofa).put(0, table, { x: -2.5, z: -1.5 }).put(0, chair, { x: -2.5, z: -0.6 }).put(0, chair, { x: -2.5, z: -2.4 })
  h.against(0, bedA, 'E', 2.2, bed).against(0, bedA, 'S', 2.2, preset('container/wardrobe', { size: [1.4, 2, 0.6] })).against(0, bedA, 'E', 3.8, nightstand)
  h.against(0, bedB, 'E', 2.2, smallBed).against(0, bedB, 'N', 2.4, desk).against(0, bedB, 'S', 3.5, preset('container/wardrobe', { size: [1.2, 2, 0.6] }))
  return h.doc()
}

/** A flight against the east wall of a narrow house climbing north, with its landings. */
function tube(id: string, name: string, w: number, d: number, storeys: number, shop: boolean): PrefabDocument {
  const hx = w / 2
  const hz = d / 2
  const h = new Building({
    prefabId: id,
    name,
    footprint: rect(-hx, -hz, hx, hz),
    storeys,
    height: 3.2,
    wallColor: shop ? '#e9e1c8' : '#dfe6d6',
    roofColor: '#7d3b2a',
    floorColor: '#b39473',
    catalog: { group: shop ? 'commercial' : 'residential', architectureStyle: 'vietnamese', tags: shop ? ['nha-pho', 'kinh-doanh', `${storeys}-tang`] : ['nha-ong', `${storeys}-tang`] },
    placement: shop ? { category: 'shop', allowedZones: ['commercial', 'residential'], weight: 2, setback: 0, sideGap: 0.1, roadFacing: true, frontage: [w - 0.5, w + 3] } : { category: 'house', allowedZones: ['residential', 'commercial'], weight: 2, setback: 1, sideGap: 0.1, roadFacing: true, frontage: [w - 0.5, w + 3] },
    variants: VARIANTS,
  })
  h.outerWalls()
  // The flight runs along the east wall, its foot 1.5 m behind the middle, climbing north.
  const sw = 1
  const sx = hx - h.t / 2 - sw / 2
  const foot = 2
  const run = 4
  const front = rect(-hx, foot + 1.5, hx, hz)
  const back = rect(-hx, -hz, hx, foot - run - 1.5)
  for (let level = 0; level < storeys; level++) {
    const up = level < storeys - 1
    // Alternate the flight direction per storey so each one starts where the previous one ended.
    if (up) h.stairs(level, level % 2 === 0 ? { x: sx, z: foot } : { x: sx, z: foot - run }, level % 2 === 0 ? 'N' : 'S', run, sw)
    const upper = level > 0
    h.wallX(level, foot + 1.5, -hx, hx - 1.6).wallX(level, foot - run - 1.5, -hx, hx - 1.6)
    h.door(level, { x: -0.3, z: foot + 1.5 }, { x: -0.3, z: foot + 2.5 }, { width: 1 }).door(level, { x: -0.3, z: foot - run - 1.5 }, { x: -0.3, z: foot - run - 2.5 }, { width: 1 })
    const mid = rect(-hx, foot - run - 1.5, hx, foot + 1.5)
    if (level === 0) {
      const doorX = hx - (shop ? 1.2 : 1)
      h.door(0, { x: doorX, z: hz }, { x: doorX, z: hz - 1 }, { width: shop ? 1.6 : 1.2, name: 'Cửa chính' })
      h.room(0, shop ? 'Gian hàng' : 'Phòng khách', front, shop ? { floor: 'tile' } : {})
      h.room(0, 'Cầu thang, hành lang', mid).room(0, 'Bếp', back, { floor: 'tile' })
      if (shop) {
        h.against(0, front, 'W', (hz - foot - 1.5) / 2, preset('container/shelf', { size: [2, 1.6, 0.6], name: 'Kệ hàng' }))
        h.against(0, front, 'E', 2.2, preset('container/shelf', { size: [1.6, 1.6, 0.6], name: 'Kệ hàng' }))
        h.against(0, front, 'N', w - 1.2, counter)
      } else {
        h.against(0, front, 'W', (hz - foot - 1.5) / 2 + 0.3, w >= 5 ? sofa : armchair)
      }
      h.against(0, back, 'N', 1.2, kitchen).against(0, back, 'W', (foot - run - 1.5 + hz) / 2 + 1.8, fridge)
      h.window(0, { x: hx - 1.1, z: hz }, { x: 0, z: 0 }, 1)
      h.window(0, { x: 0, z: -hz }, { x: 0, z: 0 }, 1)
    } else {
      h.room(level, `Phòng ngủ trước tầng ${level + 1}`, front).room(level, `Sảnh tầng ${level + 1}`, mid).room(level, `Phòng ngủ sau tầng ${level + 1}`, back)
      h.against(level, front, 'W', hz - foot - 1.5 - 1.6, w >= 5 ? bed : smallBed).against(level, front, 'N', w - 1.4, nightstand)
      h.against(level, back, 'W', 2.2, smallBed).against(level, back, 'N', w - 0.9, preset('container/wardrobe', { size: [1.2, 2, 0.6] }))
      h.window(level, { x: 0, z: hz }, { x: 0, z: 0 }, 1.4).window(level, { x: 0, z: -hz }, { x: 0, z: 0 }, 1)
    }
    void upper
  }
  return h.doc()
}


/** 10. Biệt thự (VN), 14 × 12, two storeys: hall, living, dining, kitchen; four rooms upstairs. */
function villa(): PrefabDocument {
  const h = new Building({ prefabId: 'house/villa', name: 'Biệt thự', footprint: rect(-7, -6, 7, 6), storeys: 2, height: 3.2, wallColor: '#f0ead8', roofColor: '#5a2e22', floorColor: '#b08d68', catalog: { group: 'residential', architectureStyle: 'vietnamese', tags: ['2-tang', 'biet-thu'] }, placement: home([16, 26], 0.8, 5, 2), variants: VARIANTS })
  h.outerWalls()
  // Central hall x −2…2 through the house; the flight climbs north along its east side.
  h.stairs(0, { x: 1.2, z: 1.5 }, 'N', 4, 1.2)
  for (const level of [0, 1]) {
    h.wallZ(level, -2, -6, 6).wallZ(level, 2, -6, 6).wallX(level, 0, -7, -2).wallX(level, 0, 2, 7)
    h.door(level, { x: -2, z: 2.5 }, { x: -3, z: 2.5 }, { width: 1 }).door(level, { x: -2, z: -2.5 }, { x: -3, z: -2.5 }, { width: 1 }).door(level, { x: 2, z: 3.5 }, { x: 3, z: 3.5 }, { width: 1 }).door(level, { x: 2, z: -4 }, { x: 3, z: -4 }, { width: 1 })
    h.windows(level, 'S', 7, 1.2, [3]).windows(level, 'N', 7, 1.2, [3]).window(level, { x: -7, z: 3 }, { x: 0, z: 3 }).window(level, { x: -7, z: -3 }, { x: 0, z: -3 }).window(level, { x: 7, z: 3 }, { x: 0, z: 3 }).window(level, { x: 7, z: -3 }, { x: 0, z: -3 })
  }
  h.door(0, { x: 0, z: 6 }, { x: 0, z: 5 }, { width: 1.6, name: 'Cửa chính' })
  h.window(1, { x: 0, z: 6 }, { x: 0, z: 5 }, 1.6)
  const [wf, wb, ef, eb, hall] = [rect(-7, 0, -2, 6), rect(-7, -6, -2, 0), rect(2, 0, 7, 6), rect(2, -6, 7, 0), rect(-2, -6, 2, 6)]
  h.room(0, 'Sảnh', hall, { floor: 'tile' }).room(0, 'Phòng khách', wf).room(0, 'Phòng ăn', wb).room(0, 'Phòng làm việc', ef).room(0, 'Bếp', eb, { floor: 'tile' })
  h.against(0, wf, 'W', 3, sofa).put(0, table, { x: -4.3, z: 3 }).against(0, wf, 'S', 1.6, armchair).against(0, wf, 'N', 2.5, altar)
  h.put(0, table, { x: -4.5, z: -3 }).put(0, chair, { x: -4.5, z: -2.1 }).put(0, chair, { x: -4.5, z: -3.9 }).against(0, wb, 'W', 3, preset('container/kitchen', { name: 'Tủ bát' }))
  h.against(0, ef, 'E', 3, desk).against(0, ef, 'S', 3.5, bookshelf).against(0, ef, 'N', 3.5, bookshelf)
  h.against(0, eb, 'N', 2, kitchen).against(0, eb, 'N', 3.6, fridge).against(0, eb, 'E', 3, preset('container/shelf', { name: 'Kệ bếp', loot: 'house-kitchen', size: [1.4, 1.6, 0.5] }))
  h.room(1, 'Sảnh tầng 2', hall).room(1, 'Phòng ngủ 1', wf).room(1, 'Phòng ngủ 2', wb).room(1, 'Phòng ngủ 3', ef).room(1, 'Phòng ngủ 4', eb)
  for (const r of [wf, wb]) h.against(1, r, 'W', 3, bed).against(1, r, 'W', 4.7, nightstand).against(1, r, r === wf ? 'S' : 'N', 3.6, preset('container/wardrobe', { size: [1.4, 2, 0.6] }))
  for (const r of [ef, eb]) h.against(1, r, 'E', 3, bed).against(1, r, 'E', 1.3, nightstand).against(1, r, r === ef ? 'S' : 'N', 1.8, preset('container/wardrobe', { size: [1.4, 2, 0.6] }))
  return h.doc()
}

/** 11. Nhà ngoại ô Mỹ, 12 × 10, two storeys: living, kitchen; three bedrooms upstairs. */
function suburban(): PrefabDocument {
  const h = new Building({ prefabId: 'house/suburban', name: 'Nhà ngoại ô Mỹ', footprint: rect(-6, -5, 6, 5), storeys: 2, wallColor: '#c7d3dc', roofColor: '#35383d', floorColor: '#a07d5a', catalog: { group: 'residential', architectureStyle: 'american', tags: ['2-tang', 'ngoai-o'] }, placement: home([12, 22], 1.5, 6, 1.5), variants: VARIANTS })
  h.outerWalls()
  // Hall x −1.5…1.5 through the house; the flight climbs north against its west wall.
  h.stairs(0, { x: -0.9, z: 2.4 }, 'N', 4, 1)
  for (const level of [0, 1]) {
    h.wallZ(level, -1.5, -5, 5).wallZ(level, 1.5, -5, 5).wallX(level, 0, 1.5, 6)
    h.door(level, { x: 1.5, z: 3 }, { x: 2.5, z: 3 }, { width: 1 }).door(level, { x: 1.5, z: -3 }, { x: 2.5, z: -3 }, { width: 1 })
    h.windows(level, 'N', 5, 1.2, [2]).window(level, { x: 6, z: 2.5 }, { x: 0, z: 2.5 }).window(level, { x: 6, z: -2.5 }, { x: 0, z: -2.5 })
  }
  h.door(0, { x: 0.3, z: 5 }, { x: 0.3, z: 4 }, { width: 1.2, name: 'Cửa chính' })
  h.door(0, { x: -1.5, z: -3.5 }, { x: -2.5, z: -3.5 }, { width: 1 })
  h.windows(0, 'S', 5, 1.2, [2]).window(0, { x: -6, z: 0 }, { x: 0, z: 0 })
  const west = rect(-6, -5, -1.5, 5)
  const hall = rect(-1.5, -5, 1.5, 5)
  const ef = rect(1.5, 0, 6, 5)
  const eb = rect(1.5, -5, 6, 0)
  h.room(0, 'Phòng khách', west).room(0, 'Sảnh', hall, { floor: 'tile' }).room(0, 'Phòng ăn', ef).room(0, 'Bếp', eb, { floor: 'tile' })
  h.against(0, west, 'W', 6, sofa).put(0, table, { x: -3.8, z: 1.5 }).against(0, west, 'S', 2.2, armchair).against(0, west, 'N', 1.4, bookshelf)
  h.put(0, table, { x: 3.8, z: 2.5 })
  h.against(0, eb, 'N', 1.6, kitchen).against(0, eb, 'N', 3.3, fridge).against(0, eb, 'E', 2.5, preset('container/kitchen', { name: 'Tủ bếp' }))
  // Upstairs: bedrooms off the landing.
  h.wallX(1, 0, -6, -1.5)
  h.door(1, { x: -1.5, z: 3.8 }, { x: -2.5, z: 3.8 }, { width: 1 }).door(1, { x: -1.5, z: -3.8 }, { x: -2.5, z: -3.8 }, { width: 1 })
  h.windows(1, 'S', 5, 1.2, [2]).window(1, { x: -6, z: 2.5 }, { x: 0, z: 2.5 }).window(1, { x: -6, z: -2.5 }, { x: 0, z: -2.5 })
  const [u1, u2, u3, u4] = [rect(-6, 0, -1.5, 5), rect(-6, -5, -1.5, 0), rect(1.5, 0, 6, 5), rect(1.5, -5, 6, 0)]
  h.room(1, 'Hành lang tầng 2', hall).room(1, 'Phòng ngủ chính', u1).room(1, 'Phòng ngủ trẻ', u2).room(1, 'Phòng ngủ khách', u3).room(1, 'Phòng tắm, giặt', u4, { floor: 'tile' })
  h.against(1, u1, 'W', 2.5, bed).against(1, u1, 'N', 2.5, preset('container/wardrobe', { size: [1.4, 2, 0.6] }))
  h.against(1, u2, 'W', 2, smallBed).against(1, u2, 'N', 1.4, nightstand)
  h.against(1, u3, 'E', 2, smallBed).against(1, u3, 'N', 1, preset('container/wardrobe', { size: [1.2, 2, 0.6] }))
  h.against(1, u4, 'E', 2.5, preset('container/shelf', { name: 'Tủ thuốc', loot: 'house-wardrobe', size: [1.2, 1.6, 0.4] }))
  return h.doc()
}

/** 12. Nhà chữ L hai tầng, 12 × 12. */
function lTwoStorey(): PrefabDocument {
  const outline = [
    { x: -6, z: -6 },
    { x: 0, z: -6 },
    { x: 0, z: 0 },
    { x: 6, z: 0 },
    { x: 6, z: 6 },
    { x: -6, z: 6 },
  ]
  const h = new Building({ prefabId: 'house/l-two-storey', name: 'Nhà chữ L hai tầng', footprint: rect(-6, -6, 6, 6), outline, storeys: 2, wallColor: '#d6cbb5', roofColor: '#5d3a2a', catalog: { group: 'residential', tags: ['2-tang', 'chu-l'] }, placement: home([12, 22], 1, 5, 1.5), variants: VARIANTS })
  h.outerWalls()
  h.stairs(0, { x: -5.4, z: 4.5 }, 'N', 3, 1)
  for (const level of [0, 1]) {
    h.wallX(level, 0, -6, 0).wallZ(level, -3.5, 0, 6).wallZ(level, 1.5, 0, 6)
    h.door(level, { x: -1.8, z: 0 }, { x: -1.8, z: -1 }, { width: 1 }).door(level, { x: 1.5, z: 3 }, { x: 2.5, z: 3 }, { width: 1 })
    h.window(level, { x: -3, z: -6 }, { x: -3, z: -3 }).window(level, { x: -6, z: -3 }, { x: -3, z: -3 }).window(level, { x: 3.8, z: 6 }, { x: 3.8, z: 3 }).window(level, { x: 6, z: 3 }, { x: 3, z: 3 }).window(level, { x: 3.8, z: 0 }, { x: 3.8, z: 3 })
  }
  h.door(0, { x: -1, z: 6 }, { x: -1, z: 5 }, { width: 1.2, name: 'Cửa chính' })
  h.window(1, { x: -1, z: 6 }, { x: -1, z: 5 }, 1)
  const stairHall = rect(-6, 0, -3.5, 6)
  const hall = rect(-3.5, 0, 1.5, 6)
  const wing = rect(-6, -6, 0, 0)
  const east = rect(1.5, 0, 6, 6)
  h.room(0, 'Cầu thang', stairHall).room(0, 'Phòng khách', hall).room(0, 'Bếp ăn', wing, { floor: 'tile' }).room(0, 'Phòng ngủ khách', east)
  h.door(0, { x: -3.5, z: 2 }, { x: -2.5, z: 2 }, { width: 1 }).door(1, { x: -3.5, z: 2 }, { x: -2.5, z: 2 }, { width: 1 })
  h.against(0, hall, 'S', 4.3, armchair).put(0, table, { x: -1, z: 3.2 })
  h.against(0, wing, 'W', 3, kitchen).against(0, wing, 'N', 3, fridge).put(0, table, { x: -2.4, z: -3 }).put(0, chair, { x: -2.4, z: -2.1 })
  h.against(0, east, 'E', 3.5, smallBed).against(0, east, 'S', 2.6, nightstand)
  h.room(1, 'Sảnh tầng 2', stairHall).room(1, 'Phòng ngủ chính', hall).room(1, 'Phòng ngủ 2', wing).room(1, 'Phòng ngủ 3', east)
  h.against(1, hall, 'S', 2.2, bed).against(1, hall, 'S', 3.8, nightstand).against(1, hall, 'N', 4, preset('container/wardrobe', { size: [1.4, 2, 0.6] }))
  h.against(1, wing, 'W', 3, bed).against(1, wing, 'N', 3, preset('container/wardrobe', { size: [1.4, 2, 0.6] }))
  h.against(1, east, 'E', 3.5, smallBed).against(1, east, 'S', 2.6, desk)
  return h.doc()
}

/**
 * 13. Chung cư 4 tầng, 30 × 14: a corridor along the middle of every storey, a stair core on the north
 * side with two lanes climbing in turn (a switchback), four flats per storey (living room + bedroom).
 */
export function apartment(id = 'apartment/block-4', name = 'Chung cư 4 tầng', storeys = 4): PrefabDocument {
  const h = new Building({ prefabId: id, name, footprint: rect(-15, -7, 15, 7), storeys, height: 3, wallColor: '#cfcac0', roofColor: '#5e6166', floorColor: '#9c8f7e', catalog: { group: 'residential', tags: ['chung-cu', `${storeys}-tang`] }, placement: { category: 'house', allowedZones: ['residential', 'commercial'], weight: 0.6, setback: 4, sideGap: 2, roadFacing: true, frontage: [32, 60] } })
  h.outerWalls()
  const t = h.t
  // Stair core x −3.5…3.5, z −7…−1; lane A (z −2.7…−1.5) climbs east from even storeys, lane B (z −4.1…−2.9) west from odd ones.
  const laneA = -2.1
  const laneB = laneA - 1.2 - t
  for (let level = 0; level < storeys; level++) {
    if (level < storeys - 1) h.stairs(level, level % 2 === 0 ? { x: -2, z: laneA } : { x: 2, z: laneB }, level % 2 === 0 ? 'E' : 'W', 4, 1.2)
    h.wallX(level, -1, -15, 15).wallX(level, 1, -15, 15).wallZ(level, -3.5, -7, -1).wallZ(level, 3.5, -7, -1)
    // Core door on the landing where this storey's flight starts (even: west) or the previous one arrives.
    const coreDoor = level % 2 === 0 ? -2.9 : 2.9
    h.door(level, { x: coreDoor, z: -1 }, { x: coreDoor, z: -2 }, { width: 1, name: 'Cửa cầu thang' })
    // Flats: NW, NE (beside the core), SW, SE; each split by a wall into living room and bedroom.
    const flats = [rect(-15, -7, -3.5, -1), rect(3.5, -7, 15, -1), rect(-15, 1, 0, 7), rect(0, 1, 15, 7)]
    h.wallZ(level, 0, 1, 7)
    flats.forEach((f, i) => {
      const north = i < 2
      const split = (f.minX + f.maxX) / 2
      h.wallZ(level, split, f.minZ, f.maxZ)
      const doorX = split + (north ? -1.2 : -1.2)
      h.door(level, { x: doorX, z: north ? -1 : 1 }, { x: doorX, z: north ? -2 : 2 }, { width: 1, name: `Cửa căn ${level + 1}0${i + 1}` })
      h.door(level, { x: split, z: north ? -4 : 4 }, { x: split + 1, z: north ? -4 : 4 }, { width: 1 })
      const living = rect(f.minX, f.minZ, split, f.maxZ)
      const bedroom = rect(split, f.minZ, f.maxX, f.maxZ)
      h.room(level, `Căn ${level + 1}0${i + 1} phòng khách`, living).room(level, `Căn ${level + 1}0${i + 1} phòng ngủ`, bedroom)
      const outer = north ? 'N' : 'S'
      h.against(level, living, outer, (split - f.minX) / 2 - 1, kitchen).against(level, living, outer, (split - f.minX) / 2 + 0.7, fridge)
      h.put(level, table, { x: (f.minX + split) / 2 - 0.6, z: (f.minZ + f.maxZ) / 2 })
      h.against(level, bedroom, outer, (f.maxX - split) / 2, preset('furniture/bed', { size: [2, 0.6, 1.4] }))
      h.against(level, bedroom, 'E', north ? 1.3 : 4.7, preset('container/wardrobe', { size: [1.2, 2, 0.6] }))
      h.window(level, { x: (f.minX + split) / 2 + 1.6, z: north ? -7 : 7 }, { x: (f.minX + split) / 2, z: 0 }).window(level, { x: (split + f.maxX) / 2 + 1.6, z: north ? -7 : 7 }, { x: (split + f.maxX) / 2, z: 0 })
    })
    h.room(level, `Hành lang tầng ${level + 1}`, rect(-15, -1, 15, 1), { floor: 'tile' }).room(level, `Cầu thang tầng ${level + 1}`, rect(-3.5, -7, 3.5, -1), { floor: 'concrete', switchAt: { x: 3.1, z: -5 } })
    h.window(level, { x: -15, z: 0 }, { x: 0, z: 0 }, 1).window(level, { x: 15, z: 0 }, { x: 0, z: 0 }, 1)
  }
  h.door(0, { x: -15, z: 0 }, { x: -14, z: 0 }, { width: 1.4, name: 'Cửa chính' })
  return reorderEntrance(h.doc())
}

/** The generator takes the first ground-floor door as the entrance: put the main door first. */
function reorderEntrance(p: PrefabDocument): PrefabDocument {
  const i = p.objects.findIndex((o) => o.kind === 'door' && o.name === 'Cửa chính')
  if (i <= 0) return p
  const objects = [...p.objects]
  const [main] = objects.splice(i, 1)
  // Keep it after the wall runs so the file reads naturally, but before every other door.
  const firstDoor = objects.findIndex((o) => o.kind === 'door')
  objects.splice(firstDoor, 0, main)
  return { ...p, objects }
}

export function p2(): PrefabDocument[] {
  return buildAll([cap4, cottage, bungalowL, garden, longhouse, ranch, () => tube('house/tube-4x16', 'Nhà ống 4 × 16', 4, 16, 2, false), () => tube('house/tube-5x18', 'Nhà ống 3 tầng', 5, 18, 3, false), () => tube('house/shophouse', 'Nhà phố kinh doanh', 5, 20, 3, true), villa, suburban, lTwoStorey, () => apartment()]).map(reorderEntrance)
}
