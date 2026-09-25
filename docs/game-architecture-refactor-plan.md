# Architecture Refactor Plan for Large-Scale Zombie Survival Game

## 1. Mục tiêu của đợt tái cấu trúc

Project hiện tại đang phát triển theo hướng game zombie survival bằng React + Three.js, với mục tiêu dài hạn là có thể mở rộng world lên quy mô rất lớn tương tự Project Zomboid mà không làm hiệu năng giảm tuyến tính theo kích thước map.

Mục tiêu của refactor này là thay đổi kiến trúc từ:

```text
Map nhỏ
+
mọi entity đều active
+
logic chạy trực tiếp trong component
```

sang:

```text
Large streamed world
+
chunk-based simulation
+
spatial queries
+
multi-level simulation
+
rendering độc lập với simulation
```

Nguyên tắc cốt lõi:

```text
MAP CÓ THỂ RẤT LỚN
NHƯNG RUNTIME ACTIVE AREA PHẢI NHỎ VÀ ỔN ĐỊNH.
```

Khi map tăng 10× hoặc 100×, các chỉ số sau không được tăng tương ứng:

```text
draw calls
active zombie AI
pathfinding requests/frame
vision checks/frame
lighting calculations/frame
memory active scene
```

---

# 2. Target Architecture

```text
                         WORLD DATABASE
                              │
                           IndexedDB
                              │
                         WorldStorage
                              │
                        ChunkManager
                              │
       ┌──────────────────────┼──────────────────────┐
       │                      │                      │
 ACTIVE CHUNKS           NEAR CHUNKS           DORMANT WORLD
       │                      │                      │
 Full Simulation       Reduced Simulation      Abstract Simulation
       │                      │                      │
       └───────────────┬──────┴───────────────┬──────┘
                       │                      │
                  EntityWorld            Region/Population
                       │
        ┌──────────────┼──────────────────────┐
        │              │                      │
   SpatialGrid      AI Systems          Building Systems
        │              │                      │
 Vision/Combat      Zombie AI          Room/Lighting
 Sound/Collision    Migration          Doors/Windows
 Loot Query         Navigation         Containers
        │              │                      │
        └──────────────┴──────────────┬───────┘
                                      │
                               Simulation State
                                      │
                                      ▼
                                Render Adapter
                                      │
                         ┌────────────┴─────────────┐
                         │                          │
                    Three.js                  React UI
                         │                          │
                 Instancing / LOD             Inventory
                 Culling / Shaders            HUD
                 Animation LOD                Menus
                                              Settings
```

---

# 3. Nguyên tắc thiết kế bắt buộc

## 3.1 Simulation không phụ thuộc React

Không dùng React state cho logic update tần suất cao.

Không nên:

```js
setZombiePosition(...)
setVelocity(...)
setVisionResult(...)
```

mỗi frame.

React chỉ nên quản lý:

```text
HUD
Inventory
Menus
Settings
Character creation
Slow-changing UI state
```

Simulation nên dùng:

```text
mutable runtime state
entity store
refs
custom game state
ECS nếu cần sau này
```

## 3.2 Rendering không quyết định simulation

Một zombie không render vẫn có thể:

```text
wander
migrate
exist in save
participate in abstract population simulation
```

Không được viết:

```js
if (!mesh.visible) {
  stopAI();
}
```

Rendering chỉ là visualization của simulation state.

## 3.3 World scale không được quyết định runtime cost

Map lớn hơn chỉ nên làm tăng:

```text
disk data
save data
chunk count
world metadata
```

Không nên làm tăng tương ứng:

```text
per-frame logic
active entities
draw calls
LOS checks
pathfinding calculations
```

---

# 4. Refactor Priority Overview

```text
Phase 0  Architecture Audit
Phase 1  Simulation / Rendering Separation
Phase 2  Chunk System
Phase 3  Spatial Grid
Phase 4  Entity Activation Levels
Phase 5  Zombie Virtualization
Phase 6  Rendering Optimization
Phase 7  Pathfinding Architecture
Phase 8  World Streaming + IndexedDB
Phase 9  Lighting / Vision Integration
Phase 10 Workers + Performance Scaling
Phase 11 Large-world Coordinate Strategy
Phase 12 Profiling + Regression Budget
```

---

# 5. Phase 0 – Architecture Audit

Trước khi refactor, xác định:

```text
Player component
Zombie component
Zombie AI
Zombie manager
World/map component
Building system
Door/window system
Loot system
Inventory
Combat
Day/Night
PlayerVisionSystem
BuildingLightingSystem
Save/Load
IndexedDB schema
Game loop
Three.js scene structure
React state usage
```

Lập danh sách:

```text
logic nào chạy mỗi frame
logic nào nằm trong React component
logic nào loop toàn bộ zombie
logic nào loop toàn bộ world object
logic nào tạo object mới liên tục
```

Kết quả cần có:

```text
Current Architecture Map
Hot Loop List
Global Scan List
State Ownership List
Refactor Risk List
```

---

# 6. Phase 1 – Tách Simulation khỏi Rendering

Zombie/player/world entity phải tồn tại dưới dạng simulation data độc lập với Three.js mesh.

Ví dụ:

```js
const zombie = {
  id: 1,
  position: { x: 20, y: 0, z: 15 },
  velocity: { x: 0, z: 0 },
  health: 100,
  state: "WANDER",
  targetId: null,
  chunkId: "10_8",
  isVisibleToPlayer: false,
  simulationLevel: "ACTIVE"
};
```

Renderer chỉ đọc:

```text
position
rotation
animationState
visibility
lighting
```

Không để `Zombie.jsx` chứa cả AI, pathfinding, combat, hearing, FOV, render và animation.

Target:

```text
ZombieSimulation
ZombieAISystem
ZombieNavigationSystem
ZombiePerceptionSystem
ZombieRenderer
```

### Definition of Done

- Zombie tồn tại khi không có mesh.
- Mesh destroy/recreate không làm mất AI state.
- Simulation test được mà không cần WebGL.
- React không update zombie position bằng setState mỗi frame.

---

# 7. Phase 2 – Chunk System

Đây là phần quan trọng nhất của large-world architecture.

Ví dụ:

```js
const CHUNK_SIZE = 32;
```

hoặc 64 world units tùy density.

Chunk coordinate:

```js
chunkX = Math.floor(worldX / CHUNK_SIZE);
chunkZ = Math.floor(worldZ / CHUNK_SIZE);
```

Chunk data:

```js
{
  id: "12_8",
  x: 12,
  z: 8,
  state: "ACTIVE",
  entities: [],
  buildings: [],
  lootContainers: [],
  staticObjects: [],
  dirty: false,
  lastActiveTime: 0
}
```

---

# 8. Chunk Lifecycle

```text
UNLOADED
    ↓
LOADING
    ↓
LOADED
    ↓
ACTIVE
    ↓
NEAR
    ↓
DORMANT
    ↓
UNLOADING
    ↓
UNLOADED
```

Tạo `ChunkManager` làm source of truth.

API đề xuất:

```js
loadChunk(x, z)
unloadChunk(x, z)
activateChunk(id)
deactivateChunk(id)
updatePlayerChunk(position)
getLoadedChunks()
getActiveChunks()
```

Config ví dụ:

```js
export const WORLD_STREAMING_CONFIG = {
  chunkSize: 32,
  activeRadius: 2,
  nearRadius: 5,
  unloadRadius: 7
};
```

Predictive loading phải dựa trên player velocity/facing/vehicle speed để preload chunk phía trước.

---

# 9. Phase 3 – Spatial Grid

Chunk không thay thế spatial query chi tiết.

Tạo `SpatialGrid` / `SpatialHash` cho:

```text
Player Vision
Zombie Vision
Zombie Hearing
Combat
Collision
Loot lookup
Sound propagation
Nearby interaction
Vehicle detection
Area effects
```

Không làm:

```js
allZombies.filter(...)
```

trong hot loop.

Dùng:

```js
spatialGrid.queryRadius(player.position, radius);
```

API đề xuất:

```js
insert(entity)
remove(entity)
update(entity)
queryRadius(position, radius)
queryAABB(bounds)
queryCell(x, z)
```

---

# 10. Player Vision Integration

Pipeline:

```text
SpatialGrid.queryRadius()
        ↓
Distance Check
        ↓
Near Detection
        ↓
FOV
        ↓
LOS
        ↓
Visibility Result
```

Tuyệt đối không loop toàn bộ zombie của world.

---

# 11. Phase 4 – Multi-Level Simulation

Định nghĩa bốn mức:

```text
ACTIVE
NEAR
DORMANT
UNLOADED
```

### ACTIVE

```text
AI
animation
combat
pathfinding
vision
hearing
collision
loot interaction
lighting
```

### NEAR

```text
AI update thấp hơn
animation thấp hơn
pathfinding ít thường xuyên
perception giảm tần suất
```

Ví dụ 5–10 ticks/s.

### DORMANT

Không render, không full AI. Chỉ giữ:

```text
position/chunk
state summary
population intent
migration target
health nếu cần
```

Update 0.2–1 Hz.

### UNLOADED

Chỉ tồn tại trong IndexedDB hoặc population data.

---

# 12. Phase 5 – Zombie Virtualization

Đây là chìa khóa để world có hàng chục nghìn zombie.

### Physical Zombie

```js
{
  id,
  position,
  health,
  state,
  navigation,
  animation
}
```

### Virtual Zombie

```js
{
  id,
  chunkId,
  localX,
  localZ,
  health,
  coarseState,
  migrationTarget
}
```

### Population Group

```js
{
  chunkId: "20_14",
  population: 73,
  density: 0.65,
  migrationDirection: "EAST"
}
```

Khi player tới gần:

```text
Virtual Population
       ↓
Materialization
       ↓
Physical Zombies
```

Khi player rời xa:

```text
Physical Zombies
       ↓
Dematerialization
       ↓
Virtual data
```

Giữ health, position, special state và các dữ liệu persistent cần thiết.

---

# 13. Zombie Update Budget

```text
60 FPS rendering
≠
60 Hz AI
```

Ví dụ:

```text
ACTIVE AI: 10–20 Hz
NEAR AI: 2–5 Hz
DORMANT: 0.2–1 Hz
```

Tạo `SimulationScheduler` hoặc `AIScheduler`.

Ví dụ:

```js
MAX_AI_UPDATES_PER_FRAME = 20;
```

Không để mỗi zombie tự chạy timer riêng.

---

# 14. Phase 6 – Rendering Optimization

## Draw calls

Ưu tiên:

```text
InstancedMesh
merged geometry
shared material
texture atlas
```

Dùng instancing cho:

```text
trees
grass
fences
chairs
street props
lamps
similar furniture
repeated world props
```

Static tile/chunk geometry nên batch/merge.

Target tham khảo:

```text
1–10 draw calls per terrain layer/chunk
```

---

# 15. Shared Geometry and Materials

Reuse geometry/material/texture/shader.

Không tạo `new MeshStandardMaterial()` cho từng entity tương tự.

---

# 16. LOD

Dùng LOD cho zombie, vehicles, trees, large buildings và props phức tạp.

Ví dụ:

```text
0–15m   high detail
15–35m  medium
35–60m  low
>60m    hidden / culled
```

### Animation LOD

```text
near      60 FPS visual update
medium    30 FPS
far       10–15 FPS
very far  static / not rendered
```

Simulation state vẫn chính xác.

---

# 17. Frustum and Chunk Culling

Dùng cả:

```text
chunk-level culling
+
Three.js object-level frustum culling
```

Nếu cả chunk ngoài camera thì skip render cả chunk trước khi xét object bên trong.

---

# 18. Shadow Budget

Không cho mọi light cast shadow.

Ví dụ:

```text
Sun: shadow
Player flashlight: optional
Nearest room lights: limited
Far lights: no shadow
```

Đặt budget rõ ràng, ví dụ:

```js
MAX_SHADOW_CASTING_LIGHTS = 2;
```

---

# 19. Phase 7 – Pathfinding Architecture

Không dùng tile A* toàn map.

Tạo navigation nhiều tầng:

```text
World Region Graph
        ↓
Chunk Connectivity Graph
        ↓
Local Navigation Grid
```

Zombie xa dùng coarse route.
Zombie gần dùng local path.

---

# 20. Pathfinding Queue

Tạo `PathfindingQueue`.

Không để 100 zombie request path cùng frame.

Ví dụ:

```js
MAX_PATHS_PER_FRAME = 3;
```

hoặc time budget:

```js
MAX_PATHFINDING_MS = 2;
```

Cache các dữ liệu ít đổi như:

```text
door connectivity
building entrances
road graph
chunk exits
```

Dynamic obstacle chỉ invalidate local nav/chunk, không rebuild toàn map.

---

# 21. Phase 8 – World Streaming + IndexedDB

Không save một JSON khổng lồ.

Tổ chức key theo chunk:

```text
world/chunks/12_8
world/chunks/12_9
world/chunks/13_8
```

Chunk save schema ví dụ:

```js
{
  chunkId: "12_8",
  modifiedTiles: [],
  buildings: [],
  doors: {},
  windows: {},
  lootContainers: {},
  zombies: [],
  corpses: [],
  vehicles: [],
  constructions: []
}
```

---

# 22. Dirty Chunk Saving

Set `dirty = true` khi:

```text
door changed
loot changed
zombie died
construction placed
building state changed
vehicle changed
fire/environment changed
```

Chỉ save dirty chunk.

Không save derived state như:

```text
finalRoomLight
currentLOS
cachedPath
renderLOD
```

Save source state, sau load thì recalculate derived systems.

---

# 23. Chunk Unload Pipeline

```text
stop full simulation
        ↓
serialize persistent changes
        ↓
return render objects to pools
        ↓
remove from spatial grid
        ↓
remove from active entity world
        ↓
retain virtual population if needed
```

---

# 24. Phase 9 – Lighting / Vision Integration

Building lighting phải event-driven.

Events:

```text
DOOR_STATE_CHANGED
CURTAIN_CHANGED
LIGHT_TOGGLED
DAYLIGHT_CHANGED
ELECTRICITY_CHANGED
```

Chỉ active building cần realtime update.

Giữ nguyên nguyên tắc:

```text
LIGHTING = world sáng/tối thế nào
VISION = player nhìn thấy entity nào
```

Ví dụ:

```text
bright room + zombie ngoài FOV
→ room vẫn sáng
→ zombie hidden
```

---

# 25. LOS Optimization

Pipeline:

```text
Spatial query
→ distance
→ FOV
→ LOS
```

Khi static geometry lớn, cân nhắc BVH cho walls/floors/static props.

Không rebuild BVH mỗi frame.
Dynamic door xử lý riêng nếu cần.

---

# 26. Phase 10 – Web Workers

Main thread ưu tiên:

```text
rendering
input
near-player gameplay
```

Task có thể chuyển sang Worker sau profiling:

```text
pathfinding
chunk generation
procedural generation
population simulation
save serialization
large data transforms
BVH generation
```

Không cần nhiều worker ngay từ đầu. Bắt đầu với bottleneck lớn nhất.

Không gửi full world state qua postMessage mỗi frame.

---

# 27. Object Pooling

Pool các object thường spawn/despawn:

```text
zombie renderer
blood effects
particles
bullets
temporary markers
loot visuals
```

Reuse temporary Three.js math objects trong hot loop.

Không tạo `new Vector3()` hàng nghìn lần mỗi giây nếu có thể reuse.

Mục tiêu là giảm GC spike và giữ frame-time ổn định.

---

# 28. Adaptive Graphics

Cần quality profiles:

```text
Low
Medium
High
Ultra
```

Điều chỉnh:

```text
DPR
shadow quality
render distance
active chunk radius
grass density
zombie visual distance
animation LOD
post-processing
dynamic light count
```

Có thể hạ tự động khi FPS thấp.

---

# 29. Performance Budget

Target tham khảo:

```text
60 FPS desktop mid-range
Frame budget: 16.67ms
```

Ví dụ budget ban đầu:

```text
render       8ms
simulation   3ms
AI           2ms
pathfinding  1ms
misc         2ms
```

Phải đo bằng profiler; không xem đây là số cố định.

---

# 30. Phase 11 – Floating Origin

Nếu world cực lớn, tách:

```text
logical world coordinate
render coordinate
```

Ví dụ:

```text
Logical:
player chunk = 25000,19000

Render:
player ≈ 0,0
```

Khi vượt threshold thì shift scene origin.

Save vẫn dùng logical coordinate.

---

# 31. Phase 12 – Asset Strategy

Model dùng glTF và asset cache.

Cân nhắc compression:

```text
KTX2 / Basis
Meshopt
Draco
```

Không preload toàn bộ asset game.

Stream theo:

```text
region
biome
building type
chunk type
```

---

# 32. React Usage Rules

React phù hợp cho:

```text
inventory
crafting UI
character screen
HUD
menus
settings
dialogs
```

Không dùng React cho:

```text
per-frame transforms
AI tick
collision
pathfinding
vision checks
animation tick
```

Per-frame nên mutate runtime objects/refs hoặc đọc từ simulation state.

---

# 33. Suggested Core Systems

```text
src/
├── game/
│   ├── core/
│   │   ├── GameLoop
│   │   ├── SimulationScheduler
│   │   └── GameClock
│   ├── world/
│   │   ├── ChunkManager
│   │   ├── WorldStorage
│   │   ├── SpatialGrid
│   │   ├── RegionSystem
│   │   └── FloatingOrigin
│   ├── entities/
│   │   ├── EntityWorld
│   │   ├── EntityFactory
│   │   └── EntityPools
│   ├── zombies/
│   │   ├── ZombieSystem
│   │   ├── ZombieAI
│   │   ├── ZombieVirtualization
│   │   ├── ZombiePopulation
│   │   └── ZombieNavigation
│   ├── navigation/
│   │   ├── NavigationGrid
│   │   ├── RegionGraph
│   │   ├── PathfindingQueue
│   │   └── PathWorker
│   ├── perception/
│   │   ├── PlayerVisionSystem
│   │   ├── ZombiePerceptionSystem
│   │   └── SoundSystem
│   ├── buildings/
│   │   ├── BuildingSystem
│   │   ├── RoomSystem
│   │   ├── DoorSystem
│   │   └── BuildingLightingSystem
│   ├── rendering/
│   │   ├── WorldRenderer
│   │   ├── ZombieRenderer
│   │   ├── ChunkRenderer
│   │   ├── Instancing
│   │   ├── LOD
│   │   └── RenderPools
│   ├── persistence/
│   │   ├── SaveSystem
│   │   ├── IndexedDBAdapter
│   │   └── ChunkSerializer
│   └── workers/
│       ├── pathfinding.worker
│       ├── chunk.worker
│       └── save.worker
└── ui/
    ├── Inventory
    ├── HUD
    ├── Settings
    └── Menus
```

Đây là target architecture, không phải yêu cầu tạo toàn bộ thư mục ngay lập tức.

---

# 34. Recommended Migration Order

Không big-bang rewrite.

Thứ tự an toàn:

```text
1. Tách zombie simulation khỏi Zombie component
2. Tạo EntityWorld
3. Tạo SpatialGrid
4. Chuyển PlayerVisionSystem sang SpatialGrid
5. Tạo ChunkManager
6. Chuyển world object sang chunk ownership
7. Chuyển zombies sang chunk ownership
8. Thêm ACTIVE / NEAR / DORMANT
9. Virtualize zombie xa
10. Refactor renderer sang instancing/LOD
11. Refactor pathfinding thành queue
12. Chuyển save sang chunk persistence
13. Add worker khi profiler cho thấy cần
14. Add floating origin khi world đủ lớn
```

---

# 35. Milestones

## Milestone A – Stable Local Architecture

Must have:

```text
Simulation separated
SpatialGrid
Chunk ownership
No global zombie scans
```

## Milestone B – Streamed World

Must have:

```text
Chunk loading
Chunk unloading
IndexedDB per chunk
Predictive loading
Dirty saving
```

## Milestone C – Large Zombie Population

Must have:

```text
Physical zombies near player
Virtual zombies far away
Population groups
Simulation scheduler
```

## Milestone D – Render Scale

Must have:

```text
Instancing
LOD
Chunk culling
Shared materials
Texture strategy
```

## Milestone E – CPU Scale

Must have:

```text
Path queue
AI scheduler
Worker offloading
BVH
Zero global scans
```

---

# 36. Anti-Patterns cần tránh

Không:

```text
allZombies.map(...) every frame
allWorldObjects.filter(...) every interaction
one React component = one world tile
one mesh = one grass blade
one dynamic PointLight = one lamp toàn map
one full A* path = one zombie every frame
one giant IndexedDB save JSON
React state updates at 60 FPS
raycast every zombie
all buildings recalculate lighting each frame
```

---

# 37. Profiling Requirements

Theo dõi tối thiểu:

```text
FPS
frame time
draw calls
triangles
active meshes
active lights
AI updates/sec
path requests/sec
raycasts/sec
loaded chunks
active zombies
virtual zombies
IndexedDB write time
GC spikes
```

---

# 38. Debug Performance HUD

Nên có panel kiểu:

```text
FPS: 60
Frame: 14.8ms

Chunks:
Active: 25
Near: 56
Loaded: 81

Zombies:
Physical: 73
Near: 210
Virtual: 6340

Draw Calls: 182
AI updates/frame: 16
Paths queued: 4
Raycasts/frame: 28
```

---

# 39. Stress Tests

Tạo scenario riêng:

```text
100 zombies
500 zombies logically nearby
10,000 virtual zombies world-wide
dense town
fast vehicle crossing chunks
many open/closed doors
night + lighting + zombies
```

---

# 40. Performance Regression Rule

Mỗi major feature phải đo:

```text
before
after
```

Nếu frame time tăng đáng kể, phải biết nguyên nhân trước khi tiếp tục scale feature.

---

# 41. Scaling Rule

Một hệ thống scale tốt nếu:

```text
world size ↑
```

nhưng:

```text
cost/frame ≈ stable
```

Ví dụ map 1 km², 10 km² hay 100 km² vẫn có runtime gần tương đương nếu active radius không đổi.

---

# 42. Immediate Priority for Current Project

Thứ tự thực tế đề xuất:

```text
1. Entity/Simulation separation
2. SpatialGrid
3. ChunkManager
4. Chunk-based IndexedDB
5. Zombie simulation levels
6. Zombie virtualization
7. Instancing
8. Pathfinding queue
9. BVH LOS optimization
10. Workers
```

---

# 43. What Not To Do Yet

Chưa cần:

```text
full ECS rewrite
complex server architecture
ray tracing
global illumination
GPU compute simulation
huge worker farm
procedural infinite world
```

Chỉ thêm khi profiling hoặc feature roadmap thực sự yêu cầu.

---

# 44. Refactor Strategy

Không rewrite toàn bộ project cùng lúc.

Dùng chiến lược thay dần:

```text
old system
   ↓
replace từng phần
   ↓
new architecture
```

Ví dụ:

```text
Old ZombieManager
        ↓
add EntityWorld interface
        ↓
move queries to SpatialGrid
        ↓
move ownership to ChunkManager
        ↓
remove old global arrays
```

---

# 45. Acceptance Criteria toàn bộ refactor

Refactor được coi là thành công khi:

- Map có thể tăng kích thước mà FPS gần như không đổi nếu active radius không đổi.
- Không còn global scan zombie trong hot loop.
- Không còn global scan world object trong hot loop.
- Zombie xa không chạy full AI.
- Zombie ngoài active region không cần mesh.
- Chunk load/unload không làm mất state.
- Save/load hoạt động theo chunk.
- Player Vision chỉ query nearby entities.
- Pathfinding có queue/budget.
- Lighting chỉ update dirty building.
- Rendering dùng instancing/LOD nơi hợp lý.
- React không quản lý per-frame simulation.
- Có performance HUD.
- Có stress test.
- Có frame budget rõ ràng.

---

# 46. Definition of Done

Kiến trúc đủ tốt để scale world khi:

```text
10× map size
```

không làm:

```text
10× frame cost
```

và:

```text
10× logical zombie count
```

không làm:

```text
10× active AI cost
```

Target cuối cùng:

```text
WORLD SIZE
→ data problem

ACTIVE AREA
→ runtime problem
```

Game engine phải đảm bảo chỉ giải quyết runtime problem trong một phạm vi nhỏ quanh player.

---

# 47. Core Principle cuối cùng

Luôn ưu tiên:

```text
DATA FAR AWAY
→ abstract

DATA NEAR PLAYER
→ detailed
```

và:

```text
SIMULATION
→ independent from rendering

RENDERING
→ independent from persistence

PERSISTENCE
→ independent from React
```

Đây là nền tảng quan trọng nhất để game React + Three.js có thể phát triển từ prototype map nhỏ thành một game survival có world lớn mà không phải rewrite toàn bộ kiến trúc sau này.
