import { useEffect, useState } from 'react'
import { sfx } from '../game/audio/sfx'
import { useUiStore } from '../stores/uiStore'
import { GuidePanel, SettingsPanel } from './Settings'

type MenuView = 'main' | 'settings' | 'guide'

function ControlsHelp() {
  return (
    <ul className="controls">
      <li><kbd>W A S D</kbd> di chuyển</li>
      <li><kbd>Shift</kbd> chạy (tiêu thể lực)</li>
      <li><kbd>Chuột trái</kbd> đánh về phía con trỏ</li>
      <li><kbd>Space</kbd> đẩy zombie ra xa</li>
      <li><kbd>E</kbd> tương tác cửa/tủ</li>
      <li><kbd>I</kbd> túi đồ (click dùng/chuyển)</li>
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
          Bản lưu: Ngày {slot.summary.day} · {slot.summary.timeLabel} · Máu {Math.round(slot.summary.health)} · Đã hạ {slot.summary.kills}
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

function SecondaryNav({ setView }: { setView: (v: MenuView) => void }) {
  return (
    <div className="actions actions-row">
      <button onClick={() => setView('guide')}>Hướng dẫn</button>
      <button onClick={() => setView('settings')}>Cài đặt</button>
    </div>
  )
}

export function MainMenu() {
  const startNewGame = useUiStore((s) => s.startNewGame)
  const continueGame = useUiStore((s) => s.continueGame)
  const refreshSaveSlot = useUiStore((s) => s.refreshSaveSlot)
  const discardSave = useUiStore((s) => s.discardSave)
  const slot = useUiStore((s) => s.saveSlot)
  const busy = useUiStore((s) => s.busy)
  const [confirmNew, setConfirmNew] = useState(false)
  const [view, setView] = useState<MenuView>('main')

  useEffect(() => {
    void refreshSaveSlot()
  }, [refreshSaveSlot])

  const hasSave = slot.kind === 'ready'
  const hasAnyData = slot.kind === 'ready' || slot.kind === 'incompatible' || slot.kind === 'corrupt'

  const onNewGame = () => {
    sfx.play('ui')
    if (hasAnyData && !confirmNew) {
      setConfirmNew(true)
      return
    }
    setConfirmNew(false)
    // Một slot: ván mới xóa bản lưu cũ ngay để Continue không trỏ về ván trước.
    if (hasAnyData) void discardSave()
    startNewGame()
  }

  return (
    <div className="overlay">
      <div className="panel">
        {view === 'settings' && <SettingsPanel onBack={() => setView('main')} />}
        {view === 'guide' && <GuidePanel onBack={() => setView('main')} />}
        {view === 'main' && (
          <>
            <h1>Zombie Outbreak</h1>
            <p className="subtitle">Phase 2 · bản phát triển (vũ khí và độ bền)</p>
            <SaveSlotInfo />
            {confirmNew ? (
              <div className="actions">
                <p className="save-warn">Bản lưu hiện tại sẽ bị xóa khi bắt đầu ván mới. Tiếp tục?</p>
                <button onClick={onNewGame} disabled={busy}>
                  Xóa bản lưu và bắt đầu ván mới
                </button>
                <button onClick={() => setConfirmNew(false)}>Hủy</button>
              </div>
            ) : (
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
            )}
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
      <div className="panel">
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
  const startNewGame = useUiStore((s) => s.startNewGame)
  const toMenu = useUiStore((s) => s.toMenu)
  return (
    <div className="overlay overlay-dim">
      <div className="panel">
        <h2>Bạn đã chết</h2>
        <p className="subtitle">Zombie đã hạ gục bạn. Bản lưu đã bị xóa. Thử lại?</p>
        <div className="actions">
          <button onClick={startNewGame}>New Game</button>
          <button onClick={toMenu}>Về menu chính</button>
        </div>
      </div>
    </div>
  )
}
