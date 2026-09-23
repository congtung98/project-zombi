import type { EntityId, ZombieAIState } from '../../types'

export type GameEvents = {
  'player:damaged': { amount: number; health: number; sourceId: EntityId }
  'player:died': { sourceId: EntityId }
  'zombie:stateChanged': { id: EntityId; from: ZombieAIState; to: ZombieAIState }
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
