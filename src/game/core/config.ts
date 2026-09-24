/**
 * Cấu hình gameplay tập trung. Các giá trị là "giá trị thử nghiệm" theo kế hoạch
 * Phase 1 và sẽ được chỉnh sau playtest. Quy ước 1 đơn vị thế giới ≈ 1 mét.
 */
export const GAME_CONFIG = {
  world: {
    size: 50,
  },
  loop: {
    /** Giới hạn delta time (giây) sau khi tab mất focus / khựng hình. */
    maxDelta: 0.1,
    /** Nhịp đồng bộ HUD (giây). HUD không cần rerender 60 lần/giây. */
    hudSyncInterval: 0.1,
  },
  player: {
    maxHealth: 100,
    maxStamina: 100,
    maxHunger: 100,
    maxThirst: 100,
    walkSpeed: 4,
    runSpeed: 7,
    /** Stamina tiêu khi chạy (mỗi giây). */
    sprintStaminaPerSec: 15,
    /** Stamina hồi mỗi giây khi không chạy/đánh. */
    staminaRegenPerSec: 12,
    /** Thời gian chờ trước khi hồi stamina sau khi dùng. */
    staminaRegenDelay: 0.6,
    /** Không thể bắt đầu chạy khi stamina dưới ngưỡng này. */
    minStaminaToRun: 5,
    radius: 0.4,
    height: 1.8,
    mass: 80,
  },
  survival: {
    /** Hunger giảm 100 → 0 trong ~20 phút thời gian game. */
    hungerPerSec: 100 / 1200,
    /** Thirst giảm 100 → 0 trong ~15 phút thời gian game. */
    thirstPerSec: 100 / 900,
    /** Mất máu mỗi giây cho mỗi chỉ số (hunger/thirst) đang ở mức 0. */
    starvationDamagePerSec: 1,
  },
  zombie: {
    health: 50,
    speed: 2.3,
    detectRange: 10,
    attackRange: 1.5,
    damage: 10,
    attackCooldown: 1.5,
    /** Tần suất kiểm tra phát hiện (giây), thấp hơn tần suất render. */
    detectInterval: 0.2,
    /** Thời gian mất mục tiêu trước khi quay lại IDLE. */
    loseTargetDelay: 3,
    /** Khi đang đuổi, zombie giữ mục tiêu ở tầm xa hơn tầm phát hiện ban đầu. */
    chaseRange: 14,
    /** Thời gian vung tay trước khi gây sát thương; người chơi có thể né. */
    attackWindup: 0.3,
    /** Thời gian tối đa đi tới vị trí cuối thấy người chơi trước khi bỏ cuộc. */
    searchTimeout: 8,
    /** Tách zombie khỏi nhau để không chồng lên một điểm. */
    separationRadius: 1.1,
    separationSpeed: 1.2,
    /** Vận tốc knockback giảm theo exp(-damping·t); quãng đường = tốc độ ban đầu / damping. */
    knockbackDamping: 8,
    radius: 0.4,
    height: 1.8,
    mass: 60,
  },
  nav: {
    /** Kích thước ô lưới điều hướng (đơn vị thế giới). */
    cellSize: 0.5,
    /** Bán kính tác nhân dùng để nới rộng vật cản khi dựng lưới. */
    agentRadius: 0.4,
    /** Khoảng cách tối thiểu giữa hai lần tìm đường cho cùng một zombie. */
    repathInterval: 0.4,
    /** Mục tiêu dịch xa hơn ngưỡng này thì mới tìm đường lại. */
    repathTargetDelta: 0.75,
    /** Coi như đã tới waypoint khi cách dưới ngưỡng này. */
    waypointReachDist: 0.35,
    /** Không tiến được trong khoảng này thì buộc tìm đường lại. */
    stuckTime: 1,
  },
  melee: {
    damage: 25,
    range: 2,
    cooldown: 1,
    stamina: 12,
    /** Quãng đường zombie bị đẩy lùi khi trúng gậy. */
    knockback: 1,
    /** Thời điểm gây sát thương tính từ lúc bắt đầu vung. */
    hitDelay: 0.15,
    /** Thời gian animation vung gậy. */
    swingDuration: 0.35,
    /** Nửa góc hình quạt trúng đòn (độ) tính từ hướng nhìn. */
    halfAngleDeg: 60,
    /** Zombie trúng gậy đứng khựng trong khoảng này. */
    stagger: 0.2,
  },
  push: {
    range: 1.8,
    /** Đẩy là công cụ thoát thân, không phải khóa nhóm: cooldown dài và tốn thể lực. */
    cooldown: 2,
    stamina: 20,
    knockback: 2.5,
    halfAngleDeg: 75,
    stagger: 0.45,
  },
  inventory: {
    /** Số ô túi người chơi (kế hoạch: 12 ô). */
    slots: 12,
    /** Số ô mỗi container; loot sinh ra không vượt số này. */
    containerSlots: 8,
    /** Người chơi đi xa container quá tầm tương tác cộng dư này thì panel tự đóng. */
    closeDistanceSlack: 0.75,
  },
  camera: {
    /** Vị trí camera so với nhân vật; hướng nhìn isometric. */
    offset: { x: 20, y: 24, z: 20 },
    zoomMin: 14,
    zoomMax: 60,
    zoomDefault: 28,
    zoomStep: 2,
    /** Hệ số làm mượt theo nhân vật (càng lớn càng bám sát). */
    followSmoothing: 8,
  },
  clock: {
    /** Độ dài một ngày game tính bằng giây thực. */
    dayLengthSec: 600,
    /** Giờ bắt đầu ván mới (0..1, 0.3 ≈ 7h sáng). */
    startTimeOfDay: 0.3,
    /** Ban đêm khi timeOfDay < nightEnd hoặc > nightStart (khớp `GameClock.isNight`). */
    nightEnd: 0.22,
    nightStart: 0.8,
  },
  lighting: {
    /** Độ dài đoạn chuyển bình minh/hoàng hôn (đơn vị timeOfDay). */
    twilight: 0.06,
    dayAmbient: 0.55,
    nightAmbient: 0.3,
    dayHemisphere: 0.5,
    nightHemisphere: 0.22,
    daySun: 1.6,
    nightSun: 0.3,
    daySunColor: '#fff2dc',
    nightSunColor: '#7d8fc4',
    dayAmbientColor: '#ffffff',
    nightAmbientColor: '#7c8cc0',
    dayBackground: '#161a21',
    nightBackground: '#070910',
  },
  spawn: {
    /** Số zombie còn sống tối đa cùng lúc. */
    maxActive: 10,
    /** Khoảng cách giữa hai lần spawn (giây) ban ngày/ban đêm. */
    intervalDay: 25,
    intervalNight: 12,
    /** Điểm spawn phải cách người chơi ít nhất chừng này. */
    minDistance: 16,
    /** Không spawn chồng lên zombie còn sống. */
    minZombieGap: 2,
    /** Xác zombie được dọn sau khoảng này để danh sách không phình. */
    corpseLifetime: 20,
  },
  save: {
    /** Tự động lưu mỗi chừng này giây game (ở ranh giới tick). */
    autosaveInterval: 60,
  },
}

export type GameConfig = typeof GAME_CONFIG
