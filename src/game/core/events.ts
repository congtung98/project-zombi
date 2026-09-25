import type { ItemEffect, ItemId } from '../entities/items'
import type { SimLevel } from '../entities/zombie'
import type { UseItemFailure } from '../systems/survival'
import type { CraftFailure, RepairPreview } from '../systems/crafting'
import type { ActionCancelReason } from '../systems/timedAction'
import type { EntityId, ZombieAIState } from '../../types'

export type GameEvents = {
  'player:damaged': { amount: number; health: number; sourceId: EntityId }
  'player:died': { sourceId: EntityId }
  'zombie:stateChanged': { id: EntityId; from: ZombieAIState; to: ZombieAIState }
  'zombie:damaged': { id: EntityId; amount: number; health: number }
  'zombie:died': { id: EntityId; sourceId: EntityId }
  /** Zombie mới được sinh (spawn có giới hạn); view thêm body. */
  'zombie:spawned': { id: EntityId }
  /** Xác zombie bị dọn khỏi danh sách; view gỡ body. */
  'zombie:removed': { id: EntityId }
  /** R2: simulation level changed (views mount/unmount the visual and the physics body). */
  'zombie:levelChanged': { id: EntityId; from: SimLevel; to: SimLevel }
  /** Người chơi vung vũ khí; `hitIds` là các zombie trúng đòn (có thể rỗng), `damage` mỗi mục tiêu. */
  'player:attacked': { hitIds: EntityId[]; damage: number; weaponId: string | null }
  /** Bấm đánh khi tay không: UI nhắc tìm vũ khí / dùng Space đẩy. */
  'player:unarmed': Record<string, never>
  'item:equipped': { id: string | null; itemId: ItemId | null }
  /** Condition đổi sau một đòn trúng; UI chỉ đồng bộ, không phát âm pickup. */
  'weapon:worn': { id: string; itemId: ItemId; condition: number }
  'weapon:lowCondition': { id: string; itemId: ItemId; name: string }
  'weapon:broken': { id: string; itemId: ItemId; name: string }
  'player:pushed': { hitIds: EntityId[] }
  /** A player footstep landed (only while the footsteps are audible to zombies, P2-S5 noise). */
  'player:footstep': { running: boolean }
  'door:toggled': { id: string; open: boolean }
  /** Building lighting: a lamp switched, a curtain drawn, grid power changed. */
  'light:changed': { id: string; on: boolean }
  'curtain:changed': { id: string; closed: boolean }
  'power:changed': { on: boolean }
  'door:changed': { id: string; state: import('../world/doors').DoorStatus }
  /** P2-S5: a zombie bash landed on a closed door. */
  'door:damaged': { id: string; hp: number; maxHp: number; sourceId: EntityId }
  /** The bash that took the door to 0 HP (the leaf, collider and nav blocker are gone). */
  'door:destroyed': { id: string; sourceId: EntityId }
  /** Horde director moved a zone's group; `moving` = members that started walking now. */
  'horde:migrated': { from: string; to: string; ids: EntityId[]; moving: EntityId[] }
  'drops:changed': Record<string, never>
  'container:opened': { id: string; name: string; firstTime: boolean }
  'container:closed': { id: string }
  /** Túi người chơi, panel container hoặc trạng thái mở/đóng UI đổi; UI chụp snapshot mới. */
  'inventory:changed': { inventoryOpen: boolean; containerId: string | null }
  'item:used': { itemId: ItemId; name: string; effect: ItemEffect }
  'item:useFailed': { itemId: ItemId; name: string; reason: UseItemFailure }
  /** P2-S4 timed craft/repair: started (reserved), rejected at start, cancelled, failed at commit, completed. */
  'action:started': { id: number; kind: 'craft' | 'repair'; label: string; duration: number }
  'action:rejected': { label: string; reason: CraftFailure | 'busy' | 'dead' }
  'action:cancelled': { id: number; label: string; reason: ActionCancelReason }
  'action:failed': { id: number; label: string; reason: CraftFailure }
  'action:completed': {
    id: number
    kind: 'craft' | 'repair'
    recipeId: string
    label: string
    outputItemId: ItemId | null
    outputId: string | null
    repair: RepairPreview | null
  }
  /** Tried to drop/store/use an item reserved by the running action. */
  'item:reserved': { itemId: ItemId; name: string; label: string }
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
