# AX0 — Kiến trúc Character Action & World Interaction (chờ duyệt, chưa code)

> Nhánh `feature/character-action`, ngày 2026-09-30.
>
> **Nguồn:**
> - `docs/Character_Action_System_Spec.md` (CAS);
> - `docs/World_Interaction_System_Spec.md` (WIS);
> - phản hồi của chủ dự án "Yêu cầu chỉnh lại thiết kế Character Action & World Interaction" (gọi tắt **FB**, §1–§17).
>
> **Code đối chiếu:** master `25a9ff4`, sau INV-LOOT S6. Tên file và hàm dưới đây là tên thật trong repo.
>
> **Quy tắc đợt này:** mỗi sprint tự commit và push lên `feature/character-action`, không merge vào master. Chưa viết code cho tới khi kiến trúc này được duyệt (FB §17).

## 0. Hiện trạng tóm tắt (điểm xuất phát)

| Có sẵn, giữ lại | Ở đâu |
|---|---|
| Hàng đợi có thời gian chạy theo đồng hồ mô phỏng; pause thì đứng; mọi `Job` (chuyển đồ, chế tạo, sửa) chạy lần lượt | `systems/actionQueue.ts`, `runtime.stepQueue` |
| Sổ giữ chỗ duy nhất `ReservationLedger` + claims của job đang chờ | `actionQueue.ts` |
| Commit recipe all-or-nothing (mô phỏng trên bản sao rồi mới ghi) | `systems/crafting.ts commitRecipe` |
| Hủy khi di chuyển, bị đánh, chết, X, Esc; container ra ngoài tầm | `runtime.ts` |
| Thế chiến đấu CS1 (Hold/Toggle), đòn có aim, đệm click | `systems/stance.ts`, `runtime.stepControls/stepCombat` |
| Cửa (mở/đóng/vỡ, HP, nav, collider, save), công tắc đèn, rèm | `world/doors.ts`, `runtime.setDoorState/setLamp/setCurtain` |
| Tủ: ID ổn định, loot sinh một lần, tầm với, Lấy hết chuyển một phần khi đầy | `world/worldState.ts`, `runtime.openLoot/refreshNearby` |
| Pose dựng bằng code, một socket tay phải, balo trên torso | `rendering/character/pose.ts`, `rig.ts`, `PlayerView.tsx` |
| Save v11, không lưu job/giữ chỗ | `systems/save.ts`, `types/save.ts` |

| Còn thiếu (lý do có tài liệu này) |
|---|
| **Registry action:** không có. `Job = TransferJob \| RecipeJob`; `stepQueue`/`jobView` rẽ nhánh theo `job.kind`. |
| **Ăn, uống, băng bó:** chạy tức thời (`consumeItem`), không có thời gian, không animation, không giữ chỗ. |
| **Menu item:** viết cứng theo `def.kind` (`components/inventory/itemActions.ts`). |
| **Tương tác thế giới:** viết cứng bằng chuỗi `if (kind)` (`runtime.describeInteraction/interact`). Không có menu chuột phải trên thế giới, click trái không làm gì ngoài thế, không có picker theo con trỏ ngoài tầm 1 m. |
| **Tự đi tới đối tượng:** không có. `NavWorld.findPath` chỉ zombie dùng. |
| **State machine nhân vật:** không có. Trạng thái rải trong `stance`, `attackTimer`, `jobs`, `moveSpeed`. |

## 1. Sơ đồ kiến trúc cuối cùng

```text
                        INPUT (chuột, E, I, X, Esc, menu UI)
                              │   systems/input.ts (đã lọc UI: nút nhấn trên UI không xuống canvas)
                              ▼
                 ┌──────── Pointer/Input Router ────────┐   interaction/router.ts
                 │ ưu tiên: UI > Combat mode > Object >  │
                 │ Character/Zombie > Ground > fallback  │
                 └──────────────┬────────────────────────┘
                                ▼
                        Interaction System                  interaction/interactionSystem.ts
             (WorldPicker + InteractableProvider + ItemActionProvider)
                                │ InteractionOption (đã lọc, có mặc định, có lý do khóa)
                                ▼
                        Interaction Context  ──► ActionRequest { requestId, ActionContext }
                                │
                                ▼
                           Action System                    actions/actionSystem.ts
         (ActionRegistry · validate · dedupe · queue · approach · reserve · tick · commit · cleanup)
                    ┌───────────┴─────────────┐
                    ▼                         ▼
           Character State Machine     Gameplay Effect (một transaction)   actions/effects.ts
           actions/characterState.ts   stats · items · world objects · events
                    │                         │
                    ▼                         ▼
          Animation System            World state (nguồn chân lý) → save
          CharacterAnimState →        doors/containers/lamps/curtains/...
          AnimationDriver (pose code  → render, collider, nav, lighting đọc lại
          hôm nay, AnimationMixer sau)
                    │
                    ▼
            Visual Feedback (pose, prop trên tay, âm thanh, thanh tiến trình, highlight)
```

**Luồng dữ liệu một chiều:**
- Input chỉ sinh intent. Interaction chỉ sinh option và request. Action System là nơi **duy nhất** tạo gameplay effect.
- Animation chỉ **đọc** trạng thái action (loại, tiến trình) để vẽ; không bao giờ gọi ngược vào gameplay.
- Gameplay state nằm trong `WorldState`/`PlayerState` (đang được save). Visual state (góc lá cửa, pose, prop) được dựng lại từ đó.

**Ba "làn" (lane) của Action System**, cùng registry và cùng `ActionContext`:

| Lane | Dùng cho | Đặc điểm |
|---|---|---|
| `queue` | Ăn, uống, băng bó, mở đồ hộp, mở tủ, chuyển đồ, chế tạo, sửa | Có thời gian; chạy lần lượt; giữ chỗ; hủy theo luật gián đoạn |
| `immediate` | Mở/đóng cửa, bật đèn, kéo rèm, trang bị, đeo balo, yêu thích | Kiểm tra rồi commit ngay trong tick; vẫn qua registry, kiểm tra tầm với, dedupe |
| `combat` | Thế chiến đấu, đòn cận chiến, đẩy | Nhịp độ riêng của combat hiện có (`combat.ts`); được khai báo như action để state machine và gián đoạn dùng chung một luật |

## 2. Interface/type chính

Code TypeScript thật sẽ đặt ở `src/game/actions/` và `src/game/interaction/`. Tên dưới đây là hợp đồng sẽ viết.

### 2.1. Target, Context, Request

```ts
/** Đích của một action: không bao giờ là object Three.js hay bản sao item, chỉ là ID. */
export type TargetRef =
  | { kind: 'item'; instanceId: string; inventory: InventoryKey }      // chai nước trong túi/balo/tủ
  | { kind: 'world'; objectId: string; objectType: string; version: number } // cửa, tủ, đèn, máy phát...
  | { kind: 'character'; entityId: string }                             // zombie (NPC sau này)
  | { kind: 'ground'; point: Vec3 }
  | { kind: 'self' }                                                    // băng bó cho chính mình

/** FB §11: actor, target, item, position, actionType. */
export interface ActionContext {
  actorId: 'player'                 // chuỗi, sẵn cho NPC; phase này chỉ có player
  type: ActionType                  // 'DRINK', 'OPEN_CONTAINER', ...
  target: TargetRef
  /** Món dùng để làm (dụng cụ, nguyên liệu chính) khi khác target: băng gạc khi target = self. */
  item?: { instanceId: string; inventory: InventoryKey }
  /** Điểm trúng của con trỏ hoặc anchor đã chọn. */
  position?: Vec3
  /** Số lượng/phần (clamp khi validate). */
  amount?: number
  source: 'inventory-menu' | 'world-menu' | 'left-click' | 'key-e' | 'double-click' | 'hotkey' | 'combat' | 'system'
}

export interface ActionRequest {
  /** Chặn click kép: cùng requestId gửi lại thì bị bỏ qua (runtime nhớ 64 ID gần nhất). */
  requestId: string
  ctx: ActionContext
}

/** Mã lý do chung cho UI (CAS §5.2, WIS §14): một bảng, một bộ nhãn tiếng Việt. */
export type ActionFailure =
  | 'DEAD' | 'BUSY' | 'MISSING_ITEM' | 'RESERVED' | 'QUEUED' | 'FULL' | 'OUT_OF_RANGE' | 'NO_PATH'
  | 'NOT_VISIBLE' | 'TARGET_CHANGED' | 'TARGET_GONE' | 'NO_EFFECT' | 'MISSING_TOOL' | 'MISSING_INPUT'
  | 'NOT_CARRIED' | 'LOCKED' | 'NO_POWER' | 'QUEUE_FULL' | 'DUPLICATE'
```

`ActionType` là `string` có danh sách hằng (`ACTION.DRINK`, ...), để feature mới đăng ký loại mới mà không sửa union trung tâm.

### 2.2. Định nghĩa action (Action ≠ Animation)

```ts
export interface ActionDefinition<Data = unknown> {
  type: ActionType
  lane: 'queue' | 'immediate' | 'combat'
  /** Trạng thái nhân vật khi action chạy (FB §4): 'DRINKING', 'LOOTING', ... */
  characterState: CharacterState
  /** Giây mô phỏng; 0 = xong trong tick. Hàm để tính theo item/recipe/khối lượng. */
  duration: number | ((ctx: ActionContext, w: ActionWorld) => number)
  /** FB §3 "interruptible", chi tiết theo từng nguồn gián đoạn. */
  interrupt: InterruptPolicy
  /** Cần đứng gần target (WIS §8); không có = không cần tiếp cận (item trong túi). */
  reach?: ReachRule
  /** FB §3 "requiredItem": dụng cụ theo tag hoặc món cụ thể; kiểm tra khi validate, begin, commit. */
  requires?: ItemRequirement[]
  label(ctx: ActionContext, w: ActionWorld): string

  /** Kiểm tra (lúc gửi, lúc tới lượt, lúc commit). Không ghi gì. */
  validate(ctx: ActionContext, w: ActionWorld): ActionCheck
  /** Phần của hàng tồn mà action đang chờ "hứa" dùng (claims hiện có của INV-LOOT). */
  claims?(ctx: ActionContext, w: ActionWorld): Claim[]
  /** Tới lượt: kiểm tra lại, giữ chỗ, trả về thời lượng bước và dữ liệu riêng. Multi-step (chuyển đồ) gọi lại mỗi bước. */
  begin(ctx: ActionContext, w: ActionWorld, job: ActionJob<Data>): BeginResult<Data>
  /**
   * Hết thời gian: kiểm tra lại (canCommit) rồi trả về MỘT mutation (FB §3 "effects").
   * Action System áp dụng nó như một transaction.
   */
  commit(ctx: ActionContext, w: ActionWorld, job: ActionJob<Data>): CommitResult
  /** Dọn dữ liệu riêng khi hủy (giữ chỗ do Action System tự nhả). */
  cancel?(ctx: ActionContext, w: ActionWorld, job: ActionJob<Data>): void

  /** Chỉ là mô tả trình diễn; Animation System đọc nó, action không biết pose/clip. */
  presentation: ActionPresentation
}

export interface InterruptPolicy {
  move: 'cancel' | 'allow'          // người chơi bấm WASD
  hit: 'cancel' | 'allow'           // bị đánh (đói không tính)
  attack: 'cancel' | 'allow'        // người chơi tự đánh/đẩy
  stance: 'cancel' | 'allow'        // vào thế chiến đấu
}

export interface ActionPresentation {
  anim: AnimGroup                   // 'eat' | 'drink' | 'medical' | 'work' | 'reach' | 'none' | combat groups
  prop?: { from: 'target-item' | 'item' | 'tool'; hand: 'right' | 'left' }
  hideWeapon?: boolean              // cất vũ khí khi tay bận, trả lại khi xong/hủy
  sfx?: { start?: SfxName; done?: SfxName; cancel?: SfxName }
}

export type CommitResult =
  | { ok: true; mutation: Mutation; next?: 'done' | 'another-step' }
  | { ok: false; failure: ActionFailure }
```

### 2.3. Gameplay Effect (transaction)

```ts
/** FB §2 tầng "Gameplay Effect": danh sách thay đổi, áp dụng tất cả hoặc không gì cả. */
export type GameplayEffect =
  | { type: 'stat'; stat: 'health' | 'hunger' | 'thirst' | 'stamina'; delta: number }
  | { type: 'item.consume'; instanceId: string; quantity: number }
  | { type: 'item.transform'; instanceId: string; to: ItemId; quantity: number }   // đồ hộp → hộp đã mở
  | { type: 'item.create'; inventory: InventoryKey; itemId: ItemId; quantity: number }
  | { type: 'world.set'; objectId: string; objectType: string; patch: Record<string, unknown> }
  | { type: 'inventory.commit'; prepared: PreparedInventoryChange }                 // chuyển đồ/craft đã mô phỏng sẵn
  | { type: 'event'; name: keyof GameEvents; payload: unknown }

export interface Mutation { effects: GameplayEffect[] }
```

`EffectApplier.apply(mutation)` chạy hai pha:
1. Kiểm tra mọi effect trên state hiện tại, và kiểm tra các effect item trên bản sao inventory, như `commitRecipe` đang làm.
2. Ghi thật.

Pha 1 lỗi thì không có thay đổi nào. `world.set` đi qua adapter của loại object tương ứng (ví dụ `setDoorState`), nên collider, nav, lighting và event cập nhật như hiện nay. `inventory.commit` bọc lõi `transferItems`/`commitRecipe` sẵn có, nên luật INV-LOOT không đổi.

### 2.4. Job đang chạy

```ts
export type ActionStatus = 'queued' | 'approaching' | 'running' | 'committing' | 'completed' | 'cancelled' | 'failed'

export interface ActionJob<Data = unknown> {
  id: number                 // executionId: commit tối đa một lần
  requestId: string
  def: ActionDefinition<Data>
  ctx: ActionContext
  status: ActionStatus
  step: { duration: number; elapsed: number } | null
  data: Data                 // riêng của handler: dòng chuyển, plan recipe...
  approach: ApproachState | null
}
```

`runtime.jobs: Job[]` hiện nay sẽ thành `ActionJob[]`. `TransferJob` và `RecipeJob` trở thành `data` của hai định nghĩa `TRANSFER` và `CRAFT`/`REPAIR`. `jobView`, `queuedClaims` và `ReservationLedger` giữ nguyên hợp đồng.

### 2.5. Interactable (FB §5, §9, §16)

```ts
/** Một provider cho mỗi loại object; Character Controller/runtime không biết loại cụ thể. */
export interface InteractableProvider<State = unknown> {
  type: string                                   // 'door' | 'container' | 'light' | 'curtain' | 'generator' ...
  /** Dựng danh sách object + hình pick + anchor từ map (thay `buildInteractables`). */
  build(map: MapData): InteractableInfo[]
  /** Đọc gameplay state thật (không đọc mesh). */
  state(id: string, w: ActionWorld): State | null
  canInteract(obj: InteractableInfo, ictx: InteractionContext): boolean
  /** Các option theo instance state, đã có nhãn, mặc định, và lý do nếu bị khóa. */
  getActions(obj: InteractableInfo, ictx: InteractionContext): InteractionOption[]
  getInteractionContext(obj: InteractableInfo, ictx: InteractionContext): { name: string; summary: string }
}

export interface InteractableInfo {
  id: string
  type: string
  name: string
  position: Vec3
  radius: number                                 // tầm với như hiện nay
  pick: PickVolume                               // hộp/trụ để chọn bằng con trỏ
  anchors(w: ActionWorld): Vec3[]                // chỗ đứng để thao tác (cửa: hai phía; tủ: phía trước)
}

export interface InteractionOption {
  id: string                                     // 'door.open', 'container.open', ...
  actionType: ActionType
  label: string
  isDefault?: boolean                            // click trái / E
  priority?: number
  /** null = bấm được; có lý do = hiện mờ kèm lý do; hidden = không hiện. */
  blocked: null | { reason: ActionFailure; text: string; hidden?: boolean }
  /** FB §5 "executeAction": object không tự làm, nó tạo request cho Action System. */
  toContext(): ActionContext
}
```

Ghi chú khớp FB §5 và §9:
- Các hàm `canInteract` / `getActions` / `getInteractionContext` có đúng như FB mô tả.
- `executeAction` của FB được hiện thực là `InteractionSystem.execute(option)`, tức `ActionSystem.submit({ requestId, ctx: option.toContext() })`.
- Object **không** chứa code thay đổi state. Code đó nằm trong `ActionDefinition.commit` → `world.set` → adapter. Nhờ vậy mọi đường (click trái, menu, E, script) đều đi qua cùng một executor.

**Version:** `WorldObjectVersions` là một `Map<id, number>` chỉ sống lúc chạy. Bộ đếm tăng mỗi khi `setDoorState` / `setLamp` / `setCurtain` / trạng thái tủ đổi. Request mang `version`. Tới lúc làm mà version khác thì action được kiểm tra lại; nếu không còn hợp lệ, trả `TARGET_CHANGED` (WIS §5). Bộ đếm này không vào save.

### 2.6. Item theo action (FB §6, §8)

```ts
/** Thêm vào ItemDefinition: thành phần (component) thay cho rẽ nhánh theo `kind`. */
export interface ItemComponents {
  consumable?: {
    action: 'EAT' | 'DRINK' | 'HEAL'
    /** Số phần của một đơn vị; phase này mọi món = 1 (một lần dùng hết một đơn vị). */
    portions: number
    perPortion: ItemEffect                       // effect hiện có: health/hunger/thirst/stamina
    secondsPerPortion: number
    /** Còn lại gì khi hết (lon rỗng...); phase này không dùng. */
    leaves?: ItemId
  }
  /** Đồ còn niêm phong: phải OPEN trước khi dùng (FB §8). */
  sealed?: { opensTo: ItemId; seconds: number; requiresToolTag?: ToolTag }   // 'can_opener' sau này
  equippable?: { slot: 'weapon' | 'back' }
  repairable?: { group: RepairGroup }
  // Sau này (chỉ đặt chỗ, chưa có code): perishable, cookable, fluidContainer, utensil, ingredient
}

/** Mỗi component góp action của nó; UI chỉ render danh sách này. */
export interface ItemActionProvider {
  id: string
  options(item: ItemInstance, where: InventoryKey, ictx: InteractionContext): InteractionOption[]
}
```

Luồng: `ItemActionRegistry.options(item)` gộp các option do component đóng góp (consumable → Ăn/Uống/Băng bó; sealed → Mở; equippable → Trang bị/Đeo; repairable → Sửa), rồi cộng các option chung của inventory (Chuyển tới…, Chọn số lượng…, Bỏ xuống, Yêu thích, Xem). `menuEntries` trong `itemActions.ts` trở thành bộ chuyển option thành dòng menu. Nó không còn `if (def.kind === 'food')`.

**Chỗ cho ăn dở và thêm component (FB §8):**
- Instance hiện là `stack | weapon | tool | bag | unknown`.
- Khi có món `portions > 1`, sẽ thêm kind `portioned { remaining }` bằng save v12 (migration cộng thêm, không sửa kind cũ).
- `perishable` sẽ thêm `bornAt` vào instance theo cùng cách.
- Action System, menu và effect không phải viết lại, vì chúng đọc component chứ không đọc tên món.

### 2.7. Animation (FB §7)

```ts
/** Trạng thái hình ảnh nhân vật, dựng mỗi frame từ runtime (chỉ đọc). */
export interface CharacterAnimState {
  state: CharacterState
  locomotion: { speed: number; gaitPhase: number; hipTurn: number }
  action: { group: AnimGroup; elapsed: number; progress: number } | null   // DRINK → 'drink'
  combat: { ready: number; aimLead: number; swing: number; shove: number }
  hurt: number
  dead: number
  props: { right: PropRef | null; left: PropRef | null; hideWeapon: boolean }
}

/** Hôm nay: ProceduralPoseDriver (computePose). Sau này: MixerDriver (AnimationMixer + clip). */
export interface AnimationDriver {
  update(anim: CharacterAnimState, dt: number): void
  dispose(): void
}
```

- **Action → Animation chỉ qua `presentation.anim`**, ví dụ `DRINK` → nhóm `drink`. Pose/clip nào dùng cho nhóm đó là việc của driver.
- **Đổi sang AnimationMixer:** chỉ cần viết `MixerDriver` mới; Action System không đổi.
- **Prop:** `itemProps.ts` là registry `itemId → { build(), hand, offset, rotation, scale }`, fallback là một khối nhỏ theo màu của nhóm. Socket: `rightHand` (chính là `weaponSocket` hiện có) và `leftHand` (mới, trên `elbowL`).

## 3. Action State Machine (FB §4)

### 3.1. Trạng thái

```text
IDLE · MOVING · APPROACHING · COMBAT_STANCE · ATTACKING · INTERACTING · LOOTING
EATING · DRINKING · HEALING · CRAFTING · REPAIRING · BUILDING* · DEAD
(* đặt chỗ, chưa có action BUILD)
```

State chỉ có **một** chủ là `CharacterStateMachine` (`actions/characterState.ts`). Đây là hàm thuần `transition(state, event, ctx) → { state, effects }`, trong đó `effects` là các lệnh như "hủy job với lý do X" hay "bỏ thế". Runtime gửi event vào máy trạng thái rồi thực hiện các lệnh nó trả về. Không còn chỗ nào tự quyết định việc hủy ở rải rác như hiện nay (ví dụ `stepPlayerMovement` gọi `cancelAction('moved')`).

### 3.2. Event

`MOVE_INPUT`, `MOVE_STOP`, `STANCE_ON`, `STANCE_OFF`, `ATTACK_START`, `ATTACK_END`, `ACTION_BEGIN(state)`, `ACTION_END(completed|failed|cancelled)`, `APPROACH_BEGIN`, `APPROACH_END`, `HIT`, `DIED`, `RESET` (New Game/load/pause-blur).

### 3.3. Bảng chuyển trạng thái

| Từ | Event | Tới | Lệnh kèm theo |
|---|---|---|---|
| IDLE | MOVE_INPUT | MOVING | — |
| MOVING | MOVE_STOP | IDLE | — |
| IDLE/MOVING | STANCE_ON | COMBAT_STANCE | — |
| COMBAT_STANCE | STANCE_OFF | IDLE / MOVING | — |
| COMBAT_STANCE | ATTACK_START | ATTACKING | — |
| ATTACKING | ATTACK_END | COMBAT_STANCE nếu còn giữ thế, không thì IDLE | — |
| IDLE/MOVING | ACTION_BEGIN(s) | s (EATING, DRINKING, LOOTING, ...) | — |
| IDLE/MOVING | APPROACH_BEGIN | APPROACHING | — |
| APPROACHING | APPROACH_END(ok) | trạng thái của action | begin action |
| APPROACHING | APPROACH_END(fail) / MOVE_INPUT | IDLE / MOVING | fail `NO_PATH` / hủy `moved` |
| action* | ACTION_END | IDLE, hoặc action kế tiếp trong hàng đợi | dọn presentation |
| action* | MOVE_INPUT | MOVING | hủy nếu `interrupt.move = 'cancel'` |
| action* | HIT | IDLE, hoặc COMBAT_STANCE nếu đang giữ chuột phải | hủy nếu `interrupt.hit = 'cancel'` |
| action* | STANCE_ON / ATTACK_START | COMBAT_STANCE / ATTACKING | hủy nếu policy = `cancel` |
| bất kỳ | DIED | DEAD | hủy tất cả, bỏ thế |
| bất kỳ | RESET | IDLE | xóa hàng đợi, giữ chỗ, prop |

`action*` là mọi trạng thái của lane `queue`.

**Thứ tự xử lý khi nhiều event trong một tick:** DIED > HIT > ATTACK_START/STANCE_ON > MOVE_INPUT > ACTION_END. Nhờ vậy một action không thể hoàn tất trong đúng tick nhân vật bị đánh.

- **Hủy (Cancel behavior):** nhả giữ chỗ, bỏ `step`, emit `action:cancelled` kèm lý do, trả vũ khí về tay và gỡ prop tạm. Không có effect nào được áp dụng. Bước chuyển đồ đã commit thì giữ nguyên (luật INV-LOOT).
- **Mặc định cho item/tương tác:** `{ move: 'cancel', hit: 'cancel', attack: 'cancel', stance: 'cancel' }`, giống hành vi hiện nay.
- **Ghi đè có chủ ý:** chuyển đồ vẫn chạy tiếp khi người chơi vào thế (INV-LOOT S5 cho vào thế khi đang mở cửa sổ). Hiện nay chỉ đánh/đẩy mới hủy job, còn vào thế thì không; phải giữ đúng như vậy để soak test không đổi.

## 4. Interaction Priority (FB §1)

```text
1. UI (cửa sổ, menu, popup)      – input.ts đã chặn: nút nhấn trên UI không thành nhấn vào thế giới
2. Interactive Object            – WorldPicker trúng pick volume của một Interactable nhìn thấy được
3. Character / Zombie            – trúng trụ của zombie nhìn thấy được
4. Ground                        – trúng mặt sàn tầng đang đứng
5. Combat fallback               – chuột phải = vào thế (CS1)
```

**Quy tắc bắt buộc:**

- **Đang ở thế chiến đấu** (hoặc đang vung đòn): chuột phải và chuột trái thuộc về combat, không bao giờ mở menu. Toggle: chuột phải thì rời thế. Hold: nhả nút thì rời thế. Chuột trái thì đánh. Không dùng "click nhanh = menu, giữ = combat" (FB §1).
- **Picker không xuyên vật:** ứng viên được xét theo khoảng cách dọc tia camera. Tường, sàn hoặc cửa đóng *đang được vẽ* chắn trước thì không chọn được gì phía sau. Tường đã bị cutaway cắt thì không chắn. Trong vùng pick của cùng một độ sâu (±0,25 m dọc tia), thứ tự ưu tiên 2 > 3 > 4 mới áp dụng. Như vậy tủ ngay sau lưng zombie không bị chọn nhầm, nhưng cửa có zombie đứng sát thì menu cửa thắng (đúng FB).
- **Tầm nhìn:** object/zombie ở tầng bị ẩn (`cutaway.hidesPoint`), trong phòng chưa thấy (`interiorVisibility`) hoặc ngoài vùng nhìn của người chơi thì không pick được. Không đổi ánh sáng/ambient để làm việc này (WIS §6.4).
- **Menu đang mở giữ `targetId`:** hover không đổi đích; chọn một mục thì kiểm tra lại (version, tầm, trạng thái).

| Nút | Ngoài thế | Trong thế |
|---|---|---|
| Phải trên object | Menu ngữ cảnh | Combat (không mở menu) |
| Phải trên zombie | Vào thế, đích = zombie | Combat |
| Phải trên đất trống | Vào thế | Combat |
| Trái trên object | Action mặc định (Mở cửa, Mở tủ, Bật đèn...) | Đánh |
| Trái trên zombie | Nhắc cần chuột phải (như CS1) | Đánh |
| Trái trên đất | Nhắc cần chuột phải (như CS1) | Đánh |
| E | Action mặc định của object gần nhất trong tầm (luật CS1c hiện có) | Rời thế rồi làm (như hiện có) |

## 5. Interaction flow

```text
pointerdown (canvas) ─► input.ts ghi press {button, ndc, gestureId}
       │  CursorProbe (render) ghi runtime.cursorRay mỗi frame (gốc + hướng camera)
       ▼
runtime.stepControls → InputRouter.route(press)
       │ 1 UI? (đã lọc)   2 combat mode? → lane combat
       ▼
WorldPicker.pick(cursorRay) → { kind: 'object'|'character'|'ground', id?, point }
       ▼
InteractionSystem
   ├─ object + nút trái/E → provider.getActions() → option mặc định → execute
   ├─ object + nút phải   → provider.getActions() → emit 'interaction:menu' {target, options, screenPos}
   │                         → WorldContextMenu (React) → người chơi chọn → runtime.submitInteraction(targetRef, optionId, requestId)
   ├─ character + phải    → ActionRequest COMBAT_STANCE (target = zombie)
   └─ ground + phải       → COMBAT_STANCE
       ▼
ActionSystem.submit(request)
   ├─ requestId trùng → bỏ qua (DUPLICATE, không báo lỗi)
   ├─ validate (sống, target còn, version, đồ, chỗ trống sau khi trừ input...) → lỗi thì toast lý do
   ├─ cần tầm với mà đang xa → status 'approaching' (AutoWalk theo NavWorld tới anchor gần nhất đi được)
   │      ├─ WASD / bị đánh / timeout / không có đường / target đổi → hủy/fail, báo ngắn
   │      └─ tới nơi → validate lại (tầm, LOS, version)
   ├─ lane immediate → commit ngay → EffectApplier
   └─ lane queue → vào hàng (giới hạn 12 job) → tới lượt: begin (giữ chỗ) → tick → commit → cleanup
```

**Nút phải và thế Hold:** khi chuột phải mở menu, press đó bị "tiêu thụ". Code dùng `stance.suppressed` sẵn có, nên giữ nút phải lúc menu mở không vào thế cho tới khi nhả rồi nhấn lại. **Toggle:** press đã mở menu thì không lật `toggled`.

## 6. Item Action flow

```text
Chuột phải trên dòng item (cửa sổ Túi đồ/Lục đồ) hoặc nhấp đúp/hotkey
   ▼
ItemActionRegistry.options(item, where) — từ component + option chung, có lý do khi khóa
   ▼  người chơi chọn "Uống"
ActionRequest { type: DRINK, target: {item: chai nước, inventory: 'container:tủ-lạnh'} }
   ▼
ActionSystem.submit
   ├─ món không nằm trong túi/balo (đang ở tủ/đất) → tự thêm job TRANSFER trước nó (một đơn vị), rồi DRINK
   │     (CAS §6.1: chuyển có tầm với; nếu chuyển thất bại thì DRINK fail theo)
   ├─ sealed? → thêm OPEN_ITEM trước (hộp đã mở sau commit OPEN là thật, hủy EAT sau đó vẫn giữ hộp mở)
   ▼  tới lượt DRINK
begin: kiểm tra lại, giữ 1 đơn vị (ledger), state = DRINKING, presentation: nhóm 'drink', prop = chai trên tay phải, cất vũ khí
tick: elapsed += dt mô phỏng (pause thì đứng) → HUD/ActionStrip hiện tiến trình + nút Hủy
commit: kiểm tra lại (còn món, còn chỗ nếu có output) → Mutation:
        [ stat thirst +40, item.consume chai ×1, event item:used ]
        → EffectApplier: tất cả hoặc không
cleanup: nhả giữ chỗ, gỡ prop, trả vũ khí, state → IDLE hoặc action kế tiếp
```

**Chính sách giữ nguyên từ spec và code:**
- Effect chỉ được áp dụng khi hoàn tất (all-or-nothing, CAS §5.1). Hủy thì lượng và chỉ số không đổi.
- Món đang giữ chỗ thì không chuyển, trang bị hay bỏ xuống được (`heldByTransfer` và `isReserved` đã có, mở rộng sang kind `use`).
- Lý do `NO_EFFECT` (chỉ số đầy) là `canBenefit` hiện có. Mục menu vẫn hiện mờ kèm lý do.

## 7. Animation flow

```text
ActionJob đang chạy ─► runtime.characterView()   (dữ liệu thuần, không Three.js)
   state, action.group ('drink'), elapsed, progress, props {right: 'water'}, hideWeapon
   ▼
PlayerView.useFrame → AnimationDriver.update(animState, dt)
   ProceduralPoseDriver:
     computePose(input) với kênh mới `action: { group, t }` thay kênh `work` hiện nay
     thứ tự lớp: death > hurt (cộng thêm) > swing/shove > action group > stance ready > locomotion/idle
   PropAttachment:
     right/left socket ← itemProps.build(itemId) (cache theo itemId, dispose khi đổi)
     hideWeapon → weapon model ẩn tạm (không tháo trang bị)
   Âm thanh: event action:started/completed/cancelled → sfx theo presentation.sfx (âm lượng chung Settings)
```

- **Thời gian lấy từ clock mô phỏng:** animation có hình dạng theo `progress` của job, không có sự kiện "finished". Thiếu pose/prop thì dùng pose `work` và prop dự phòng; gameplay vẫn đúng giờ (CAS §7).
- **Nhóm pose phase này:** `eat` (tay đưa lên miệng theo nhịp), `drink` (ngửa đầu, chai nghiêng), `medical` (hai tay trước bụng/cánh tay), `work` (hiện có), `reach` (với tay mở tủ/cửa, ~0,35 s). Combat giữ nguyên các kênh `ready`/`swing`/`shove`.
- **Hình ảnh của object:**
  - Cửa: `DoorView` đã dựng góc lá cửa từ `state`.
  - Tủ: chỉ báo trạng thái (vàng/xám) đọc `open`/`opened`. Cánh tủ lạnh xoay thật (tách phần `door-*` của asset khỏi static batch) để sau: cùng dữ liệu, chỉ thêm một view đọc `open`.

## 8. Ví dụ cụ thể

### 8.1. Door

| Tầng | Nội dung |
|---|---|
| Object | `door` provider. State: `world.doors` `{ state: open/closed/destroyed, hp }`, có save. Anchors: hai phía cửa, cách 0,7 m |
| getActions | closed → **Mở cửa** (mặc định); open → **Đóng cửa** (mặc định; khóa với lý do "Có người/zombie chắn" nếu thân chắn lá cửa); destroyed → không option (tóm tắt "Cửa đã vỡ"); độ bền hiện trong tóm tắt. Khóa/barricade: không hiện vì chưa có feature |
| Action | `OPEN_DOOR` / `CLOSE_DOOR`, lane `immediate`, duration 0, `reach` = tầm hiện có + LOS, state `INTERACTING`, presentation `reach` |
| Effect | `world.set door {state}` → `setDoorState` (nav, lighting, event `door:changed`) |
| Visual | `DoorView` dựng lá cửa và collider từ state (đã có) |
| Chống spam | Một request đang chờ (approach) cho mỗi cửa; click lại trong lúc đang đi tới thì thay request cũ, không xếp thêm |

### 8.2. Fridge (container)

| Tầng | Nội dung |
|---|---|
| Object | `container` provider. State: `world.containers` `{ opened (đã từng lục, có save), items }` + `open` (đang mở, chỉ lúc chạy, là tủ đang hiện trong cửa sổ Lục đồ) |
| getActions | đóng → **Mở** (mặc định), **Lấy hết** (bấm được khi có đồ; tự mở trước); đang mở → **Đóng** (mặc định), **Lấy hết** |
| Action | `OPEN_CONTAINER`, lane `queue`, 0,35 s, state `LOOTING`, presentation `reach` + âm mở. `CLOSE_CONTAINER` immediate. `TAKE_ALL` = OPEN (nếu cần) + TRANSFER |
| Effect | `world.set container {open: true, opened: true}` → mở cửa sổ Lục đồ (+ Túi đồ); lần đầu emit `container:opened firstTime` như hiện nay |
| Out of reach | Hiện "Ngoài tầm" và hủy transfer như INV-LOOT; đi xa hơn tầm + slack thì tủ tự `open = false` |
| Acceptance FB Case 1 | Chuột phải tủ lạnh → Menu → Mở → `OPEN_CONTAINER` → pose `reach` → tủ `open = true` → cửa sổ hiện |

### 8.3. Water Bottle

| Tầng | Nội dung |
|---|---|
| Item | `water`: `consumable { action: DRINK, portions: 1, perPortion: {thirst: 40}, secondsPerPortion: 2.5 }` |
| Options | **Uống** (khóa kèm lý do nếu khát đầy hoặc món đang giữ chỗ), **Chuyển tới…**, **Bỏ xuống**, **Yêu thích**, **Xem**. "Rót" (Pour) chỉ đặt chỗ, cần `fluidContainer` |
| Action | `DRINK`, lane `queue`, 2,5 s, state `DRINKING`, `interrupt` mặc định, presentation `drink` + prop chai tay phải + `hideWeapon` |
| Effect | `[stat thirst +40, item.consume ×1]` một transaction |
| FB Case 2 | Chuột phải chai → Uống → `DRINK` → pose `drink` → +khát |

### 8.4. Bandage

| Tầng | Nội dung |
|---|---|
| Item | `bandage`: `consumable { action: HEAL, portions: 1, perPortion: {health: 25}, secondsPerPortion: 3 }`; `medkit` 5 s |
| Options | **Băng bó** (target `self`), chuyển/bỏ/xem. "Băng cho người khác" chỉ đặt chỗ (target `character`), vì chưa có NPC |
| Action | `HEAL`, state `HEALING`, presentation `medical` + prop tay trái |
| Effect | `[stat health +25, item.consume ×1]`. Không có chảy máu/nhiễm trùng nên không tạo chỉ số giả (CAS §6.1) |
| FB Case 5 | Đang HEALING, zombie đánh → event HIT → `interrupt.hit = cancel` → hủy, không trừ món, không +máu → IDLE (hoặc COMBAT_STANCE nếu đang giữ chuột phải) |

### 8.5. Zombie

| Tầng | Nội dung |
|---|---|
| Pick | Trụ r 0,4, cao 1,8 quanh zombie còn sống, nhìn thấy được |
| Chuột phải (ngoài thế) | `COMBAT_STANCE` lane combat, `target = {character: zombie}` → state COMBAT_STANCE; hướng aim vẫn theo con trỏ (CS1 không auto-aim); zombie đích có vòng highlight |
| Chuột trái (trong thế) | `MELEE_ATTACK` lane combat: validate = `canStartAttack` (vũ khí, thể lực, cooldown) → begin = `startAttack` (hiện có) → state ATTACKING → pose swing → cửa sổ trúng đòn `resolvePlayerMelee` (hiện có) → effect: sát thương, đẩy lùi, mòn vũ khí |
| Gián đoạn | Vào thế hoặc đánh thì hủy các action queue theo policy (như hiện nay) |
| FB Case 3 | Chuột phải zombie → combat interaction → COMBAT_STANCE → chuột trái = attack action |

### 8.6. Generator (chỉ để kiểm chứng khả năng mở rộng, không làm phase này)

```ts
// src/game/interaction/providers/generator.ts — file MỚI duy nhất, cộng một dòng đăng ký
registerInteractable({
  type: 'generator',
  build: (map) => map.generators.map(toInteractableInfo),
  state: (id, w) => w.world.generators.get(id) ?? null,       // { running, fuel } có save
  canInteract: (obj, ictx) => true,
  getActions: (obj, ictx) => {
    const g = ictx.state<GeneratorState>(obj.id)
    return [
      option('generator.start', 'GENERATOR_START', 'Khởi động', { isDefault: !g.running, blocked: g.fuel <= 0 ? 'Hết nhiên liệu' : null }),
      option('generator.stop', 'GENERATOR_STOP', 'Tắt máy', { isDefault: g.running, hidden: !g.running }),
      option('generator.refuel', 'REFUEL', 'Đổ xăng', { blocked: hasFuelCan(ictx) ? null : 'Cần can xăng' }),
    ]
  },
  getInteractionContext: (obj, ictx) => ({ name: obj.name, summary: `Nhiên liệu ${fuelPct}%` }),
})
registerAction({ type: 'GENERATOR_START', lane: 'queue', duration: 2, characterState: 'INTERACTING', ...,
  commit: (ctx) => ({ ok: true, mutation: { effects: [{ type: 'world.set', objectType: 'generator', objectId, patch: { running: true } }] } }),
  presentation: { anim: 'work', sfx: { done: 'generatorStart' } } })
registerAction({ type: 'REFUEL', lane: 'queue', duration: (ctx) => ..., requires: [{ toolTag: 'fuel_can' }], ... })
```

- Không sửa runtime, input, picker hay state machine.
- Phần thật sự phải thêm cho generator (không thuộc Action System):
  - dữ liệu map `generators`;
  - `WorldState.generators` + save;
  - adapter `world.set` → `setElectricity`;
  - view/âm máy chạy.
- FB Case 7 thỏa.

## 9. Làm ngay trong phase này

Mỗi sprint có test, build, commit + push lên `feature/character-action` và một ghi chú `docs/character-action-axN.md`.

| Sprint | Nội dung | Nghiệm thu chính |
|---|---|---|
| **AX1 — Action core** | `actions/` (types, registry, `ActionSystem` submit/dedupe/queue ≤ 12/tick/cancel/commit/cleanup), `CharacterStateMachine`, `EffectApplier`; chuyển `TRANSFER`, `CRAFT`, `REPAIR` sang định nghĩa; hủy di chuyển/đánh/đòn/chết đi qua state machine; `WorldObjectVersions` | Toàn bộ 1049 test cũ pass; soak trùng **từng số** (hành vi không đổi); test domain: dedupe requestId, commit một lần, transaction lỗi không để nửa thay đổi, thứ tự event trong tick |
| **AX2 — Item Action System** | `ItemComponents` cho mọi item; `ItemActionRegistry` thay nhánh `kind` trong `itemActions.ts`; `EAT`/`DRINK`/`HEAL` có thời gian + giữ chỗ; tự chuyển từ tủ/đất trước khi dùng; `OPEN_ITEM` + đồ hộp niêm phong (nếu D3 duyệt); HUD/ActionStrip nhãn mới | FB Case 2, 5, 6; CAS §11: click kép, bị đánh giây thứ 2, pause, chuyển món đang giữ chỗ, hộp đã mở rồi hủy ăn, save/load |
| **AX3 — Animation layer** | `CharacterAnimState`, `AnimationDriver` + `ProceduralPoseDriver`; nhóm `eat`/`drink`/`medical`/`reach`; socket tay trái; `itemProps.ts` + fallback; ẩn/hiện vũ khí; sfx theo presentation | Test pose thuần (nhóm, thứ tự lớp, death thắng), prop gắn/gỡ không rò rỉ; ảnh chụp từ game thật |
| **AX4 — Picker + định tuyến input** | `cursorRay`; `WorldPicker` (pick volume, chắn bởi tường đang vẽ, cutaway, interior visibility, vùng nhìn); `InputRouter` theo §4; click trái = action mặc định; E cùng đường; providers `door`/`container`/`light`/`curtain` thay `describeInteraction`/`interact`; `OPEN_CONTAINER`/`CLOSE_CONTAINER`, `OPEN_DOOR`/`CLOSE_DOOR` | WIS §13 các dòng về chọn đúng tủ/cửa ở mọi zoom, không xuyên tường, UI không lọt; CS1 browser check vẫn PASS |
| **AX5 — Context menu + combat lane** | `WorldContextMenu` (neo con trỏ, trong viewport, Esc/phím, disabled có lý do), `interaction:menu`; chuột phải theo §4; `COMBAT_STANCE`/`MELEE_ATTACK`/`SHOVE` khai báo trong registry (bọc code combat hiện có); zombie đích | FB Case 1, 3, 4; WIS: menu cửa theo trạng thái, menu đang mở mà cửa đổi → kiểm tra lại, không spam mở/đóng |
| **AX6 — Tiếp cận (approach)** | Anchors theo provider; `AutoWalk` theo `NavWorld.findPath` (bán kính người chơi = zombie 0,4 m); trạng thái APPROACHING, highlight đích, "Đang đi tới…"; timeout + phát hiện kẹt; WASD/bị đánh hủy; kiểm tra lại khi tới | WIS §13: click tủ xa có đường → đi tới rồi mở; không đường/đích vỡ → hủy gọn; không loot xuyên tường |
| **AX7 — Nghiệm thu và bàn giao** | Bảng CAS §11 + WIS §13 + FB §15 Case 1–7 với bằng chứng; script trình duyệt `ax-*.mjs`; đo hiệu năng picker/menu; sổ tay `docs/character-action-handbook.md`; CURRENT_STATE | Build/lint/test/check:bundle/map:check sạch; soak khớp; mọi browser check cũ PASS |

**Save:** AX1–AX7 dự kiến không đổi schema.
- Có thể có item ID mới (`canned_food_open`). Code cũ gặp ID này thì phục hồi thành `unknown` (S5), nên an toàn.
- Trạng thái `open` của tủ, hàng đợi, approach và version không vào save.

## 10. Chỉ chuẩn bị kiến trúc cho phase sau

| Hạng mục | Điểm nối đã có trong thiết kế |
|---|---|
| Ăn dở (`portions > 1`), thối rữa, nấu, dụng cụ, chế biến | `ItemComponents` (`consumable.portions`, `perishable`, `cookable`, `utensil`) + instance kind mới qua save v12 |
| Đồ khui hộp | `sealed.requiresToolTag = 'can_opener'`; `ToolTag` thêm một giá trị; không sửa action |
| Rót nước, nguồn nước, bình chứa | `fluidContainer` component + provider `water_source` |
| Khóa cửa, barricade, sửa cửa | Option mới trong `door` provider + action `BARRICADE`/`REPAIR_DOOR` (lane queue, `requires` búa + đinh + ván); `TimedAction.worldTargetId` và luật "zombie đánh cửa thì hủy" đã có |
| Build / công trình | Action `BUILD` + chế độ đặt (Input Router ưu tiên 2 "mode"); object type `structure`; adapter `world.set` làm nav invalidation |
| Workbench / crafting station | Provider `workbench` trả option mở cửa sổ Chế tạo với `station` trong context; recipe thêm `requires.station` |
| Generator, nhiên liệu | §8.6 |
| Farming | Object type `plot` (state trồng/tưới/lớn, tick bởi một world system); action PLANT/WATER/HARVEST |
| Xác zombie (corpse loot) | Provider `corpse` dùng lại container: `InventoryKey 'corpse:<id>'` |
| Vehicle | Provider `vehicle`: mở cốp (container), đổ xăng (REFUEL), vào xe. Lái xe là **chế độ điều khiển mới** (Input Router mode + state `DRIVING`), không đụng Action System |
| AnimationMixer, clip, animation state machine | `MixerDriver` thay `ProceduralPoseDriver` qua `AnimationDriver` |
| NPC dùng action | `actorId` đã có trong context; ActionSystem theo từng actor |
| Nhóm âm lượng Settings | `presentation.sfx` đã tách; thêm group ở `settingsStore` khi cần |

## 11. File/module dự kiến

**Mới:**

```text
src/game/actions/types.ts              ActionContext, TargetRef, ActionDefinition, ActionJob, Mutation, ActionFailure
src/game/actions/registry.ts           registerAction / getAction (ID trùng → lỗi dev)
src/game/actions/actionSystem.ts       submit, dedupe, queue, approach hook, tick, cancel, commit, cleanup
src/game/actions/characterState.ts     CharacterState, event, bảng chuyển, thứ tự xử lý
src/game/actions/effects.ts            EffectApplier (kiểm tra → ghi), adapter world.set
src/game/actions/defs/transfer.ts      TRANSFER (chuyển từ runtime.queueTransfer/beginTransferStep/commitTransferStep)
src/game/actions/defs/recipe.ts        CRAFT, REPAIR
src/game/actions/defs/consume.ts       EAT, DRINK, HEAL, OPEN_ITEM
src/game/actions/defs/world.ts         OPEN_DOOR, CLOSE_DOOR, OPEN_CONTAINER, CLOSE_CONTAINER, TOGGLE_LIGHT, TOGGLE_CURTAIN
src/game/actions/defs/combat.ts        COMBAT_STANCE, MELEE_ATTACK, SHOVE (bọc combat.ts/stance.ts)
src/game/actions/defs/inventory.ts     EQUIP, UNEQUIP, WEAR_BAG, REMOVE_BAG, DROP, FAVORITE
src/game/items/components.ts           ItemComponents + helper đọc
src/game/items/itemActions.ts          ItemActionRegistry + provider theo component
src/game/interaction/types.ts          InteractableProvider, InteractableInfo, InteractionOption, PickVolume
src/game/interaction/registry.ts       registerInteractable
src/game/interaction/interactionSystem.ts  option/default/menu/execute, version
src/game/interaction/picker.ts         WorldPicker (tia × pick volume, chắn, tầm nhìn)
src/game/interaction/router.ts         InputRouter theo §4
src/game/interaction/approach.ts       anchors, AutoWalk, timeout/kẹt
src/game/interaction/providers/{door,container,light,curtain}.ts
src/game/rendering/character/animState.ts   CharacterAnimState, AnimationDriver, ProceduralPoseDriver
src/game/rendering/character/itemProps.ts    prop theo item + fallback
src/components/WorldContextMenu.tsx    menu chuột phải trên thế giới
src/stores/worldMenuStore.ts
+ test cho từng module (domain, không chép cấu trúc code)
+ scripts/ax-*.mjs (trình duyệt)
```

**Sửa:**

```text
src/game/core/runtime.ts               bỏ phần job/interaction viết cứng, ủy cho ActionSystem/InteractionSystem; giữ API công khai cũ làm lớp mỏng (test cũ không đổi)
src/game/systems/actionQueue.ts        giữ ReservationLedger/transferStep/jobView; Job → ActionJob
src/game/systems/timedAction.ts        TimedAction thành data của CRAFT/REPAIR
src/game/systems/interaction.ts        selectInteractable giữ cho E; Interactable → InteractableInfo
src/game/systems/survival.ts           consumeInventoryItem thành effect builder (canBenefit giữ)
src/game/systems/input.ts              press có gestureId + button cho router
src/game/systems/stance.ts             tiêu thụ press chuột phải khi mở menu
src/game/entities/items.ts             thêm components; (D3) canned_food niêm phong + canned_food_open
src/game/rendering/character/pose.ts   kênh action group thay work; nhóm eat/drink/medical/reach
src/game/rendering/character/rig.ts    socket tay trái
src/game/rendering/PlayerView.tsx      dùng AnimationDriver + prop
src/game/rendering/CursorProbe.tsx     ghi cursorRay
src/game/rendering/InteractHighlight.tsx  highlight đích hover/approach
src/components/inventory/itemActions.ts, commands.ts, Panels.tsx   render option từ registry; mọi lệnh qua submit
src/components/HUD.tsx, stores/hudStore.ts   nhãn state/approach
src/components/inventory/escape.ts     tầng Esc: menu thế giới là popup
src/app/App.tsx                        sfx theo event action
docs/CURRENT_STATE.md, docs/character-action-axN.md, handbook
```

## 12. Xác nhận không phải viết lại lớn khi thêm

| Tính năng | Cần thêm | Không phải sửa |
|---|---|---|
| **Looting container** | Đã nằm trong thiết kế (container provider + TRANSFER/OPEN_CONTAINER). Xác zombie = provider mới dùng lại container | ActionSystem, state machine, router |
| **Crafting** | Recipe mới trong `recipes.ts`; workbench = provider mới; `requires.station` | ActionSystem (CRAFT là một định nghĩa) |
| **Building** | Action BUILD, chế độ đặt trong router, object type `structure` + adapter nav | Pipeline action, menu, save của action |
| **Weapon repair** | Đã có (REPAIR); sửa cửa/barricade là option + action mới | Recipe engine, ledger |
| **Farming** | Object type `plot` + world system tick + 3 action | Router, picker, ActionSystem |
| **Vehicle interaction** | Provider `vehicle` (cốp, xăng, vào xe) + **chế độ lái mới** (điều khiển và vật lý riêng) | Action System, item, interaction. Chế độ lái là hệ mới đúng nghĩa, nhưng chỉ cắm vào router như một mode |

Kết luận: backbone là một đường duy nhất `Input → Interaction → ActionRequest → ActionSystem → (State · Effect) → Animation`, dùng chung cho item, object và combat (FB §16). Thêm nội dung mới là thêm provider, component hoặc định nghĩa action, không phải thêm nhánh `if` trong runtime hay Character Controller.

## 13. Cần chủ dự án quyết (đề xuất in đậm)

> **Đã duyệt 2026-09-30** theo đề xuất ("oke hãy bắt đầu"). D5 đổi thành 128 ở AX1 vì test T26 của INV-LOOT (chi tiết `docs/character-action-ax1.md` §0).

| # | Câu hỏi | Đề xuất |
|---|---|---|
| D1 | Thời lượng mở tủ (`OPEN_CONTAINER`) | **0,35 s** có pose `reach`. Mở/đóng cửa, đèn, rèm giữ **tức thời** (0 s, pose chỉ là phản hồi) để không làm chậm lúc bị đuổi |
| D2 | Chuột phải trên zombie có tung đòn đầu tiên không | **Không**: chỉ vào thế với zombie là đích; chuột trái mới đánh (giữ CS1, tránh đánh nhầm) |
| D3 | Đồ hộp niêm phong ngay phase này | **Có**: `canned_food` (niêm phong) → Mở 1,5 s bằng tay (chưa cần đồ khui) → `canned_food_open` → Ăn. Save cũ giữ nguyên là hộp niêm phong. Không làm thì chỉ để sẵn component `sealed` |
| D4 | Thời gian dùng đồ | **Ăn đồ hộp 3 s, snack 2 s, nước/nước ngọt 2,5 s, băng gạc 3 s, hộp cứu thương 5 s** (giá trị khởi điểm trong config) |
| D5 | Giới hạn hàng đợi | **12 job**; quá thì từ chối `QUEUE_FULL` |
| D6 | Nhịp duyệt | **Tự commit + push mỗi sprint và làm tiếp; dừng chờ duyệt sau AX1 (lõi) và AX5 (đổi input chuột)** như INV-LOOT; hoặc dừng sau mỗi sprint |
| D7 | Vào thế khi đang dùng đồ | **Hủy action** (policy `stance: cancel`) cho ăn/uống/băng bó/mở tủ; chuyển đồ vẫn chạy tiếp như INV-LOOT S5 |

## 14. Khác biệt có chủ ý so với spec gốc

- **Animation:**
  - CAS nói `AnimationMixer`/clip; thiết kế này dùng pose dựng bằng code theo nhóm, đúng FB §7.
  - Có interface `AnimationDriver` để đổi sau.
- **Cửa và đèn chạy tức thời:**
  - WIS §9.1 cho phép, nếu vẫn kiểm tra tầm với khi thực hiện.
  - Mở tủ có thời gian ngắn để đúng FB Case 1.
- **Không có WorldObject store chung thay cho `world.doors/containers/...`:**
  - Viết lại store và save là rủi ro lớn mà không thêm năng lực.
  - Provider và adapter cho cùng hợp đồng `WorldObject` của WIS §5 (ID, type, state, version, vị trí). Version chỉ sống lúc chạy.
- **Âm lượng:** giữ một thanh chung. Nhóm âm lượng để sau (§10).
