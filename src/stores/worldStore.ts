import { create } from 'zustand'
import type { GameRuntime } from '../game/core/runtime'
import type { DoorStatus } from '../game/world/doors'
import type { Vec3 } from '../types'

/**
 * Bản sao (mirror) trạng thái thế giới cho React: chỉ những gì view cần
 * re-render khi thay đổi (cửa mở/đóng, container đã mở, danh sách zombie).
 * Nguồn sự thật vẫn là `runtime`; App cập nhật store này từ sự kiện, và
 * `syncFromRuntime` chụp lại toàn bộ khi bắt đầu ván mới hoặc load.
 */
interface WorldUiState {
  doorStates: Record<string, DoorStatus>
  drops: { id: string; position: Vec3 }[]
  containerOpened: Record<string, boolean>
  /** Zombies with a visual (R2: every level except DORMANT, dead ones until their corpse is removed). */
  zombieIds: string[]
  /** Zombies with a kinematic physics body (R2: ACTIVE and alive). */
  zombieBodyIds: string[]
  setDoor: (id: string, state: DoorStatus) => void
  setContainerOpened: (id: string) => void
  /** Recompute both zombie lists from the runtime (after spawn, removal, death or a level change). */
  refreshZombies: (rt: GameRuntime) => void
  syncFromRuntime: (rt: GameRuntime) => void
  reset: () => void
}

export const useWorldStore = create<WorldUiState>((set) => ({
  doorStates: {},
  drops: [],
  containerOpened: {},
  zombieIds: [],
  zombieBodyIds: [],
  setDoor: (id, state) => set((s) => ({ doorStates: { ...s.doorStates, [id]: state } })),
  setContainerOpened: (id) => set((s) => ({ containerOpened: { ...s.containerOpened, [id]: true } })),
  refreshZombies: (rt) => set((s) => {
    const { zombieIds, zombieBodyIds } = zombieLists(rt)
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i])
    return same(zombieIds, s.zombieIds) && same(zombieBodyIds, s.zombieBodyIds) ? s : { zombieIds, zombieBodyIds }
  }),
  syncFromRuntime: (rt) => {
    const doorStates: Record<string, DoorStatus> = {}
    for (const d of rt.world.doors.values()) doorStates[d.id] = d.state
    const drops = Array.from(rt.world.containers.values()).flatMap((c) => c.position ? [{ id: c.id, position: { ...c.position } }] : [])
    const containerOpened: Record<string, boolean> = {}
    for (const c of rt.world.containers.values()) containerOpened[c.id] = c.opened
    set({ doorStates, drops, containerOpened, ...zombieLists(rt) })
  },
  reset: () => set({ doorStates: {}, drops: [], containerOpened: {}, zombieIds: [], zombieBodyIds: [] }),
}))

function zombieLists(rt: GameRuntime): { zombieIds: string[]; zombieBodyIds: string[] } {
  const zombieIds: string[] = []
  const zombieBodyIds: string[] = []
  for (const z of rt.zombies.values()) {
    if (z.simLevel !== 'DORMANT') zombieIds.push(z.id)
    if (z.simLevel === 'ACTIVE' && z.ai !== 'DEAD') zombieBodyIds.push(z.id)
  }
  return { zombieIds, zombieBodyIds }
}
