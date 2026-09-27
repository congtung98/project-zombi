import { describe, expect, it } from 'vitest'
import {
  BODY_PRESETS,
  DEFAULT_APPEARANCE,
  DEFAULT_PLAYER_NAME,
  HAIR_STYLES,
  OUTFIT_STYLES,
  PANTS_COLORS,
  SHIRT_COLORS,
  SKIN_TONES,
  isAppearance,
  isValidName,
  normalizeName,
  outfitOf,
  randomAppearance,
} from './appearance'
import { createRng } from '../systems/loot'
import { GameRuntime } from '../core/runtime'
import { validateSaveGame } from '../systems/save'
import { NEIGHBORHOOD_MAP } from '../world/mapData'

describe('character appearance data', () => {
  it('has the planned content: 3 presets, 3 hair styles, 4 skin, 4 shirt, 4 pants colors, 4 outfits', () => {
    expect([BODY_PRESETS.length, HAIR_STYLES.length, SKIN_TONES.length, SHIRT_COLORS.length, PANTS_COLORS.length, OUTFIT_STYLES.length]).toEqual([3, 3, 4, 4, 4, 4])
    expect(isAppearance(DEFAULT_APPEARANCE)).toBe(true)
  })

  it('names are trimmed, capped at 24 characters (Vietnamese diacritics count once) and default when blank', () => {
    expect(normalizeName('   ')).toBe(DEFAULT_PLAYER_NAME)
    expect(normalizeName('  Tùng  ')).toBe('Tùng')
    expect(Array.from(normalizeName('Nguyễn Thị Hồng Nhung Ánh Dương'))).toHaveLength(24)
    // Decomposed input (e + combining marks) is normalized to NFC before counting.
    expect(normalizeName('Tùng')).toBe('Tùng')
    expect(isValidName('Tùng')).toBe(true)
    expect(isValidName(' Tùng')).toBe(false)
    expect(isValidName('')).toBe(false)
    expect(isValidName('x'.repeat(25))).toBe(false)
  })

  it('randomize only produces valid appearances and reaches every option', () => {
    const rng = createRng(7)
    const seen = new Set<string>()
    for (let i = 0; i < 300; i++) {
      const a = randomAppearance(rng)
      expect(isAppearance(a)).toBe(true)
      for (const [k, v] of Object.entries(a)) seen.add(`${k}:${v}`)
    }
    expect(seen.size).toBe(3 + 3 + 4 + 4 + 4 + 4)
    expect(isAppearance({ ...DEFAULT_APPEARANCE, hair: 'afro' })).toBe(false)
    expect(isAppearance({ ...DEFAULT_APPEARANCE, extra: 1 })).toBe(false)
  })

  it('C2: outfit is optional (saves from before outfits stay valid and draw the T-shirt), unknown outfits are rejected', () => {
    const { outfit: _drop, ...old } = DEFAULT_APPEARANCE
    expect(Object.keys(old)).toHaveLength(5)
    expect(isAppearance(old)).toBe(true)
    expect(outfitOf(old)).toBe('tee')
    for (const outfit of OUTFIT_STYLES) expect(isAppearance({ ...DEFAULT_APPEARANCE, outfit })).toBe(true)
    expect(isAppearance({ ...DEFAULT_APPEARANCE, outfit: 'suit' })).toBe(false)
    expect(isAppearance({ ...old, extra: 'tee' })).toBe(false)
  })
})

describe('character profile in the runtime and save', () => {
  it('every preset starts with identical gameplay state; only name/appearance differ', () => {
    const snapshots = BODY_PRESETS.map((preset) => {
      const rt = new GameRuntime(NEIGHBORHOOD_MAP)
      rt.newGame(42, { name: `  Người ${preset}  `, appearance: { ...DEFAULT_APPEARANCE, preset } })
      const { name, appearance, ...rest } = rt.createSnapshot().player
      expect(name).toBe(`Người ${preset}`)
      expect(appearance.preset).toBe(preset)
      return rest
    })
    expect(snapshots[1]).toEqual(snapshots[0])
    expect(snapshots[2]).toEqual(snapshots[0])
  })

  it('save/load keeps the chosen name and look; reload does not reset them; bad IDs are rejected', () => {
    const rt = new GameRuntime(NEIGHBORHOOD_MAP)
    const appearance = { preset: 'slim', hair: 'mohawk', skin: 'dark', shirt: 'red', pants: 'olive' } as const
    rt.newGame(9, { name: 'Linh', appearance })
    const snap = JSON.parse(JSON.stringify(rt.createSnapshot()))
    const v = validateSaveGame(snap, NEIGHBORHOOD_MAP.id)
    expect(v.ok && !v.migrated).toBe(true)
    const rt2 = new GameRuntime(NEIGHBORHOOD_MAP)
    rt2.loadSnapshot(snap)
    rt2.loadSnapshot(rt2.createSnapshot())
    expect([rt2.player.name, rt2.player.appearance]).toEqual(['Linh', appearance])
    expect(validateSaveGame({ ...snap, player: { ...snap.player, appearance: { ...appearance, skin: 'blue' } } }, NEIGHBORHOOD_MAP.id).ok).toBe(false)
    expect(validateSaveGame({ ...snap, player: { ...snap.player, name: '' } }, NEIGHBORHOOD_MAP.id).ok).toBe(false)
    expect(validateSaveGame({ ...snap, player: { ...snap.player, name: 'x'.repeat(30) } }, NEIGHBORHOOD_MAP.id).ok).toBe(false)
  })

  it('C2: the outfit survives save/load; a save without one loads unchanged and draws the T-shirt', () => {
    const rt = new GameRuntime(NEIGHBORHOOD_MAP)
    const appearance = { ...DEFAULT_APPEARANCE, outfit: 'work' } as const
    rt.newGame(3, { name: 'Tú', appearance })
    const snap = JSON.parse(JSON.stringify(rt.createSnapshot()))
    const rt2 = new GameRuntime(NEIGHBORHOOD_MAP)
    rt2.loadSnapshot(snap)
    expect(rt2.player.appearance).toEqual(appearance)
    const { outfit: _drop, ...old } = appearance
    const legacy = { ...snap, player: { ...snap.player, appearance: old } }
    const v = validateSaveGame(legacy, NEIGHBORHOOD_MAP.id)
    expect(v.ok && !v.migrated).toBe(true)
    const rt3 = new GameRuntime(NEIGHBORHOOD_MAP)
    rt3.loadSnapshot(legacy)
    expect(rt3.player.appearance).toEqual(old)
    expect(outfitOf(rt3.player.appearance)).toBe('tee')
    // Inventory and equipment are untouched by the look.
    expect(rt3.player.inventory).toEqual(rt2.player.inventory)
    expect(rt3.player.equipment).toEqual(rt2.player.equipment)
  })

  it('New Game without a profile uses the default character', () => {
    const rt = new GameRuntime(NEIGHBORHOOD_MAP)
    rt.newGame(1)
    expect([rt.player.name, rt.player.appearance]).toEqual([DEFAULT_PLAYER_NAME, DEFAULT_APPEARANCE])
  })
})
