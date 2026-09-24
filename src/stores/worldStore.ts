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
  zombieIds: string[]
  setDoor: (id: string, state: DoorStatus) => void
  setContainerOpened: (id: string) => void
  addZombie: (id: string) => void
  removeZombie: (id: string) => void
  syncFromRuntime: (rt: GameRuntime) => void
  reset: () => void
}

export const useWorldStore = create<WorldUiState>((set) => ({
  doorStates: {},
  drops: [],
  containerOpened: {},
  zombieIds: [],
  setDoor: (id, state) => set((s) => ({ doorStates: { ...s.doorStates, [id]: state } })),
  setContainerOpened: (id) => set((s) => ({ containerOpened: { ...s.containerOpened, [id]: true } })),
  addZombie: (id) => set((s) => (s.zombieIds.includes(id) ? s : { zombieIds: [...s.zombieIds, id] })),
  removeZombie: (id) => set((s) => ({ zombieIds: s.zombieIds.filter((z) => z !== id) })),
  syncFromRuntime: (rt) => {
    const doorStates: Record<string, DoorStatus> = {}
    for (const d of rt.world.doors.values()) doorStates[d.id] = d.state
    const drops = Array.from(rt.world.containers.values()).flatMap((c) => c.position ? [{ id: c.id, position: { ...c.position } }] : [])
    const containerOpened: Record<string, boolean> = {}
    for (const c of rt.world.containers.values()) containerOpened[c.id] = c.opened
    set({ doorStates, drops, containerOpened, zombieIds: Array.from(rt.zombies.keys()) })
  },
  reset: () => set({ doorStates: {}, drops: [], containerOpened: {}, zombieIds: [] }),
}))
