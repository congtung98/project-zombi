import { describe, expect, it } from 'vitest'
import { bundledWorldCatalog, bundledWorldFiles, REGISTERED_LOOT_TABLES, type BundledWorldEntry } from '../../map/content'
import { updateWorld } from '../../map/editor/commands'
import { forkDocument } from '../../map/editor/document'
import { documentFromFiles } from '../../map/editor/pack'
import { validateWorldDocument } from '../../map/validate'
import type { MapData } from './mapData'
import { DEFAULT_WORLD_ID, menuWorlds, selectWorld, type WorldRequest } from './worldChoice'

const entry = (worldId: string, name = worldId, listed = true): BundledWorldEntry => ({ worldId, name, listed, size: { x: 50, z: 50 } })
const CATALOG = [entry(DEFAULT_WORLD_ID, 'Khu phố 50 m'), entry('town-42', 'Thị trấn 42'), entry('lab', 'Lab', false), entry('broken', 'Hỏng')]
const fake = (id: string) => ({ id }) as MapData

function request(over: Partial<WorldRequest> = {}): WorldRequest {
  return {
    url: null,
    stored: null,
    catalog: CATALOG,
    load: (id) => {
      if (id === 'broken') throw new Error('Map content invalid (1 error)')
      return fake(id)
    },
    loadDefault: () => fake(DEFAULT_WORLD_ID),
    strictUrl: false,
    ...over,
  }
}

describe('world choice', () => {
  it('plays the default world when nothing was picked', () => {
    expect(selectWorld(request())).toEqual({ map: fake(DEFAULT_WORLD_ID), source: 'default' })
  })

  it('plays the stored choice, and the URL over it', () => {
    expect(selectWorld(request({ stored: 'town-42' }))).toEqual({ map: fake('town-42'), source: 'stored' })
    expect(selectWorld(request({ stored: 'town-42', url: 'lab' }))).toEqual({ map: fake('lab'), source: 'url' })
    expect(selectWorld(request({ stored: 'town-42', url: DEFAULT_WORLD_ID }))).toEqual({ map: fake(DEFAULT_WORLD_ID), source: 'url' })
  })

  it('falls back to the default world with a notice when the stored world is gone or broken', () => {
    const gone = selectWorld(request({ stored: 'deleted-town' }))
    expect(gone.map.id).toBe(DEFAULT_WORLD_ID)
    expect(gone.source).toBe('default')
    expect(gone.notice).toContain('deleted-town')
    const broken = selectWorld(request({ stored: 'broken' }))
    expect(broken.map.id).toBe(DEFAULT_WORLD_ID)
    expect(broken.notice).toContain('Map content invalid')
  })

  it('a bad ?world= throws in dev (strict) and falls back in the production game', () => {
    expect(() => selectWorld(request({ url: 'broken', strictUrl: true }))).toThrow('Map content invalid')
    expect(() => selectWorld(request({ url: 'nope', strictUrl: true }))).toThrow('nope')
    expect(selectWorld(request({ url: 'nope' })).notice).toContain('nope')
    // A strict URL never hides a stored choice's failure mode: stored worlds always fall back.
    expect(selectWorld(request({ stored: 'broken', strictUrl: true })).map.id).toBe(DEFAULT_WORLD_ID)
  })

  it('menu lists listed worlds, the default first, then by name; hidden ones in dev or when playing them', () => {
    expect(menuWorlds(CATALOG, DEFAULT_WORLD_ID, false).map((w) => w.worldId)).toEqual([DEFAULT_WORLD_ID, 'broken', 'town-42'])
    expect(menuWorlds(CATALOG, DEFAULT_WORLD_ID, true).map((w) => w.worldId)).toEqual([DEFAULT_WORLD_ID, 'broken', 'lab', 'town-42'])
    expect(menuWorlds(CATALOG, 'lab', false).map((w) => w.worldId)).toContain('lab')
  })

  it('catalog reads name, listed flag and play area of the bundled worlds', () => {
    const catalog = bundledWorldCatalog()
    expect(catalog.map((w) => w.worldId)).toEqual([...catalog.map((w) => w.worldId)].sort())
    expect(catalog.find((w) => w.worldId === DEFAULT_WORLD_ID)).toEqual({ worldId: DEFAULT_WORLD_ID, name: 'Khu phố 50 m', listed: true, size: { x: 50, z: 50 } })
  })
})

describe('world.json listed flag', () => {
  const open = () => {
    const r = documentFromFiles(bundledWorldFiles(DEFAULT_WORLD_ID), { lootTables: REGISTERED_LOOT_TABLES })
    if (!r.ok) throw new Error(r.error)
    return r.doc
  }

  it('is optional and must be a boolean', () => {
    const world = open().world
    expect(validateWorldDocument(world)).toEqual([])
    expect(validateWorldDocument({ ...world, listed: false })).toEqual([])
    expect(validateWorldDocument({ ...world, listed: 'no' }).map((i) => i.path)).toEqual(['world.json#/listed'])
  })

  it('the editor writes it only for hidden worlds, and a fork is listed again', () => {
    const doc = open()
    const hidden = updateWorld(doc, { listed: false })
    if (!hidden.ok) throw new Error(hidden.error)
    expect(hidden.doc.world.listed).toBe(false)
    const shown = updateWorld(hidden.doc, { listed: true })
    if (!shown.ok) throw new Error(shown.error)
    expect('listed' in shown.doc.world).toBe(false)
    expect('listed' in forkDocument(hidden.doc, 'copy', 'Copy').world).toBe(false)
  })
})
