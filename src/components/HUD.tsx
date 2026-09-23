import { useHudStore } from '../stores/hudStore'
import { useUiStore } from '../stores/uiStore'

interface StatBarProps {
  label: string
  value: number
  max: number
  color: string
}

function StatBar({ label, value, max, color }: StatBarProps) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <div className="stat-track">
        <div className="stat-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="stat-value">{Math.round(value)}</span>
    </div>
  )
}

export function HUD() {
  const hud = useHudStore()
  const debug = useUiStore((s) => s.debug)

  return (
    <div className="hud">
      <div className="hud-stats">
        <StatBar label="Máu" value={hud.health} max={hud.maxHealth} color="#d9453d" />
        <StatBar label="Thể lực" value={hud.stamina} max={hud.maxStamina} color="#e0b23a" />
        <StatBar label="Đói" value={hud.hunger} max={hud.maxHunger} color="#e0812f" />
        <StatBar label="Khát" value={hud.thirst} max={hud.maxThirst} color="#3f9fd9" />
      </div>

      <div className="hud-clock">
        <div className="hud-day">Ngày {hud.day}</div>
        <div className="hud-time">
          {hud.timeLabel} {hud.isNight ? '🌙' : '☀️'}
        </div>
      </div>

      <div className="hud-hint">WASD di chuyển · Shift chạy · Con lăn zoom · Esc tạm dừng · F3 debug</div>

      {debug && (
        <div className="hud-debug">
          <div>FPS: {hud.fps}</div>
          <div>
            Player: ({hud.playerX.toFixed(1)}, {hud.playerZ.toFixed(1)}) {hud.running ? 'RUN' : ''}
          </div>
          {hud.zombies.map((z) => (
            <div key={z.id}>
              {z.id}: {z.ai} hp={z.health} d={z.distance.toFixed(1)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
