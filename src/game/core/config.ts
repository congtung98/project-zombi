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
    /**
     * Metres per full gait cycle (two footsteps). Drives both the leg animation and the footstep
     * sounds: walking ≈ 3.6 steps/s, running ≈ 4.4 steps/s (Phase 2 S3 used 1.5 m for both).
     */
    walkStride: 2.2,
    runStride: 3.2,
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
    /**
     * P2-S5 (plan §10.1): a sighting or heard footstep is remembered this long. SEARCH gives up
     * when the memory is older (replaces Phase 1's fixed 8 s search timeout).
     */
    memoryDuration: 20,
    /**
     * Unaware zombies (IDLE/WANDER/MIGRATE) only see inside this half-angle around their facing;
     * hunting zombies track all around. 180 restores Phase 1's all-round vision.
     */
    viewHalfAngleDeg: 70,
    /** Anything this close is noticed whatever the facing (bumping into the player). */
    closeSenseRange: 1.2,
    /** Considered at a SEARCH/WANDER goal within this distance. */
    arriveDistance: 0.75,
    /** Wander: rest a random time, walk to a random reachable point around the zone, repeat. */
    wanderSpeed: 0.9,
    wanderRestMin: 3,
    wanderRestMax: 8,
    /** Radius around the spawn point when the map has no zones (test/lab maps). */
    wanderRadius: 6,
    /** Skip wander targets closer than this (the zombie would barely move). */
    wanderMinStep: 1.5,
    /** Give up a wander/migration leg after this long (blocked by other zombies, etc.). */
    wanderTimeout: 20,
    migrateSpeed: 1.4,
    migrateTimeout: 60,
    /** Tách zombie khỏi nhau để không chồng lên một điểm. */
    separationRadius: 1.1,
    separationSpeed: 1.2,
    /** Vận tốc knockback giảm theo exp(-damping·t); quãng đường = tốc độ ban đầu / damping. */
    knockbackDamping: 8,
    radius: 0.4,
    height: 1.8,
    mass: 60,
  },
  /**
   * P2-S5 hearing: the player's footsteps reach every zombie within a fixed radius (walking vs
   * running), in any direction. Walls/closed doors between them shrink the radius by `wallFactor`.
   * Standing still, crafting or opening doors makes no footstep noise.
   */
  hearing: {
    walkRadius: 5,
    runRadius: 12,
    wallFactor: 0.5,
  },
  /** P2-S5 zombies bashing doors (plan §10.4): 10 structure damage every 1.2 s (windup 0.3 + 0.9). */
  structure: {
    damage: 10,
    /** Cooldown after a structure hit; the zombie windup (`zombie.attackWindup`) comes on top. */
    cooldown: 0.9,
    /** Max distance from the zombie to the door centre to hit it. */
    reach: 1.3,
    /** Keep bashing this long after the last new information about the player, then give up. */
    siegeHold: 60,
    /** Zombies without one of the two contact slots per door side wait this far from the door. */
    queueDistance: 2.4,
  },
  /**
   * P2-S5 horde migration: an external director every few minutes pushes every zombie of one zone
   * (group) to another zone. Only zombies that are not hunting start walking at once; hunters
   * keep hunting and wander in the new zone afterwards.
   */
  horde: {
    intervalMin: 90,
    intervalMax: 180,
    /** A zone needs at least this many idle/wandering zombies to migrate. */
    minGroupSize: 2,
    /** Retry sooner when no zone had a group this time. */
    retryDelay: 20,
  },
  /**
   * Player vision (sprint "tầm nhìn"): what the player character can see, separate from the camera
   * and from zombie perception. Only affects how zombies are drawn; AI never reads it. It is not a
   * light: world lighting belongs to `lighting` + the day/night clock (`rendering/Lights.tsx`) only.
   * Heights are absolute (the map is flat, ground at y = 0).
   */
  playerVision: {
    /** Zombies this close are noticed in any direction (behind the back), still not through walls. */
    nearDetectionRadius: 2.5,
    /** true = the near radius also sees through walls/closed doors (Project Zomboid "sense"). */
    nearDetectionThroughWalls: false,
    visionDistance: 20,
    /** Full cone angle (degrees) around the character's facing, not the camera. */
    fieldOfView: 110,
    playerEyeHeight: 1.6,
    zombieTargetHeight: 1.2,
    /** Seconds for a full fade in/out (opacity 0 ↔ 1). */
    visibilityFadeDuration: 0.2,
    /** Keep a zombie shown this long after losing sight (visual smoothing, not AI memory). */
    visibilityGracePeriod: 0.15,
    /** Milliseconds between two visibility passes (≈ 20 passes/s); fading runs every frame. */
    visionUpdateInterval: 50,
    /** LOS raycasts per pass; with more candidates the stalest ones are re-checked first. */
    maxRaycastsPerUpdate: 48,
    /** Walls/furniture whose top reaches this height block sight (fences, crates, cars and beds do not). */
    occluderMinHeight: 1.5,
    /** Debug drawing (DEBUG_PLAYER_VISION); F4 toggles it in game, `?vision=debug` starts with it on. */
    debug: false,
  },
  /**
   * VisionOverlay: a subtle perception layer (one full-screen pass drawn over the finished frame).
   * It is NOT lighting: it never touches lights, exposure or materials, only reads the daylight
   * factor to scale itself. Cone, near radius and distance come from `playerVision`.
   * Perceived brightness = 1 − alpha: inside vision 100 %, outside ≈ 92 %, never below 85 %.
   */
  visionOverlay: {
    enabled: true,
    insideOpacity: 0,
    outsideOpacity: 0.08,
    /** Inside the cone but behind a wall/closed door/tall furniture (LOS sector mask). */
    blockedOpacity: 0.12,
    /** Hard clamp of the final alpha. */
    maxOpacity: 0.15,
    /** Soft cone edge, in cosine units around cos(FOV/2). */
    edgeSoftness: 0.2,
    /** Near the player the overlay is ~35 % of its value and ramps to 100 % towards the far distance. */
    nearDistanceShare: 0.35,
    /** Seconds (time constant) the overlay direction trails the character facing: ≈ 60 ms response. */
    directionSmoothing: 0.06,
    /** Strength by world light (read only): full in daylight, half at night (the night is dark already). */
    daytimeStrength: 1,
    nighttimeStrength: 0.5,
    /** Darken areas behind occluders inside the cone (sector mask of `losRays` rays, no per-pixel raycast). */
    losAware: true,
    losRays: 128,
    /** DEBUG_VISION_OVERLAY: tint the mask so it can be seen; F4 debug also shows direction and alpha. */
    debug: false,
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
  /**
   * damage/range/cooldown/stamina are the Phase 1 bat baseline that `ITEMS.baseball_bat` reuses;
   * other weapons define their own. Timing, arc, knockback and stagger are shared by all melee.
   */
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
  weapon: {
    /** Condition lost once per swing that hits at least one valid target (never per target). */
    wearPerHit: 1,
    /** Damage of a broken weapon (condition 0) = round(base × ratio), minimum 1. */
    brokenDamageRatio: 0.2,
    /** Yellow warning when condition ≤ this fraction of max. */
    lowConditionRatio: 0.25,
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

export const PLAYER_VISION_CONFIG = GAME_CONFIG.playerVision
export type PlayerVisionConfig = typeof PLAYER_VISION_CONFIG

export const VISION_OVERLAY_CONFIG = GAME_CONFIG.visionOverlay
export type VisionOverlayConfig = typeof VISION_OVERLAY_CONFIG
