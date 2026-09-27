import { describe, expect, it } from 'vitest'
import { bundledWorldFiles, bundledWorldIds, REGISTERED_LOOT_TABLES } from '../content'
import { deleteRecords } from './commands'
import { forkDocument } from './document'
import { exportPack, parsePack, validateDocument } from './pack'
import { applyCommand, initialEditState, redo, undo } from './session'
import { applyPatch, diffDocument, isEmptyPatch } from './docPatch'
import { generatorBlockReason, layoutWorldFromGeoJson, libraryCatalog, LIBRARY_WORLD } from './generator'
import { documentLayout, generatorStatus, LAYOUT_FILE, syncGenerated } from '../layout/worldSync'
import FIXTURE from '../../test/fixtures/layouts/wg1-town.geojson?raw'

/** WG4: the editor side of the world generator (no React): library, Q3 rule, import, history, drafts. */

const OPTS = { lootTables: REGISTERED_LOOT_TABLES }
const catalog = libraryCatalog(bundledWorldFiles(LIBRARY_WORLD))!
const request = { worldId: 'wg4-editor', name: 'WG4 editor', text: FIXTURE, file: 'wg1-town.geojson', mode: 'full' as const, seed: 1, profile: 'default' }

describe('WG4 editor: library and the Q3 rule', () => {
  it('reads the placeable prefabs of the hidden library world', () => {
    expect(catalog.id).toMatch(/^prefab-library@\d+$/)
    expect(catalog.prefabs.length).toBeGreaterThanOrEqual(10)
    expect(libraryCatalog(new Map())).toBeNull()
  })

  it('refuses to regenerate published worlds (content/maps), allows unpublished ones', () => {
    const ids = bundledWorldIds()
    expect(ids).toContain('neighborhood-50')
    expect(generatorBlockReason('neighborhood-50', ids)).toMatch(/Q3/)
    expect(generatorBlockReason('wg4-editor', ids)).toBeNull()
  })
})

describe('WG4 editor: a world from a GeoJSON reference', () => {
  const made = layoutWorldFromGeoJson(request, catalog, OPTS)
  if (!made.ok) throw new Error(made.error)
  const doc = made.doc

  it('imports, snaps, plans and builds: a valid world holding its layout', () => {
    expect(validateDocument(doc, OPTS).filter((i) => i.severity === 'error')).toEqual([])
    const layout = documentLayout(doc).layout!
    expect(layout.source.file).toBe('wg1-town.geojson')
    expect(layout.generated!.mode).toBe('full')
    expect([...doc.chunks.values()].reduce((n, c) => n + c.instances.length, 0)).toBeGreaterThan(60)
    expect(made.issues.some((i) => i.code === 'buildings')).toBe(true)
  })

  it('makes LAYOUT_ONLY worlds and clips to a test size', () => {
    // Q1: a clip that makes two junctions snap together is refused, never silently joined.
    const merged = layoutWorldFromGeoJson({ ...request, mode: 'layout-only', clip: { width: 250, depth: 250 } }, null, OPTS)
    expect(merged.ok || merged.error).toMatch(/nắn trùng/)
    const bare = layoutWorldFromGeoJson({ ...request, mode: 'layout-only', clip: { width: 300, depth: 300 } }, null, OPTS)
    expect(bare.ok).toBe(true)
    if (!bare.ok) return
    expect([...bare.doc.chunks.values()].reduce((n, c) => n + c.instances.length, 0)).toBe(0)
    expect(documentLayout(bare.doc).layout!.clip).not.toBeNull()
  })

  it('explains what is wrong with a bad reference', () => {
    const bad = layoutWorldFromGeoJson({ ...request, text: '{"type":' }, catalog, OPTS)
    expect(bad.ok).toBe(false)
    const empty = layoutWorldFromGeoJson({ ...request, text: '{"type":"FeatureCollection","features":[]}' }, catalog, OPTS)
    expect(empty.ok || empty.error).toMatch(/đường/)
    const noLib = layoutWorldFromGeoJson(request, null, OPTS)
    expect(noLib.ok).toBe(false)
  })

  it('goes through the editor history: one entry per action, undo restores the layout and records exactly', () => {
    let state = initialEditState(doc)
    const r = syncGenerated(doc, { kind: 'world', params: { seed: 5 } }, { catalog, validation: OPTS })
    if (!r.ok) throw new Error(r.error)
    state = applyCommand(state, 'Sinh lại world', { ok: true, doc: r.doc, selection: [] }).state
    expect(state.past).toHaveLength(1)
    expect(documentLayout(state.doc).layout!.plan!.params.seed).toBe(5)
    state = undo(state)
    expect(state.doc).toBe(doc)
    expect(documentLayout(state.doc).layout!.plan!.params.seed).toBe(1)
    state = redo(state)
    expect(state.doc).toBe(r.doc)
  })

  it('keeps the layout in drafts, exports and Save As; a hand deletion survives the round trip', () => {
    const id = [...doc.chunks.values()].flatMap((c) => c.instances)[0].instanceId
    const del = deleteRecords(doc, [id])
    if (!del.ok) throw new Error(del.error)
    const pack = JSON.parse(exportPack(del.doc)) as { files: Record<string, unknown> }
    expect(Object.keys(pack.files)).toContain(LAYOUT_FILE)
    const back = parsePack(exportPack(del.doc), OPTS)
    if (!back.ok) throw new Error(back.error)
    const layout = documentLayout(back.doc).layout!
    expect(generatorStatus(back.doc, layout).records.get(id)).toMatchObject({ state: 'modified', modified: 'deleted' })
    const copy = forkDocument(back.doc, 'wg4-copy', 'copy')
    expect(documentLayout(copy).layout).toEqual(layout)
    expect(generatorStatus(copy, layout).counts).toEqual(generatorStatus(back.doc, layout).counts)
  })

  it('WG5 worker path: a copy regenerated, only the changes sent back, applied onto the editor document', () => {
    // What the worker gets: a structured clone (no shared objects with the editor's document).
    const copy = structuredClone(doc)
    const r = syncGenerated(copy, { kind: 'parcels', parcels: [documentLayout(doc).layout!.plan!.parcels.find((q) => q.build && q.build.prefabId !== null)!.id] }, { catalog, validation: OPTS })
    if (!r.ok) throw new Error(r.error)
    const patch = structuredClone(diffDocument(copy, r.doc))
    expect(patch.chunks.length).toBeLessThan(doc.chunks.size / 4)
    const applied = applyPatch(doc, patch)
    const direct = syncGenerated(doc, { kind: 'parcels', parcels: [documentLayout(doc).layout!.plan!.parcels.find((q) => q.build && q.build.prefabId !== null)!.id] }, { catalog, validation: OPTS })
    if (!direct.ok) throw new Error(direct.error)
    expect(exportPack(applied)).toBe(exportPack(direct.doc))
    // Unchanged chunks are the editor's own objects: cheap history, nothing re-resolved.
    const same = [...applied.chunks].filter(([id, c]) => doc.chunks.get(id) === c).length
    expect(same).toBe(doc.chunks.size - patch.chunks.length)
    expect(isEmptyPatch(diffDocument(doc, doc))).toBe(true)
  })
})
