import { useEffect, useState } from 'react'
import { sfx } from '../game/audio/sfx'
import { useUiStore, type SaveSlotState } from '../stores/uiStore'
import { useHudStore } from '../stores/hudStore'
import { GuidePanel, SettingsPanel } from './Settings'

type MenuView = 'main' | 'settings' | 'guide' | 'worlds'

function ControlsHelp() {
  return (
    <ul className="controls">
      <li><kbd>W A S D</kbd> di chuyển</li>
      <li><kbd>Shift</kbd> chạy (tiêu thể lực)</li>
      <li><kbd>Chuột trái</kbd> đánh về phía con trỏ</li>
      <li><kbd>Space</kbd> đẩy zombie ra xa</li>
      <li><kbd>E</kbd> tương tác cửa/tủ</li>
      <li><kbd>I</kbd> túi đồ (dùng/chuyển, sửa, chế tạo)</li>
      <li><kbd>X</kbd> hủy sửa/chế tạo</li>
      <li><kbd>Con lăn</kbd> zoom camera</li>
      <li><kbd>Esc</kbd> tạm dừng · <kbd>F3</kbd> debug</li>
    </ul>
  )
}

function formatSavedAt(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
}

function SaveSlotInfo() {
  const slot = useUiStore((s) => s.saveSlot)
  switch (slot.kind) {
    case 'ready':
      return (
        <p className="save-info">
          Bản lưu: <b>{slot.summary.name}</b> · Ngày {slot.summary.day} · {slot.summary.timeLabel} · Máu {Math.round(slot.summary.health)} · Đã hạ {slot.summary.kills}
          <br />
          <span className="muted">lưu lúc {formatSavedAt(slot.summary.savedAt)}</span>
        </p>
      )
    case 'incompatible':
      return <p className="save-info save-warn">Bản lưu không tương thích với phiên bản này ({slot.detail}). Hãy bắt đầu ván mới.</p>
    case 'corrupt':
      return <p className="save-info save-warn">Bản lưu bị hỏng ({slot.detail}). Hãy bắt đầu ván mới.</p>
    case 'error':
      return <p className="save-info save-warn">Không đọc được bộ nhớ lưu: {slot.detail}</p>
    case 'empty':
      return <p className="save-info muted">Chưa có bản lưu.</p>
    default:
      return <p className="save-info muted">Đang kiểm tra bản lưu…</p>
  }
}

/** One line per world in the world list. */
function saveLine(save: SaveSlotState): string {
  switch (save.kind) {
    case 'ready':
      return `Bản lưu: ${save.summary.name} · Ngày ${save.summary.day} · ${save.summary.timeLabel}`
    case 'empty':
      return 'Chưa có bản lưu'
    case 'incompatible':
      return 'Bản lưu không tương thích'
    case 'corrupt':
      return 'Bản lưu bị hỏng'
    case 'error':
      return 'Không đọc được bản lưu'
    default:
      return 'Đang kiểm tra bản lưu…'
  }
}

/** World being played, and the way to the world list when there is more than one. */
function WorldLine({ onOpen }: { onOpen: () => void }) {
  const worlds = useUiStore((s) => s.worlds)
  const notice = useUiStore((s) => s.worldNotice)
  const current = worlds.find((w) => w.current)
  return (
    <>
      {notice && (
        <p className="save-info save-warn" data-world-notice>
          {notice}
        </p>
      )}
      {current && (
        <p className="world-line">
          World: <b data-current-world={current.worldId}>{current.name}</b>
          {worlds.length > 1 && (
            <button className="link" onClick={onOpen} data-open-worlds>
              Đổi world
            </button>
          )}
        </p>
      )}
    </>
  )
}

/** Bundled worlds (`content/maps/`, including `map:unpack` output); picking one reloads the page on it. */
function WorldsPanel({ onBack }: { onBack: () => void }) {
  const worlds = useUiStore((s) => s.worlds)
  const refreshWorlds = useUiStore((s) => s.refreshWorlds)
  const chooseWorld = useUiStore((s) => s.chooseWorld)
  const busy = useUiStore((s) => s.busy)

  useEffect(() => {
    void refreshWorlds()
  }, [refreshWorlds])

  return (
    <div className="worlds">
      <h2>Chọn world</h2>
      <p className="subtitle">Mỗi world có bản lưu riêng; đổi world không xóa bản lưu nào. Game tải lại trên world mới.</p>
      <ul className="world-list">
        {worlds.map((w) => (
          <li key={w.worldId} className={w.current ? 'current' : ''} data-world={w.worldId}>
            <div>
              <b>{w.name}</b>
              {!w.listed && <span className="muted"> (ẩn, chỉ dev)</span>}
              <br />
              <span className="muted">
                {w.worldId} · {w.size.x} × {w.size.z} m
              </span>
              <br />
              <span className={w.save.kind === 'ready' ? '' : 'muted'} data-world-save={w.save.kind}>
                {saveLine(w.save)}
              </span>
            </div>
            <button
              disabled={w.current || busy}
              onClick={() => {
                sfx.play('ui')
                chooseWorld(w.worldId)
              }}
              data-choose-world={w.worldId}
            >
              {w.current ? 'Đang chơi' : 'Chơi'}
            </button>
          </li>
        ))}
      </ul>
      <div className="actions">
        <button onClick={onBack}>Quay lại</button>
      </div>
    </div>
  )
}

function SecondaryNav({ setView }: { setView: (v: MenuView) => void }) {
  return (
    <div className="actions actions-row">
      <button onClick={() => setView('guide')}>Hướng dẫn</button>
      <button onClick={() => setView('settings')}>Cài đặt</button>
    </div>
  )
}

export function MainMenu() {
  const openCharacterCreation = useUiStore((s) => s.openCharacterCreation)
  const continueGame = useUiStore((s) => s.continueGame)
  const refreshSaveSlot = useUiStore((s) => s.refreshSaveSlot)
  const slot = useUiStore((s) => s.saveSlot)
  const busy = useUiStore((s) => s.busy)
  const [view, setView] = useState<MenuView>('main')

  useEffect(() => {
    void refreshSaveSlot()
  }, [refreshSaveSlot])

  const hasSave = slot.kind === 'ready'

  // New Game opens character creation; overwrite confirmation and deletion happen there.
  const onNewGame = () => {
    sfx.play('ui')
    openCharacterCreation()
  }

  return (
    <div className="overlay">
      <div className={view === 'guide' ? 'panel panel-wide' : 'panel'}>
        {view === 'settings' && <SettingsPanel onBack={() => setView('main')} />}
        {view === 'guide' && <GuidePanel onBack={() => setView('main')} />}
        {view === 'worlds' && <WorldsPanel onBack={() => setView('main')} />}
        {view === 'main' && (
          <>
            <h1>Zombie Outbreak</h1>
            <p className="subtitle">Phase 2 · bản phát triển (nhân vật, vũ khí và độ bền)</p>
            <WorldLine onOpen={() => setView('worlds')} />
            <SaveSlotInfo />
            <div className="actions">
              <button onClick={onNewGame} disabled={busy}>
                New Game
              </button>
              <button
                onClick={() => {
                  sfx.play('ui')
                  void continueGame()
                }}
                disabled={!hasSave || busy}
                title={hasSave ? 'Tiếp tục ván đã lưu' : 'Chưa có bản lưu hợp lệ'}
              >
                Continue
              </button>
            </div>
            <SecondaryNav setView={setView} />
            <ControlsHelp />
          </>
        )}
      </div>
    </div>
  )
}

export function PauseMenu() {
  const resume = useUiStore((s) => s.resume)
  const toMenu = useUiStore((s) => s.toMenu)
  const saveGame = useUiStore((s) => s.saveGame)
  const busy = useUiStore((s) => s.busy)
  const [view, setView] = useState<MenuView>('main')

  const saveAndMenu = async () => {
    const ok = await saveGame('Đã lưu game.')
    if (ok) toMenu()
  }

  return (
    <div className="overlay overlay-dim">
      <div className={view === 'guide' ? 'panel panel-wide' : 'panel'}>
        {view === 'settings' && <SettingsPanel onBack={() => setView('main')} />}
        {view === 'guide' && <GuidePanel onBack={() => setView('main')} />}
        {view === 'main' && (
          <>
            <h2>Tạm dừng</h2>
            <div className="actions">
              <button onClick={resume}>Tiếp tục</button>
              <button onClick={() => void saveGame()} disabled={busy}>
                Lưu game
              </button>
              <button onClick={() => void saveAndMenu()} disabled={busy}>
                Lưu và về menu
              </button>
              <button onClick={toMenu} title="Tiến trình từ lần lưu gần nhất sẽ mất">
                Về menu (không lưu)
              </button>
            </div>
            <SecondaryNav setView={setView} />
            <p className="save-info muted">Game tự động lưu mỗi phút khi đang chơi.</p>
          </>
        )}
      </div>
    </div>
  )
}

export function GameOverScreen() {
  const openCharacterCreation = useUiStore((s) => s.openCharacterCreation)
  const toMenu = useUiStore((s) => s.toMenu)
  const name = useHudStore((s) => s.playerName)
  return (
    <div className="overlay overlay-dim">
      <div className="panel">
        <h2>{name} đã gục ngã</h2>
        <p className="subtitle">Zombie đã hạ gục bạn. Bản lưu đã bị xóa. Thử lại?</p>
        <div className="actions">
          <button onClick={openCharacterCreation}>New Game</button>
          <button onClick={toMenu}>Về menu chính</button>
        </div>
      </div>
    </div>
  )
}
