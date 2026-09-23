import { useUiStore } from '../stores/uiStore'

function ControlsHelp() {
  return (
    <ul className="controls">
      <li><kbd>W A S D</kbd> di chuyển</li>
      <li><kbd>Shift</kbd> chạy (tiêu thể lực)</li>
      <li><kbd>Chuột trái</kbd> đánh (Sprint 3)</li>
      <li><kbd>Space</kbd> đẩy (Sprint 3)</li>
      <li><kbd>E</kbd> tương tác (Sprint 2)</li>
      <li><kbd>I</kbd> inventory (Sprint 4)</li>
      <li><kbd>Con lăn</kbd> zoom camera</li>
      <li><kbd>Esc</kbd> tạm dừng · <kbd>F3</kbd> debug</li>
    </ul>
  )
}

export function MainMenu() {
  const startNewGame = useUiStore((s) => s.startNewGame)
  return (
    <div className="overlay">
      <div className="panel">
        <h1>Zombie Outbreak</h1>
        <p className="subtitle">Phase 1 · Sprint 1 prototype</p>
        <div className="actions">
          <button onClick={startNewGame}>New Game</button>
          <button disabled title="Lưu/tải game được làm ở Sprint 5">
            Continue
          </button>
        </div>
        <ControlsHelp />
      </div>
    </div>
  )
}

export function PauseMenu() {
  const resume = useUiStore((s) => s.resume)
  const toMenu = useUiStore((s) => s.toMenu)
  return (
    <div className="overlay overlay-dim">
      <div className="panel">
        <h2>Tạm dừng</h2>
        <div className="actions">
          <button onClick={resume}>Tiếp tục</button>
          <button onClick={toMenu}>Về menu chính</button>
        </div>
        <ControlsHelp />
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
        <p className="subtitle">Zombie đã hạ gục bạn. Thử lại?</p>
        <div className="actions">
          <button onClick={startNewGame}>New Game</button>
          <button onClick={toMenu}>Về menu chính</button>
        </div>
      </div>
    </div>
  )
}
