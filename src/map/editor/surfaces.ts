import type { SurfaceMaterial, SurfaceObject } from '../schema.ts'

/**
 * Prefab library P1: what a surface of each material starts as (palette presets, the Inspector when
 * the material changes). Water is solid and blocked for navigation; everything else is walkable.
 */
export const SURFACE_DEFAULTS: Record<SurfaceMaterial, { label: string; color: string; collision: SurfaceObject['collision']; navigation: SurfaceObject['navigation'] }> = {
  concrete: { label: 'Bê tông', color: '#9c988f', collision: 'none', navigation: 'walkable' },
  asphalt: { label: 'Nhựa đường', color: '#3d3d40', collision: 'none', navigation: 'walkable' },
  grass: { label: 'Cỏ', color: '#5f8a3e', collision: 'none', navigation: 'walkable' },
  dirt: { label: 'Đất', color: '#8a6a45', collision: 'none', navigation: 'walkable' },
  tile: { label: 'Gạch lát', color: '#b3a38b', collision: 'none', navigation: 'walkable' },
  water: { label: 'Nước', color: '#3e6e8e', collision: 'solid', navigation: 'blocked' },
}

export const SURFACE_COLLISION_LABEL: Record<SurfaceObject['collision'], string> = { none: 'Không (đi qua được)', solid: 'Chắn (không đi vào được)' }
export const SURFACE_NAVIGATION_LABEL: Record<SurfaceObject['navigation'], string> = { walkable: 'Đi được', blocked: 'Chặn (zombie đi vòng)' }

/** Fields of a surface after a material change: its colour, collision and navigation follow unless they were customised. */
export function surfaceMaterialPatch(o: Pick<SurfaceObject, 'material' | 'color' | 'collision' | 'navigation'>, material: SurfaceMaterial): Partial<SurfaceObject> {
  const before = SURFACE_DEFAULTS[o.material]
  const after = SURFACE_DEFAULTS[material]
  return {
    material,
    ...(o.color.toLowerCase() === before.color ? { color: after.color } : {}),
    ...(o.collision === before.collision && o.navigation === before.navigation ? { collision: after.collision, navigation: after.navigation } : {}),
  }
}

/** A surface template (palette presets of the world and the prefab editor). */
export function surfaceTemplate(material: SurfaceMaterial, shape: SurfaceObject['shape'], size: [number, number], layer = 0): Omit<SurfaceObject, 'localId' | 'position'> {
  const d = SURFACE_DEFAULTS[material]
  return { kind: 'surface', shape, size, material, color: d.color, ...(layer ? { layer } : {}), collision: d.collision, navigation: d.navigation }
}
