/**
 * Trees (map editor M9): a trunk under a canopy. The trunk is an ordinary static wall in `MapData`
 * (same ID as the tree): collider, nav blocker and zombie sight blocker, like any post. The canopy is
 * only drawn (batched with the other static geometry) and fades when it hides the player, like a
 * roof; it blocks nothing. Pure: the resolver, the game renderer and the editor share the shape.
 */

export type TreeStyle = 'round' | 'pine'

export interface TreeDef {
  id: string
  position: { x: number; z: number }
  /** Total height (m). */
  height: number
  /** Canopy radius (m). */
  canopy: number
  /** Trunk radius (m). */
  trunk: number
  /** Canopy colour. */
  color: string
  style: TreeStyle
}

export const TREE_TRUNK_COLOR = '#5b4330'

/** Accepted ranges (validator, editor fields, generator). */
export const TREE_LIMITS = { height: [2, 20], canopy: [0.5, 8], trunk: [0.1, 1] } as const

export interface TreeProfile {
  /** Visible trunk: ground to a little inside the canopy. */
  trunkHeight: number
  /** Canopy: bottom and top heights. */
  canopyBottom: number
  canopyTop: number
}

/** Where the trunk ends and the canopy sits: broadleaf trees start higher than pines. */
export function treeProfile(t: Pick<TreeDef, 'height' | 'canopy' | 'style'>): TreeProfile {
  const canopyTop = t.height
  const depth = t.style === 'pine' ? t.height * 0.8 : Math.min(2 * t.canopy, t.height * 0.65)
  const canopyBottom = canopyTop - depth
  return { trunkHeight: Math.min(t.height, canopyBottom + 0.3), canopyBottom, canopyTop }
}

/** The trunk as a static wall (collider/nav/sight), same ID as the tree. */
export function trunkWall(t: TreeDef): { id: string; position: { x: number; y: number; z: number }; size: [number, number, number]; color: string } {
  const h = treeProfile(t).trunkHeight
  const w = 2 * t.trunk
  return { id: t.id, position: { x: t.position.x, y: h / 2, z: t.position.z }, size: [w, h, w], color: TREE_TRUNK_COLOR }
}
