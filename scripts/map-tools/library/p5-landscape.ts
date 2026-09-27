// Prefab library P5: special places and landscape. A prison (cell block, guard towers, gatehouse,
// perimeter wall), a cemetery (tombstones, chapel, fence), a park (paths, playground, kiosk) and
// ponds (water that blocks walking and navigation, D2), hand-placed like P4 (D6) with placement
// metadata on the compounds for the generator later.
import type { CompoundDocument, PrefabDocument, PrefabPlacement, LandUseZone } from '../../../src/map/schema.ts'
import { Building, box, buildAll, Compound, compoundDoc, preset, rect } from './builder.ts'
import { core, corridorBuilding, type RoomSpec } from './p4-public.ts'

const counter = preset('furniture/counter')
const chair = preset('furniture/chair')
const benchProp = box('prop', [1.8, 0.5, 0.5], '#6b5a44')
const tomb = box('prop', [0.7, 0.9, 0.25], '#8e8e8a')
const bigTomb = box('prop', [1, 1.2, 0.4], '#a4a39d')
const bin = box('container', [0.8, 1.1, 0.8], '#3f5f3a', { name: 'Thùng rác', loot: 'scrap-pile', asset: 'outdoor/bin' })
const lamp = box('prop', [0.3, 4.2, 0.3], '#4a4d51', { asset: 'outdoor/streetlight' })

const cell = (n: number, w = 3.6): RoomSpec => ({ w, name: `Buồng giam ${n}`, kind: 'cell' })

/** Khối giam, 36 × 20, 2 storeys: cells on both sides of the corridor, guard room, mess hall, infirmary. */
function prisonBlock(): PrefabDocument {
  const north = (from: number): RoomSpec[] => [core, ...Array.from({ length: 8 }, (_, i) => cell(from + i, 3.625))]
  return corridorBuilding({
    prefabId: 'public/prison-block',
    name: 'Khối giam',
    w: 36,
    d: 20,
    corridor: [-1.5, 1.5],
    storeys: 2,
    height: 3.4,
    colors: ['#b8b4ab', '#4d5054', '#8f8b84'],
    tags: ['nha-tu', 'khoi-giam'],
    entrances: [{ side: 'S', at: -12, width: 1.4 }, { side: 'E', at: 0, width: 1.2, name: 'Cửa sân' }],
    levels: [
      { north: north(1), south: [{ w: 8, name: 'Phòng quản giáo', kind: 'office', door: 'right' }, { w: 12, name: 'Nhà ăn', kind: 'canteen' }, { w: 6, name: 'Phòng y tế', kind: 'clinic' }, { w: 5, name: 'Phòng thay đồ', kind: 'lockers' }, { w: 5, name: 'Kho', kind: 'store' }] },
      { north: north(9), south: Array.from({ length: 10 }, (_, i) => cell(17 + i, 3.6)) },
    ],
  })
}

/** Chòi canh, 8 × 4, 2 storeys: a flight inside to the lookout room. */
function guardTower(): PrefabDocument {
  const h = new Building({ prefabId: 'public/guard-tower', name: 'Chòi canh', footprint: rect(-4, -2, 4, 2), storeys: 2, height: 3, wallColor: '#a9a59c', roofColor: '#3f4246', floorColor: '#8a8680', catalog: { group: 'public', tags: ['nha-tu', 'choi-canh'] } })
  h.outerWalls()
  h.stairs(0, { x: -1.5, z: 0 }, 'E', 3, 1)
  h.door(0, { x: -3, z: 2 }, { x: -3, z: 1 }, { width: 1, name: 'Cửa chính' })
  h.room(0, 'Chân chòi', rect(-4, -2, 4, 2), { floor: 'concrete' }).room(1, 'Chòi quan sát', rect(-4, -2, 4, 2))
  for (const [x, z] of [[-2.5, -2], [2.5, -2], [-2.5, 2], [2.5, 2]]) h.window(1, { x, z }, { x, z: 0 }, 1.4)
  h.window(1, { x: -4, z: 0 }, { x: 0, z: 0 }, 1.2).window(1, { x: 4, z: 0 }, { x: 0, z: 0 }, 1.2)
  h.put(1, box('container', [0.8, 1, 0.5], '#4f5a4a', { name: 'Tủ trực', loot: 'police-armory', asset: 'furniture/cabinet' }), { x: -3.3, z: -1.4 })
  return h.doc()
}

/** Nhà nguyện nghĩa trang, 8 × 10: benches before an altar. */
function chapel(): PrefabDocument {
  const h = new Building({ prefabId: 'landscape/chapel', name: 'Nhà nguyện', footprint: rect(-4, -5, 4, 5), height: 4, wallColor: '#e2ddd2', roofColor: '#5a3e33', floorColor: '#9d8f7d', catalog: { group: 'landscape', tags: ['nghia-trang', 'nha-nguyen'] } })
  h.outerWalls()
  h.door(0, { x: 0, z: 5 }, { x: 0, z: 4 }, { width: 1.6, name: 'Cửa chính' })
  h.windows(0, 'W', 3, 1).windows(0, 'E', 3, 1)
  const r = rect(-4, -5, 4, 5)
  h.room(0, 'Gian nguyện', r)
  h.against(0, r, 'N', 4, box('prop', [2, 1.1, 0.8], '#6b2e22', { asset: 'furniture/cabinet' }))
  for (const z of [-1.5, 0.5, 2.5]) h.put(0, benchProp, { x: -2, z }).put(0, benchProp, { x: 2, z })
  h.against(0, r, 'W', 1.2, box('container', [0.8, 1, 0.5], '#6f5a45', { name: 'Tủ đồ lễ', loot: 'house-nightstand', asset: 'furniture/cabinet' }))
  return h.doc()
}

/** Ki-ốt, 4 × 4: a counter with snacks (park, gatehouse). */
function kiosk(): PrefabDocument {
  const h = new Building({ prefabId: 'landscape/kiosk', name: 'Ki-ốt', footprint: rect(-2, -2, 2, 2), height: 2.8, wallColor: '#d9c9a0', roofColor: '#2f6b4a', floorColor: '#9a8f7e', catalog: { group: 'landscape', tags: ['cong-vien', 'ki-ot'] } })
  h.outerWalls()
  h.door(0, { x: 0, z: 2 }, { x: 0, z: 1 }, { width: 1, name: 'Cửa chính' })
  h.window(0, { x: -2, z: 0 }, { x: 0, z: 0 }, 1.2).window(0, { x: 2, z: 0 }, { x: 0, z: 0 }, 1.2)
  const r = rect(-2, -2, 2, 2)
  h.room(0, 'Ki-ốt', r)
  h.against(0, r, 'N', 2, box('container', [2, 1, 0.6], '#8a6a45', { name: 'Quầy bán hàng', loot: 'kiosk-counter', asset: 'furniture/counter' }))
  void counter
  void chair
  return h.doc()
}

const place = (zones: LandUseZone[], frontage: [number, number]): PrefabPlacement => ({ category: 'public', allowedZones: zones, weight: 0.5, setback: 1, sideGap: 1, roadFacing: true, frontage })

function compounds(prefabs: ReadonlyMap<string, PrefabDocument>): CompoundDocument[] {
  // Nhà tù: a 4 m wall 64 × 52 with a gate in the south, the block, towers in the corners, a yard.
  const prison = new Compound('compound/prison', 'Nhà tù', { group: 'public', tags: ['nha-tu'] }, place(['public', 'industrial'], [70, 120]))
  prison.building('public/prison-block', { x: 0, z: -10 }, 0, 'block')
  for (const [x, z, q] of [[-27, -21, 0], [27, -21, 0], [-27, 21, 2], [27, 21, 2]] as const) prison.building('public/guard-tower', { x, z }, q, 'tower')
  prison.building('landscape/kiosk', { x: 8, z: 21 }, 0, 'gatehouse')
  prison.enclose(rect(-32, -26, 32, 26), 0.5, 4, '#9c978d', 'wall', [['S', 32, 6]])
  prison.surface('dirt', { x: 0, z: 12 }, [40, 14], { base: 'yard' }).surface('asphalt', { x: -8, z: 12 }, [14, 9], { layer: 1, base: 'court' })
  for (const x of [-14, -2]) prison.box(box('prop', [0.3, 3, 0.3], '#d0d4d8'), { x, z: 12 }, { base: 'hoop' })
  for (const x of [8, 14]) prison.box(benchProp, { x, z: 9 }, { base: 'bench' })
  prison.box(lamp, { x: -4, z: 23 }, { base: 'streetlight' })

  // Nghĩa trang, 30 × 24: rows of graves either side of a central path, a chapel, pines, a fence with a gate.
  const cem = new Compound('compound/cemetery', 'Nghĩa trang', { group: 'landscape', tags: ['nghia-trang'] }, place(['public', 'empty', 'farmland'], [32, 60]))
  cem.surface('grass', { x: 0, z: 0 }, [30, 24], { base: 'lawn', color: '#56733a' }).surface('dirt', { x: 0, z: 3 }, [2.4, 18], { layer: 1, base: 'path' })
  cem.building('landscape/chapel', { x: 0, z: -6.5 }, 0, 'chapel')
  for (const side of [-1, 1])
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 4; col++) {
        const x = side * (3.5 + col * 2.4)
        const z = 1 + row * 2.4
        cem.box(row === 0 && col === 3 ? bigTomb : tomb, { x, z }, { base: 'grave' })
        cem.surface('dirt', { x, z: z + 1 }, [1, 1.6], { layer: 1, base: 'plot', color: '#6f5638' })
      }
  cem.enclose(rect(-15, -12, 15, 12), 0.15, 1.2, '#5a5550', 'prop', [['S', 15, 4]], 'outdoor/fence')
  for (const [x, z] of [[-12, -9], [12, -9], [-12.5, 9.5], [12.5, 9.5], [-8, -9.5], [8, -9.5]]) cem.tree({ x, z }, 'pine', 7, 1.4)
  cem.box(benchProp, { x: 7, z: -3 }, { base: 'bench' })

  // Công viên, 30 × 30: a lawn with crossing paths, a playground, a kiosk, benches, trees, bins, lamps.
  const park = new Compound('compound/park', 'Công viên', { group: 'landscape', tags: ['cong-vien'] }, place(['public', 'residential', 'empty'], [30, 60]))
  park.surface('grass', { x: 0, z: 0 }, [30, 30], { base: 'lawn' }).surface('concrete', { x: 0, z: 0 }, [2.5, 30], { layer: 1, base: 'path' }).surface('concrete', { x: 0, z: 0 }, [30, 2.5], { layer: 1, base: 'path' })
  park.surface('dirt', { x: 8, z: 8 }, [9, 7], { layer: 1, base: 'playground', color: '#b59a6a' })
  park.box(box('prop', [1, 2, 3.2], '#c8412f'), { x: 6, z: 8 }, { base: 'slide' }).box(box('prop', [3, 2.2, 0.3], '#3b6fa8'), { x: 10, z: 6 }, { base: 'swing' }).box(box('prop', [2, 0.4, 2], '#d9c07a'), { x: 10, z: 10 }, { base: 'sandbox' })
  park.building('landscape/kiosk', { x: -8, z: -8 }, 0, 'kiosk')
  for (const [x, z] of [[-3, 5], [3, -5], [-6, 3], [6, -3]]) park.box(benchProp, { x, z }, { base: 'bench', turn: Math.abs(x) > Math.abs(z) })
  for (const [x, z] of [[-11, 11], [-11, 4], [11, -11], [4, -11], [-4, -12], [12, -4]]) park.tree({ x, z }, 'round', 6, 2.3)
  park.surface('grass', { x: -8, z: 8 }, [4, 4], { shape: 'ellipse', layer: 2, color: '#6f9a45', navigation: 'blocked', base: 'flowerbed' })
  for (const [x, z] of [[1.8, 3], [-1.8, -3]]) park.box(bin, { x, z }, { base: 'bin' })
  for (const [x, z] of [[1.8, 12], [-1.8, -12], [12, 1.8], [-12, -1.8]]) park.box(lamp, { x, z }, { base: 'streetlight' })

  // Hồ nước nhỏ, 24 × 18: water ellipse in a muddy bank, trees, benches and a jetty.
  const pond = new Compound('compound/pond', 'Hồ nước nhỏ', { group: 'landscape', tags: ['ho-nuoc'] }, place(['public', 'empty', 'forest', 'farmland', 'residential'], [24, 60]))
  pond.surface('grass', { x: 0, z: 0 }, [24, 18], { base: 'lawn' }).surface('dirt', { x: 0, z: 0 }, [19, 13], { shape: 'ellipse', layer: 1, base: 'bank', color: '#7b6546' }).surface('water', { x: 0, z: 0 }, [16, 10], { shape: 'ellipse', layer: 2, base: 'water' })
  for (const [x, z] of [[-10, -7], [10, -7], [-10.5, 7], [10.5, 7.5]]) pond.tree({ x, z }, 'round', 6, 2)
  pond.box(benchProp, { x: 0, z: 7.8 }, { base: 'bench' }).box(benchProp, { x: 0, z: -7.8 }, { base: 'bench' })
  for (const [x, z] of [[-8.6, 1.5], [8.8, -1], [-3, 6.2], [4, -6.2]]) pond.decor('decor/bush', { x, z })

  // Hồ lớn, 44 × 30: two overlapping water ellipses, a path round it, trees, benches.
  const lake = new Compound('compound/lake', 'Hồ lớn', { group: 'landscape', tags: ['ho-nuoc'] }, place(['public', 'empty', 'forest'], [44, 90]))
  lake.surface('grass', { x: 0, z: 0 }, [44, 30], { base: 'lawn' })
  lake.surface('concrete', { x: 0, z: -13 }, [40, 2], { layer: 1, base: 'path' }).surface('concrete', { x: 0, z: 13 }, [40, 2], { layer: 1, base: 'path' })
  lake.surface('dirt', { x: 0, z: 0 }, [37, 23], { shape: 'ellipse', layer: 1, base: 'bank', color: '#7b6546' }).surface('water', { x: 0, z: 0 }, [34, 20], { shape: 'ellipse', layer: 2, base: 'water' })
  for (const [x, z] of [[-20, -11], [-20, 11], [20, -11], [20, 11]]) lake.tree({ x, z }, 'round', 7, 2.4)
  // The jetty is drawn over the water (layer 3): the water under it still keeps everybody out.
  lake.surface('dirt', { x: 0, z: 8.5 }, [1.6, 4], { layer: 3, base: 'jetty', color: '#7a5f45' })
  for (const x of [-10, 10]) lake.box(benchProp, { x, z: 11 }, { base: 'bench' })
  for (const x of [-14, 14]) lake.box(lamp, { x, z: -11.5 }, { base: 'streetlight' })

  return [prison, cem, park, pond, lake].map((c) => compoundDoc(c, prefabs))
}

export function p5(): { prefabs: PrefabDocument[]; compounds: CompoundDocument[] } {
  const prefabs = buildAll([prisonBlock, guardTower, chapel, kiosk])
  return { prefabs, compounds: compounds(new Map(prefabs.map((p) => [p.prefabId, p]))) }
}
