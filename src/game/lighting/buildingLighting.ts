import type { BuildingLightingConfig } from '../core/config'
import { daylightAt } from '../rendering/daylight'
import { isInsideRoom, onRoomStorey, type LampPlacement, type RoomPlacement } from '../world/buildings'
import { stairApproach } from '../world/floors'
import type { DoorStatus } from '../world/doors'
import { mapRooms, mapWindows, type MapData } from '../world/mapData'
import type { Vec3 } from '../../types'

/**
 * Building lighting (room graph, no GI): how much light each room gets, from
 *   windows (direct daylight) → rooms ← doors/openings (propagation, outdoors is a source) + lamps.
 * Pure numbers, event driven (doors, curtains, lamps, power, daylight steps), recomputed per dirty
 * building only. It consumes the day/night `outdoorLightLevel` and never reads the player's
 * facing, vision or camera; the renderer only turns `finalLightLevel` into indoor shading.
 */

/** The outdoors as a graph node: a light source reached through exterior doors. */
export const OUTDOOR = 'outdoor'

/** Day/night adapter: 0 = pitch dark, 1 = noon (≈ 0.05 at night with the default config). */
export function outdoorLightLevel(timeOfDay: number, cfg: BuildingLightingConfig): number {
  return cfg.nightOutdoorLevel + (1 - cfg.nightOutdoorLevel) * daylightAt(timeOfDay)
}

export interface LightingWindow {
  id: string
  roomId: string
  /** Transmission × size share (before outdoor light, curtain and barricade). */
  daylightFactor: number
}

/** A door or opening joining two rooms, or a room and the outdoors. */
export interface LightingEdge {
  doorId: string
  a: string
  b: string
  /** M11b: fixed transmission of an opening that is always open (a stairwell); omitted = the door's state. */
  transmission?: number
}

export interface LightingBuilding {
  id: string
  rooms: RoomPlacement[]
  windows: LightingWindow[]
  edges: LightingEdge[]
  lamps: LampPlacement[]
  lightingDirty: boolean
}

export interface RoomLight {
  roomId: string
  buildingId: string
  /** Sum of window contributions before scaling (debug: window exposure). */
  windowLight: number
  directOutdoorLight: number
  propagatedLight: number
  artificialLight: number
  finalLightLevel: number
  /** Light colour 0..1 (daylight vs lamps by their share), for indoor tinting. */
  color: [number, number, number]
}

/** World state the lighting reads (never writes). */
export interface LightingInputs {
  doorState(id: string): DoorStatus | undefined
  curtainClosed(id: string): boolean
  lampOn(id: string): boolean
  electricity(): boolean
  /** Light factor of a barricaded window (P2-S6 hook); 1 = not barricaded. */
  windowBarricade?(id: string): number
}

export function doorTransmission(state: DoorStatus | undefined, cfg: BuildingLightingConfig): number {
  if (state === 'open') return cfg.defaultOpenDoorTransmission
  if (state === 'destroyed') return cfg.destroyedDoorTransmission
  return cfg.defaultClosedDoorTransmission
}

/** windowLight = outdoor × daylightFactor × curtain × barricade. */
export function windowContribution(outdoor: number, win: LightingWindow, curtainClosed: boolean, barricade: number, cfg: BuildingLightingConfig): number {
  return outdoor * win.daylightFactor * (curtainClosed ? cfg.closedCurtainTransmission : 1) * barricade
}

/**
 * Room containing a point; null = outdoors. With `y` (feet or sample height, M11b) only rooms of
 * that storey count; without it the first room over the ground point (single-storey callers).
 */
export function roomAt(rooms: readonly RoomPlacement[], x: number, z: number, y?: number): RoomPlacement | null {
  for (const r of rooms) if ((y === undefined || onRoomStorey(r, y)) && isInsideRoom(r.bounds, x, z, r.outline)) return r
  return null
}

/**
 * Graph of every building of a map. Windows and doors find their rooms by sampling a point on
 * each side (so partitions, exterior doors and future openings need no manual wiring).
 */
export function buildLightingBuildings(map: MapData, cfg: BuildingLightingConfig): LightingBuilding[] {
  const rooms = mapRooms(map)
  const windows = mapWindows(map)
  return map.buildings.map((b) => {
    const own = rooms.filter((r) => r.buildingId === b.id)
    const lightingWindows: LightingWindow[] = []
    for (const w of windows.filter((x) => x.buildingId === b.id)) {
      const room = roomAt(own, w.center.x + w.inward.x * 0.4, w.center.z + w.inward.z * 0.4, w.center.y - (w.sill + w.head) / 2)
      if (!room) continue
      const area = w.width * (w.head - w.sill)
      lightingWindows.push({ id: w.id, roomId: room.id, daylightFactor: cfg.defaultWindowTransmission * Math.min(1, area / cfg.referenceWindowArea) })
    }
    const edges: LightingEdge[] = []
    for (const d of map.doors.filter((x) => x.buildingId === b.id)) {
      const alongX = d.hinge.x !== d.center.x
      const nx = alongX ? 0 : 0.6
      const nz = alongX ? 0.6 : 0
      const a = roomAt(own, d.center.x - nx, d.center.z - nz, d.center.y)?.id ?? OUTDOOR
      const c = roomAt(own, d.center.x + nx, d.center.z + nz, d.center.y)?.id ?? OUTDOOR
      if (a !== c) edges.push({ doorId: d.id, a, b: c })
    }
    // M11b: a stairwell is an open opening between the room at its foot and the room at its head.
    for (const s of (map.stairs ?? []).filter((x) => x.buildingId === b.id)) {
      const foot = stairApproach(s, 0, 0.4)
      const head = stairApproach(s, 1, 0.4)
      const a = roomAt(own, foot.x, foot.z, foot.y)?.id
      const c = roomAt(own, head.x, head.z, head.y)?.id
      if (a && c && a !== c) edges.push({ doorId: s.id, a, b: c, transmission: cfg.defaultOpenDoorTransmission })
    }
    return { id: b.id, rooms: own, windows: lightingWindows, edges, lamps: own.flatMap((r) => (r.lamp ? [r.lamp] : [])), lightingDirty: true }
  })
}

/**
 * Solve one building: direct window light per room, graph propagation (sources = the outdoors and
 * every lit room; depth ≤ maxPropagationDepth, × transmission × decay per step, below the threshold
 * stops, no revisiting a room on the same path, best arrival wins), lamps, then
 * final = 1 − (1 − direct)(1 − propagated)(1 − artificial), clamped to [minIndoorLight, 1].
 */
export function solveBuilding(b: LightingBuilding, outdoor: number, inputs: LightingInputs, cfg: BuildingLightingConfig): Map<string, RoomLight> {
  const windowLight = new Map<string, number>()
  for (const w of b.windows) {
    const c = windowContribution(outdoor, w, inputs.curtainClosed(w.id), inputs.windowBarricade?.(w.id) ?? 1, cfg)
    windowLight.set(w.roomId, (windowLight.get(w.roomId) ?? 0) + c)
  }
  const direct = new Map<string, number>()
  for (const r of b.rooms) direct.set(r.id, clamp01((windowLight.get(r.id) ?? 0) * cfg.windowExposureScale) * cfg.roomDepthFactor)

  const adjacency = new Map<string, { target: string; transmission: number }[]>()
  const link = (from: string, target: string, transmission: number) => {
    const list = adjacency.get(from) ?? []
    list.push({ target, transmission })
    adjacency.set(from, list)
  }
  for (const e of b.edges) {
    const t = e.transmission ?? doorTransmission(inputs.doorState(e.doorId), cfg)
    link(e.a, e.b, t)
    link(e.b, e.a, t)
  }

  const propagated = new Map<string, number>()
  const walk = (node: string, light: number, depth: number, visited: Set<string>) => {
    if (depth >= cfg.maxPropagationDepth) return
    for (const edge of adjacency.get(node) ?? []) {
      // The outdoors is a source only: light never travels out and back in through it.
      if (edge.target === OUTDOOR || visited.has(edge.target)) continue
      const next = light * edge.transmission * cfg.propagationDecay
      if (next < cfg.minPropagationLight) continue
      if (next > (propagated.get(edge.target) ?? 0)) propagated.set(edge.target, next)
      visited.add(edge.target)
      walk(edge.target, next, depth + 1, visited)
      visited.delete(edge.target)
    }
  }
  walk(OUTDOOR, outdoor, 0, new Set([OUTDOOR]))
  for (const r of b.rooms) {
    const d = direct.get(r.id) ?? 0
    if (d >= cfg.minPropagationLight) walk(r.id, d, 0, new Set([r.id]))
  }

  const power = inputs.electricity()
  const result = new Map<string, RoomLight>()
  const daylightRgb = hexToRgb(cfg.daylightColor)
  for (const r of b.rooms) {
    let artificial = 0
    const lampRgb: [number, number, number] = [0, 0, 0]
    for (const lamp of b.lamps) {
      if (lamp.roomId !== r.id || !inputs.lampOn(lamp.id) || (lamp.requiresElectricity && !power)) continue
      artificial += lamp.intensity
      const c = hexToRgb(lamp.color)
      for (let i = 0; i < 3; i++) lampRgb[i] += c[i] * lamp.intensity
    }
    const lampWeight = artificial
    artificial = Math.min(1, artificial)
    const d = direct.get(r.id) ?? 0
    const p = propagated.get(r.id) ?? 0
    const final = Math.min(1, Math.max(cfg.minIndoorLight, 1 - (1 - d) * (1 - p) * (1 - artificial)))
    // Colour: daylight share vs lamp share.
    const day = d + p
    const color: [number, number, number] = [1, 1, 1]
    if (day + artificial > 1e-6) {
      for (let i = 0; i < 3; i++) {
        const lamp = lampWeight > 0 ? lampRgb[i] / lampWeight : 1
        color[i] = (daylightRgb[i] * day + lamp * artificial) / (day + artificial)
      }
    }
    result.set(r.id, {
      roomId: r.id,
      buildingId: b.id,
      windowLight: windowLight.get(r.id) ?? 0,
      directOutdoorLight: d,
      propagatedLight: p,
      artificialLight: artificial,
      finalLightLevel: final,
      color,
    })
  }
  return result
}

export interface LightingStats {
  /** Building solves since start (event driven, not per frame). */
  recalculations: number
  /** Daylight steps that marked every building dirty. */
  daylightSteps: number
}

/**
 * Owns the lighting graph and the derived room light. `update()` (once per tick) re-solves dirty
 * buildings only; `revision` changes whenever any room value changed, so renderers upload uniforms
 * on change instead of every frame. Derived values are never saved.
 */
export class BuildingLightingSystem {
  readonly stats: LightingStats = { recalculations: 0, daylightSteps: 0 }
  /** Increments after any recomputation (renderer/debug re-read on change). */
  revision = 0
  private readonly buildings = new Map<string, LightingBuilding>()
  private readonly rooms: RoomPlacement[] = []
  private readonly roomLight = new Map<string, RoomLight>()
  private readonly cfg: BuildingLightingConfig
  private readonly inputs: LightingInputs
  private outdoor = 1
  private appliedOutdoor = Number.NaN

  constructor(cfg: BuildingLightingConfig, inputs: LightingInputs, buildings: LightingBuilding[] = []) {
    this.cfg = cfg
    this.inputs = inputs
    for (const b of buildings) this.registerBuilding(b)
  }

  get outdoorLightLevel(): number {
    return this.outdoor
  }

  registerBuilding(building: LightingBuilding): void {
    this.unregisterBuilding(building.id)
    building.lightingDirty = true
    this.buildings.set(building.id, building)
    this.rooms.push(...building.rooms)
  }

  unregisterBuilding(buildingId: string): void {
    const old = this.buildings.get(buildingId)
    if (!old) return
    this.buildings.delete(buildingId)
    for (const r of old.rooms) {
      this.roomLight.delete(r.id)
      const i = this.rooms.indexOf(r)
      if (i >= 0) this.rooms.splice(i, 1)
    }
    this.revision += 1
  }

  allBuildings(): IterableIterator<LightingBuilding> {
    return this.buildings.values()
  }

  markDirty(buildingId: string): void {
    const b = this.buildings.get(buildingId)
    if (b) b.lightingDirty = true
  }

  markAllDirty(): void {
    for (const b of this.buildings.values()) b.lightingDirty = true
  }

  /** A door changed (open/close/break): only the building(s) it belongs to. */
  markDoorDirty(doorId: string): void {
    for (const b of this.buildings.values()) if (b.edges.some((e) => e.doorId === doorId)) b.lightingDirty = true
  }

  markWindowDirty(windowId: string): void {
    for (const b of this.buildings.values()) if (b.windows.some((w) => w.id === windowId)) b.lightingDirty = true
  }

  markLampDirty(lampId: string): void {
    for (const b of this.buildings.values()) if (b.lamps.some((l) => l.id === lampId)) b.lightingDirty = true
  }

  /** Throttled daylight: rooms follow the sky only in steps of `daylightRecalcThreshold`. */
  updateOutdoorLight(level: number): void {
    this.outdoor = level
    if (Number.isNaN(this.appliedOutdoor) || Math.abs(level - this.appliedOutdoor) >= this.cfg.daylightRecalcThreshold) {
      this.appliedOutdoor = level
      this.stats.daylightSteps += 1
      this.markAllDirty()
    }
  }

  /** Re-solve dirty buildings (call once per tick). */
  update(): void {
    let changed = false
    for (const b of this.buildings.values()) {
      if (!b.lightingDirty) continue
      this.recalculateBuilding(b.id)
      changed = true
    }
    if (changed) this.revision += 1
  }

  recalculateBuilding(buildingId: string): void {
    const b = this.buildings.get(buildingId)
    if (!b) return
    const level = Number.isNaN(this.appliedOutdoor) ? this.outdoor : this.appliedOutdoor
    for (const [id, light] of solveBuilding(b, level, this.inputs, this.cfg)) this.roomLight.set(id, light)
    b.lightingDirty = false
    this.stats.recalculations += 1
  }

  getRoomLight(roomId: string): RoomLight | undefined {
    return this.roomLight.get(roomId)
  }

  /** Room at an entity's feet (its storey, M11b). */
  getRoomAtPosition(position: Vec3): RoomPlacement | null {
    return roomAt(this.rooms, position.x, position.z, position.y)
  }

  /** Light where an entity stands: its room's final level, or the outdoor level outside. */
  getLightAtPosition(position: Vec3): number {
    const room = this.getRoomAtPosition(position)
    return room ? this.roomLight.get(room.id)?.finalLightLevel ?? this.outdoor : this.outdoor
  }

  roomsList(): readonly RoomPlacement[] {
    return this.rooms
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
