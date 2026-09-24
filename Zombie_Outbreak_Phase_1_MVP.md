# Zombie Outbreak — Kế hoạch triển khai Phase 1 (MVP)

> Phiên bản kế hoạch: 1.0 · Ngày: 23/09/2026 · Đối tượng: một developer quen React/TypeScript, làm khoảng 15–20 giờ/tuần.

## 1. Mục tiêu và ranh giới

Xây dựng game sinh tồn zombie 3D góc nhìn isometric, chơi trên trình duyệt máy tính, một người chơi, đồ họa low-poly. Người chơi khám phá khu phố nhỏ, lấy nhu yếu phẩm, đánh hoặc tránh zombie, duy trì sức khỏe và sống qua chu kỳ ngày đêm. Có thể lưu rồi chơi tiếp sau khi tải lại trang.

**Mốc nghiệm thu:** chơi được một phiên 15–30 phút với vòng lặp khám phá → loot → đối mặt zombie → dùng tài nguyên → sống tiếp; trạng thái được khôi phục đúng sau khi tải lại. Thời gian dự kiến 8 tuần, là ước lượng để lập lịch chứ không phải cam kết.

### Phạm vi bắt buộc

- Một bản đồ cố định, bắt đầu 50 × 50 đơn vị; chỉ mở rộng khi hệ thống hoạt động ổn định. Tối thiểu hai công trình có thể vào và tìm đồ.
- Một nhân vật mặc định; đi, chạy, đẩy, đánh cận chiến và tương tác.
- Zombie phát hiện theo khoảng cách, đuổi, tấn công, nhận sát thương và chết; không đi xuyên tường.
- Health, stamina, hunger, thirst; một vũ khí cận chiến; inventory 12 ô; thức ăn, nước và vật phẩm hồi máu.
- Container có loot hữu hạn; ngày đêm; game over; new game/continue; lưu cục bộ.
- Menu và HUD đủ rõ để chơi; âm thanh, phản hồi khi trúng đòn và tùy chọn cơ bản ở giai đoạn hoàn thiện.

### Để sau Phase 1

Multiplayer, căn cứ, crafting, farming, xe, súng, nghề nghiệp, bản đồ tạo ngẫu nhiên, tùy chỉnh nhân vật và zombie migration. Chỉ thêm vật liệu chế tạo vào loot khi chúng có tác dụng trong MVP; mặc định bỏ wood và scrap metal khỏi loot để mọi vật phẩm thu được đều hữu ích.

## 2. Thông số thiết kế ban đầu

Các con số sau là **giá trị thử nghiệm**, được chỉnh sau playtest; quy ước 1 đơn vị thế giới ≈ 1 mét. Chỉ số hunger/thirst bằng 100 là tốt và giảm theo thời gian.

| Thành phần | Giá trị khởi đầu | Ghi chú |
|---|---:|---|
| Player health/stamina/hunger/thirst | 100 mỗi chỉ số | Health = 0: game over; hunger/thirst = 0: mất máu theo thời gian |
| Đi/chạy | 4 / 7 đơn vị/giây | Chạy tiêu stamina; hồi khi ngừng chạy hoặc đánh |
| Zombie health/tốc độ | 50 / 2 đơn vị/giây | Tốc độ phải đủ để người chơi có lựa chọn chạy |
| Zombie phát hiện/tầm đánh | 10 / 1,5 đơn vị | Chỉ đánh khi có thể tiếp cận, không xuyên tường |
| Zombie sát thương/hồi đòn | 10 / 1,5 giây | Mỗi zombie có cooldown riêng |
| Gậy sát thương/tầm/hồi đòn | 25 / 2 đơn vị / 0,8 giây | Hai đòn trúng để hạ zombie cơ bản |
| Gậy stamina/knockback | 10 / 1,5 đơn vị | Kiểm tra hướng đánh và đường va chạm |
| Inventory | 12 ô | Item cùng loại có thể stack theo giới hạn định nghĩa trong item data |

**Điều khiển:** WASD di chuyển; Shift chạy; chuột trái đánh; Space đẩy; E tương tác; I mở inventory; Esc pause. Khi đánh, nhân vật hướng về điểm con trỏ chiếu xuống mặt đất. UI đang mở không được kích hoạt đòn đánh ngoài ý muốn. Camera orthographic nghiêng isometric, theo nhân vật có làm mượt, cho zoom bằng con lăn với giới hạn min/max.

## 3. Vòng lặp và luồng người chơi

1. New Game tạo một seed loot và trạng thái thế giới; nhân vật xuất hiện tại nhà an toàn.
2. Người chơi nhìn thấy điểm cần khám phá, đi tới, né hoặc đánh zombie.
3. Nhấn E gần cửa/container, lấy thức ăn, nước hoặc băng; inventory có sức chứa hữu hạn.
4. Sử dụng vật phẩm để hồi chỉ số; hoạt động và thời gian làm giảm stamina, hunger, thirst.
5. Trời tối làm thay đổi bầu không khí và độ khó cảm nhận; người chơi tìm nơi trú, rồi tiếp tục ngày tiếp theo.
6. Tự động lưu tại các sự kiện quan trọng và có nút lưu trong pause menu; Continue khôi phục đúng phiên chơi.
7. Health về 0 mở Game Over; New Game tạo ván mới sau xác nhận ghi đè save.

**Nguyên tắc cân bằng:** tránh ngõ cụt không cứu được: khu khởi đầu có đủ nhu yếu phẩm cho lần khám phá đầu; loot đủ để duy trì một phiên thử 15–30 phút; zombie không xuất hiện sát nhân vật ngay sau load.

## 4. Thế giới và tương tác

Bắt đầu bằng bản đồ tay 50 × 50: nhà xuất phát, cửa hàng và một nhà dân đi vào được; đường, hàng rào, vật cản. Mục tiêu mở rộng lên khu phố với 5–7 công trình và tối đa khoảng 150 × 150 **chỉ nếu** hiệu năng và nội dung đủ tốt. Tách geometry hiển thị khỏi collider. Các lối đi, cửa và vị trí loot phải đặt thủ công để kiểm soát trải nghiệm đầu tiên.

- Tương tác chọn đối tượng gần nhất trong tầm, ưu tiên đối tượng người chơi đang nhìn; hiện prompt tên + phím E.
- Mỗi cửa có ID ổn định, trạng thái mở/đóng và collider phù hợp; cửa đóng chặn đường đi và đòn đánh.
- Mỗi container có ID ổn định và danh sách item được tạo một lần theo seed; lấy đồ là thao tác chuyển số lượng từ container vào inventory. Hết chỗ thì phần dư vẫn ở container.
- Cần định nghĩa rõ vùng có thể đi, điểm nối cửa và collider trước khi làm AI. Không đặt đồ có thể loot phía sau tường không vào được.

## 5. Các hệ thống gameplay

### 5.1 Player và survival

Input manager lưu trạng thái phím/chuột, được đọc trong vòng cập nhật game. Chuyển động theo hướng mặt phẳng thế giới nhất quán với hình chiếu camera, dùng physics controller/collider và delta time; giới hạn delta sau khi tab không hoạt động. Chạy và đánh bị ràng buộc bởi stamina. Pause phải dừng simulation, cooldown và đồng hồ trong game.

Cập nhật survival theo thời gian game, dùng công thức có thể chỉnh trong config. Thirst/hunger giảm đều; ở 0 thì health giảm. Băng hồi health, thức ăn hồi hunger, nước hồi thirst; không vượt quá 100. Chỉ trừ item khi hành động dùng thành công. HUD không cần rerender 60 lần/giây: cập nhật theo thay đổi có ý nghĩa hoặc nhịp chậm.

### 5.2 Zombie AI và điều hướng

FSM tối thiểu: `IDLE → CHASE → ATTACK → CHASE`, mọi trạng thái có thể chuyển `DEAD`. Kiểm tra phát hiện ở tần suất thấp hơn render; khi mất mục tiêu thì quay về IDLE sau một khoảng chờ. Đòn zombie phải xác nhận tầm đánh, cooldown và không bị tường chắn tại thời điểm gây sát thương; DEAD hủy AI, collider gây hại và đòn đang chờ.

**Quyết định kỹ thuật theo cổng thử nghiệm:** với bản đồ nhỏ, dựng trước navigation grid hoặc waypoint quanh tường và qua cửa, tìm đường khi mục tiêu đổi ô/đường bị chặn, không tìm lại mỗi frame. Nếu demo cửa và góc nhà cho thấy nhiều zombie mắc kẹt hoặc việc biên tập đường đi quá tốn công, thử navmesh (ví dụ recast-navigation) trước khi tăng số lượng zombie. Steering tránh vật cản chỉ dùng phụ trợ cho chuyển động cục bộ, không dựa vào nó để đi vòng cả tòa nhà.

### 5.3 Combat

Chuột trái kích hoạt animation/cửa sổ trúng đòn một lần, tiêu stamina và bắt đầu cooldown. Tại frame gây sát thương, lấy các zombie trong tầm, lọc bằng góc theo hướng nhìn (dot product), rồi kiểm tra tường che (raycast hoặc truy vấn collider). Mỗi zombie chỉ nhận sát thương một lần trong mỗi cú đánh. Knockback không đẩy zombie xuyên tường. Space đẩy có cooldown và chi phí stamina riêng, mục đích tạo khoảng trống; chốt thông số qua playtest.

### 5.4 Inventory và loot

Item definition là dữ liệu cố định gồm `itemId`, tên, loại, stackLimit và hiệu ứng. Inventory entry gồm `itemId`, `quantity`, `instanceId` nếu cần phân biệt; gậy có thể là item trang bị riêng. Các thao tác `add/remove/use/transfer` phải trả kết quả rõ ràng, không để số lượng âm hoặc mất vật phẩm khi đầy ô. UI gồm inventory 12 ô và panel container; có thể click để chuyển item, thêm Take All nếu còn chỗ. Dữ liệu loot phát sinh một lần khi tạo ván hoặc lần đầu mở container, lưu kết quả thay vì gieo lại mỗi lần mở.

### 5.5 Thời gian, spawn và save

Một clock game điều khiển ngày/đêm và tác động ánh sáng. Spawn zombie ở các điểm hợp lệ, ngoài tầm nhìn và đủ xa người chơi, có giới hạn số con hoạt động; không làm zombie xuất hiện trực tiếp trong nhà an toàn. Trạng thái spawn cần tái lập nhất quán sau load.

Save trong IndexedDB chứa `schemaVersion`, `worldSeed`, `savedAt`, thời gian trong game, player (vị trí/hướng/chỉ số), inventory, trạng thái container/cửa và trạng thái zombie cần bảo toàn. Mỗi thực thể lưu được có ID ổn định. Save phải là snapshot của simulation ở ranh giới một tick để tránh trạng thái nửa chừng. Ghi bản lưu theo thao tác nguyên tử của IndexedDB; bắt lỗi quota/hỏng dữ liệu và báo rõ cho người chơi. Khởi đầu một phiên bản schema, có cơ chế migrate hoặc thông báo save không tương thích khi đổi schema; không lặng lẽ nạp sai. Pause trước khi Save/Load; load không được nhân đôi zombie hoặc loot.

## 6. Kiến trúc và cấu trúc mã

| Tầng | Công nghệ/việc phụ trách |
|---|---|
| App/UI | Vite, React, TypeScript; menu, HUD, inventory, settings |
| Render | Three.js, React Three Fiber, Drei; scene, camera, mesh, ánh sáng |
| Physics | React Three Rapier; collider và truy vấn vật lý |
| Gameplay | Module TypeScript thuần; simulation, AI, combat, loot, clock |
| UI state | Zustand; menu, màn hình, thông tin HUD theo nhịp phù hợp |
| Persistence | IndexedDB; snapshot có version |
| Audio/Test | Howler.js khi thêm âm thanh; Vitest cho luật game cốt lõi |

Không đẩy vị trí và vận tốc của mọi zombie vào React state mỗi frame. Simulation giữ dữ liệu runtime; render đọc và áp vào object 3D trong game loop; UI chỉ nhận snapshot cần hiển thị. Chỉ có một nguồn thời gian simulation. Chốt thứ tự một tick, ví dụ: input → chuyển động/physics → AI → combat → survival/clock → phát sự kiện → sync render/UI. Dùng delta time có giới hạn, hoặc fixed timestep cho logic nhạy với va chạm; tách tốc độ logic khỏi FPS.

```text
src/
  app/                 App, điều hướng màn hình, khởi tạo game
  game/
    core/              config, clock, loop, runtime, events
    entities/          player, zombie, item definitions
    systems/           input, movement, AI, combat, survival, inventory, loot, save
    world/             map data, cửa, container, navigation, spawn
    rendering/         scene, camera, mesh/animation, lighting
  components/          HUD, inventory, menu, loot panel
  stores/              UI state và HUD snapshot
  types/               kiểu dữ liệu chia sẻ và save schema
public/                models, textures, audio
```

Giữ thư mục theo nhu cầu thực tế; tránh tạo file rỗng chỉ để theo sơ đồ. Cấu hình gameplay tập trung, dữ liệu map/item có ID cố định. Ghi chú nguồn và giấy phép asset bên cạnh manifest khi đưa asset bên ngoài vào dự án.

## 7. Lộ trình 8 tuần và Definition of Done

### Sprint 1 — Nền tảng và prototype (tuần 1)

**Thứ tự:** khởi tạo Vite/TypeScript → R3F/Drei/Rapier → scene + mặt đất 50 × 50 → input → player placeholder và collider → WASD/Shift → camera orthographic theo nhân vật → tường thử nghiệm → một zombie placeholder đuổi nhân vật.

**Bàn giao:** một build chơi được bằng trình duyệt. Di chuyển không phụ thuộc FPS, player không xuyên tường, camera không giật; zombie theo được người chơi trong khu trống. Đây là bản thử kỹ thuật 2–3 ngày đầu rồi hoàn thiện trong tuần.

### Sprint 2 — Khu phố và tương tác (tuần 2)

**Thứ tự:** vẽ layout → đường/nhà/collider → hai công trình đi vào được → cửa và lối đi → prompt E → container ID ổn định → kiểm tra va chạm và tiếp cận mọi container.

**Bàn giao:** đi vào hai công trình, mở cửa, tương tác với container; không mắc kẹt và không tương tác xuyên tường.

### Sprint 3 — AI và chiến đấu (tuần 3–4)

**Thứ tự:** zombie FSM → đường đi quanh nhà/cửa → health/damage → định hướng con trỏ → gậy và hit window → lọc góc/tường → knockback → zombie attack/cooldown → tử vong và feedback → Space đẩy.

**Bàn giao:** nhiều zombie đuổi qua lối hợp lệ, tấn công và bị hạ; không đánh xuyên tường hoặc đánh sau khi chết. Playtest tại cửa, góc nhà và khi nhiều con vây người chơi; giải quyết navigation trước khi mở rộng map.

### Sprint 4 — Survival, inventory, loot (tuần 5)

**Thứ tự:** item definitions + inventory logic → loot hữu hạn và transfer → UI inventory/container → dùng thức ăn/nước/băng → hunger/thirst/stamina → HUD → cân bằng tài nguyên vòng chơi đầu.

**Bàn giao:** có thể lấy, dùng và thấy hiệu ứng vật phẩm; hết slot không mất loot; mở lại tủ không sinh thêm đồ; chỉ số thay đổi đúng khi pause/chơi.

### Sprint 5 — Tiến trình và lưu game (tuần 6)

**Thứ tự:** clock → ánh sáng ngày/đêm → spawn có giới hạn → game over/New Game → snapshot schema → IndexedDB save/load → Continue → kiểm tra reload và dữ liệu không tương thích.

**Bàn giao:** lưu giữa phiên, reload và tiếp tục đúng vị trí, giờ, chỉ số, inventory, cửa, container và zombie; không nhân đôi thực thể. Nút New Game xử lý rõ việc ghi đè save.

### Sprint 6 — Hoàn thiện và phát hành (tuần 7–8)

**Thứ tự:** playtest 15–30 phút → sửa lỗi làm gián đoạn vòng chơi → audio/feedback → settings và hướng dẫn điều khiển → đo FPS trên cấu hình thử → tối ưu nút thắt đo được → build production → deploy → chơi thử bản deploy và kiểm tra save/reload.

**Bàn giao:** URL game hoạt động; bản build ổn định. Mục tiêu khoảng 60 FPS trên laptop GPU tích hợp tương đối mới ở cấu hình phù hợp, nhưng chỉ xác nhận sau khi đo trên thiết bị thực; ghi lại thiết bị, trình duyệt, độ phân giải và số zombie trong kết quả.

## 8. Checklist kiểm thử theo rủi ro

| Nhóm | Tình huống cần chứng minh |
|---|---|
| Input/physics | Di chuyển chéo không nhanh hơn; tab mất focus không kẹt phím; không xuyên tường/cửa; pause dừng đúng |
| AI | Zombie đi vòng tường, qua cửa mở; không kẹt góc; không teleport qua cửa đóng; chỉ zombie còn sống gây sát thương |
| Combat | Mục tiêu phía sau hoặc sau tường không trúng; mỗi cú đánh chỉ gây một lần; hết stamina/cooldown không tấn công |
| Loot/inventory | Hết chỗ thì đồ còn trong container; không tự nhân bản; stack hợp lệ; không sử dụng item khi số lượng bằng 0 |
| Survival | Giá trị giới hạn 0–100; hunger/thirst = 0 gây mất máu; dùng vật phẩm hồi đúng; pause không trừ chỉ số |
| Save/load | Reload nhiều lần không reset loot, cửa, giờ hoặc nhân zombie; dữ liệu lỗi báo được; New Game tạo trạng thái sạch |
| Release | Build mở được từ URL, asset tải thành công, điều khiển có hướng dẫn, save/continue chạy trong bản deploy |

Viết unit test có ý nghĩa cho inventory transfer, combat filter, survival tick và chuyển đổi save schema; dùng một vài bài kiểm thử tích hợp/manual cho tương tác xuyên tường, navigation và reload. Không viết test chỉ lặp lại cấu trúc component.

## 9. Các cổng quyết định và quản lý công việc

- **Cuối tuần 1:** nếu controller/collision/camera chưa ổn, chưa làm asset hoặc bản đồ lớn.
- **Cuối tuần 2:** khóa layout nhỏ và ID của đối tượng lưu được trước khi gắn AI/save.
- **Cuối tuần 4:** nếu zombie mắc kẹt thường xuyên ở cửa/góc, ưu tiên sửa đường đi hoặc đổi sang navmesh trước sprint inventory.
- **Cuối tuần 5:** kiểm tra vòng chơi 10–15 phút; nếu thiếu mục tiêu hoặc tài nguyên mất cân bằng, chỉnh map/loot/spawn trước khi thêm tính năng.
- **Cuối tuần 6:** kiểm tra snapshot và reload qua nhiều lần; giữ save schema ổn định cho bản phát hành.
- **Cuối tuần 8:** chỉ xem MVP hoàn tất khi đáp ứng mốc 15–30 phút và checklist release.

Dùng backlog theo mẫu: **mục tiêu người chơi → nhiệm vụ kỹ thuật → tiêu chí nghiệm thu → phụ thuộc → mức ưu tiên**. Mỗi sprint nên tạo một build chơi được, ghi lỗi phát hiện trong playtest và chỉ nhận việc mới sau khi lỗi chặn tiến độ đã xử lý.

## 10. Việc bắt đầu ngay

1. Tạo repository Vite React TypeScript và scene R3F/Rapier tối thiểu.
2. Dựng sân 50 × 50, player placeholder, camera isometric và một bức tường collider.
3. Hoàn thành WASD/Shift, giới hạn camera zoom, xử lý tab blur/pause.
4. Thêm zombie placeholder truy đuổi trong khu trống.
5. Chạy build và chơi thử 5 phút; ghi nhận va chạm, hướng di chuyển, giật camera và FPS. Chỉ sau đó mới dựng hai công trình của Sprint 2.

**Tiêu chí hoàn thành Phase 1:** tất cả mục trong phạm vi bắt buộc hoạt động cùng nhau trong bản deploy, một phiên 15–30 phút chơi trọn vòng sinh tồn và Continue sau reload khôi phục thế giới nhất quán.
