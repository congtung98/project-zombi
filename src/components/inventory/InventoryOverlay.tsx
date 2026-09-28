import { useEffect, useMemo, useState } from 'react'
import { runtime } from '../../game/core/runtime'
import { useInventoryStore } from '../../stores/inventoryStore'
import { useInventoryUiStore } from '../../stores/inventoryUiStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { CraftingList } from '../CraftingPanel'
import { InvWindow } from './InvWindow'
import { InventoryPanel, LootPanel } from './Panels'
import { Popups } from './Popups'
import { Glyph } from './ItemIcon'
import { defaultLayout, isCompact, NO_SAFE_AREA, type SafeArea, type View } from './layout'
import { L } from './labels'

/** Viewport in UI pixels (screen pixels / UI scale), updated on resize. */
function useView(scale: number): View {
  const read = () => ({ w: window.innerWidth / scale, h: window.innerHeight / scale })
  const [view, setView] = useState<View>(read)
  useEffect(() => {
    const update = () => setView({ w: window.innerWidth / scale, h: window.innerHeight / scale })
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [scale])
  return view
}

/** Space the HUD uses, measured from its elements (clock top-right, stats bottom-left, hints bottom). */
function measureSafeArea(scale: number): SafeArea {
  const rect = (sel: string) => document.querySelector(sel)?.getBoundingClientRect()
  const clock = rect('.hud-clock')
  const stats = rect('.hud-stats')
  const bottomBars = [rect('.hud-actions'), rect('.hud-hint')].filter((r): r is DOMRect => !!r)
  const bottomTop = bottomBars.length ? Math.min(...bottomBars.map((r) => r.top)) : window.innerHeight
  return {
    ...NO_SAFE_AREA,
    topRight: clock ? clock.bottom / scale : 0,
    bottomLeft: stats ? stats.top / scale : Infinity,
    bottom: Math.max(0, (window.innerHeight - bottomTop) / scale),
  }
}

/**
 * INV-LOOT windows over the running game (no pause, no darkening, no lighting change): Inventory,
 * Loot and Crafting, independent, in one layer scaled by the UI scale setting. Too narrow for two
 * windows side by side: one window with Inventory / Loot tabs (the buttons still move items).
 */
export function InventoryOverlay() {
  const inventoryOpen = useInventoryStore((s) => s.open)
  const loot = useInventoryStore((s) => s.lootView)
  const lootWindow = useInventoryStore((s) => s.lootOpen)
  const craftingOpen = useInventoryUiStore((s) => s.craftingOpen)
  const compactTab = useInventoryUiStore((s) => s.compactTab)
  const { setCraftingOpen, setCompactTab } = useInventoryUiStore.getState()
  const scale = useSettingsStore((s) => s.uiScale)
  const view = useView(scale)
  const lootOpen = lootWindow && loot !== null
  // The HUD (rendered before this layer) is measured again whenever the view or the scale changes.
  const defaults = useMemo(() => defaultLayout(view, measureSafeArea(scale)), [view, scale])
  const compact = isCompact(view)

  // A newly opened container shows the Loot tab in compact mode.
  useEffect(() => {
    if (lootOpen) setCompactTab('loot')
    else setCompactTab('inventory')
  }, [lootOpen, setCompactTab])

  if (!inventoryOpen && !lootOpen) return null
  const craftTool = (
    <button type="button" className="inv-tool" title={L.crafting} aria-pressed={craftingOpen} onClick={() => setCraftingOpen(!craftingOpen)}>
      <Glyph name="craft" />
    </button>
  )
  const closeInventory = () => runtime.setInventoryOpen(false)
  const closeLoot = () => runtime.closeContainer()
  const tab = compact && lootOpen && (compactTab === 'loot' || !inventoryOpen) ? 'loot' : 'inventory'

  return (
    <div className="inv-layer" style={{ transform: `scale(${scale})`, width: `${100 / scale}vw`, height: `${100 / scale}vh` }} onContextMenu={(e) => e.preventDefault()}>
      {compact ? (
        <InvWindow
          id="inventory"
          label={tab === 'loot' ? L.loot : L.inventory}
          view={view}
          scale={scale}
          defaultRect={defaults.compact}
          onClose={tab === 'loot' ? closeLoot : closeInventory}
          tools={inventoryOpen ? craftTool : undefined}
          title={
            <span className="inv-tabs-title" role="tablist" aria-label={L.compactTabs}>
              {inventoryOpen && (
                <button type="button" role="tab" aria-selected={tab === 'inventory'} className="inv-title-tab" onClick={() => setCompactTab('inventory')}>{L.inventory}</button>
              )}
              {lootOpen && (
                <button type="button" role="tab" aria-selected={tab === 'loot'} className="inv-title-tab" onClick={() => setCompactTab('loot')}>{L.loot}</button>
              )}
            </span>
          }
        >
          {tab === 'loot' ? <LootPanel scale={scale} /> : <InventoryPanel scale={scale} />}
        </InvWindow>
      ) : (
        <>
          {inventoryOpen && (
            <InvWindow id="inventory" label={L.inventory} title={L.inventory} view={view} scale={scale} defaultRect={defaults.inventory} onClose={closeInventory} tools={craftTool}>
              <InventoryPanel scale={scale} />
            </InvWindow>
          )}
          {lootOpen && (
            <InvWindow id="loot" label={L.loot} title={`${L.loot} · ${loot.name}`} view={view} scale={scale} defaultRect={defaults.loot} onClose={closeLoot}>
              <LootPanel scale={scale} />
            </InvWindow>
          )}
        </>
      )}
      {inventoryOpen && craftingOpen && (
        <InvWindow id="crafting" label={L.crafting} title={L.crafting} view={view} scale={scale} defaultRect={defaults.crafting} onClose={() => setCraftingOpen(false)}>
          <CraftingList />
        </InvWindow>
      )}
      <Popups view={view} />
    </div>
  )
}
