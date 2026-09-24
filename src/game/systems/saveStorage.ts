import type { SaveGame } from '../../types/save'

/**
 * Lưu một slot trong IndexedDB. Mỗi thao tác là một transaction riêng nên ghi
 * là nguyên tử (hoặc toàn bộ bản mới, hoặc giữ bản cũ). Mọi lỗi (quota, bị
 * chặn, dữ liệu hỏng) trả về kết quả rõ ràng thay vì ném ra ngoài.
 */
const DB_NAME = 'zombie-outbreak'
const DB_VERSION = 1
const STORE = 'saves'
export const SAVE_SLOT = 'slot-1'

export type StorageResult<T = void> = { ok: true; value: T } | { ok: false; error: string }

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Không mở được IndexedDB'))
    req.onblocked = () => reject(new Error('IndexedDB bị chặn bởi tab khác'))
  })
}

function describe(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === 'QuotaExceededError') return 'Hết dung lượng lưu trữ của trình duyệt.'
    return `${e.name}: ${e.message}`
  }
  if (e instanceof Error) return e.message
  return String(e)
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<StorageResult<T>> {
  if (!hasIndexedDb()) return { ok: false, error: 'Trình duyệt không hỗ trợ IndexedDB.' }
  let db: IDBDatabase | null = null
  try {
    db = await openDb()
    const value = await new Promise<T>((resolve, reject) => {
      const tx = db!.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req.result)
      tx.onerror = () => reject(tx.error ?? new Error('Transaction lỗi'))
      tx.onabort = () => reject(tx.error ?? new Error('Transaction bị hủy'))
    })
    return { ok: true, value }
  } catch (e) {
    return { ok: false, error: describe(e) }
  } finally {
    db?.close()
  }
}

export function writeSave(save: SaveGame, slot = SAVE_SLOT): Promise<StorageResult<IDBValidKey>> {
  return withStore('readwrite', (s) => s.put(save, slot))
}

/** Trả về dữ liệu thô (chưa kiểm tra); `undefined` nếu chưa có bản lưu. */
export function readSave(slot = SAVE_SLOT): Promise<StorageResult<unknown>> {
  return withStore<unknown>('readonly', (s) => s.get(slot))
}

export function deleteSave(slot = SAVE_SLOT): Promise<StorageResult<undefined>> {
  return withStore('readwrite', (s) => s.delete(slot))
}
