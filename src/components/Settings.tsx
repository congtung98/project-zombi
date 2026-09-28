import { sfx } from '../game/audio/sfx'
import { GRAPHICS_PRESETS, useSettingsStore, type GraphicsQuality, type ShadowQuality, type UiScale } from '../stores/settingsStore'
import { useInventoryUiStore } from '../stores/inventoryUiStore'

/** Panel cài đặt dùng chung cho menu chính và menu pause; lưu localStorage ngay khi đổi. */
export function SettingsPanel({ onBack }: { onBack: () => void }) {
  const s = useSettingsStore()

  return (
    <div className="settings">
      <h2>Cài đặt</h2>
      <label className="setting-row">
        <span>Âm lượng</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(s.volume * 100)}
          onChange={(e) => s.set({ volume: Number(e.target.value) / 100 })}
          onPointerUp={() => sfx.play('ui')}
        />
        <span className="setting-value">{Math.round(s.volume * 100)}%</span>
      </label>
      <label className="setting-row">
        <span>Tắt tiếng</span>
        <input type="checkbox" checked={s.muted} onChange={(e) => s.set({ muted: e.target.checked })} />
        <span className="setting-value">{s.muted ? 'Đang tắt' : 'Đang bật'}</span>
      </label>
      <label className="setting-row">
        <span>Chất lượng đồ họa</span>
        <select
          value={s.graphics}
          onChange={(e) => {
            const graphics = e.target.value as GraphicsQuality
            const p = GRAPHICS_PRESETS[graphics]
            s.set({ graphics, shadows: p.shadows, maxPixelRatio: p.maxPixelRatio })
          }}
          data-graphics-quality
        >
          <option value="low">Thấp (máy yếu)</option>
          <option value="medium">Vừa</option>
          <option value="high">Cao</option>
        </select>
        <span className="setting-value muted">chỉ đổi hình, không đổi gameplay</span>
      </label>
      <label className="setting-row">
        <span>Bóng đổ</span>
        <select value={s.shadows} onChange={(e) => s.set({ shadows: e.target.value as ShadowQuality })}>
          <option value="off">Tắt (nhanh nhất)</option>
          <option value="low">Thấp</option>
          <option value="high">Cao</option>
        </select>
        <span className="setting-value muted">GPU tích hợp: chọn Thấp/Tắt</span>
      </label>
      <label className="setting-row">
        <span>Độ phân giải</span>
        <select value={s.maxPixelRatio} onChange={(e) => s.set({ maxPixelRatio: Number(e.target.value) })}>
          <option value={1}>1× (nhẹ)</option>
          <option value={1.5}>1.5×</option>
          <option value={2}>2× (nét, nặng)</option>
        </select>
        <span className="setting-value muted">giới hạn pixel ratio</span>
      </label>
      <label className="setting-row">
        <span>Thế chiến đấu</span>
        <select value={s.combatStance} onChange={(e) => s.set({ combatStance: e.target.value === 'toggle' ? 'toggle' : 'hold' })} data-combat-stance>
          <option value="hold">Giữ chuột phải</option>
          <option value="toggle">Bấm chuột phải để bật/tắt</option>
        </select>
        <span className="setting-value muted">chuột trái chỉ đánh khi đang ở thế</span>
      </label>
      <label className="setting-row">
        <span>Cỡ cửa sổ túi đồ</span>
        <select value={s.uiScale} onChange={(e) => s.set({ uiScale: Number(e.target.value) as UiScale })} data-ui-scale>
          <option value={1}>100%</option>
          <option value={1.25}>125%</option>
          <option value={1.5}>150%</option>
        </select>
        <button type="button" onClick={() => useInventoryUiStore.getState().resetLayout()} data-reset-layout>
          Đặt lại bố cục
        </button>
      </label>
      <label className="setting-row">
        <span>Gợi ý phím</span>
        <input type="checkbox" checked={s.showHints} onChange={(e) => s.set({ showHints: e.target.checked })} />
        <span className="setting-value">{s.showHints ? 'Hiện trên HUD' : 'Ẩn'}</span>
      </label>
      <label className="setting-row">
        <span>Hiệu ứng tầm nhìn</span>
        <input type="checkbox" checked={s.visionOverlay} onChange={(e) => s.set({ visionOverlay: e.target.checked })} />
        <span className="setting-value">{s.visionOverlay ? 'Bật (ngoài tầm nhìn hơi mờ)' : 'Tắt'}</span>
      </label>
      <div className="actions">
        <button onClick={s.reset}>Mặc định</button>
        <button onClick={onBack}>Quay lại</button>
      </div>
    </div>
  )
}

/** Hướng dẫn mục tiêu và điều khiển (kế hoạch Sprint 6: hướng dẫn điều khiển trong game). */
export function GuidePanel({ onBack }: { onBack: () => void }) {
  return (
    <div className="guide">
      <h2>Hướng dẫn</h2>
      <p>
        Bạn tỉnh dậy trong <b>nhà an toàn</b> giữa khu phố bị zombie tràn vào. Mục tiêu: <b>sống sót</b> càng lâu càng tốt.
        Đói và khát giảm dần theo thời gian; về 0 thì mất máu. Zombie đông hơn về đêm.
      </p>
      <ol className="guide-steps">
        <li>Bạn bắt đầu tay không. Mở <b>tủ quần áo</b> trong nhà an toàn (<kbd>E</kbd>): cửa sổ <b>Lục đồ</b> hiện bên phải, <b>Túi đồ</b> bên trái. Nhấp đúp một món để lấy, hoặc chọn nhiều (<kbd>Ctrl</kbd>/<kbd>Shift</kbd>+click) rồi <b>Lấy đã chọn</b>; <b>Lấy hết</b> lấy cả tủ. Chuột phải vũ khí trong túi → <b>Trang bị</b>. Tủ đồ bên cạnh có nước, đồ hộp, băng gạc.</li>
        <li>Ra <b>cửa hàng tiện lợi</b> (phía đông) và <b>nhà dân</b> (đông nam) để tìm thêm đồ; mỗi tủ chỉ có một lượt loot.</li>
        <li>Trong túi: rê chuột lên món để xem chi tiết, chuột phải để mở menu (ăn, uống, dùng, trang bị, cất, bỏ xuống, yêu thích). Nước hồi khát, đồ ăn hồi đói, băng gạc/hộp cứu thương hồi máu. Tìm kiếm, lọc theo loại và bấm tiêu đề cột để sắp xếp. Cửa sổ kéo bằng thanh tiêu đề, kéo góc để đổi cỡ, ghim/thu gọn/đóng ở góc phải.</li>
        <li>Zombie tới gần: <b>giữ chuột phải</b> để vào thế chiến đấu (nhân vật nâng vũ khí và quay dần về phía con trỏ, đi chậm lại, không chạy được), rồi <kbd>chuột trái</kbd> để đánh; đánh ra sau lưng thì nhân vật phải quay người trước nên đòn tới chậm hơn. Ngoài thế chiến đấu chuột trái không đánh. Cài đặt có chế độ bấm chuột phải để bật/tắt. Mỗi đòn trúng mất 1 độ bền; vũ khí <b>hỏng</b> (0) chỉ còn 20% sát thương, hãy đổi vũ khí khác. Kệ dụng cụ ở cửa hàng có búa, ống sắt/xà beng hiếm hơn. Bị vây thì <kbd>Space</kbd> đẩy ra rồi chạy (<kbd>Shift</kbd>).</li>
        <li>Sửa vũ khí: mở túi (<kbd>I</kbd>), chuột phải vũ khí → <b>Sửa</b>. Đồ gỗ (gậy) cần 1 ván gỗ + 1 băng keo (+30), đồ kim loại (ống sắt, xà beng, búa) cần 1 kim loại vụn + 1 băng keo (+25). Vũ khí hỏng vẫn sửa được. Nút <b>Chế tạo</b> trên thanh tiêu đề Túi đồ mở cửa sổ chế tạo gậy gỗ tự chế (2 ván + 1 băng keo). Vật liệu ở hộp đồ nghề nhà an toàn, kệ vật liệu cửa hàng, đống phế liệu sau nhà dân.</li>
        <li>Sửa/chế tạo mất vài giây: di chuyển, đánh, bị trúng đòn hoặc <kbd>X</kbd> sẽ hủy và không mất nguyên liệu. Thời gian vẫn chạy khi mở túi; <kbd>Esc</kbd> tạm dừng thì thao tác dừng theo.</li>
        <li>Zombie lang thang theo từng đàn và thỉnh thoảng cả đàn kéo sang khu khác. Chúng <b>nhìn</b> phía trước mặt và <b>nghe tiếng bước chân</b> quanh mình (chạy nghe xa hơn đi bộ; đứng yên thì im lặng; tường làm tiếng nhỏ đi). Lẻn sau lưng zombie thì đi chậm.</li>
        <li>Bạn chỉ <b>thấy</b> zombie trong hình quạt phía trước nhân vật (theo hướng nhân vật quay, không theo camera) và không bị tường/cửa đóng che; zombie đứng sát bên cạnh hay sau lưng vẫn nhận ra. Ngoài tầm nhìn zombie mờ dần rồi biến mất; khung cảnh vẫn sáng theo giờ trong ngày, chỉ hơi dịu đi phía sau lưng, nhưng chúng vẫn đi lại, đuổi và đập cửa bình thường: hãy quay lại nhìn khi nghe tiếng động.</li>
        <li>Trong nhà sáng nhờ <b>cửa sổ</b> và cửa mở; phòng sâu không cửa sổ (phòng ngủ nhà dân) tối hơn, đóng cửa phòng thì tối hẳn. <b>Công tắc đèn</b> cạnh cửa (<kbd>E</kbd>) bật đèn trần, hữu ích ban đêm (cần điện). Đứng sát cửa sổ bên trong nhấn <kbd>E</kbd> để kéo/mở <b>rèm</b>: bớt ánh sáng và che tầm nhìn qua kính.</li>
        <li>Đóng cửa sau lưng (<kbd>E</kbd>): zombie không mở được cửa, nhưng con nào vừa <b>thấy hoặc nghe</b> bạn sẽ <b>đập cửa</b> (tiếng thình thịch, cửa rung và sẫm dần) và phá được sau vài chục giây. Zombie chưa hề phát hiện bạn thì không biết bạn ở trong nhà.</li>
        <li>Game tự lưu mỗi phút; <kbd>Esc</kbd> → Lưu game để lưu ngay. Chết là mất bản lưu.</li>
      </ol>
      <ul className="controls">
        <li><kbd>W A S D</kbd> di chuyển</li>
        <li><kbd>Shift</kbd> chạy (tiêu thể lực)</li>
        <li><kbd>Giữ chuột phải</kbd> thế chiến đấu, ngắm theo con trỏ</li>
        <li><kbd>Chuột trái</kbd> (khi đang ở thế) đánh</li>
        <li><kbd>Space</kbd> đẩy zombie ra xa</li>
        <li><kbd>E</kbd> tương tác cửa/tủ</li>
        <li><kbd>I</kbd> túi đồ, sửa, chế tạo</li>
        <li><kbd>X</kbd> hủy sửa/chế tạo đang làm</li>
        <li><kbd>Con lăn</kbd> zoom camera</li>
        <li><kbd>Esc</kbd> đóng menu → hủy thao tác → đóng cửa sổ → rời thế chiến đấu → tạm dừng (mỗi lần một bước)</li>
        <li><kbd>F3</kbd> overlay debug (FPS)</li>
        <li><kbd>F4</kbd> debug tầm nhìn người chơi</li>
        <li><kbd>F6</kbd> debug ánh sáng trong nhà</li>
      </ul>
      <div className="actions">
        <button onClick={onBack}>Quay lại</button>
      </div>
    </div>
  )
}
