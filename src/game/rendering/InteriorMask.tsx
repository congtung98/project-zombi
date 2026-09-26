import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { DataTexture, NearestFilter, RGBAFormat, UnsignedByteType } from 'three'
import { runtime } from '../core/runtime'
import { onRoomStorey } from '../world/buildings'
import type { RoomGrid } from '../systems/interiorVisibility'
import { indoorSlots, indoorUniforms, INDOOR_MAX_ROOMS } from './indoorShading'

const CFG = runtime.config.interiorVisibility

/** The mask texture (R seen, G explored per cell) and its bytes. */
class MaskTexture {
  readonly texture: DataTexture
  readonly size: number
  private readonly data: Uint8Array

  constructor(size: number) {
    this.size = size
    this.data = new Uint8Array(size * size * 4)
    this.texture = new DataTexture(this.data, size, size, RGBAFormat, UnsignedByteType)
    this.texture.magFilter = NearestFilter
    this.texture.minFilter = NearestFilter
    this.texture.needsUpdate = true
  }

  clear(): void {
    this.data.fill(0)
  }

  /** One texel: how much it is seen now (0..1) and whether it was explored. */
  set(tx: number, tz: number, seen: number, explored: boolean): void {
    const o = (tz * this.size + tx) * 4
    this.data[o] = Math.round(seen * 255)
    this.data[o + 1] = explored ? 255 : 0
  }

  commit(): void {
    this.texture.needsUpdate = true
  }

  dispose(): void {
    this.texture.dispose()
  }
}

/**
 * M11c-1B: feeds the interior mask of the indoor shader from `runtime.interior` (the cells the
 * character sees now and has explored). Every frame it eases each seen cell towards its state over
 * `fadeSeconds` (a window edge never flickers), writes the cells of the character's storey into a
 * texture over a `maskSize` square around the player (nearest filtering: a cell never bleeds into
 * the room behind a wall) and sets per shader slot whether the room reads the texture (same storey)
 * or a constant (another storey: remembered if any of it was explored, else never seen).
 *
 * Presentation only: it reads the simulation, writes uniforms. Lighting is untouched (the shader
 * applies the mask as a factor after the room light). `debug` (F4) tints instead of darkening.
 */
export function InteriorMask({ debug }: { debug: boolean }) {
  const size = Math.round(CFG.maskSize / CFG.cell)
  const mask = useMemo(() => new MaskTexture(size), [size])
  /** Eased "seen" per cell of each room (only rooms near the player are eased and drawn). */
  const eased = useRef(new Map<string, Float32Array>())
  const last = useRef({ revision: -1, originX: NaN, originZ: NaN, slots: -1, storey: NaN, easing: false })

  useEffect(() => {
    const previous = indoorUniforms.uVisMap.value
    indoorUniforms.uVisMap.value = mask.texture
    return () => {
      indoorUniforms.uVisMap.value = previous
      indoorUniforms.uVisWindow.value.w = 0
      mask.dispose()
    }
  }, [mask])

  useFrame((_, delta) => {
    const u = indoorUniforms
    if (!CFG.enabled) {
      u.uVisWindow.value.w = 0
      return
    }
    u.uVisLevels.value.set(CFG.unexploredLevel, CFG.rememberedLevel, CFG.rememberedDesaturation, debug ? 1 : 0)
    const interior = runtime.interior
    const p = runtime.player.position
    const cell = CFG.cell
    const originX = Math.floor((p.x - CFG.maskSize / 2) / cell) * cell
    const originZ = Math.floor((p.z - CFG.maskSize / 2) / cell) * cell
    const s = last.current
    const storeyKey = Math.round(p.y * 4)
    // Per-slot flags: the texture for the character's storey, a constant for the others.
    if (s.slots !== indoorSlots.version || s.storey !== storeyKey || s.revision !== interior.revision) {
      const rooms = indoorSlots.rooms
      for (let i = 0; i < Math.min(rooms.length, INDOOR_MAX_ROOMS); i++) {
        const room = rooms[i]
        u.uRoomMask.value[i].set(onRoomStorey(room, p.y) ? 1 : 0, interior.exploredShare(room.id) > 0 ? 1 : 0)
      }
      s.slots = indoorSlots.version
      s.storey = storeyKey
    }
    u.uVisWindow.value.set(originX, originZ, 1 / (size * cell), 1)
    if (s.revision === interior.revision && s.originX === originX && s.originZ === originZ && !s.easing) return
    s.revision = interior.revision
    s.originX = originX
    s.originZ = originZ

    mask.clear()
    const step = CFG.fadeSeconds > 0 ? Math.min(1, delta / CFG.fadeSeconds) : 1
    let easing = false
    const near = new Set<string>()
    for (const g of interior.grids) {
      if (!onRoomStorey(g.room, p.y) || !overlaps(g, cell, originX, originZ, size * cell)) continue
      near.add(g.room.id)
      let e = eased.current.get(g.room.id)
      if (!e) eased.current.set(g.room.id, (e = Float32Array.from(g.seen)))
      for (let r = 0; r < g.rows; r++) {
        const tz = Math.floor((g.minZ + (r + 0.5) * cell - originZ) / cell)
        if (tz < 0 || tz >= size) continue
        for (let c = 0; c < g.cols; c++) {
          const i = r * g.cols + c
          if (!g.inside[i]) continue
          const tx = Math.floor((g.minX + (c + 0.5) * cell - originX) / cell)
          if (tx < 0 || tx >= size) continue
          const target = g.seen[i]
          const v = e[i] + Math.sign(target - e[i]) * Math.min(Math.abs(target - e[i]), step)
          e[i] = v
          if (v !== target) easing = true
          mask.set(tx, tz, v, g.explored[i] === 1)
        }
      }
    }
    // Rooms that left the area start from their state next time.
    for (const id of eased.current.keys()) if (!near.has(id)) eased.current.delete(id)
    s.easing = easing
    mask.commit()
  })

  return null
}

function overlaps(g: RoomGrid, cell: number, originX: number, originZ: number, span: number): boolean {
  return g.minX + g.cols * cell >= originX && g.minX <= originX + span && g.minZ + g.rows * cell >= originZ && g.minZ <= originZ + span
}
