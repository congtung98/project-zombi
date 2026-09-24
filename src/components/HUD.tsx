import { useHudStore } from '../stores/hudStore'
import { useSettingsStore } from '../stores/settingsStore'
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
  const showHints = useSettingsStore((s) => s.showHints)

  return (
    <div className="hud">
      <div className="hud-stats">
        <StatBar label="Máu" value={hud.health} max={hud.maxHealth} color="#d9453d" />
        <StatBar label="Thể lực" value={hud.stamina} max={hud.maxStamina} color="#e0b23a" />
        <StatBar label="Đói" value={hud.hunger} max={hud.maxHunger} color="#e0812f" />
        <StatBar label="Khát" value={hud.thirst} max={hud.maxThirst} color="#3f9fd9" />
      </div>

      {hud.damageFlash > 0 && <div key={hud.damageFlash} className="hud-damage-flash" />}

      <div className="hud-clock">
        <div className="hud-day">Ngày {hud.day}</div>
        <div className="hud-time">
          {hud.timeLabel} {hud.isNight ? '🌙' : '☀️'}
        </div>
        <div className="hud-kills">Đã hạ: {hud.kills}</div>
      </div>

      <div className="hud-actions">
        <span className={hud.attackCooldown > 0 ? 'cooling' : ''}>
          <kbd>Chuột trái</kbd> Đánh
        </span>
        <span className={hud.pushCooldown > 0 ? 'cooling' : ''}>
          <kbd>Space</kbd> Đẩy
        </span>
        <span className={hud.inventoryOpen ? 'active' : ''}>
          <kbd>I</kbd> Túi {hud.bagUsed}/{hud.bagSize}
        </span>
        {hud.weapon ? (
          <span className={`hud-weapon hud-weapon-${hud.weapon.level}`} title={hud.weapon.level === 'broken' ? 'Vũ khí hỏng: sát thương còn 20%' : 'Độ bền vũ khí đang cầm'}>
            {hud.weapon.icon} {hud.weapon.name} {hud.weapon.condition}/{hud.weapon.maxCondition}
            {hud.weapon.level === 'broken' && <strong> HỎNG</strong>}
          </span>
        ) : (
          <span className="hud-weapon hud-weapon-none">✋ Tay không</span>
        )}
      </div>

      {hud.toast && <div className={`hud-toast hud-toast-${hud.toastTone}`}>{hud.toast}</div>}

      {hud.interactPrompt && (
        <div className="hud-prompt">
          <kbd>E</kbd> {hud.interactPrompt}
        </div>
      )}

      {showHints && (
        <div className="hud-hint">WASD di chuyển · Shift chạy · Chuột trái đánh · Space đẩy · E tương tác · I túi đồ · Esc tạm dừng · F3 debug</div>
      )}

      {debug && (
        <div className="hud-debug">
          <div>FPS: {hud.fps}</div>
          <div>
            Player: ({hud.playerX.toFixed(1)}, {hud.playerZ.toFixed(1)}) {hud.running ? 'RUN' : ''}
          </div>
          <div>Interact: {hud.interactPrompt ?? '-'}</div>
          <div>Zombies: {hud.zombies.filter((z) => z.ai !== 'DEAD').length} sống / {hud.zombies.length}</div>
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
