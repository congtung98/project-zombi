import { create } from 'zustand'

/**
 * Bản sao (mirror) trạng thái thế giới cho React: chỉ những gì view cần
 * re-render khi thay đổi (cửa mở/đóng, container đã mở). Nguồn sự thật vẫn
 * là `runtime.world`; App cập nhật store này từ sự kiện của runtime.
 */
interface WorldUiState {
  doorOpen: Record<string, boolean>
  containerOpened: Record<string, boolean>
  setDoor: (id: string, open: boolean) => void
  setContainerOpened: (id: string) => void
  reset: () => void
}

export const useWorldStore = create<WorldUiState>((set) => ({
  doorOpen: {},
  containerOpened: {},
  setDoor: (id, open) => set((s) => ({ doorOpen: { ...s.doorOpen, [id]: open } })),
  setContainerOpened: (id) => set((s) => ({ containerOpened: { ...s.containerOpened, [id]: true } })),
  reset: () => set({ doorOpen: {}, containerOpened: {} }),
}))
