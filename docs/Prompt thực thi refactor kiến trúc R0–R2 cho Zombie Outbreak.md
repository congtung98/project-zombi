Tôi muốn bạn thực hiện một đợt refactor có giới hạn cho codebase game Zombie Outbreak theo roadmap R0–R2.

KHÔNG thực hiện full architecture rewrite.

KHÔNG triển khai streaming world, virtualization, worker, floating origin hoặc chunk-based persistence trong đợt này.

Mục tiêu của đợt này là xử lý các bottleneck nền tảng khiến game không thể scale lên map lớn và số lượng zombie cao hơn.

---

# 1. Bối cảnh

Codebase hiện tại đã có một số nền tảng tốt:

- `GameRuntime` tách khỏi React.
- AI không phụ thuộc việc zombie có render hay không.
- Physics đã có abstraction `PhysicsQuery`.
- Building lighting update theo event.
- Player Vision đã có `getNearbyZombies`.
- Save system không lưu derived state như LOS/path/light.

Không rewrite những phần đang hoạt động đúng nếu không cần thiết.

Các bottleneck hiện tại cần xử lý:

1. Zombie movement phụ thuộc Rapier body nằm trong React component.
2. NavGrid là một dense grid phủ toàn map.
3. Zombie separation đang O(N²).
4. AI tất cả zombie chạy 60 Hz.
5. Có nhiều global linear scans.
6. Có `scene.traverse()` trong hot path.
7. Shader indoor giới hạn cứng số room.
8. Static geometry và character mesh tạo quá nhiều draw call.
9. Map chưa có ownership model để sau này gắn chunk.

Đợt này chỉ tập trung vào R0–R2.

---

# 2. Scope bắt buộc

Thực hiện:

```text
R0
Performance baseline + instrumentation

R1
SpatialHash + loại global scans + reuse buffer/material

R2
Tách simulation khỏi Rapier body/view
AI Scheduler
Pathfinding Queue
Simulation update levels cơ bản
```

KHÔNG triển khai:

```text
world streaming
IndexedDB per chunk
full chunk persistence
zombie virtualization
population simulation
Web Worker
floating origin
full hierarchical pathfinding
procedural world
```

Có thể chuẩn bị interface cho các phần trên nếu cần, nhưng không implement.

---

# 3. Nguyên tắc refactor

Phải áp dụng:

```text
Simulation owns state.
Rendering visualizes state.
Physics assists simulation.
React does not own gameplay state.
```

Đặc biệt:

```text
Zombie simulation position
MUST NOT depend on ZombieView or React component lifetime.
```

Zombie phải có thể:

```text
move
think
change state
navigate
```

ngay cả khi không có visual mesh hoặc Rapier body.

---

# 4. R0 – Performance Baseline

Trước khi sửa behavior, tạo baseline.

## 4.1 Performance HUD

Tạo debug performance HUD.

Phải hiển thị ít nhất:

```text
FPS
frame time

simulation ms
AI ms
navigation ms
vision ms

draw calls
triangles nếu có thể

active zombies

AI updates/frame

path requests/frame
path queue size

LOS raycasts/frame

scene object count nếu có thể
```

Không cần đẹp.

Ưu tiên debug usefulness.

---

# 5. Stress Mode

Thêm khả năng chạy stress scenario.

Ví dụ:

```text
?stress=4
```

có thể duplicate map hiện tại theo grid:

```text
4 x 4
```

để tạo synthetic larger map.

Mục tiêu:

```text
48+ building
150+ zombie
```

hoặc mức tương đương phù hợp architecture hiện tại.

Stress mode:

```text
development/debug only
```

Không ảnh hưởng normal game.

---

# 6. Baseline report

Trước refactor R1:

đo ít nhất:

```text
normal map

stress map

standing still

moving through map

many zombies nearby
```

Ghi:

```text
FPS
frame time
draw calls
AI cost
vision cost
navigation cost
raycasts
```

Sau mỗi phase phải so sánh lại.

---

# 7. R1 – SpatialHash

Tạo một spatial query system dùng chung.

Ví dụ:

```js
SpatialHash
```

API tối thiểu:

```js
insert(entity)
remove(entity)
update(entity)

queryRadius(position, radius)

queryAABB(bounds)
```

Không bắt buộc ECS.

Không over-engineer.

---

# 8. Spatial categories

SpatialHash hoặc spatial registry phải hỗ trợ ít nhất:

```text
zombies
vision occluders
interactables
buildings
combat targets
```

Có thể:

```text
separate hashes
```

hoặc:

```text
one spatial index with category masks
```

Chọn thiết kế đơn giản nhất phù hợp code hiện tại.

---

# 9. Zombie Separation

Hiện tại separation đang O(N²).

Thay:

```text
for every zombie
    compare every zombie
```

bằng:

```text
SpatialHash.queryRadius()
```

Chỉ xét neighbor gần.

Ví dụ:

```js
const neighbors = spatialHash.queryRadius(
  zombie.position,
  separationRadius
);
```

Target complexity:

```text
O(N * local_neighbors)
```

không phải:

```text
O(N²)
```

---

# 10. Player Vision

PlayerVisionSystem phải dùng spatial query.

Flow:

```text
query nearby zombies
↓
distance
↓
FOV
↓
LOS
```

Không global zombie scan.

Giữ behavior hiện tại.

Vision refactor không được làm thay đổi gameplay.

---

# 11. Vision Occluders

Hiện tại mỗi LOS ray không được duyệt toàn bộ occluder trên map.

Tạo spatial query cho:

```text
walls
doors
large blockers
buildings
```

Query occluder theo:

```text
ray AABB
hoặc
nearby cells
```

rồi mới raycast tập candidate.

Nếu architecture cho phép dễ dàng, có thể chuẩn bị cho BVH sau này.

KHÔNG bắt buộc đưa BVH vào đợt này.

---

# 12. Interaction System

Interaction không được scan toàn bộ interactable.

Thay bằng:

```js
queryRadius(player.position, interactionRadius)
```

Sau đó:

```text
distance / priority / facing
```

---

# 13. Melee Target Search

Combat target selection cũng phải query nearby.

Không:

```text
all zombies
```

Mà:

```text
nearby zombies in attack radius
```

---

# 14. Building Query

Nếu đang có:

```text
allBuildings.find(...)
```

trong hot path:

chuyển sang spatial query hoặc precomputed room/building ownership.

Không optimize các query chỉ chạy khi load/start nếu không cần.

Chỉ tập trung hot path.

---

# 15. Scene Traversal

Audit:

```text
IndoorLighting.tsx
OcclusionFader.tsx
```

và mọi:

```js
scene.traverse(...)
```

trong:

```text
useFrame
timer thường xuyên
```

Loại bỏ traversal runtime.

---

# 16. Material Registration

Thay vì traverse scene để tìm material:

khi object được tạo hoặc load:

```text
registerMaterial()
```

hoặc:

```text
registerRenderable()
```

với system liên quan.

Ví dụ:

```text
IndoorLightingRegistry
OcclusionRegistry
```

Khi destroy:

```text
unregister
```

Không scan toàn scene.

---

# 17. Shared Materials

Audit static world object.

Nếu nhiều wall/object tạo material giống nhau:

reuse material.

Không tạo:

```js
new MeshStandardMaterial()
```

cho từng wall.

Giữ visual output tương đương.

---

# 18. NavGrid buffer reuse

Hiện tại pathfinding allocation lớn.

Trong R1:

KHÔNG cần rewrite full navigation architecture.

Nhưng:

```text
reuse working arrays
reuse visited buffers
reuse cost buffers
```

nếu current A\* allocate lại buffer trên mỗi request.

Mục tiêu:

```text
reduce GC
reduce allocation spikes
```

---

# 19. NavGrid limitation

Không cố biến dense NavGrid hiện tại thành system hỗ trợ 1 km² trong R1.

Chỉ:

```text
reduce allocation
reduce unnecessary rebuild
```

và chuẩn bị interface để sau này chia navigation theo chunk.

---

# 20. R1 Acceptance Criteria

R1 không được thay đổi gameplay behavior.

Các existing tests phải pass.

Soak result phải tương đương baseline.

Đặc biệt:

```text
zombie movement
combat
vision
interaction
lighting
```

không đổi behavior.

Performance stress scenario phải cải thiện hoặc ít nhất không regression đáng kể.

---

# 21. R2 – Tách Zombie Simulation khỏi Rapier/View

Đây là phần quan trọng nhất.

Hiện tại zombie position không được lấy từ Rapier body như source of truth.

Phải chuyển sang:

```text
Zombie simulation owns logical transform.
```

Ví dụ:

```js
zombie.position
zombie.rotation
zombie.velocity
```

là authoritative state.

---

# 22. Rapier role mới

Rapier không được sở hữu zombie state.

Rapier chỉ là:

```text
collision representation
physics query helper
active-area physics
```

Flow:

```text
Simulation
     ↓
logical position
     ↓
Rapier body sync
     ↓
Visual sync
```

KHÔNG:

```text
Rapier body
     ↓
game state
```

---

# 23. ZombieView

`ZombieView` chỉ chịu trách nhiệm:

```text
mesh
animation
visual transform
optional active physics body
```

Không sở hữu:

```text
AI state
logical position
navigation state
health
target
```

Nếu component unmount:

```text
simulation continues
```

---

# 24. Active Physics

Trong đợt này tạo abstraction để chỉ zombie ACTIVE cần Rapier body.

Ví dụ:

```text
ACTIVE
→ Rapier body

NEAR
→ no Rapier body

DORMANT
→ no Rapier body
```

Chưa cần implement full world/chunk activation.

Có thể dựa trên distance tới player trước.

---

# 25. Simulation Levels

Tạo enum:

```js
ACTIVE
NEAR
DORMANT
```

UNLOADED chưa cần.

Ví dụ config ban đầu:

```js
ACTIVE_DISTANCE = 25
NEAR_DISTANCE = 60
```

Không hardcode ở nhiều file.

---

# 26. ACTIVE zombie

ACTIVE chạy:

```text
full movement
collision
AI
combat
pathfinding
Rapier body
animation
```

---

# 27. NEAR zombie

NEAR:

```text
no Rapier body
lower AI rate
simplified movement
no expensive perception unless required
```

Vẫn giữ position.

---

# 28. DORMANT zombie

DORMANT:

```text
very low update rate
no physics
no visual if outside render range
no expensive pathfinding
```

Không cần virtualization trong đợt này.

Zombie vẫn là entity runtime.

---

# 29. AI Scheduler

Hiện tại mọi zombie chạy AI 60 Hz.

Tạo:

```js
AIScheduler
```

hoặc integrate vào SimulationScheduler.

Không mỗi zombie tự quản timer.

---

# 30. AI tick rates

Config ví dụ:

```js
ACTIVE_AI_HZ = 15;
NEAR_AI_HZ = 4;
DORMANT_AI_HZ = 0.5;
```

Không cần đúng các số trên.

Phải benchmark và chọn reasonable defaults.

---

# 31. Gameplay-critical logic

Không giảm tần suất những logic cần realtime.

Ví dụ:

```text
combat collision
damage
player attack
immediate danger
```

có thể vẫn chạy simulation tick phù hợp.

AI decision-making có thể thấp hơn render FPS.

---

# 32. Pathfinding Queue

Tạo:

```js
PathfindingQueue
```

Zombie không gọi A\* trực tiếp tùy ý.

Thay:

```text
AI
↓
path request
↓
PathfindingQueue
↓
budgeted processing
```

---

# 33. Pathfinding budget

Support một trong hai:

```js
MAX_PATHS_PER_FRAME
```

hoặc:

```js
MAX_PATHFINDING_MS
```

Ưu tiên time budget nếu implementation không quá phức tạp.

Nếu khó, bắt đầu request-count budget.

---

# 34. Path request deduplication

Nếu zombie đã có pending request:

không enqueue duplicate mỗi AI tick.

Ví dụ:

```js
if (zombie.pathRequestPending) return;
```

---

# 35. Path invalidation

Path chỉ request lại khi:

```text
target moved enough
path invalid
door/navigation changed
stuck
path finished
```

Không request lại mỗi frame.

---

# 36. Determinism and tests

R2 sẽ thay simulation timing.

Vì vậy expected soak result có thể thay đổi.

Không cố ép test cũ nếu test đang phụ thuộc 60 Hz AI behavior.

Thay vào đó:

```text
document changed behavior
create new deterministic baseline
```

Nhưng core invariants phải giữ:

```text
zombies chase
zombies attack
zombies wander
zombies navigate
combat works
```

---

# 37. Physics Query abstraction

Giữ `PhysicsQuery`.

Không làm AI import Rapier trực tiếp.

Simulation chỉ gọi abstraction như:

```js
isBlocked()
sweep()
raycast()
```

Điều này quan trọng để NEAR/DORMANT không phụ thuộc physics world.

---

# 38. Static collider handling

Trong R2 chưa implement chunk collider streaming.

Nhưng refactor code để collider registration không bị hardwired vào global React scene.

Tạo interface kiểu:

```js
registerStaticCollider()
unregisterStaticCollider()
```

để R3 sau này có thể load/unload collider theo chunk.

---

# 39. Không implement R3 đầy đủ

Trong đợt này chỉ chuẩn bị interface nếu cần.

Không:

```text
full chunk streaming
chunk persistence
portal graph
hierarchical nav
```

trừ khi thật sự bắt buộc để R2 hoạt động.

---

# 40. Render Draw Call Audit

R0 phải ghi nhận draw calls.

R1/R2 không cần solve toàn bộ draw-call problem.

Nhưng hãy audit và report:

```text
walls
characters
furniture
props
```

và xác định candidate cho:

```text
instancing
geometry merge
shared material
```

Không redesign visual system trong đợt này.

---

# 41. Indoor Shader Room Limit

Shader giới hạn 16 room:

không cần full redesign nếu map hiện tại chưa vượt.

Nhưng:

```text
document limitation
remove magic number from scattered code
put limit in config
```

Nếu sửa dễ thì chuyển sang active-room subset.

Không để phần này kéo scope quá lớn.

---

# 42. Map Pipeline

Không tạo procedural map trong đợt này.

Nhưng cần tạo một technical note:

```text
Current map format limitations
```

và đề xuất một trong:

```text
prefab-based
JSON/data-driven
procedural seed
```

Không implement trừ stress-map duplication.

---

# 43. Code ownership target

Sau R2:

```text
GameRuntime
→ simulation coordinator

Entity/Zombie state
→ simulation-owned

SpatialHash
→ nearby query

AIScheduler
→ decision update budget

PathfindingQueue
→ navigation budget

PhysicsQuery
→ collision query abstraction

ZombieView
→ rendering only
```

---

# 44. Required Metrics Before / After

Report table:

```text
Metric
Before
After R1
After R2
```

Bao gồm:

```text
FPS
avg frame time
worst frame time nếu có

simulation ms
AI ms
navigation ms
vision ms

draw calls

LOS raycasts/frame

separation neighbor checks/frame

AI updates/frame

path requests/frame

active Rapier zombie bodies

GC/allocation observations
```

---

# 45. Regression Checklist

Sau mỗi R:

Test:

```text
new game
load save

zombie wander
zombie chase
zombie attack

melee combat

player vision
LOS

indoor lighting

doors
windows

inventory
loot

save/load

day/night
```

---

# 46. No Big-Bang Rewrite

Không được xóa hệ thống cũ rồi viết lại tất cả cùng lúc.

Refactor incremental:

```text
introduce new abstraction
↓
route old system through abstraction
↓
verify
↓
remove obsolete implementation
```

---

# 47. Git / Change Management

Nếu môi trường cho phép:

chia thay đổi thành logical commits hoặc logical change groups:

```text
R0 instrumentation

R1 spatial index

R1 query migration

R1 material/traverse cleanup

R2 zombie transform ownership

R2 AI scheduler

R2 pathfinding queue

R2 tests/baseline
```

Không mix tất cả trong một khối khó review.

---

# 48. Stop Conditions

Nếu phát hiện một thay đổi yêu cầu:

```text
full chunk streaming
full map rewrite
save schema rewrite lớn
full ECS migration
```

thì STOP phần đó.

Không tự mở rộng scope.

Ghi nó vào:

```text
Deferred Work
```

---

# 49. Deferred Work

Sau R2, report những việc còn lại:

```text
R3 Chunk ownership

NavGrid per chunk

portal graph

static geometry batching

instancing

streaming

per-chunk IndexedDB

zombie virtualization

population simulation

worker

floating origin
```

---

# 50. Definition of Done – R0

R0 done khi:

- có performance HUD
- có stress mode
- có baseline numbers
- không thay gameplay

---

# 51. Definition of Done – R1

R1 done khi:

- zombie separation không còn O(N²)
- vision candidate query không global
- interaction query không global
- combat target query không global
- occluder query không scan toàn map
- scene.traverse hot path được loại bỏ
- repeated materials được share nơi phù hợp
- A\* hot buffers được reuse nếu khả thi
- tests vẫn tương đương behavior cũ

---

# 52. Definition of Done – R2

R2 done khi:

- zombie logical transform không phụ thuộc Rapier body
- ZombieView có thể unmount mà zombie simulation vẫn hoạt động
- chỉ ACTIVE zombie cần physics body
- AI không chạy 60 Hz cho mọi zombie
- có AIScheduler
- có ACTIVE / NEAR / DORMANT update rate
- có PathfindingQueue
- duplicate path requests bị hạn chế
- physics access vẫn qua abstraction
- soak tests có baseline mới
- không regression gameplay-critical systems

---

# 53. Final Report

Sau khi hoàn tất, trả về report theo format:

```text
Executive Summary

R0 Baseline

R1 Changes

R2 Changes

Architecture Before

Architecture After

Files Changed

Performance Before/After

Behavior Changes

Tests Run

Regression Results

Known Limitations

Deferred Work

Recommendation for R3
```

---

# 54. Final Rule

Ưu tiên:

```text
FIX SCALE BOTTLENECKS FIRST.
DO NOT BUILD LARGE-WORLD FEATURES YET.
```

Mục tiêu của đợt này không phải biến game thành Project Zomboid ngay.

Mục tiêu là tạo nền tảng để khi map và zombie count tăng lên, codebase không phải rewrite lại từ đầu.
