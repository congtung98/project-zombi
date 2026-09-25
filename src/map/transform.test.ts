import { describe, expect, it } from 'vitest'
import { Euler, Vector3 } from 'three'
import { resolveInstance } from './resolve'
import { chunkIdOf, chunkIndex, chunksOverlapping, parseChunkId, parseRecordId, quantize, rotateXZ } from './transform'
import type { PrefabDocument, QuarterTurns } from './schema'

/** A prefab with an off-origin pivot and one object of every kind (plus a room with a lamp). */
const PREFAB: PrefabDocument = {
  schemaVersion: 1,
  prefabId: 'test/cabin',
  contentVersion: 1,
  name: 'Cabin',
  pivot: { x: 1, y: 0, z: 2 },
  footprint: { minX: -2, minZ: -1, maxX: 4, maxZ: 5 },
  building: { height: 3, wallThickness: 0.2, wallColor: '#aaaaaa', roofColor: '#bbbbbb', floorColor: '#cccccc' },
  objects: [
    { kind: 'wall', localId: 'wall-long', position: { x: 1, y: 1.5, z: -1 }, size: [6, 3, 0.2], color: '#aaaaaa' },
    { kind: 'prop', localId: 'table', position: { x: 3, y: 0.4, z: 3.5 }, size: [1.2, 0.8, 0.6], color: '#884400' },
    { kind: 'container', localId: 'crate', name: 'Crate', position: { x: -1, y: 0.5, z: 4 }, size: [0.5, 1, 0.9], color: '#553311', lootTableId: 'x' },
    { kind: 'door', localId: 'door', name: 'Door', position: { x: 0.5, z: -1 }, quarterTurns: 0, width: 1.4, openTowards: 1 },
    { kind: 'door', localId: 'door-side', name: 'Side door', position: { x: 4, z: 2 }, quarterTurns: 3, width: 1, openTowards: -1 },
    { kind: 'window', localId: 'win', name: 'Window', position: { x: -2, z: 2 }, quarterTurns: 1, width: 1.2, sill: 0.9, head: 2.1, thickness: 0.2 },
  ],
  rooms: [
    {
      localId: 'room', name: 'Room', bounds: { minX: -2, minZ: -1, maxX: 4, maxZ: 5 },
      lamp: { localId: 'lamp', name: 'Lamp', intensity: 0.8, color: '#ffffff', requiresElectricity: true, switchAt: { x: 0.2, z: -0.8 }, at: { x: 2, z: 1 } },
    },
  ],
}

const ORIGIN = { x: -32, z: 64 }
const POSITION = { x: 10.5, y: 0, z: 7.25 }

/** Independent reference: Three.js rotation about +Y of (local − pivot), then translate. */
function expected(local: { x: number; z: number }, q: number) {
  const v = new Vector3(local.x - PREFAB.pivot.x, 0, local.z - PREFAB.pivot.z).applyAxisAngle(new Vector3(0, 1, 0), (q * Math.PI) / 2)
  return { x: ORIGIN.x + POSITION.x + v.x, z: ORIGIN.z + POSITION.z + v.z }
}

function leafDirection(angle: number) {
  return new Vector3(1, 0, 0).applyEuler(new Euler(0, angle, 0))
}

describe('map transforms (M1)', () => {
  it('rotates (x, z) like Three.js rotation.y and never yields −0', () => {
    for (const q of [0, 1, 2, 3]) {
      const [x, z] = rotateXZ(2, -5, q)
      const v = new Vector3(2, 0, -5).applyAxisAngle(new Vector3(0, 1, 0), (q * Math.PI) / 2)
      expect(x).toBeCloseTo(v.x, 12)
      expect(z).toBeCloseTo(v.z, 12)
    }
    expect(Object.is(rotateXZ(0, 3, 1)[1], -0)).toBe(false)
    expect(Object.is(quantize(-0.0000001), -0)).toBe(false)
  })

  for (const q of [0, 1, 2, 3] as QuarterTurns[]) {
    it(`places every kind consistently at ${q * 90}° (pivot off origin)`, () => {
      const { parts, bounds } = resolveInstance({ instanceId: 'c-1_2/cabin', prefabId: 'test/cabin', position: POSITION, quarterTurns: q }, PREFAB, ORIGIN)
      const at = (p: { x: number; z: number }, local: { x: number; z: number }) => {
        const e = expected(local, q)
        expect(p.x).toBeCloseTo(e.x, 6)
        expect(p.z).toBeCloseTo(e.z, 6)
      }
      // Colliders / mesh boxes: centre follows the rotation, X/Z extents swap on odd turns.
      const wall = parts.walls.find((w) => w.id === 'c-1_2/cabin/wall-long')!
      at(wall.position, { x: 1, z: -1 })
      expect(wall.size).toEqual(q % 2 ? [0.2, 3, 6] : [6, 3, 0.2])
      expect(wall.position.y).toBe(1.5)
      const crate = parts.containers[0]
      at(crate.position, { x: -1, z: 4 })
      expect(crate.size).toEqual(q % 2 ? [0.9, 1, 0.5] : [0.5, 1, 0.9])
      expect(crate.loot).toBe('x')

      // Doors: centre and hinge rotate; the leaf angle matches the rotated local leaf direction.
      for (const [id, local, dq, towards] of [['door', { x: 0.5, z: -1 }, 0, 1], ['door-side', { x: 4, z: 2 }, 3, -1]] as const) {
        const door = parts.doors.find((d) => d.id === `c-1_2/cabin/${id}`)!
        at(door.center, local)
        const [hx, hz] = rotateXZ(-door.width / 2, 0, dq)
        at(door.hinge, { x: local.x + hx, z: local.z + hz })
        const total = (q + dq) * (Math.PI / 2)
        const closed = leafDirection(door.closedAngle)
        const wantClosed = new Vector3(1, 0, 0).applyAxisAngle(new Vector3(0, 1, 0), total)
        expect(closed.distanceTo(wantClosed)).toBeLessThan(1e-9)
        // The closed leaf spans the opening: hinge + width · dir = far jamb.
        expect(door.hinge.x + closed.x * door.width).toBeCloseTo(2 * door.center.x - door.hinge.x, 6)
        expect(door.hinge.z + closed.z * door.width).toBeCloseTo(2 * door.center.z - door.hinge.z, 6)
        const side = new Vector3(0, 0, towards).applyAxisAngle(new Vector3(0, 1, 0), total)
        expect(leafDirection(door.openAngle).dot(side)).toBeCloseTo(1, 9)
      }

      // Window: pane centre, orientation and inside direction.
      const win = parts.windows[0]
      at(win.center, { x: -2, z: 2 })
      expect(win.center.y).toBeCloseTo(1.5, 12)
      const inward = new Vector3(0, 0, 1).applyAxisAngle(new Vector3(0, 1, 0), ((q + 1) * Math.PI) / 2)
      expect(win.inward.x).toBeCloseTo(inward.x, 12)
      expect(win.inward.z).toBeCloseTo(inward.z, 12)
      expect(win.alongX).toBe((q + 1) % 2 === 0)

      // Room, lamp and switch (interaction point) stay together.
      const room = parts.rooms[0]
      const corners = [expected({ x: -2, z: -1 }, q), expected({ x: 4, z: 5 }, q)]
      expect(room.bounds.minX).toBeCloseTo(Math.min(corners[0].x, corners[1].x), 6)
      expect(room.bounds.maxZ).toBeCloseTo(Math.max(corners[0].z, corners[1].z), 6)
      at(room.lamp!.switchAt, { x: 0.2, z: -0.8 })
      at(room.lamp!.position, { x: 2, z: 1 })
      expect(room.lamp!.position.y).toBeCloseTo(2.92, 12)
      expect(room.lamp!.roomId).toBe(room.id)

      // Building footprint and record bounds cover everything placed.
      const b = parts.buildings[0]
      expect(b.size).toEqual(q % 2 ? { w: 6, d: 6 } : { w: 6, d: 6 })
      for (const p of [wall.position, crate.position, win.center, room.lamp!.switchAt]) {
        expect(p.x).toBeGreaterThanOrEqual(bounds.minX)
        expect(p.x).toBeLessThanOrEqual(bounds.maxX)
        expect(p.z).toBeGreaterThanOrEqual(bounds.minZ)
        expect(p.z).toBeLessThanOrEqual(bounds.maxZ)
      }
    })
  }

  it('assigns negative coordinates and chunk lines to exactly one chunk (half-open)', () => {
    expect(chunkIndex(-0.000001, 32)).toBe(-1)
    expect(chunkIndex(0, 32)).toBe(0)
    expect(chunkIndex(-32, 32)).toBe(-1)
    expect(chunkIndex(-32.5, 32)).toBe(-2)
    expect(chunkIndex(31.999999, 32)).toBe(0)
    expect(chunkIndex(32, 32)).toBe(1)
    expect(chunkIdOf(-0, 0)).toBe('c0_0')
    expect(parseChunkId('c-1_0')).toEqual({ cx: -1, cz: 0 })
    for (const bad of ['c-0_0', 'c01_0', 'c1-0', 'c1_0x', 'C1_0']) expect(parseChunkId(bad)).toBeNull()
    // An edge exactly on a chunk line does not reach the next chunk; a point on it belongs above.
    expect(chunksOverlapping({ minX: -4, minZ: 1, maxX: 0, maxZ: 2 }, 32)).toEqual([{ cx: -1, cz: 0 }])
    expect(chunksOverlapping({ minX: -4, minZ: 1, maxX: 0.5, maxZ: 2 }, 32)).toEqual([{ cx: -1, cz: 0 }, { cx: 0, cz: 0 }])
    expect(chunksOverlapping({ minX: 0, minZ: 0, maxX: 0, maxZ: 0 }, 32)).toEqual([{ cx: 0, cz: 0 }])
    expect(chunksOverlapping({ minX: -25, minZ: -3, maxX: 25, maxZ: 1 }, 32)).toHaveLength(4)
  })

  it('parses record IDs with an immutable identity chunk', () => {
    expect(parseRecordId('c0_-1/store', null)).toEqual({ chunkId: 'c0_-1', name: 'store' })
    expect(parseRecordId('c0_-1/zones/cross', 'zones')).toEqual({ chunkId: 'c0_-1', name: 'cross' })
    expect(parseRecordId('c0_-1/objects/cross', 'zones')).toBeNull()
    expect(parseRecordId('c0_-1/Store', null)).toBeNull()
    expect(parseRecordId('store', null)).toBeNull()
  })
})
