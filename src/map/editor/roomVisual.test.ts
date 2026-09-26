import { describe, expect, it } from 'vitest'
import { bundledWorldFiles, REGISTERED_LOOT_TABLES } from '../content'
import { checkWorldDocuments } from '../validate'
import type { CommandResult } from './commands'
import { documentFiles, type MapDocument } from './document'
import { documentFromFiles } from './pack'
import { updatePrefabItem } from './prefabCommands'

/**
 * G2: a room's floor surface and colour (`visual`) set in the prefab editor survive export, validate,
 * and come off again cleanly (the Inspector's "Sàn" / "Màu sàn" fields send these patches).
 */

const OPTS = { lootTables: REGISTERED_LOOT_TABLES }
const P = 'building/lab-house'

function ok(r: CommandResult): Extract<CommandResult, { ok: true }> {
  if (!r.ok) throw new Error(r.error)
  return r
}

function lab(): MapDocument {
  const r = documentFromFiles(bundledWorldFiles('graphics-lab'), OPTS)
  if (!r.ok) throw new Error(r.error)
  return r.doc
}

const room = (doc: MapDocument, id: string) => doc.prefabs.get(P)!.rooms.find((r) => r.localId === id)!
const issues = (doc: MapDocument) => {
  const files = new Map(documentFiles(doc))
  return checkWorldDocuments((p) => files.get(p), OPTS).issues.filter((i) => i.severity === 'error')
}

describe('room floor in the prefab editor (G2)', () => {
  it('loads the lab kitchen tile, sets a floor and colour, clears it, and exports what it shows', () => {
    let doc = lab()
    expect(room(doc, 'kitchen').visual).toEqual({ floor: 'tile' })
    doc = ok(updatePrefabItem(doc, P, 'bedroom', { visual: { floor: 'concrete' } })).doc
    doc = ok(updatePrefabItem(doc, P, 'bedroom', { visual: { ...room(doc, 'bedroom').visual, floorColor: '#8d8a84' } })).doc
    expect(room(doc, 'bedroom').visual).toEqual({ floor: 'concrete', floorColor: '#8d8a84' })
    expect(issues(doc)).toEqual([])
    // Round trip through the exported files keeps it.
    const again = documentFromFiles(new Map(documentFiles(doc)), OPTS)
    if (!again.ok) throw new Error(again.error)
    expect(room(again.doc, 'bedroom').visual).toEqual({ floor: 'concrete', floorColor: '#8d8a84' })
    // "Mặc định" removes the field.
    doc = ok(updatePrefabItem(doc, P, 'bedroom', { visual: undefined })).doc
    expect('visual' in room(doc, 'bedroom')).toBe(false)
  })
})
