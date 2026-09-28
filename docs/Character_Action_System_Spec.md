# Character Action System — Đặc tả triển khai

**Dự án:** game sinh tồn zombie React + Three.js  
**Phiên bản tài liệu:** 1.0 · 28/09/2026  
**Đối tượng đọc:** coding agent triển khai gameplay, animation, inventory và persistence.

## 1. Mục tiêu và bối cảnh

Xây dựng hệ thống xử lý hành động của nhân vật với vật phẩm: lấy đồ từ container/ba lô, ăn, uống, băng bó, dùng đồ hồi phục, sửa vũ khí, craft, thao tác công trình. Một lệnh của người chơi phải trở thành chuỗi có điều kiện, thời gian, animation/âm thanh, khả năng hủy và thay đổi gameplay nhất quán.

Đây là kiến trúc **đề xuất cho game hiện tại**, lấy cảm hứng từ timed actions của Project Zomboid; tên module/API bên dưới không hàm ý tương ứng một-một với mã nguồn PZ.

### 1.1. Nền tảng đã biết

- React + Three.js, save bằng IndexedDB; Phase 1 có inventory 12 ô, đồ hộp, nước, snack, băng gạc, hộp cứu thương, nước tăng lực và combat.
- Kế hoạch Phase 2 định nghĩa `ItemDefinition` khác `ItemInstance`; equipment tham chiếu instance ID, không nhân bản item.
- Phase 2 yêu cầu craft/repair/build dùng chung timed action, đặt trước nguyên liệu, hủy không tiêu nguyên liệu và hoàn tất theo một transaction logic; save không giữ action đang dở.
- Player có model/rig và socket tay theo kế hoạch Phase 2; agent phải kiểm tra API animation, inventory, clock, input và save **trong repository thực tế** trước khi sửa. Tên file/type ở đây là hợp đồng gợi ý, không giả định repository đã có sẵn.

### 1.2. Kết quả cần đạt

1. Chọn hành động từ inventory hoặc menu thế giới → validate → nếu cần đi đến mục tiêu → chạy action → commit kết quả đúng một lần.
2. Animation, vật phẩm trên tay, âm thanh và thanh tiến trình phản ánh cùng một action; chúng không tự sửa gameplay state.
3. Hành động có thể bị gián đoạn theo chính sách riêng; hủy dọn sạch animation/attachment/reservation.
4. Chuyển đồ từ ba lô/container, tiêu hao đồ ăn/uống, condition và trạng thái nhân vật giữ cùng một nguồn dữ liệu; save/load không nhân hoặc mất item.
5. Có điểm mở rộng theo definition/handler để thêm item mới mà không phải sao chép controller animation.

## 2. Phạm vi bản đầu

| Nhóm | Bắt buộc | Ghi chú |
|---|---|---|
| Dùng item | Ăn đồ hộp/snack, uống nước/energy drink, dùng bandage/first aid kit | Bám các effect và chỉ số đang tồn tại; không tự tạo hunger/thirst nếu game chưa có. |
| Chuỗi thao tác | Với đồ hộp chưa mở: nếu dữ liệu hiện có có trạng thái mở/dụng cụ mở hộp, chạy `open → eat`; nếu chưa có, thiết kế hook `open` và chỉ triển khai khi state/asset phù hợp | Không giả định mọi hộp cần đồ mở hộp; cấu hình ở item definition. |
| Vật phẩm nguồn | Inventory chính, ba lô nếu có, container đang mở | Phase 2 hiện biết inventory 12 ô; không tự thêm một loại ba lô hoặc slot mới chỉ để đáp ứng ví dụ. |
| Action dài | Craft/repair/build/refuel gọi chung scheduler và reservation | Giữ recipe, chi phí, thời lượng từ plan Phase 2 nếu đã triển khai. |
| Trình diễn | Animation ăn/uống/làm việc hoặc fallback hợp lý, model vật phẩm gắn socket tay, progress và audio hiện có | Ưu tiên một clip theo nhóm item, offset per item. |
| Tích hợp | Combat, movement, pause, save/load, death, đổi scene | Action bị hủy/dọn đúng lúc. |

Ngoài phạm vi bản đầu: mô phỏng nhai từng miếng, dinh dưỡng chuyên sâu, network multiplayer, skill/XP, combo nhiều action tự động vượt qua mọi menu, rig/animation riêng cho từng item. Không làm giả việc “đã có animation” bằng cách chỉ hiện icon hoặc tự cộng chỉ số trước khi animation bắt đầu.

## 3. Kiến trúc và ranh giới

```text
Inventory UI / World Context Menu / Hotkey
             ↓ ActionRequest
CharacterActionSystem (validate, queue, lifecycle)
             ├─ Movement/Reach adapter
             ├─ Inventory + reservation + gameplay commit
             ├─ Animation/hand attachment/audio presenter
             └─ Clock + save lifecycle
```

| Thành phần | Trách nhiệm | Không được làm |
|---|---|---|
| `ActionRegistry` | Đăng ký action type, guard, factory/handler và metadata UI | Giữ state của một action đang chạy. |
| `CharacterActionSystem` | Nhận request, enqueue, start/tick/cancel/finish, serialize policy | Trực tiếp đọc DOM hoặc chỉnh bone của model. |
| `ActionHandler` | Kiểm tra đặc thù, reserve và tạo mutation khi hoàn tất | Ghi inventory khi mới hiện menu. |
| `InventoryService` | Tìm instance, owner, stack, transfer, reservation, commit | Điều khiển animation. |
| `AnimationPresenter` | Crossfade clip, gắn/ẩn prop, phát audio theo event | Quyết định có được ăn/uống hay trừ vật phẩm. |
| `Movement/Reach` | Đưa player tới anchor hợp lệ, kiểm tra khoảng cách/LOS nếu cần | Mở container hoặc trừ vật phẩm từ xa. |
| `Persistence` | Snapshot state đã commit, hủy transient action khi load | Lưu closure, `Object3D`, `AnimationMixer` hoặc reservation. |

Tái sử dụng module hiện có thay vì dựng event bus, state manager hoặc inventory mới nếu repository đã giải quyết trách nhiệm tương ứng. React nhận snapshot/event cho UI; game loop là nơi cập nhật tiến trình. Không để `setTimeout`/timer của component tự hoàn tất action.

## 4. Hợp đồng dữ liệu gợi ý

Ví dụ TypeScript mang tính định hướng; nếu codebase là JavaScript, giữ shape và invariant tương đương.

```ts
type ActionStatus =
  | 'queued' | 'approaching' | 'running'
  | 'committing' | 'completed' | 'cancelled' | 'failed';

type ActionRequest = {
  requestId: string;          // chống double click, không reuse
  actorId: string;
  actionId: string;           // eat, drink, bandage, repair, craft, ...
  itemInstanceId?: string;
  targetId?: string;          // cửa, vật thể, container, bệnh trạng...
  targetVersion?: number;     // tùy hệ world state hiện có
  amount?: number;            // số lượng/phần dùng, được clamp ở validate
  source?: 'inventory' | 'context-menu' | 'hotkey';
};

type ActionDefinition = {
  id: string;
  durationGameSeconds: number | ((ctx: ActionContext) => number);
  movementPolicy: 'cancel' | 'allow' | 'require-stationary';
  hitPolicy: 'cancel' | 'allow';
  canStart(ctx: ActionContext): ActionCheck;
  reserve?(ctx: ActionContext): Reservation[];
  canCommit(ctx: ActionContext): ActionCheck;
  commit(ctx: ActionContext): GameplayMutation;
  presentation: {
    clip?: string;
    handProp?: 'sourceItem' | 'tool' | 'none';
    soundStart?: string;
    soundFinish?: string;
  };
};

type RunningAction = {
  executionId: string;
  request: ActionRequest;
  status: ActionStatus;
  elapsedGameSeconds: number;
  durationGameSeconds: number;
  reservationIds: string[];
  committed: boolean;
};
```

**Invariants:** một `ItemInstance` có đúng một owner (inventory, container hoặc world drop); equipment chỉ giữ ID tham chiếu. Reservation khóa đúng instance/quantity được action sử dụng nhưng chưa trừ. Hai execution không được reserve cùng phần quantity; item đang reserve không thể drop/transfer/equip gây xung đột. Một `executionId` commit tối đa một lần. Giá trị chỉ số người chơi và item sau commit nằm trong một snapshot hợp lệ.

## 5. Vòng đời action

1. **Request:** UI gửi ID và tham số; không gửi object render hay bản copy item. Chặn cùng `requestId` được gửi lại khi click kép.
2. **Validate sớm:** actor sống, item/target tồn tại, quyền sở hữu và lượng cần dùng hợp lệ, slot/output khả dụng theo mô phỏng trạng thái sau khi tiêu input. Trả mã lý do ngắn cho UI (`OUT_OF_RANGE`, `MISSING_ITEM`, `FULL`, `TARGET_CHANGED`, ...).
3. **Queue:** thêm các bước phụ thực sự cần thiết (di chuyển, chuyển item, mở đồ hộp nếu có, dùng item). Chỉ một action chủ động của actor; giới hạn độ dài queue hợp lý và có nút Cancel/Clear.
4. **Approach:** đi tới anchor nếu action cần đứng gần target. Theo dõi đổi trạng thái/biến mất/chặn đường; timeout hoặc không có path → fail/cancel và dọn queue liên quan. Chuyển đồ từ container phải kiểm tra khoảng cách tại lúc chuyển.
5. **Reserve khi bắt đầu chạy:** kiểm tra lại, khóa input/tool/target cần khóa, lưu `duration` tính từ game time; phát animation, prop và âm thanh bắt đầu. Hành động đọc thuần có thể không reserve.
6. **Tick:** tăng `elapsed` bằng delta của simulation clock đã chịu pause/time scale; clamp `0…duration`. Cập nhật progress. Marker của clip có thể phát âm thanh/FX nhưng **không** commit gameplay nhiều lần.
7. **Hoàn tất:** `canCommit` kiểm tra lại owner/target/slot/tool. Một gameplay transaction trừ input, thay đổi item/actor/target, tạo output và emit event. Đánh dấu `committed` rồi kết thúc presentation; nếu fail, không có nửa thay đổi.
8. **Cleanup:** dù completed/cancelled/failed/death/unmount/load đều release reservation, dừng action clip, tháo prop tạm, gỡ listener/timer và bắt đầu action kế tiếp nếu actor còn hợp lệ.

Nếu game đang dùng nhiều store, tạo mutation ở game-domain layer và cập nhật các store bằng một commit điều phối; không để `InventoryService.remove()` thành công rồi `Stats.apply()` ném lỗi khiến mất item. Không dùng keyframe `finished` của animation làm nguồn chân lý thời gian; fallback clip thiếu/đổi tốc độ vẫn hoàn tất theo clock.

### 5.1. Chính sách gián đoạn

| Tình huống | Chính sách mặc định |
|---|---|
| Player chủ động di chuyển hoặc đánh | Hủy action đứng yên; enqueue mới tùy input hiện có. |
| Player bị zombie đánh, chết | Hủy action hiện tại và queue; không commit phần chưa hoàn tất. |
| Bấm Cancel/Esc khi gameplay còn chạy | Hủy action theo cách UI hiện có phân biệt Pause và Cancel; không phá Esc pause đã có. |
| Target/item bị chuyển, vỡ, hết nội dung | Fail khi revalidate; không trừ input. |
| Pause, tab bị ẩn nếu game tự pause | Đóng băng elapsed, không âm thầm hoàn tất theo wall clock. |
| Save giữa action | Snapshot chỉ ghi các commit đã hoàn tất; load bắt đầu khi không có action đang chạy. |

Với ăn/uống bản đầu, **chỉ áp dụng lượng tiêu hao và effect khi hoàn tất** để hủy là all-or-nothing. Nếu về sau muốn ăn/uống từng phần, tách thành các tick commit độc lập có ID và snapshot riêng; không chia nhỏ bằng biến progress hiển thị mà chưa xử lý persistence.

## 6. Các luồng gameplay cụ thể

### 6.1. Ăn snack hoặc đồ hộp

`Click item → Eat → kiểm tra còn phần ăn → nếu ở container/ba lô cần đưa vào owner khả dụng theo luật inventory → nếu là đồ hộp đóng và cấu hình cần mở: Open → Eat → animation → commit lượng và effect`.

- Item definition khai báo `useActions`/`foodProfile`, `portion` và `openState` nếu cần. Đừng suy loại đồ hộp từ tên hiển thị.
- Nếu mở hộp là action riêng: chuyển trạng thái `closed → open` tại commit của bước mở; hủy bước ăn sau đó vẫn giữ hộp đã mở. Save được trạng thái mở. Kiểm tra dụng cụ mở hộp khi definition yêu cầu.
- Nếu người chơi chọn `Eat 1/4`, clamp lượng theo số phần còn; tiêu đúng một phần và giữ instance; hết phần thì xóa/đổi thành vật chứa rỗng theo item definition. UI luôn đọc lượng thực từ instance.
- Nếu chưa có hunger/nutrition, dùng effect đang tồn tại trong game; agent ghi rõ chỗ chưa thể nối thay vì thêm chỉ số giả chỉ để animation chạy.

### 6.2. Uống nước hoặc energy drink

- Dùng cùng clip `drink` với prop theo model chai/lon, cấu hình offset per item; attachment gắn bone/socket tay và bám animation ở idle lẫn khi chuyển state. Nếu clip không có, dùng fallback `use_item` nhưng progress/gameplay vẫn chuẩn.
- `water` có lượng dùng hoặc stack theo schema hiện hữu; không tự biến mọi chai thành vô hạn. `energy_drink` tiêu đúng lượng và áp effect hiện có. Audio qua nhóm âm lượng của Settings.
- Gián đoạn trước commit không giảm lượng. Chuyển item sang nơi khác trong lúc reserve bị chặn; xóa item từ ngoại lực → fail sạch.

### 6.3. Băng bó, sơ cứu và craft/repair

- Bandage/first aid dùng target actor/body state nếu hiện có; `canStart` và `canCommit` xác minh effect còn hợp lệ, không tiêu đồ để chữa người đã chết hoặc mục tiêu không còn hiệu lực.
- Craft/repair/build/refuel dùng cùng lifecycle. Recipe handler tự tính input, tool, target, output và duration; scheduler không chứa switch lớn với từng recipe.
- Recipe Phase 2 giữ chính sách: hủy không mất nguyên liệu/fuel; hoàn tất trừ input và tạo output đúng một lần; tool hỏng, slot đầy, target biến mất được xử lý trước commit.

### 6.4. Trang bị và chuyển đồ

Equip/unequip có thể tức thời nếu gameplay hiện có thiết kế như vậy. Nếu có animation thì vẫn đi qua action request, nhưng equipment ID chỉ đổi tại điểm commit đã định. Transfer từ container là mutation inventory có kiểm tra reach, capacity, ownership và reservation; không được copy instance sang owner mới. Chuyển món đang equip ra container phải tự unequip như kế hoạch Phase 2.

## 7. Animation, prop và audio

- `AnimationMixer`/controller có các layer hoặc priority hợp lý: death/hit > action > locomotion; action làm đứng yên thì movement controller khóa chạy, không khóa camera/UI tùy ý.
- Chuẩn hóa socket tay phải (và tay trái nếu asset có), `handProp` dùng model từ item definition hoặc fallback hình đơn giản. Offset/rotation/scale để trong asset config; cleanup prop tạm không tháo weapon đang equip vĩnh viễn.
- Không cần clip riêng cho từng lon/chai; dùng biến thể animation theo nhóm `food`, `bottle`, `can`, `medical`, `work` nếu rig cho phép.
- Event animation dùng cho visual/audio marker. Hit damage của combat hiện có vẫn do combat controller quyết định; action ăn/uống không kích hoạt hitbox.
- Thiếu asset không làm game treo: fallback clip hoặc pose, log một lần ở dev, hoàn tất đúng thời gian. Release reference/model clone và listener khi cancel/unmount.

## 8. UI, accessibility cơ bản và phản hồi

- Menu item chỉ hiện action tương thích theo definition; action thiếu điều kiện có thể disabled kèm lý do, không bấm rồi im lặng.
- Thanh progress chỉ hiện khi đang `running`, có nhãn hành động và nút hủy; không hiện 100% rồi lại fail mà không giải thích.
- Double click, hotkey và context menu đi qua cùng API; phát một request thực thi. UI không trực tiếp cộng chỉ số/trừ item.
- Khi cần tiếp cận target, có trạng thái đang đi tới và highlight đích; path thất bại báo ngắn gọn.
- Không để click UI lọt xuống canvas làm player đánh hoặc đổi target; đồng bộ quy tắc input với đặc tả World Interaction System.

## 9. Save, migration và tính quyết định

Persist `ItemInstance` (owner, quantity, opened/remaining amount, condition nếu có), actor stats, target/world state đã commit. Không persist queue, elapsed, reservation, animation state, prop hoặc DOM. Sau load: không còn action đang chạy; item/actor/target ở trạng thái trước hoặc sau commit trọn vẹn. `executionId` sống trong runtime; nếu kiến trúc save có replay/event log thì lưu marker idempotency ở nơi phù hợp.

Migrate save Phase 1 theo kế hoạch Phase 2: giữ consumable stack, gậy của save cũ thành instance nếu cần, không hồi đầy đồ đang dùng hoặc nhân item. Đừng sửa schema save nếu module hiện tại đã hỗ trợ thêm trường có default; nếu cần schema version mới, thêm migration và fixture. Inventory 12 ô và policy New Game tay không/Continue giữ gậy không bị thay đổi bởi feature này.

## 10. Thứ tự triển khai cho agent

1. **Khảo sát:** tìm các module input, game clock, pause, player stats, inventory, item schema, equipment, animation, audio, save, test; ghi mapping tên thật và lệnh build/test hiện có. Đọc kế hoạch Phase 2 nếu có trong repo.
2. **Chốt hợp đồng:** chuẩn hóa request/handler/result và một owner cho mỗi item; chỉ thêm adapter tại ranh giới module đang có.
3. **Core lifecycle:** queue, validate, approach, reserve, tick, cancel, commit, cleanup; nối game clock và pause. Dùng một action test đơn giản trước.
4. **Item use:** ăn/uống/bandage với item thật; chuyển source item nếu cần; gắn clip/prop/audio và UI progress.
5. **Recipe integration:** đưa craft/repair/refuel/build đã có hoặc kế hoạch sắp làm qua lifecycle chung, không thay luật recipe vô cớ.
6. **Persistence và kiểm tra:** migration nếu cần, save/load, regression combat/movement/container; build production.
7. **Bàn giao:** liệt kê file đã sửa, API/hợp đồng thực tế, test đã chạy, asset còn fallback và quyết định khác đặc tả do codebase thực tế.

## 11. Kiểm thử và tiêu chí nghiệm thu

| Kịch bản | Kết quả bắt buộc |
|---|---|
| Double click Eat/Drink và gửi cùng request ID hai lần | Một action, một lần tiêu item/effect. |
| Uống trong 3 giây, bị zombie đánh ở giây 2 | Hủy animation/prop/progress, lượng item và effect chưa đổi. |
| Pause giữa action rồi chờ ngoài đời | Progress không tăng; unpause mới chạy tiếp. |
| Chuyển item đã reserve qua container | Transfer bị từ chối hoặc action cancel sạch theo policy; không nhân bản. |
| Hộp đóng cần mở, hoàn tất Open rồi hủy Eat | Hộp vẫn mở, chưa ăn; reload giữ trạng thái. |
| Bước chuyển đồ từ container khi đứng xa/đường bị chặn | Đi tới rồi kiểm tra reach; thất bại không lấy đồ từ xa. |
| Inventory đầy, craft tiêu stack giải phóng slot | Tính chỗ sau khi tiêu input, thành công nếu đủ; fail giữ nguyên nếu thiếu. |
| Save đúng lúc commit; load lại | Snapshot trước hoặc sau toàn bộ thay đổi, không mất/ngẫu nhiên nhân item. |
| Player chết hoặc đổi scene khi đang hành động | Queue dừng, reservation/prop/listener được dọn. |
| Thiếu clip/model của một item | Gameplay vẫn đúng, UI không kẹt, fallback hiển thị phù hợp. |

**Definition of Done:** tất cả luồng ăn/uống/băng bó dùng được từ inventory; ít nhất một prop và clip nhóm dùng chung vận hành trên model player; action bị hủy và pause đúng; double click/save/load không nhân/mất item; recipe đang triển khai dùng cùng lifecycle; các kiểm thử trọng điểm của bảng trên chạy qua được. Thử tay trong scene thật cạnh container và zombie, cùng với test domain cho transaction/reservation. Không viết test chỉ sao chép cấu trúc code; tập trung invariant và lỗi có thể mất dữ liệu.

## 12. Điểm nối với World Interaction System

World Interaction System chịu trách nhiệm raycast, chọn object, tạo menu và chuyển thành `ActionRequest` với `targetId`/anchor. Character Action System chịu trách nhiệm đi tới, kiểm tra lại, chạy timed action và commit. Mở loot panel của container khi player đã đứng gần có thể là tương tác tức thời qua cùng resolver; chuyển item từ container vẫn phải qua InventoryService với reach/ownership validation. Cả hai tài liệu dùng **một action registry và một đường thực thi**, dù UI gọi từ chuột trái, chuột phải hay inventory.
