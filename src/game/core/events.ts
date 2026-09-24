import type { ItemEffect, ItemId } from '../entities/items'
import type { UseItemFailure } from '../systems/survival'
import type { EntityId, ZombieAIState } from '../../types'

export type GameEvents = {
  'player:damaged': { amount: number; health: number; sourceId: EntityId }
  'player:died': { sourceId: EntityId }
  'zombie:stateChanged': { id: EntityId; from: ZombieAIState; to: ZombieAIState }
  'zombie:damaged': { id: EntityId; amount: number; health: number }
  'zombie:died': { id: EntityId; sourceId: EntityId }
  /** Người chơi vung gậy; `hitIds` là các zombie trúng đòn (có thể rỗng). */
  'player:attacked': { hitIds: EntityId[] }
  'player:pushed': { hitIds: EntityId[] }
  'door:toggled': { id: string; open: boolean }
  'container:opened': { id: string; name: string; firstTime: boolean }
  'container:closed': { id: string }
  /** Túi người chơi, panel container hoặc trạng thái mở/đóng UI đổi; UI chụp snapshot mới. */
  'inventory:changed': { inventoryOpen: boolean; containerId: string | null }
  'item:used': { itemId: ItemId; name: string; effect: ItemEffect }
  'item:useFailed': { itemId: ItemId; name: string; reason: UseItemFailure }
}

type Listener<T> = (payload: T) => void

interface QueuedEvent<E, K extends keyof E = keyof E> {
  type: K
  payload: E[K]
}

/**
 * Event bus có hàng đợi: simulation `queue()` trong tick, rồi `flush()` ở
 * bước "phát sự kiện" để listener không thấy trạng thái nửa chừng.
 */
export class EventBus<E extends Record<string, unknown>> {
  private listeners = new Map<keyof E, Set<Listener<unknown>>>()
  private queued: QueuedEvent<E>[] = []

  on<K extends keyof E>(type: K, fn: Listener<E[K]>): () => void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(fn as Listener<unknown>)
    return () => {
      set.delete(fn as Listener<unknown>)
    }
  }

  queue<K extends keyof E>(type: K, payload: E[K]): void {
    this.queued.push({ type, payload })
  }

  flush(): void {
    if (this.queued.length === 0) return
    const batch = this.queued
    this.queued = []
    for (const evt of batch) {
      const set = this.listeners.get(evt.type)
      if (!set) continue
      for (const fn of set) fn(evt.payload)
    }
  }

  clear(): void {
    this.queued = []
  }
}
