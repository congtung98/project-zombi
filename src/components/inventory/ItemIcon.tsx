import type { ReactNode } from 'react'
import type { ItemId } from '../../game/entities/items'

/**
 * INV-LOOT item icons drawn in code (owner decision D2): flat low-detail shapes on a 24×24 grid with
 * a dark outline so each silhouette reads at 20–24 px on the dark panel. No external assets.
 */
const O = '#15181a'
const SW = 1.2

const SHAPES: Record<Exclude<ItemId, 'unknown_item'>, ReactNode> = {
  canned_food: (
    <g stroke={O} strokeWidth={SW}>
      <rect x="6" y="5" width="12" height="15" rx="1.5" fill="#b9bec4" />
      <rect x="6" y="9" width="12" height="7" fill="#c0463a" />
      <ellipse cx="12" cy="5" rx="6" ry="1.6" fill="#d9dde1" />
    </g>
  ),
  // AX2: the same tin without its lid, the pull ring up and the food showing.
  canned_food_open: (
    <g stroke={O} strokeWidth={SW}>
      <rect x="6" y="7" width="12" height="13" rx="1.5" fill="#b9bec4" />
      <rect x="6" y="11" width="12" height="6" fill="#c0463a" />
      <ellipse cx="12" cy="7" rx="6" ry="1.8" fill="#8a5a36" />
      <path d="M14 6.5 Q17.5 1.5 19.5 4.5" fill="none" />
    </g>
  ),
  chips: (
    <g stroke={O} strokeWidth={SW}>
      <path d="M6 4 L18 4 L17 7 L18.5 12 L17 17 L18 20 L6 20 L7 17 L5.5 12 L7 7 Z" fill="#e8b93a" />
      <path d="M7 10 L17 10 L17 14 L7 14 Z" fill="#c0463a" />
    </g>
  ),
  water: (
    <g stroke={O} strokeWidth={SW}>
      <rect x="10" y="2.5" width="4" height="3" fill="#2e6fb0" />
      <path d="M9 6 L15 6 L16.5 9 L16.5 20 Q16.5 21.5 15 21.5 L9 21.5 Q7.5 21.5 7.5 20 L7.5 9 Z" fill="#8cc6ef" />
      <rect x="7.5" y="12" width="9" height="4" fill="#dfeff9" />
    </g>
  ),
  soda: (
    <g stroke={O} strokeWidth={SW}>
      <rect x="7" y="4.5" width="10" height="16" rx="2" fill="#2f8f5a" />
      <path d="M7 12 Q12 9 17 12 L17 14 Q12 11 7 14 Z" fill="#e9f3ec" />
      <rect x="9" y="3" width="6" height="2" rx="1" fill="#b9bec4" />
    </g>
  ),
  bandage: (
    <g stroke={O} strokeWidth={SW}>
      <rect x="2.5" y="8.5" width="19" height="7" rx="3.5" fill="#e6c9a8" transform="rotate(-35 12 12)" />
      <rect x="9" y="9" width="6" height="6" fill="#f3e3cf" transform="rotate(-35 12 12)" />
    </g>
  ),
  medkit: (
    <g stroke={O} strokeWidth={SW}>
      <rect x="9" y="3.5" width="6" height="3" rx="1" fill="none" />
      <rect x="3.5" y="6.5" width="17" height="13" rx="2" fill="#eef0f1" />
      <path d="M10.5 9 H13.5 V11.5 H16 V14.5 H13.5 V17 H10.5 V14.5 H8 V11.5 H10.5 Z" fill="#c9362c" />
    </g>
  ),
  baseball_bat: (
    <g stroke={O} strokeWidth={SW}>
      <path d="M4 21 L3 20 L14.5 6.5 Q17.5 2.5 20.5 5 Q22.5 7.5 18.5 10.5 Z" fill="#b98652" />
      <path d="M4 21 L3 20 L6 16.8 L7.3 18 Z" fill="#3a2a1d" />
    </g>
  ),
  metal_pipe: (
    <g stroke={O} strokeWidth={SW}>
      <path d="M3.5 18.5 L17.5 4.5 L19.5 6.5 L5.5 20.5 Z" fill="#8e979f" />
      <path d="M2.5 17.5 L6.5 21.5 L5.3 22.7 L1.3 18.7 Z M16.5 3.5 L20.5 7.5 L21.7 6.3 L17.7 2.3 Z" fill="#6c747b" />
    </g>
  ),
  crowbar: (
    <g fill="none" stroke={O} strokeWidth="4" strokeLinecap="round">
      <path d="M5 20 L16 5 Q17.5 3 19.5 4.5" />
      <path d="M5 20 L16 5 Q17.5 3 19.5 4.5" stroke="#b33a2e" strokeWidth="2.2" />
      <path d="M5 20 L3.5 18.5" stroke="#6c747b" strokeWidth="2.2" />
    </g>
  ),
  hammer: (
    <g stroke={O} strokeWidth={SW}>
      <path d="M11 9 L13 9 L13.5 21 L10.5 21 Z" fill="#b98652" />
      <path d="M4.5 4.5 L17 4.5 Q19.5 5.5 19.5 7.5 L17 9 L4.5 9 Z" fill="#8e979f" />
    </g>
  ),
  wooden_club: (
    <g stroke={O} strokeWidth={SW}>
      <path d="M5 21 L3 19 L13.5 7 L18 3 L21 6 L17 10.5 Z" fill="#9c7447" />
      <path d="M9.5 12 L12 14.5 L10.8 15.8 L8.3 13.3 Z M12.8 8.3 L15.5 11 L14.3 12.3 L11.6 9.6 Z" fill="#a9b0b6" />
    </g>
  ),
  wood_plank: (
    <g stroke={O} strokeWidth={SW}>
      <rect x="2.5" y="8.5" width="19" height="7" fill="#c89b62" transform="rotate(-20 12 12)" />
      <path d="M5 11 H19 M6 13.5 H16" stroke="#8b6337" strokeWidth="0.9" transform="rotate(-20 12 12)" />
    </g>
  ),
  scrap_metal: (
    <g stroke={O} strokeWidth={SW}>
      <path d="M3.5 14 L8 6 L12 8.5 L16.5 4 L20.5 11 L17 13 L19 19.5 L10 20.5 L6 17.5 Z" fill="#8e979f" />
      <path d="M8 11 L13 12.5 L11 16 Z" fill="#6c747b" />
    </g>
  ),
  // A roll seen from above at a slant (a short wide cylinder with its core), the loose end of the tape
  // hanging from its side with a torn edge: never a lens (S6).
  duct_tape: (
    <g stroke={O} strokeWidth={SW} strokeLinejoin="round">
      <path d="M15.5 12.5 L20.5 19.5 L19 20.5 L18 19.4 L17 21 L15.8 19.8 L14.6 21 L12.5 14.5 Z" fill="#9aa2a9" />
      <path d="M3 8.5 L3 13.5 A8 3.8 0 0 0 19 13.5 L19 8.5 Z" fill="#7d868e" />
      <ellipse cx="11" cy="8.5" rx="8" ry="3.8" fill="#b4bbc1" />
      <ellipse cx="11" cy="8.5" rx="3.6" ry="1.6" fill="#c9a36a" />
      <ellipse cx="11" cy="8.6" rx="2.2" ry="0.95" fill="#23282c" />
      <path d="M4.2 12.3 A7.4 3.2 0 0 0 9.5 14.6" fill="none" stroke="#a3abb2" strokeWidth="0.9" />
    </g>
  ),
  nails: (
    <g stroke={O} strokeWidth="1">
      {[[6, 4], [11, 3], [16, 5]].map(([x, y]) => (
        <g key={x}>
          <rect x={x - 2.2} y={y} width="4.4" height="2" fill="#6c747b" />
          <path d={`M${x - 0.9} ${y + 2} L${x + 0.9} ${y + 2} L${x} ${y + 16} Z`} fill="#b9bec4" />
        </g>
      ))}
    </g>
  ),
  backpack: (
    <g stroke={O} strokeWidth={SW}>
      <path d="M9 5 Q12 1.5 15 5" fill="none" />
      <rect x="5" y="5" width="14" height="16" rx="4" fill="#6f7a4a" />
      <rect x="7.5" y="12.5" width="9" height="6.5" rx="1.5" fill="#56603a" />
      <rect x="10" y="9" width="4" height="1.8" rx="0.9" fill="#c9b57a" />
    </g>
  ),
}

const UNKNOWN = (
  <g stroke={O} strokeWidth={SW}>
    <rect x="4" y="4" width="16" height="16" rx="2" fill="#5b5f63" />
    <path d="M9.5 9.5 Q9.5 7 12 7 Q14.5 7 14.5 9.3 Q14.5 11 12 12 L12 13.8" fill="none" stroke="#e2dfd4" strokeWidth="1.6" />
    <circle cx="12" cy="16.8" r="1" fill="#e2dfd4" stroke="none" />
  </g>
)

export function ItemIcon({ itemId, size = 22, title }: { itemId: ItemId | string; size?: number; title?: string }) {
  const shape = (SHAPES as Record<string, ReactNode>)[itemId] ?? UNKNOWN
  return (
    <svg className="inv-icon" width={size} height={size} viewBox="0 0 24 24" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      {shape}
    </svg>
  )
}

/** Small UI glyphs (title bar, sort) in the same stroke style. */
export function Glyph({ name }: { name: 'pin' | 'pinned' | 'collapse' | 'expand' | 'close' | 'up' | 'down' | 'chevron-right' | 'chevron-down' | 'craft' }) {
  const d: Record<typeof name, ReactNode> = {
    pin: <path d="M9 3 H15 L14 9 L17 12 H7 L10 9 Z M12 12 V20" fill="none" stroke="currentColor" strokeWidth="1.6" />,
    pinned: <path d="M9 3 H15 L14 9 L17 12 H7 L10 9 Z M12 12 V20" fill="currentColor" stroke="currentColor" strokeWidth="1.6" />,
    collapse: <path d="M6 12 H18" stroke="currentColor" strokeWidth="2" />,
    expand: <rect x="6" y="6" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" />,
    close: <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="2" />,
    up: <path d="M7 14 L12 9 L17 14" fill="none" stroke="currentColor" strokeWidth="2" />,
    down: <path d="M7 10 L12 15 L17 10" fill="none" stroke="currentColor" strokeWidth="2" />,
    'chevron-right': <path d="M10 7 L15 12 L10 17" fill="none" stroke="currentColor" strokeWidth="2" />,
    'chevron-down': <path d="M7 10 L12 15 L17 10" fill="none" stroke="currentColor" strokeWidth="2" />,
    craft: <path d="M5 19 L13 11 M11 5 L19 13 L16 16 L8 8 Z" fill="none" stroke="currentColor" strokeWidth="1.8" />,
  }
  return (
    <svg className="inv-glyph" width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      {d[name]}
    </svg>
  )
}
