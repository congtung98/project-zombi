# CURRENT_STATE — bàn giao cho phiên làm việc mới

> Cập nhật: **2026-09-24**, hoàn thành **Phase 2 — Sprint P2-S1**.
> Đọc file này, README.md, toàn bộ Zombie_Outbreak_Phase_2_Plan.md và docs/phase2-s1.md.
> **Người dùng tự commit và push mọi thay đổi. Không tự commit/push. Cập nhật CURRENT_STATE cuối mỗi sprint.**

## 1. Trạng thái hiện tại

Phase 1 đã hoàn thành mã cả 6 sprint. Phase 2 đã hoàn thành **S1: dữ liệu item, save/migration và thử cửa động**. Sprint kế tiếp là **P2-S2**, không phải Sprint 2 Phase 1.

Mốc Git trước phiên: **f56399c** (docs: update project status after phase 1 sprint 6); mã Sprint 6 ở f2f70b2. Khác nội dung CURRENT_STATE cũ: Sprint 4/5/6 thực tế đã được commit (01977b3, 15fb349, f2f70b2). Đã ghi nhận mốc Phase 1 trong tài liệu, không tạo tag. Lúc bắt đầu chỉ có plan Phase 2 chưa track; các thay đổi của phiên S1 đều để người dùng review/commit.

| Sprint | Trạng thái |
|---|---|
| Phase 1 S1–S6 | Xong mã; deploy thật, FPS GPU thật và playtest tay vẫn cần xác nhận |
| P2-S1 Item/save/cửa động | Xong; 135 test, build/lint, Chrome dev + production qua; chưa commit |
| P2-S2 Loot/equipment/melee/condition | Tiếp theo |
| P2-S3 Model/animation/character creation | Chưa làm |
| P2-S4 Timed action/craft/repair | Chưa làm |
| P2-S5 Perception/zombie phá cửa | Chưa làm; dùng kết quả spike S1 |
| P2-S6 Barricade/tool/fuel | Chưa làm |
| P2-S7 Building/thùng/vách/rebuild | Chưa làm |
| P2-S8 Tích hợp/cân bằng/release | Chưa làm |

## 2. S1 đã bàn giao

- **ItemDefinition/ItemInstance/Equipment**: itemId tham chiếu definition (giữ tên field từ Phase 1), instance có id/kind. Stack giữ quantity; weapon/tool không stack, quantity 1. Definition gậy thử có maxCondition 80; instance giữ condition. Chưa thêm các melee khác/vật liệu/fuel gameplay.
- **Ownership**: slot trong inventory/container sở hữu instance; equipment chỉ tham chiếu ID của weapon trong túi 12 ô. Inventory có namespace id + nextItemId, lưu counter để không tái sử dụng ID. Chuyển món không stack giữ ID/condition; tách stack cấp ID mới, gộp giữ ID stack đích.
- **Equipment có thể chơi/thử**: click gậy để equip/unequip, chuyển sang tủ tự unequip; thả gậy tạo container một ô có marker dưới chân và E để nhặt lại. Chặn đổi/thả vũ khí khi đang vung. Model gậy theo equipment. Không có gậy thì shove vẫn dùng được.
- **New Game S1 còn gậy**: cấp gậy thật, đặt ở ô cuối và trang bị sẵn để giữ vòng chơi Phase 1. Đây là quyết định theo bàn giao S1 của plan; **S2 mới bỏ grant này** và đưa melee vào loot. Condition chỉ lưu/hiển thị ở S1, chưa wear/broken damage.
- **Save v2/migration v1**: migrate thuần, không mutate đầu vào, giữ stack/loot/clock/stats/vị trí. Gậy mặc định Phase 1 thành instance condition đầy. Túi v1 đủ 12 ô → drop:legacy-bat tại vị trí player, không mất món cũ, không tăng capacity. Cửa nhận state/HP.
- **Backup IndexedDB**: preview menu không ghi save. Continue validate → kiểm tra slot còn đúng bản gốc → backup + ghi v2 trong một transaction → load. Backup đầu ở slot-1.backup-v1, bản v1 khác nhập sau có backup UUID riêng. Schema lạ, ownership/counter/condition/capacity/ID sai giữ slot và báo lỗi; không tự New Game. Autosave validate trước khi ghi. Bỏ logic cắt slot/kẹp số lượng item lúc load.
- **Door foundation**: state closed/open/destroyed và hp; destroyed loại cả body/collider/mesh. doorLeafTransform dùng chung cho render và test. Lưu/load cả state và HP.
- **Nav động**: chỉ cập nhật các ô corridor/open-leaf liên quan, giữ blocker của cửa chồng nhau; revision đổi khi topology đổi, không theo HP. Portal có hai điểm tiếp cận. findDoorRoute ưu tiên tuyến thông, rồi graph portal có chi phí phá cửa; trả cửa đầu tiên thực sự nằm trên tuyến cùng path tới phía tiếp cận.
- **Lỗi AI Phase 1 đã sửa**: không còn đi thẳng tới goal khi A* trả null; dừng chờ và repath sau cửa mở/vỡ. Không sửa thông số balance.
- **Phòng thử dev ?lab=doors**: một phòng, một cửa, một zombie; nút đóng/mở/phá, kiểm tra route dựa trên lastKnownTarget, thêm hai gậy 10/70 và save/load. Slot riêng slot-lab; production không bật lab. Chưa nối route vào FSM approach/bash của map chính (S5).

## 3. Kiểm chứng cuối sprint

- **npm test: 135/135**, 15 file, gồm soak 30 phút, fixture/migration/ownership và Rapier WASM thật.
- **npm run build** thành công, bao gồm tsc -b; **npm run lint** sạch.
- Soak sau sửa AI: **30 phút sống, 11 kill, 60 damageTaken, minHealth 40, endHealth 65, 7/7 tủ, 29 snapshot round-trip, 11 spawn, tối đa 9 zombie**. Dùng 4 water/3 canned_food/1 bandage; còn gậy thật trong túi. Kết quả balance không đổi so với Phase 1.
- Chrome headless 1280×800, profile riêng: v1→v2 + backup; hai condition 10/70 qua IndexedDB; túi đầy có gậy rơi; schema 99 không ghi đè/không tự New Game; transaction conflict giữ slot. Render thật: đóng chặn raycast, mở/vỡ thông, dựng lại chặn; nav đồng nhất. Save/load cửa vỡ và slot-lab không thay đổi slot-1. Không exception trình duyệt.
- Production vite preview port 5199: New Game → túi có gậy 80/80 → lưu/về menu → reload → Continue. Không window.__runtime, ?lab=doors không mở phòng thử. Không exception trình duyệt.
- Fixture v1 xuất từ runtime Phase 1 thật trước khi sửa schema (seed 20260924, đã loot tủ, health 73, clock 30 giây); fixture v2 từ Chrome smoke. Không phải save do người dùng gửi hoặc schema tự đoán.

## 4. File/module liên quan

| File | Trách nhiệm |
|---|---|
| src/game/entities/items.ts, player.ts | Definitions, instance union, equipment/player state |
| src/game/systems/inventory.ts, equipment.ts | IDs/counters, transfer, equip, reconcile ownership |
| src/game/systems/save.ts, saveStorage.ts | Validate/migrate v1→v2, IndexedDB atomic backup |
| src/game/systems/fixtures/ | phase1-v1.json, phase2-s1-v2.json |
| src/game/systems/phase2-save.test.ts | Migration, ownership, cả hai fixture |
| src/game/world/doors.ts | State/HP và shared leaf geometry |
| src/game/world/navigation.ts | Local door cells, revision, portals/route query |
| src/game/world/doorLab.ts, doorLab.test.ts | Dev map, route selection, Rapier, repath/load |
| src/game/core/runtime.ts | Lifecycle/save/drop/equip/door integration |
| src/components/DoorLab.tsx | Dev controls |
| scripts/p2-smoke.mjs | Chrome CDP smoke dev và --production |
| docs/phase2-s1.md | Baseline, quyết định, kiểm chứng và hướng dẫn |

Các file khác cập nhật theo contract: events, worldState, types/save, AI, loot, stores, Inventory UI, DoorView/PlayerView/Scene/App và test cũ. Các system survival/combat/spawn và config gameplay giữ nguyên thông số. Plan S1 được đánh dấu hoàn tất; README thêm trạng thái và điều khiển hiện tại.

## 5. Bước tiếp theo — P2-S2

1. Bỏ cấp gậy trong GameRuntime.newGame, giữ shove và gợi ý khi tay không. **Không bỏ grant riêng của migration v1.**
2. Mở rộng loot container với melee đầu game có bảo đảm; vẫn gieo đúng một lần theo seed. Không reroll container save cũ.
3. Definitions gậy/ống sắt/xà beng/búa và các thông số; đối chiếu baseline GAME_CONFIG.melee đã cân bằng bằng soak, không chép bảng plan một cách máy móc.
4. Damage/wear theo instance, trừ một lần theo attackId kể cả nhiều target; condition 1→0 vẫn damage đầy cho hit đó, hit sau broken 20%. Tool broken không đủ điều kiện craft khi S4 triển khai.
5. Hoàn thiện equip/drop/transfer UI, tooltip damage/condition, cảnh báo vũ khí hỏng. Giữ ownership và snapshot nhất quán; thêm fixture/migration nếu schema đổi.
6. Chạy regression + soak nếu đổi combat, ghi số liệu, cập nhật CURRENT_STATE cuối sprint. Người dùng tự commit/push.

## 6. Giới hạn và việc còn lại

- Chưa deploy thật, đo FPS GPU tích hợp thật hay playtest tay 15–30 phút. Không coi headless là benchmark GPU thật.
- Chưa có wear/broken damage, loot melee mới, model/appearance, timed action/repair, zombie tự phá cửa, barricade hay building. Các phần này thuộc S2–S8.
- Route portal S1 là spike đã kiểm chứng. Khi tích hợp S5 cần cache theo topology revision và chỉ tìm khi đổi mục tiêu, tránh A* giữa mọi cặp portal mỗi frame. Chi phí phá cửa tạm là 12 đơn vị đường đi, chưa theo HP/DPS.
- Save chưa lưu cooldown/AI timer; load có thể ổn định lại trong khoảng 2 giây. Ngoại hình mặc định sẽ thêm cùng schema appearance S3.
- Warning thư viện: THREE.Clock, Rapier init parameters, Vite advancedChunks deprecated. Không đổi dependency trong sprint này.
- Bot soak dùng body giả theo nav; đã thêm Rapier capsule và render/raycast Chrome cho phòng thử, nhưng góc hẹp/chen nhiều zombie vẫn cần playtest tay.
- Audio Safari chưa được kiểm chứng trên thiết bị iOS thật.

## 7. Kiểm tra nhanh và nguyên tắc giữ lại

Chạy npm test, npm run build, npm run lint. Để xem số liệu soak: npx vitest run src/game/core/soak.test.ts --reporter=verbose. Chơi thử bằng npm run dev; mở http://localhost:5173/?lab=doors cho phòng thử.

Browser smoke: xem hướng dẫn profile/cổng trong docs/phase2-s1.md. Script dùng profile Chrome thử và ghi/xóa slot thử, không chạy trên profile chơi thật. Vite phải khởi động mới sau sửa source để tránh script import nhầm module do URL HMR. Ảnh lab: node_modules/.tmp/p2-door-lab.png (không track).

Giữ simulation ngoài React; thứ tự tick hiện có; không import Rapier runtime vào simulation (test được dùng WASM). Giữ layout map neighborhood-50, IDs map và fixture v1. Tăng schema khi đổi cấu trúc save; không im lặng cắt/mất item. Không thay balance khi chưa đo; chạy soak sau sửa combat/AI/spawn/survival. Không thêm asset ngoài khi chưa ghi nguồn/giấy phép. **Không commit/push; chỉ gợi ý message.**

Commit message gợi ý: **feat(phase2): add item instances, save migration and dynamic door prototype**
