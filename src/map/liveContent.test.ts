import { describe, expect, it } from 'vitest'
import { BUNDLED_FILES } from './bundledFiles'
import { bundledWorldCatalog, loadWorld, REGISTERED_LOOT_TABLES } from './content'
import { DEFAULT_WORLD_ID } from '../game/world/worldChoice'

/**
 * Tests play the frozen neighbourhood (`src/test/fixtures/maps/`); this file checks the live
 * `content/maps/` the game ships: every world loads (validator + resolver), the default world
 * exists and is listed. `npm run map:check -- --deep` runs the deeper game-system checks.
 */
const LIVE = import.meta.glob<unknown>('/content/maps/**/*.json', { eager: true, import: 'default' })
const FROZEN = import.meta.glob<unknown>('/src/test/fixtures/maps/**/*.json', { eager: true, import: 'default' })

const liveWorlds = Object.keys(LIVE)
  .map((p) => /^\/content\/maps\/([^/]+)\/world\.json$/.exec(p)?.[1])
  .filter((id): id is string => !!id)
  .sort()

function liveReader(worldId: string) {
  return (path: string) => {
    const value = LIVE[`/content/maps/${worldId}/${path}`]
    if (value === undefined) throw new Error(`Missing content file ${worldId}/${path}`)
    return value
  }
}

describe('live content (content/maps)', () => {
  it('has the default world, listed', () => {
    expect(liveWorlds).toContain(DEFAULT_WORLD_ID)
    const world = LIVE[`/content/maps/${DEFAULT_WORLD_ID}/world.json`] as { listed?: boolean }
    expect(world.listed).not.toBe(false)
  })

  it.each(liveWorlds)('%s loads without errors', (worldId) => {
    const { map, docs } = loadWorld(liveReader(worldId))
    expect(docs.world.worldId).toBe(worldId)
    expect(map.id).toBe(worldId)
    expect(map.playerSpawn).toBeDefined()
  })

  it('the lab world is hidden from the menu', () => {
    expect(bundledWorldCatalog().find((w) => w.worldId === 'neighborhood-50-lab')?.listed).toBe(false)
  })
})

describe('frozen test neighbourhood', () => {
  it('replaces the live neighbourhood in tests, file for file', () => {
    const frozen = Object.keys(FROZEN)
    expect(frozen).toContain('/src/test/fixtures/maps/neighborhood-50/world.json')
    for (const p of frozen) expect(BUNDLED_FILES[p.replace('/src/test/fixtures/maps/', '/content/maps/')]).toBe(FROZEN[p])
    // Nothing of the live copy leaks through (a file only the live world has would be served otherwise).
    const served = Object.keys(BUNDLED_FILES).filter((p) => p.startsWith(`/content/maps/${DEFAULT_WORLD_ID}/`))
    expect(served.length).toBe(frozen.filter((p) => p.includes(`/maps/${DEFAULT_WORLD_ID}/`)).length)
  })

  it('other worlds are the live ones (M11b: the floors lab is frozen too, for the storey tests)', () => {
    const frozenWorlds = new Set(Object.keys(FROZEN).map((p) => p.split('/')[5]))
    expect([...frozenWorlds].sort()).toEqual(['floors-lab', DEFAULT_WORLD_ID])
    for (const p of Object.keys(LIVE).filter((p) => !frozenWorlds.has(p.split('/')[3]))) expect(BUNDLED_FILES[p]).toBe(LIVE[p])
  })

  it('still loads', () => {
    const read = (path: string) => BUNDLED_FILES[`/content/maps/${DEFAULT_WORLD_ID}/${path}`]
    expect(loadWorld(read).map.id).toBe(DEFAULT_WORLD_ID)
    expect(REGISTERED_LOOT_TABLES.size).toBeGreaterThan(0)
  })
})
