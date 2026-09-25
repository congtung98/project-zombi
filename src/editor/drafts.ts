/**
 * Editor drafts in their own IndexedDB database, separate from the game's `zombie-outbreak`
 * saves: the editor never opens the game database and the game never opens this one.
 * A draft is an exported pack (text) plus when it was saved; the key is the world ID.
 */
export const DRAFT_DB_NAME = 'zombie-outbreak-editor'
const DB_VERSION = 1
const STORE = 'drafts'

export interface DraftRecord {
  worldId: string
  name: string
  /** ISO time, shown in the Open dialog only (never part of content). */
  savedAt: string
  pack: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Trình duyệt không hỗ trợ IndexedDB'))
      return
    }
    const req = indexedDB.open(DRAFT_DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'worldId' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Không mở được IndexedDB'))
    req.onblocked = () => reject(new Error('IndexedDB bị chặn bởi tab khác'))
  })
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req.result)
      tx.onerror = () => reject(tx.error ?? new Error('Transaction lỗi'))
      tx.onabort = () => reject(tx.error ?? new Error('Transaction bị hủy'))
    })
  } finally {
    db.close()
  }
}

export async function saveDraft(draft: DraftRecord): Promise<void> {
  await run('readwrite', (s) => s.put(draft))
}

export async function listDrafts(): Promise<DraftRecord[]> {
  const all = await run<DraftRecord[]>('readonly', (s) => s.getAll())
  return all.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))
}

export async function readDraft(worldId: string): Promise<DraftRecord | undefined> {
  return run<DraftRecord | undefined>('readonly', (s) => s.get(worldId))
}

export async function deleteDraft(worldId: string): Promise<void> {
  await run('readwrite', (s) => s.delete(worldId))
}
