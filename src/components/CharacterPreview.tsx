import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import type { CharacterAppearance } from '../game/entities/appearance'
import { computePose, createPose } from '../game/rendering/character/pose'
import { applyPose, buildCharacter, playerLook } from '../game/rendering/character/rig'

/** Idle preview of the same rig used in game; yaw comes from the drag handler. */
function PreviewModel({ appearance, yaw }: { appearance: CharacterAppearance; yaw: { current: number } }) {
  const rig = useMemo(() => buildCharacter(playerLook(appearance), 'full'), [appearance])
  const turn = useRef<Group>(null)
  const pose = useRef(createPose())
  const time = useRef(0)

  useEffect(() => () => rig.dispose(), [rig])

  useFrame((_, delta) => {
    time.current += delta
    if (turn.current) turn.current.rotation.y = yaw.current
    computePose({ kind: 'player', time: time.current, gaitPhase: 0, speed: 0, swing: -1, hitAt: 0.4, shove: -1, attack: -1, hurt: 0, dead: -1, armed: false, work: -1 }, pose.current)
    applyPose(rig, pose.current)
  })

  return (
    <group ref={turn}>
      <primitive object={rig.root} />
    </group>
  )
}

/** Separate small canvas for character creation; drag horizontally to rotate. */
export default function CharacterPreview({ appearance }: { appearance: CharacterAppearance }) {
  const yaw = useRef(0.5)
  const drag = useRef<number | null>(null)
  return (
    <div
      className="creation-preview"
      title="Kéo chuột để xoay"
      onPointerDown={(e) => {
        drag.current = e.clientX
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (drag.current === null) return
        yaw.current += (e.clientX - drag.current) * 0.012
        drag.current = e.clientX
      }}
      onPointerUp={() => {
        drag.current = null
      }}
      onPointerCancel={() => {
        drag.current = null
      }}
    >
      <Canvas camera={{ position: [0, 1.05, 4.3], fov: 30 }} dpr={[1, 1.5]} onCreated={({ camera }) => camera.lookAt(0, 0.9, 0)}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[2, 4, 3]} intensity={1.6} />
        <directionalLight position={[-3, 2, -2]} intensity={0.5} color="#9fb4ff" />
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.8, 32]} />
          <meshStandardMaterial color="#2a303b" />
        </mesh>
        <PreviewModel appearance={appearance} yaw={yaw} />
      </Canvas>
    </div>
  )
}
