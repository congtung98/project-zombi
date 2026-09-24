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
    speed: 2,
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
    attackWindup: 0.4,
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
    cooldown: 0.8,
    stamina: 10,
    /** Quãng đường zombie bị đẩy lùi khi trúng gậy. */
    knockback: 1.5,
    /** Thời điểm gây sát thương tính từ lúc bắt đầu vung. */
    hitDelay: 0.15,
    /** Thời gian animation vung gậy. */
    swingDuration: 0.35,
    /** Nửa góc hình quạt trúng đòn (độ) tính từ hướng nhìn. */
    halfAngleDeg: 60,
    /** Zombie trúng gậy đứng khựng trong khoảng này. */
    stagger: 0.35,
  },
  push: {
    range: 1.8,
    cooldown: 1.2,
    stamina: 15,
    knockback: 3,
    halfAngleDeg: 75,
    stagger: 0.6,
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
  },
}

export type GameConfig = typeof GAME_CONFIG
