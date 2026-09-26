import { memo, useEffect, useMemo } from 'react'
import type { ResolvedRecord } from '../map/resolve'
import { buildBatches, drawItems, GEOMETRIES, mat } from './drawItems'

/**
 * Resolved records drawn for authoring: the runtime descriptors (walls, doors, windows,
 * containers, floors, roads, zones, spawns) as plain boxes and markers. They read the same
 * resolver output as the game, so placement matches; roofs, lighting and characters are not drawn.
 *
 * `RecordView` draws one record as separate meshes (placement ghosts, the prefab editor);
 * `ChunkBatch` (M7) draws every record of a chunk in one `BatchedMesh` per pass, so the world
 * viewport costs a few draw calls per chunk instead of one per box.
 */

export const RecordView = memo(function RecordView({ record, ghost }: { record: ResolvedRecord; ghost: boolean }) {
  const items = useMemo(() => drawItems(record), [record])
  return (
    <group>
      {items.map((it, i) => (
        <mesh
          key={i}
          geometry={GEOMETRIES[it.geometry]}
          material={mat(it.color, ghost ? 'ghost' : it.pass)}
          position={it.position}
          rotation={[0, it.rotationY, 0]}
          scale={it.scale}
        />
      ))}
    </group>
  )
})

/**
 * Every record of one chunk in a few draw calls (M7). Rebuilt when the chunk's record list changes
 * (the resolver caches it per chunk object, so an edit rebuilds only the chunks it touched).
 */
/** Batches currently mounted (StrictMode mounts, unmounts and remounts the same ones). */
const attached = new WeakSet<object>()

export const ChunkBatch = memo(function ChunkBatch({ records }: { records: readonly ResolvedRecord[] }) {
  const meshes = useMemo(() => buildBatches(records.flatMap(drawItems)), [records])
  useEffect(() => {
    for (const m of meshes) attached.add(m)
    return () => {
      for (const m of meshes) attached.delete(m)
      // Free GPU data unless the same batches were attached again right away (StrictMode remount).
      setTimeout(() => {
        for (const m of meshes) if (!attached.has(m)) m.dispose()
      }, 0)
    }
  }, [meshes])
  return (
    <>
      {meshes.map((m) => (
        <primitive key={m.uuid} object={m} />
      ))}
    </>
  )
})
