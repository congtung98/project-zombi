import { useState } from 'react'
import { runtime } from '../game/core/runtime'
import { useUiStore } from '../stores/uiStore'
import { useWorldStore } from '../stores/worldStore'
import { addItem } from '../game/systems/inventory'
import type { DoorStatus } from '../game/world/doors'
import type { ItemId } from '../game/entities/items'

/** Developer-only reproducible scene; persistence uses slot-lab, never the player's slot. */
export default function DoorLab() {
  const state = useWorldStore((s) => s.doorStates['lab-door'] ?? 'closed')
  const [report, setReport] = useState('Mở cửa để zombie thấy bạn; đóng cửa rồi kiểm tra tuyến tới vị trí nhớ.')
  function toggle(state: DoorStatus) {
    runtime.setDoorState('lab-door', state)
    runtime.events.flush()
  }
  function route() {
    const zombie = runtime.zombies.get('zombie-1')
    if (!zombie?.lastKnownTarget) { setReport('Zombie chưa thấy người chơi; chưa có mục tiêu để chọn cửa.'); return }
    const result = runtime.nav.findDoorRoute(zombie.position, zombie.lastKnownTarget)
    setReport(result ? result.doorId ? `Cửa trên tuyến: ${result.doorId}; điểm tiếp cận (${result.approach.x.toFixed(2)}, ${result.approach.z.toFixed(2)}).` : 'Có đường thông tới vị trí nhớ.' : 'Không có tuyến hợp lệ.')
  }
  function give(items: [ItemId, number][]) {
    for (const [itemId, condition] of items) addItem(runtime.player.inventory, itemId, 1, { condition })
    runtime.setInventoryOpen(true)
    runtime.events.flush()
  }
  return (
    <aside style={{ position: 'absolute', right: 12, top: 12, zIndex: 20, maxWidth: 340, padding: 12, background: '#18202fee' }}>
      <strong>P2 · Phòng thử cửa/vũ khí ({state})</strong>
      <p>1 phòng / 1 cửa / 1 zombie. Save riêng: slot-lab.</p>
      <button onClick={() => toggle('closed')}>Đóng</button>{' '}
      <button onClick={() => toggle('open')}>Mở</button>{' '}
      <button onClick={() => toggle('destroyed')}>Phá cửa</button>{' '}
      <button onClick={route}>Kiểm tra tuyến zombie</button>
      <p>{report}</p>
      <button onClick={() => give([['baseball_bat', 10], ['baseball_bat', 70]])}>Thêm hai gậy 10 / 70</button>{' '}
      <button onClick={() => give([['baseball_bat', 1], ['metal_pipe', 30], ['crowbar', 150], ['hammer', 0]])}>Bộ vũ khí thử (gậy 1, búa hỏng)</button>{' '}
      <button onClick={() => { void useUiStore.getState().saveGame() }}>Lưu thử</button>{' '}
      <button onClick={() => { void useUiStore.getState().continueGame() }}>Nạp lại</button>
    </aside>
  )
}
