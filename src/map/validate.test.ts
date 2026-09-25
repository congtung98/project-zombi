import { describe, expect, it } from 'vitest'
import { ChunkLifecycle } from './loader'
import { computeExternalRefs, loadWorldDocuments, MapContentError, type ValidationIssue } from './validate'
import type { ChunkDocument, PrefabDocument, WorldDocument } from './schema'
import type { ResolvedRecord } from './resolve'

/**
 * Two chunks side by side (c-1_0 | c0_0) and a shed whose footprint crosses the chunk line at
 * x = 0: owned by c-1_0, referenced by c0_0.
 */
function fixture() {
  const shed: PrefabDocument = {
    schemaVersion: 1,
    prefabId: 'building/shed',
    contentVersion: 1,
    name: 'Shed',
    pivot: { x: 0, y: 0, z: 0 },
    footprint: { minX: -2, minZ: -2, maxX: 2, maxZ: 2 },
    building: { height: 3, wallThickness: 0.2, wallColor: '#999999', roofColor: '#555555', floorColor: '#777777' },
    objects: [
      { kind: 'wall', localId: 'wall-n', position: { x: 0, y: 1.5, z: -2 }, size: [4, 3, 0.2], color: '#999999' },
      { kind: 'container', localId: 'box', name: 'Box', position: { x: 1, y: 0.5, z: 1 }, size: [0.5, 1, 0.5], color: '#553311', lootTableId: 'crate' },
      { kind: 'door', localId: 'door', name: 'Door', position: { x: 0, z: 2 }, quarterTurns: 0, width: 1, openTowards: -1 },
    ],
    rooms: [{ localId: 'room', name: 'Room', bounds: { minX: -2, minZ: -2, maxX: 2, maxZ: 2 } }],
  }
  const world: WorldDocument = {
    schemaVersion: 1,
    worldId: 'test-world',
    name: 'Test',
    contentVersion: 1,
    chunkSize: 32,
    coordinateSystem: 'y-up-xz-meters',
    playArea: { size: 60 },
    boundary: { height: 2, thickness: 1 },
    chunkBounds: { minCx: -1, maxCx: 0, minCz: 0, maxCz: 0 },
    chunks: [
      { chunkId: 'c-1_0', cx: -1, cz: 0, path: 'chunks/c-1_0.json' },
      { chunkId: 'c0_0', cx: 0, cz: 0, path: 'chunks/c0_0.json' },
    ],
    prefabs: [{ prefabId: 'building/shed', contentVersion: 1, path: 'prefabs/shed.json' }],
    playerSpawn: 'c0_0/spawns/start',
  }
  const west: ChunkDocument = {
    schemaVersion: 1, contentVersion: 1, chunkId: 'c-1_0', cx: -1, cz: 0,
    // Local x 31 → world x −1: the shed spans −3..1 and reaches into c0_0.
    instances: [{ instanceId: 'c-1_0/shed', prefabId: 'building/shed', position: { x: 31, y: 0, z: 10 }, quarterTurns: 0 }],
    objects: [{ kind: 'prop', objectId: 'c-1_0/objects/crate', position: { x: 10, y: 0.5, z: 10 }, size: [1, 1, 1], color: '#aa7744' }],
    roads: [], zones: [], spawns: [], externalRefs: [],
  }
  const east: ChunkDocument = {
    schemaVersion: 1, contentVersion: 1, chunkId: 'c0_0', cx: 0, cz: 0,
    instances: [], objects: [], roads: [],
    zones: [{ zoneId: 'c0_0/zones/yard', kind: 'zombiePopulation', name: 'Yard', shape: 'circle', center: { x: 10, z: 20 }, radius: 3 }],
    spawns: [{ spawnId: 'c0_0/spawns/start', kind: 'player', position: { x: 12, z: 12 } }, { spawnId: 'c0_0/spawns/z1', kind: 'zombie', position: { x: 20, z: 20 } }],
    externalRefs: [{ id: 'c-1_0/shed', ownerChunkId: 'c-1_0' }],
  }
  const files: Record<string, unknown> = {
    'world.json': world,
    'prefabs/shed.json': shed,
    'chunks/c-1_0.json': west,
    'chunks/c0_0.json': east,
  }
  return { world, shed, west, east, files }
}

const LOOT = new Set(['crate'])

function load(files: Record<string, unknown>) {
  return loadWorldDocuments((path) => {
    if (!(path in files)) throw new Error(`missing ${path}`)
    return structuredClone(files[path])
  }, { lootTables: LOOT })
}

function errorsOf(files: Record<string, unknown>): ValidationIssue[] {
  try {
    load(files)
    return []
  } catch (e) {
    if (!(e instanceof MapContentError)) throw e
    return e.issues.filter((i) => i.severity === 'error')
  }
}

function codes(files: Record<string, unknown>): string[] {
  return errorsOf(files).map((i) => i.code)
}

describe('map validation (M1)', () => {
  it('accepts the fixture and computes its ownership references', () => {
    const f = fixture()
    const { docs, issues } = load(f.files)
    expect(issues).toEqual([])
    expect(computeExternalRefs(docs).get('c0_0')).toEqual([{ id: 'c-1_0/shed', ownerChunkId: 'c-1_0' }])
    expect(computeExternalRefs(docs).get('c-1_0')).toEqual([])
  })

  it('rejects an anchor on the far chunk line (half-open ownership) and negative locals', () => {
    const f = fixture()
    f.west.instances[0].position.x = 32
    expect(codes(f.files)).toContain('owner-mismatch')
    const g = fixture()
    g.west.objects[0].position.z = -0.5
    const errors = errorsOf(g.files)
    expect(errors.map((e) => e.code)).toContain('owner-mismatch')
    expect(errors.find((e) => e.code === 'owner-mismatch')).toMatchObject({ path: 'chunks/c-1_0.json#/objects/0/position', entityId: 'c-1_0/objects/crate' })
  })

  it('requires consistent references for anything crossing a chunk line', () => {
    const f = fixture()
    f.east.externalRefs = []
    expect(codes(f.files)).toEqual(['missing-external-ref'])
    const g = fixture()
    g.east.externalRefs.push({ id: 'c-1_0/objects/crate', ownerChunkId: 'c-1_0' })
    expect(codes(g.files)).toEqual(['stale-external-ref'])
    const h = fixture()
    h.east.externalRefs = [{ id: 'c-1_0/shed', ownerChunkId: 'c0_0' }]
    expect(codes(h.files).sort()).toEqual(['missing-external-ref', 'stale-external-ref'])
  })

  it('rejects duplicate IDs, reserved or malformed IDs and unknown references', () => {
    const f = fixture()
    f.east.objects.push({ kind: 'prop', objectId: 'c-1_0/objects/crate', position: { x: 5, y: 0.5, z: 5 }, size: [1, 1, 1], color: '#aa7744' })
    expect(codes(f.files)).toContain('duplicate-id')
    const g = fixture()
    g.shed.objects.push({ kind: 'prop', localId: 'box', position: { x: 0, y: 0.5, z: 0 }, size: [1, 1, 1], color: '#aa7744' })
    expect(codes(g.files)).toContain('duplicate-id')
    const h = fixture()
    h.west.instances[0].instanceId = 'c-1_0/objects'
    expect(codes(h.files)).toContain('invalid-id')
    const i = fixture()
    i.west.objects[0].objectId = 'c-1_0/crate'
    expect(codes(i.files)).toContain('invalid-id')
    const j = fixture()
    j.west.instances[0].prefabId = 'building/nope'
    expect(codes(j.files)).toContain('unknown-prefab')
    const k = fixture()
    ;(k.shed.objects[1] as { lootTableId: string }).lootTableId = 'gold'
    expect(codes(k.files)).toEqual(['unknown-loot-table'])
    const l = fixture()
    l.world.playerSpawn = 'c0_0/spawns/z1'
    expect(codes(l.files)).toEqual(['missing-player-spawn'])
  })

  it('rejects non-finite numbers, bad rotations, schema/version mismatches and missing files', () => {
    const f = fixture()
    f.west.instances[0].position.z = Number.NaN
    expect(codes(f.files)).toContain('not-finite')
    const g = fixture()
    ;(g.west.instances[0] as { quarterTurns: number }).quarterTurns = 4
    expect(codes(g.files)).toContain('schema')
    const h = fixture()
    h.world.schemaVersion = 2
    expect(codes(h.files)).toEqual(['unsupported-schema'])
    const i = fixture()
    i.shed.contentVersion = 2
    expect(codes(i.files)).toContain('version-mismatch')
    const j = fixture()
    delete j.files['chunks/c0_0.json']
    expect(codes(j.files)).toEqual(['missing-file'])
    const k = fixture()
    k.world.chunks[1].path = '../c0_0.json'
    expect(codes(k.files)).toContain('invalid-path')
  })

  it('rejects spawns inside colliders or outside the play area', () => {
    const f = fixture()
    f.east.spawns[0].position = { x: 0.2, z: 8.1 } // world (0.2, 8.1): 0.1 m from the shed's north wall (z = 8)
    expect(codes(f.files)).toContain('spawn-blocked')
    const g = fixture()
    g.world.playArea.size = 30
    expect(codes(g.files)).toContain('spawn-outside-play-area')
  })
})

describe('chunk lifecycle (M2)', () => {
  function lifecycle() {
    const { docs } = load(fixture().files)
    const events: string[] = []
    const chunks = new ChunkLifecycle(docs, {
      added: (r: ResolvedRecord) => events.push(`+${r.id}`),
      removed: (r: ResolvedRecord) => events.push(`-${r.id}`),
    })
    return { chunks, events }
  }

  it('keeps a building on a chunk line once while any chunk touching it is loaded', () => {
    const { chunks, events } = lifecycle()
    expect(chunks.load('c0_0')).toBe(true)
    expect(chunks.refCount('c-1_0/shed')).toBe(1)
    expect(events).toContain('+c-1_0/shed')
    expect(events).not.toContain('+c-1_0/objects/crate')
    expect(chunks.load('c-1_0')).toBe(true)
    expect(chunks.refCount('c-1_0/shed')).toBe(2)
    expect(events.filter((e) => e === '+c-1_0/shed')).toHaveLength(1)
    expect(chunks.load('c-1_0')).toBe(false)
    expect(chunks.refCount('c-1_0/shed')).toBe(2)
    expect(chunks.unload('c0_0')).toBe(true)
    expect(chunks.refCount('c-1_0/shed')).toBe(1)
    expect(events).not.toContain('-c-1_0/shed')
    chunks.unload('c-1_0')
    expect(chunks.refCount('c-1_0/shed')).toBe(0)
    expect(events.filter((e) => e === '-c-1_0/shed')).toHaveLength(1)
    expect(chunks.records()).toEqual([])
  })

  it('assembles the same map whatever the load order, and after unload/reload', () => {
    const a = lifecycle().chunks
    a.load('c-1_0')
    a.load('c0_0')
    const b = lifecycle().chunks
    b.load('c0_0')
    b.load('c-1_0')
    b.unload('c-1_0')
    b.load('c-1_0')
    expect(JSON.stringify(b.toMapData())).toBe(JSON.stringify(a.toMapData()))
    const map = a.toMapData()
    expect(map.doors.map((d) => d.id)).toEqual(['c-1_0/shed/door'])
    expect(map.containers.map((c) => c.id)).toEqual(['c-1_0/shed/box'])
    expect(map.walls.map((w) => w.id)).toEqual(['world/boundary-n', 'world/boundary-s', 'world/boundary-w', 'world/boundary-e', 'c-1_0/shed/wall-n', 'c-1_0/objects/crate'])
    expect(map.playerSpawn).toEqual({ x: 12, y: 0, z: 12 })
    expect(map.zombieSpawns).toEqual([{ x: 20, y: 0, z: 20 }])
  })
})
