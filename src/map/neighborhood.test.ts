import { describe, expect, it } from 'vitest'
import { bundledWorldReader, loadBundledWorld } from './content'
import { importLegacyMap, type LegacyIdMap, type LegacyMap } from './tools/importLegacy'
import { formatJson } from './format'

/**
 * M2 gate: content v1 of the neighbourhood is the hand-coded map it replaced (frozen in
 * `migrations/legacy-v7-map.json`), object for object, with IDs renamed by the migration map.
 * A later content version changes the layout on purpose and retires this check.
 */
const read = bundledWorldReader('neighborhood-50')
const legacy = read('migrations/legacy-v7-map.json') as LegacyMap
const ids = read('migrations/legacy-v7-ids.json') as LegacyIdMap
const { map, docs, issues } = loadBundledWorld('neighborhood-50')

/** Deep equality with numbers compared to 1e-6 (resolved coordinates are quantised to 1 µm). */
function close(actual: unknown, want: unknown, path = ''): void {
  if (typeof want === 'number') {
    expect(typeof actual, path).toBe('number')
    expect(Math.abs((actual as number) - want), `${path}: ${actual} vs ${want}`).toBeLessThan(1e-6)
  } else if (Array.isArray(want)) {
    expect(Array.isArray(actual), path).toBe(true)
    expect((actual as unknown[]).length, path).toBe(want.length)
    want.forEach((w, i) => close((actual as unknown[])[i], w, `${path}[${i}]`))
  } else if (want && typeof want === 'object') {
    const a = actual as Record<string, unknown>
    const keys = new Set([...Object.keys(want), ...Object.keys(a)].filter((k) => (want as Record<string, unknown>)[k] !== undefined || a[k] !== undefined))
    for (const k of keys) close(a[k], (want as Record<string, unknown>)[k], `${path}.${k}`)
  } else {
    expect(actual, path).toEqual(want)
  }
}

function byId<T extends { id: string }>(list: T[]): Map<string, T> {
  return new Map(list.map((x) => [x.id, x]))
}

describe('neighbourhood content v1 (M2)', () => {
  it('loads with no errors or warnings', () => {
    expect(issues).toEqual([])
  })

  // Content v1 is the migrated hand-coded map; later versions change the layout on purpose.
  const v1 = docs.world.contentVersion === 1

  it.runIf(v1)('reproduces every legacy wall, door, window, room, container, road, zone and spawn', () => {
    const walls = byId(map.walls)
    expect(map.walls).toHaveLength(legacy.walls.length)
    // M11c-1A: resolved props carry `prop: true` (the cutaway never cuts furniture); the hand-coded
    // map had no such flag, so it is left out of the comparison.
    for (const w of legacy.walls) {
      const { prop: _prop, ...resolved } = walls.get(ids.walls[w.id])!
      close(resolved, { ...w, id: ids.walls[w.id] }, w.id)
    }

    const doors = byId(map.doors)
    expect(map.doors).toHaveLength(legacy.doors.length)
    for (const d of legacy.doors) close(doors.get(ids.doors[d.id]), { ...d, id: ids.doors[d.id], buildingId: ids.buildings[d.buildingId] }, d.id)

    const windows = byId(map.windows!)
    expect(map.windows).toHaveLength(legacy.windows!.length)
    for (const w of legacy.windows!) close(windows.get(ids.windows[w.id]), { ...w, id: ids.windows[w.id], buildingId: ids.buildings[w.buildingId] }, w.id)

    const rooms = byId(map.rooms!)
    expect(map.rooms).toHaveLength(legacy.rooms!.length)
    for (const r of legacy.rooms!) {
      const lamp = r.lamp && { ...r.lamp, id: ids.lamps[r.lamp.id], roomId: ids.rooms[r.id] }
      close(rooms.get(ids.rooms[r.id]), { ...r, id: ids.rooms[r.id], buildingId: ids.buildings[r.buildingId], lamp }, r.id)
    }

    const containers = byId(map.containers)
    expect(map.containers).toHaveLength(legacy.containers.length)
    for (const c of legacy.containers) close(containers.get(ids.containers[c.id]), { ...c, id: ids.containers[c.id] }, c.id)

    const roads = byId(map.roads)
    for (const r of legacy.roads) close(roads.get(ids.roads[r.id]), { ...r, id: ids.roads[r.id] }, r.id)
    const zones = byId(map.zombieZones!)
    expect(map.zombieZones).toHaveLength(legacy.zombieZones!.length)
    for (const z of legacy.zombieZones!) close(zones.get(ids.zones[z.id]), { ...z, id: ids.zones[z.id] }, z.id)

    const key = (p: { x: number; z: number }) => `${p.x},${p.z}`
    expect(map.zombieSpawns.map(key).sort()).toEqual(legacy.zombieSpawns.map(key).sort())
    close(map.playerSpawn, legacy.playerSpawn)
    expect(map.size).toBe(legacy.size)
    expect(map.id).toBe(legacy.id)

    const buildings = byId(map.buildings)
    for (const b of legacy.buildings) {
      const { id, name, center, size, height, wallThickness, wallColor, roofColor, floorColor } = b
      close(buildings.get(ids.buildings[id]), { id: ids.buildings[id], name, center, size, height, wallThickness, wallColor, roofColor, floorColor }, id)
    }
  })

  it('maps legacy IDs one-to-one onto IDs that exist', () => {
    const persisted = { doors: map.doors, containers: map.containers, windows: map.windows!, zones: map.zombieZones!, rooms: map.rooms! }
    for (const [kind, list] of Object.entries(persisted)) {
      const targets = Object.values(ids[kind as keyof typeof persisted])
      expect(new Set(targets).size, kind).toBe(targets.length)
      expect([...targets].sort(), kind).toEqual(list.map((x) => x.id).sort())
    }
    const lamps = Object.values(ids.lamps)
    expect(lamps.sort()).toEqual(map.rooms!.flatMap((r) => (r.lamp ? [r.lamp.id] : [])).sort())
  })

  it.runIf(v1)('is exactly what the legacy importer produces (the committed files are its output)', () => {
    const again = importLegacyMap(legacy, { worldId: 'neighborhood-50', name: docs.world.name, chunkSize: 32, legacySaveVersion: 7 })
    expect(formatJson(again.world)).toBe(formatJson(docs.world))
    for (const p of again.prefabs) expect(formatJson(p)).toBe(formatJson(docs.prefabs.get(p.prefabId)))
    for (const c of again.chunks) expect(formatJson(c)).toBe(formatJson(docs.chunks.get(c.chunkId)))
    expect(formatJson(again.ids)).toBe(formatJson(ids))
  })
})
