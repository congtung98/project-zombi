import { getItemDef, type ItemInstance } from '../../game/entities/items'
import { repairRecipeFor } from '../../game/entities/recipes'
import { conditionLevel, weaponHitDamage } from '../../game/systems/weapons'
import { useInventoryStore } from '../../stores/inventoryStore'
import { ItemIcon } from './ItemIcon'
import { CATEGORY_LABEL, L, effectText, itemName } from './labels'

const LEVEL_TEXT = { ok: 'Tốt', low: 'Sắp hỏng (≤ 25%)', broken: 'Hỏng — sát thương còn 20%' } as const
const kg = (n: number) => `${n.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ${L.kg}`

/** Details of one instance: only numbers the registry really has (INV-LOOT §4.5). */
function Single({ item }: { item: ItemInstance }) {
  const def = getItemDef(item.itemId)
  const weaponId = useInventoryStore((s) => s.weaponInstanceId)
  const backId = useInventoryStore((s) => s.backInstanceId)
  const bagWeight = useInventoryStore((s) => s.bagWeights[item.id])
  const repair = item.kind === 'weapon' ? repairRecipeFor(item.itemId) : null
  const level = item.kind === 'weapon' ? conditionLevel(item.itemId, item.condition) : null
  const effect = effectText(def.effect)
  return (
    <>
      <div className="inv-card-head">
        <ItemIcon itemId={item.itemId} size={40} />
        <div>
          <div className="inv-card-name">{itemName(item)}{item.quantity > 1 ? ` ×${item.quantity}` : ''}</div>
          <div className="inv-card-sub">
            {CATEGORY_LABEL[def.kind]}
            {item.id === weaponId && ` · ${L.equippedWeapon}`}
            {item.id === backId && ` · ${L.wornBag}`}
            {item.favorite && ` · ★ ${L.favorite}`}
          </div>
        </div>
      </div>
      <dl className="inv-card-stats">
        <dt>Khối lượng</dt>
        <dd>
          {kg(item.kind === 'bag' ? (bagWeight ?? def.weightKg) : def.weightKg * item.quantity)}
          {item.quantity > 1 && ` (${kg(def.weightKg)} ${L.perUnit})`}
        </dd>
        {item.kind === 'weapon' && def.melee && (
          <>
            <dt>{L.condition}</dt>
            <dd className={`inv-card-${level}`}>{item.condition}/{def.maxCondition} · {LEVEL_TEXT[level!]}</dd>
            <dt>{L.damage}</dt>
            <dd>{weaponHitDamage(item.itemId, item.condition)}{level === 'broken' ? ` (gốc ${def.melee.damage})` : ''} · {L.range} {def.melee.range} m · {L.cooldown} {def.melee.cooldown} s · {L.stamina} {def.melee.stamina}</dd>
          </>
        )}
        {repair && (
          <>
            <dt>{L.repairWith}</dt>
            <dd>{repair.inputs.map((i) => `${getItemDef(i.itemId).name} ×${i.quantity}`).join(', ')} · +{repair.amount} {L.condition.toLowerCase()} · {repair.duration} s</dd>
          </>
        )}
        {def.bag && (
          <>
            <dt>{L.capacity}</dt>
            <dd>{def.bag.slots} {L.slots}{bagWeight !== undefined && bagWeight > def.weightKg ? ` · ${L.contents} ${kg(bagWeight - def.weightKg)}` : ''}</dd>
          </>
        )}
        {effect && (
          <>
            <dt>Tác dụng</dt>
            <dd>{effect}</dd>
          </>
        )}
      </dl>
      <p className="inv-card-desc">{def.description}</p>
    </>
  )
}

/** A display group lists each instance with its own state (never one condition for all). */
function Group({ items }: { items: readonly ItemInstance[] }) {
  const def = getItemDef(items[0].itemId)
  return (
    <>
      <div className="inv-card-head">
        <ItemIcon itemId={items[0].itemId} size={40} />
        <div>
          <div className="inv-card-name">{def.name} ×{items.length}</div>
          <div className="inv-card-sub">{CATEGORY_LABEL[def.kind]} · {kg(def.weightKg)} {L.perUnit}</div>
        </div>
      </div>
      <ul className="inv-card-members">
        {items.map((i) => (
          <li key={i.id}>
            {def.name}
            {i.kind === 'weapon' && ` · ${L.condition} ${i.condition}/${def.maxCondition}`}
            {i.favorite && ' · ★'}
          </li>
        ))}
      </ul>
      <p className="inv-card-desc">{def.description}</p>
    </>
  )
}

export function ItemCard({ items }: { items: readonly ItemInstance[] }) {
  if (items.length === 0) return null
  return <div className="inv-card-body">{items.length === 1 ? <Single item={items[0]} /> : <Group items={items} />}</div>
}
