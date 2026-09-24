import { create } from 'zustand'
import type { GameRuntime } from '../game/core/runtime'

/**
 * Bản sao (mirror) trạng thái thế giới cho React: chỉ những gì view cần
 * re-render khi thay đổi (cửa mở/đóng, container đã mở, danh sách zombie).
 * Nguồn sự thật vẫn là `runtime`; App cập nhật store này từ sự kiện, và
 * `syncFromRuntime` chụp lại toàn bộ khi bắt đầu ván mới hoặc load.
 */
interface WorldUiState {
  doorOpen: Record<string, boolean>
  containerOpened: Record<string, boolean>
  zombieIds: string[]
  setDoor: (id: string, open: boolean) => void
  setContainerOpened: (id: string) => void
  addZombie: (id: string) => void
  removeZombie: (id: string) => void
  syncFromRuntime: (rt: GameRuntime) => void
  reset: () => void
}

export const useWorldStore = create<WorldUiState>((set) => ({
  doorOpen: {},
  containerOpened: {},
  zombieIds: [],
  setDoor: (id, open) => set((s) => ({ doorOpen: { ...s.doorOpen, [id]: open } })),
  setContainerOpened: (id) => set((s) => ({ containerOpened: { ...s.containerOpened, [id]: true } })),
  addZombie: (id) => set((s) => (s.zombieIds.includes(id) ? s : { zombieIds: [...s.zombieIds, id] })),
  removeZombie: (id) => set((s) => ({ zombieIds: s.zombieIds.filter((z) => z !== id) })),
  syncFromRuntime: (rt) => {
    const doorOpen: Record<string, boolean> = {}
    for (const d of rt.world.doors.values()) doorOpen[d.id] = d.open
    const containerOpened: Record<string, boolean> = {}
    for (const c of rt.world.containers.values()) containerOpened[c.id] = c.opened
    set({ doorOpen, containerOpened, zombieIds: Array.from(rt.zombies.keys()) })
  },
  reset: () => set({ doorOpen: {}, containerOpened: {}, zombieIds: [] }),
}))
