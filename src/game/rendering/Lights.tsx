/** Ánh sáng tĩnh cho Sprint 1. Chu kỳ ngày/đêm điều khiển ánh sáng ở Sprint 5. */
export function Lights() {
  return (
    <>
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#cfe3ff', '#3b4a2f', 0.5]} />
      <directionalLight
        castShadow
        position={[18, 32, 12]}
        intensity={1.6}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={120}
        shadow-camera-left={-36}
        shadow-camera-right={36}
        shadow-camera-top={36}
        shadow-camera-bottom={-36}
        shadow-bias={-0.0004}
      />
    </>
  )
}
