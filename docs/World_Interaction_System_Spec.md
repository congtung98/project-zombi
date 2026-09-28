# World Interaction System — Đặc tả triển khai

**Dự án:** game sinh tồn zombie React + Three.js  
**Phiên bản tài liệu:** 1.0 · 28/09/2026  
**Đối tượng đọc:** coding agent triển khai chọn vật thể bằng chuột, tương tác trực tiếp và menu ngữ cảnh.

## 1. Mục tiêu và bối cảnh

Cho phép người chơi click chuột trái vào cửa, tủ, kệ, giá sách và các object trong game để thực hiện thao tác mặc định; click chuột phải để xem hành động hợp lệ theo trạng thái của object và nhân vật. Tương tác từ xa phải đi đến vị trí hợp lệ trước khi thực hiện, khi target thay đổi phải kiểm tra lại.

Tên `WorldInteractionSystem` và module con là kiến trúc **đề xuất cho game React + Three.js**, lấy cảm hứng từ cách PZ tách picking, click handler, context menu và timed action. Không mặc định code PZ hay codebase của game dùng đúng tên/API trong tài liệu này.

### 1.1. Ràng buộc từ dự án

- Game đã có player, zombie/navigation cơ bản, inventory 12 ô, melee, save bằng IndexedDB và chu kỳ ngày/đêm.
- Phase 2 có furniture container với ID ổn định, loot chỉ tạo một lần; cửa, barricade, công trình thay đổi collider/navigation và lưu state.
- New Game không tự trang bị gậy; một container gần điểm bắt đầu có vũ khí để người chơi tìm. Tương tác container phải đưa người chơi tới vòng gameplay này.
- Tài liệu Character Action System quy định request, queue, reservation, cancel/commit. World Interaction chỉ chọn target, quyết định action nào khả dụng và gửi request tới cùng executor.
- Agent phải đối chiếu camera, input controls, render layer, collision, navigation, item/container và save thật trong repository trước khi code. Tên API bên dưới là gợi ý.

## 2. Phạm vi và hành vi người chơi

| Object | Click trái mặc định | Click phải |
|---|---|---|
| Cửa thường | Nếu đóng và có thể mở: mở; nếu mở: đóng, sau khi đến đúng phía/khoảng cách | Open/Close; Lock/Unlock, Repair, Barricade hoặc Remove nếu các feature tương ứng đã có. |
| Container (tủ, tủ đầu giường, kệ, giá sách, thùng) | Chọn/mở loot panel khi ở gần; ở xa thì đi tới rồi mở | Loot, Take All nếu phù hợp; Disassemble/Pick Up chỉ khi feature thực sự tồn tại. |
| Công tắc đèn | Toggle khi ở gần | Turn On/Off theo state, nếu hệ điện hiện có hỗ trợ. |
| Công trình/barricade | Thao tác mặc định hợp lý nếu có; không tự phá khi click trái | Repair/Remove/Inspect và các action đã được triển khai. |
| Đất trống | Giữ hành vi movement/selection hiện tại | Menu ground nếu có hành động hợp lệ; ngoài ra đóng menu. |
| Zombie | Giữ combat/targeting hiện tại theo input mode | Không hiện menu furniture. |

Không đưa action chưa được triển khai thành lựa chọn bấm được. Có thể hiện disabled kèm lý do nếu hữu ích; ví dụ `Barricade (cần búa và đinh)`. Ban đầu chỉ cần door, container và một object thứ ba làm ví dụ registry; mở rộng tree/bed/generator sau khi có gameplay thực.

## 3. Luồng xử lý

```text
Canvas pointer event
  → Input router (UI/modal/combat/movement priority)
  → Object picker (raycast + occlusion + hit priority)
  → Interaction resolver (state + player + reach + registry)
  ├─ left click: chọn default action
  └─ right click: tạo context menu
  → Character Action System / immediate world command
  → validate lại khi đến gần và khi commit
  → world state → render + collider + navigation + save
```

**Một nguồn chân lý:** mesh/userData chỉ chứa hoặc tham chiếu `worldObjectId` và phần hitbox. `WorldObject` trong world state giữ `type`, transform, state, `version` và dữ liệu tương tác. UI/mesh/collider được dựng từ state. Không cất loot thật trong mesh và không tính state cửa bằng `mesh.visible`.

## 4. Thành phần đề xuất

| Thành phần | Vai trò | Đầu ra |
|---|---|---|
| `InputRouter` | Phân biệt click UI và canvas, nút trái/phải, drag camera, combat mode, movement | `PointerIntent` hoặc bỏ qua. |
| `ObjectPicker` | Tính ray từ camera/NDC, intersect hitbox, lọc occlusion/layer và thứ tự | `PickedTarget` gồm ID và hit point. |
| `WorldObjectRegistry` | Định nghĩa object/action theo loại và capability | Danh sách descriptor, default action. |
| `InteractionResolver` | Tính action hợp lệ/disabled dựa trên object state, actor, inventory, reach | Menu model hoặc request. |
| `InteractionController` | Điều phối click trái, click phải, menu, click lần hai/cancel | Một command duy nhất. |
| `Approach/Reach` | Đi đến interaction anchor và xác minh range, mặt tiếp cận, LOS theo action | Vị trí hợp lệ hoặc lý do fail. |
| `WorldMutation` | Đổi cửa/đèn/container/công trình và phát invalidation | State/render/collider/nav/save thống nhất. |

Action tốn thời gian được chuyển cho `CharacterActionSystem`; chọn container và bật loot panel có thể tức thời **sau khi** kiểm tra reach. Đừng tạo một timed action cho mọi click nếu gameplay hiện tại không cần thời gian chờ.

## 5. Hợp đồng dữ liệu

```ts
type WorldObject = {
  id: string;                   // ổn định qua save/load
  type: 'door' | 'container' | 'lightSwitch' | 'structure' | string;
  position: { x: number; y: number; z: number };
  rotation?: number;
  version: number;              // tăng khi state liên quan đổi
  state: Record<string, unknown>; // schema cụ thể theo type
};

type InteractionContext = {
  actorId: string;
  targetId: string;
  hitPoint?: { x: number; y: number; z: number };
  inventoryView: unknown;
  worldVersion: number;
};

type InteractionDescriptor = {
  id: string;                   // open-door, loot, barricade...
  label: string;
  priority?: number;
  isDefault?: boolean;
  availability(ctx: InteractionContext):
    | { enabled: true }
    | { enabled: false; reason: string; hidden?: boolean };
  reach: { radius: number; needsLineOfSight?: boolean; side?: 'either' | 'near' };
  execution: 'immediate' | 'character-action';
  makeRequest(ctx: InteractionContext): ActionRequest | WorldCommand;
};
```

`ActionRequest` tuân theo đặc tả Character Action System. Registry khai báo khả năng theo loại, handler đánh giá theo **instance state**. Ví dụ `door` chỉ cho Open khi `closed && !locked && !barricaded`; `container` chỉ cho Loot khi có quyền mở và ở vị trí tiếp cận; menu có thể hiển thị action disabled để giải thích lý do. `availableActions` không được cache qua thay đổi state mà không invalidation.

### 5.1. Quy tắc ID và persistence

- World object có ID cố định theo map/instance; container không reroll loot khi mở lại hoặc reload. Nếu sinh procedural, lưu ID và lootGenerated/contents sau lần sinh đầu.
- Save state cửa open/closed/locked/barricade/HP theo schema Phase 2, contents container và công trình đặt bởi người chơi. Hover, menu đang mở, picked mesh và path tạm không lưu.
- Sau load: dựng world state → mesh/collider → navigation → bắt đầu simulation; không để visual cửa mở còn collider đóng.

## 6. Picking bằng Three.js

1. Nghe `pointerdown` hoặc `click` ở canvas theo input architecture thật; right click gọi `preventDefault` để chặn menu trình duyệt **chỉ khi canvas đang nhận input gameplay**.
2. Tính tọa độ pointer theo `getBoundingClientRect()` của canvas, cập nhật khi resize/DPR; dùng camera đang active để `Raycaster.setFromCamera()`.
3. Raycast vào tập collider/pick proxy tương tác được, không raycast toàn bộ decorative meshes mỗi frame. Một object nhiều mesh con trỏ về cùng `worldObjectId`.
4. Xử lý occlusion: tường, tầng, mái hoặc object chắn trước target theo camera/gameplay hiện có. Không click xuyên tường vào tủ phía sau; các mesh mái đang bị ẩn để thấy nội thất không chặn sai. Vùng nhìn của player (fog/visibility) nếu có phải chặn tương tác với object chưa được thấy theo luật game, **không chỉnh ambient light/độ sáng môi trường** để thực hiện picking.
5. Dùng ưu tiên chọn rõ ràng khi hit chồng lấn: UI overlay > object tương tác gần hit point > ground; cửa và furniture có pick proxy phù hợp để không bị sàn ăn click. Tránh sort thuần theo loại khiến click xuyên object phía trước.
6. Hover highlight chỉ cho target thực sự pick được; chỉ render outline/emissive tạm, không mutate material dùng chung của các object khác. Dọn hover/menu khi target bị destroy/unmount.

Nếu game dùng góc nhìn isometric hoặc camera nghiêng, cần kiểm thử click phần thân/biên cửa, kệ trước tường, sàn ngay dưới furniture, nhiều tầng và zoom khác nhau. Raycast chỉ chọn target; reach/LOS của **player** vẫn được kiểm tra riêng.

## 7. Input routing và xung đột nút chuột

Thứ tự ưu tiên đề xuất:

1. Nếu pointer nằm trên inventory/context menu/dialog/overlay, UI xử lý và chặn propagation xuống canvas.
2. Nếu đang kéo camera, chọn vùng, đặt công trình hoặc trong combat mode có quy tắc riêng, input router chuyển cho mode đó; không đồng thời loot/mở cửa/đánh.
3. Chuột trái trên object tương tác → default action; trên zombie → combat/targeting như hiện có; trên đất → move nếu game dùng click-to-move.
4. Chuột phải trên object → menu ngữ cảnh neo tại vị trí pointer; trên đất → menu ground hoặc đóng menu.

Mọi lệnh từ click chỉ phát một command. Debounce theo pointer gesture/request ID để `pointerdown + click` không tạo hai request. Right click mở menu không đồng thời ra lệnh move/attack. Bấm ngoài, Esc theo quy tắc pause UI hiện hữu, target mất, chuyển scene hoặc chọn một action thì menu đóng. Khi menu đang mở, không cập nhật target ngầm theo hover khiến hành động áp lên object khác; menu giữ `targetId` và resolver revalidate trước dispatch.

## 8. Reach, approach và đường đi

- Mỗi loại action có `interaction anchors` từ footprint/collider: cửa có vị trí hai phía, container có ô đứng phía trước; chọn anchor đi được gần actor nhất theo navigation hiện có.
- Nếu đứng trong radius và LOS hợp lệ → xử lý ngay hoặc bắt đầu timed action. Nếu xa → enqueue `moveToAnchor`, hiện feedback đang tiếp cận, tới nơi kiểm tra lại target/range/LOS/state rồi thực hiện.
- Chặn tương tác qua tường hoặc cửa đóng dù khoảng cách Euclidean nhỏ; path, reach và LOS là các kiểm tra riêng. Cửa được phép mở từ phía tiếp cận hợp lệ; container sau cửa đóng đòi đi qua cửa theo cơ chế game, không loot xuyên qua.
- Target bị phá, đổi trạng thái, người chơi chủ động di chuyển/đánh, đường bị zombie/công trình chặn, scene đổi → hủy/cập nhật path theo policy có giới hạn; timeout rõ ràng, không đứng kẹt vô tận.
- Menu có thể xem ở xa nếu thiết kế cho phép, nhưng action không commit ngoài tầm với. Điều kiện tài nguyên/target được đánh giá lại khi đến nơi.

Navigation target và obstacle update phải khớp Phase 2: cửa mở/vỡ thay collider và path; barricaded door chặn mở; công trình đặt/xóa cập nhật topology. Không chỉ đổi animation/mesh mà để collider cũ.

## 9. Luồng object cụ thể

### 9.1. Cửa

`Click → pick door ID → resolver xác định Open/Close → approach đúng phía → validate cửa hiện tại → đổi state → cập nhật animation, collider, nav, audio và save`.

- Closed/unlocked/unbarricaded → Open. Open → Close nếu vùng đóng không đè player/zombie theo luật collider. Locked → không mở, báo lý do; barricaded → không mở cho tới khi tháo đúng quy tắc Phase 2.
- Nếu action mở/đóng cần thời gian/animation của nhân vật, gửi qua Character Action System; nếu game đã xử lý tức thời thì world command vẫn phải revalidate ở tầm với.
- Khi nhiều click liên tiếp, tránh open-close-open bất ngờ: chỉ một command pending cho cùng actor/target; command cũ bị hủy hoặc click tiếp theo được xử lý có chủ ý. Một lần state transition → một nav invalidation.
- Door/barricade HP riêng theo Phase 2. Zombie phá cửa có thể làm target thay đổi khi player đang đến; request stale fail sạch.

### 9.2. Container/furniture

`Click → approach → chọn container → nếu loot chưa tạo, sinh đúng một lần theo seed/state → hiển thị loot panel → chuyển item qua InventoryService`.

- UI có cột inventory người chơi và container nếu UI hiện hữu hỗ trợ; chỉ mở một container active. Mở lại giữ contents, condition/ID/quantity không reroll.
- Chuyển từng item hoặc Take All kiểm tra capacity 12 ô, stack và reservation. Một item instance đổi owner một lần; nếu Take All thiếu chỗ, định nghĩa rõ partial transfer hoặc fail toàn bộ, báo kết quả. Đề xuất partial transfer theo thứ tự item ổn định và báo món còn lại.
- Nếu player đi quá xa, container bị phá/nhấc đi, đổi scene hoặc chết: đóng panel hoặc vô hiệu hóa transfer ngay; không cho kéo đồ từ xa qua panel còn mở.
- Container được chế tạo bởi player không tự sinh loot. Container bị phá xử lý world drop và item ID theo kế hoạch Phase 2.

### 9.3. Context menu cho object mở rộng

Menu sinh từ descriptor đã lọc/sort, không hardcode mọi nút bằng `if (mesh.name === ...)` trong React component. Ví dụ:

```ts
registerInteractions('door', [openDoor, closeDoor, repairDoor, barricadeDoor]);
registerInteractions('container', [lootContainer, takeAll, disassemble]);
registerInteractions('lightSwitch', [toggleLight]);
```

Các entry chưa có implementation được loại bỏ hoặc disabled có thông báo; mod/feature tương lai đăng ký descriptor mới qua API có kiểm soát. Registry cho phép nhiều provider, nhưng ID trùng thì báo lỗi dev để không âm thầm ghi đè. Không chạy mã handler tùy ý từ save data; save chỉ chứa state/ID.

## 10. UI, thông báo và cảm giác điều khiển

- Context menu nằm gần pointer, giới hạn trong viewport, hoạt động khi canvas resize; hỗ trợ click, Escape và bàn phím cơ bản nếu hệ UI có sẵn.
- Nhãn action ngắn, chính xác với state: `Open Door`/`Close Door`, `Loot`, `Repair`, `Remove Barricade`; disabled có lý do cụ thể.
- Highlight và cursor tương ứng object/action; phản hồi rõ khi quá xa, khóa, thiếu tool, path không đến được, inventory đầy hoặc target đã đổi.
- Loot panel và context menu không bắt buộc pause simulation; nhất quán với plan Phase 2, trong đó mở inventory/crafting không tự pause. Nếu game hiện tại có setting pause inventory khác, giữ hành vi hiện hữu và ghi lại quyết định.
- Layer menu không sửa world state. Một click action tạo request, world state chỉ đổi trong executor/command.

## 11. Save và tác động liên hệ

`WorldMutation` phát event như `doorStateChanged`, `containerContentsChanged`, `structureCreated/Destroyed`, `navigationInvalidated` hoặc callback tương đương. Adapter render cập nhật mesh/animation, physics cập nhật collider, navigation recalculates vùng cần thiết, UI render từ snapshot, persistence ghi trạng thái đã commit. Đảm bảo việc thay đổi cửa/container không tạo item trùng nếu save hoặc reload trong cùng tick.

Trong scene có vision/fog, interaction visibility chỉ tham chiếu kết quả visibility để quyết định pick/select; không dùng đèn/ambient light để tạo vùng click. Chu kỳ ngày/đêm hiện có không bị thay đổi vì feature này.

## 12. Trình tự triển khai cho agent

1. **Khảo sát repository:** xác định camera, raycast/picking hiện hữu, pointer controls, movement/pathfinding, door/world object model, loot/inventory, React overlay, save schema và lệnh build/test. Ghi mapping tới interface trong tài liệu.
2. **Thử vertical slice:** một cửa và một container trong scene thật; ID ổn định, click chính xác, tiếp cận và validate lại; không làm menu toàn bộ object trước khi luồng này chạy.
3. **Input + picker:** routing UI/canvas/mode, hit priority/occlusion, click trái/phải; hover và cleanup.
4. **Registry + resolver:** capability per type, availability per instance; menu dùng cùng descriptor/default action.
5. **Executor integration:** action tức thời có reach guard; action có thời gian gửi Character Action System; loot transfer qua InventoryService.
6. **World mutation:** cửa/container cập nhật render, collider, navigation, save; thêm lightSwitch/công trình nếu data đã có.
7. **Kiểm tra scene và bàn giao:** mouse gestures, nhiều cửa/tủ, zombie và save/load; ghi file đã sửa, hành vi thật và feature vẫn phụ thuộc Phase 2.

## 13. Kiểm thử và tiêu chí nghiệm thu

| Tình huống | Kết quả bắt buộc |
|---|---|
| Click tủ cạnh cửa/sàn, zoom và góc camera khác nhau | Chọn đúng tủ, không vô tình move/đánh. |
| Click tủ sau tường hoặc container chưa nhìn thấy | Không loot xuyên tường; ray/visibility theo luật game. |
| Click tủ từ xa có đường đi | Player đi tới anchor rồi mới mở panel; transfer chỉ khi còn đủ gần. |
| Không có path/target bị phá trong lúc di chuyển | Hủy gọn, báo lỗi, không mở panel/đổi state. |
| Chuột phải cửa khóa/barricaded | Menu phản ánh trạng thái, Open không thực thi; không xuất hiện action chưa làm. |
| Menu đang mở, cửa đổi state do zombie/player khác | Click action revalidate và fail/đổi theo quy tắc, không áp lên object khác. |
| Click liên tiếp cửa đang pending | Không tạo nhiều lệnh mở/đóng trái ý hoặc nhiều nav invalidation. |
| Mở cùng tủ 3 lần, save/load rồi mở | Loot sinh một lần, ID/condition/quantity giữ nguyên. |
| Take All khi inventory gần đầy | Không vượt 12 ô, item còn lại trong tủ và UI phản ánh đúng. |
| Chuyển item rồi rời tủ hoặc chết | Panel/transfer vô hiệu ở xa; không có bản sao item. |
| Cửa mở/đóng/vỡ rồi reload | Mesh, collider và navigation đồng bộ; zombie/player đi đúng đường. |
| Click UI trên canvas, click phải, kéo camera | Không lọt sang move/attack/loot ngoài ý muốn; menu trình duyệt không che game. |

**Definition of Done:** chuột trái tương tác cửa và container theo trạng thái, chuột phải hiện menu hợp lệ; object ở xa cần tiếp cận; UI không gây click xuyên; container không reroll/mất/nhân đồ; thay đổi cửa cập nhật render/collider/navigation/save; action có thời gian đi qua Character Action System; kiểm tra tay các scene ở trên và test domain tập trung ownership, state transition, save/load.

## 14. Điểm nối với Character Action System

World Interaction tạo `ActionRequest` hoặc `WorldCommand` từ `targetId` và descriptor, không tự thực hiện craft/repair/eat. Character Action System nhận request, điều phối approach và timed action, kiểm tra lại target, reserve/commit/cancel. Mở loot panel sau khi tới gần là lệnh tức thời; lấy đồ khỏi container là mutation có kiểm tra inventory/reach; sửa hoặc gia cố cửa là timed action. Cả hai tài liệu phải được triển khai với cùng ID, inventory ownership, clock, save snapshot và mã lý do lỗi.
