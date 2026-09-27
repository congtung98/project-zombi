// Print the navigation grid of library prefabs being built (see access.ts), e.g.
// node scripts/map-tools/library/debug.ts p2 house/cap4
import { checkAccess } from './access.ts'
import type { PrefabDocument } from '../../../src/map/schema.ts'
import { buildRaw } from './builder.ts'

const [sprint, id] = process.argv.slice(2)
const mod = await import(`./${sprint === 'p2' ? 'p2-houses' : sprint === 'p3' ? 'p3-services' : sprint === 'p4' ? 'p4-public' : 'p5-landscape'}.ts`)
buildRaw(true)
const docs: PrefabDocument[] = (mod[sprint]().prefabs ?? mod[sprint]()) as PrefabDocument[]
const p = docs.find((d) => d.prefabId === id)!
console.log(checkAccess(p, console.log).map((x) => x.message).join('\n'))
