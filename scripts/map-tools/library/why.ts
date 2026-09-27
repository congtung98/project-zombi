// Which colliders make a cell of a library prefab blocked (debugging): node why.ts p2 house/cap4 x z level
import { buildRaw } from './builder.ts'
import { resolvePrefab } from '../../../src/map/editor/prefabCommands.ts'
import type { PrefabDocument } from '../../../src/map/schema.ts'
const [sprint, id, xs, zs, ls] = process.argv.slice(2)
const mod = await import(`./${sprint === 'p2' ? 'p2-houses' : sprint === 'p3' ? 'p3-services' : sprint === 'p4' ? 'p4-public' : 'p5-landscape'}.ts`)
buildRaw(true)
const docs: PrefabDocument[] = (mod[sprint]().prefabs ?? mod[sprint]()) as PrefabDocument[]
const p = docs.find((d) => d.prefabId === id)!
const x = Number(xs), z = Number(zs), fy = Number(ls ?? 0) * (p.building?.height ?? 3)
const parts = resolvePrefab(p, 0).parts
for (const w of parts.walls) {
  const bottom = w.position.y - w.size[1] / 2, top = w.position.y + w.size[1] / 2
  if (!(bottom < fy + 1.6 && top > fy + 0.05)) continue
  if (Math.abs(x - w.position.x) <= w.size[0] / 2 + 0.4 && Math.abs(z - w.position.z) <= w.size[2] / 2 + 0.4) console.log('wall', w.id, JSON.stringify(w.position), JSON.stringify(w.size))
}
for (const d of parts.doors) console.log('door', d.id, JSON.stringify(d.hinge), d.openAngle.toFixed(2), d.width)
