# TASK: Implement Data-Driven World Map Generator

## 1. Project context

Tôi đang phát triển một zombie survival web game lấy cảm hứng từ Project Zomboid.

Technology stack:
- React
- Three.js
- Vite
- IndexedDB for save/load

Game hiện đã có Map Editor và Prefab System.

Nhiệm vụ là xây dựng World Map Generator có khả năng tạo bản đồ từ dữ liệu layout địa lý hoặc ảnh tham chiếu có quyền sử dụng.

Mục tiêu là giữ nguyên bố cục đường sá, giao lộ và khu đất của reference, nhưng tự do thay thế công trình bằng prefab của game.

Đây phải là một hệ thống mở rộng editor hiện tại, KHÔNG phải editor mới.

## 2. Mandatory codebase audit

Trước khi viết code, hãy phân tích:

- Map Editor hiện tại.
- Map serialization format.
- Prefab Registry và prefab placement.
- Coordinate system và world units.
- Terrain và road rendering.
- Collision và navigation.
- Zombie spawning và pathfinding.
- IndexedDB save/load.
- Existing chunking hoặc spatial partitioning.
- Undo/redo nếu đã tồn tại.

Xác định những thành phần có thể tái sử dụng.

Không tự giả định cấu trúc thư mục, interface hoặc tên các class chưa được kiểm tra.

Không rewrite những system đang hoạt động tốt.

## 3. Architecture

Implement một pipeline có các thành phần logic:

ReferenceImporter
→ LayoutNormalizer
→ RoadNetworkGenerator
→ ParcelGenerator
→ PrefabPlacementGenerator
→ EnvironmentGenerator
→ WorldSerializer
→ ExistingMapEditor

Các thành phần có thể được tổ chức thành module hoặc service tùy kiến trúc project hiện tại.

Tách generation logic khỏi Three.js rendering.

Không lưu trực tiếp THREE.Mesh trong dữ liệu bản đồ.

## 4. Reference import

Hỗ trợ hai loại input:

A. Structured Geographic Data

Ưu tiên GeoJSON hoặc dữ liệu OpenStreetMap được sử dụng theo đúng giấy phép.

Đọc road geometry, land-use geometry và các feature được hỗ trợ.

B. Reference Image

Cho phép import ảnh bản đồ có quyền sử dụng.

Hiển thị ảnh làm overlay trong Map Editor.

Cho phép người dùng:
- Đánh dấu các điểm hiệu chỉnh.
- Xác định world scale.
- Đánh dấu đường.
- Đánh dấu giao lộ.
- Khoanh vùng khu đất.
- Xác định khu vực dân cư, thương mại và công nghiệp.

Thiết kế Image Layout Extraction dưới dạng module có thể thay thế.

Không yêu cầu hoàn thành một mô hình AI computer vision trong phase này.

Nếu sử dụng image segmentation trong tương lai, output vẫn phải được chuẩn hóa về cùng WorldLayout.

Không giả định ảnh raster chứa thông tin tọa độ địa lý hoặc tỷ lệ chính xác.

## 5. Coordinate system

Sử dụng coordinate convention hiện tại của project.

Nếu cần bổ sung quy ước, sử dụng:

X = horizontal world position
Y = elevation
Z = vertical map position

Thiết lập một WorldCoordinateTransformer.

Có khả năng chuyển:

- Geographic coordinates → local world coordinates.
- Reference image coordinates → world coordinates.
- World coordinates → editor coordinates.

Đối với dữ liệu địa lý, sử dụng phép chiếu phù hợp với khu vực trước khi chuyển sang mét.

Không sử dụng trực tiếp longitude và latitude như tọa độ mesh.

Mọi phép chuyển đổi phải có thể kiểm thử.

## 6. Road Network Generator

Road layout là thành phần có tính ràng buộc cao nhất.

Yêu cầu:
- Hỗ trợ đường thẳng và polyline cong.
- Hỗ trợ đường một làn và nhiều làn.
- Sinh intersection geometry.
- Sinh sidewalk nếu road type yêu cầu.
- Sinh đường vào khu dân cư.
- Hạn chế mesh overlap tại giao lộ.
- Giữ kết nối giữa các road segment.
- Tạo hoặc cập nhật collision.
- Tương thích zombie navigation hiện tại.

Road network phải được biểu diễn bằng dữ liệu có cấu trúc.

Không generate road chỉ bằng texture phẳng không có thông tin kết nối.

Hình dạng và kết nối road phải được giữ nguyên khi regenerate prefab.

## 7. Parcel Generator

Từ road network và ranh giới khu vực, tạo các land parcel.

Mỗi parcel chứa:
- Unique ID.
- Polygon boundary.
- Zone type.
- Available placement area.
- Road access.
- Preferred building orientation.
- Generation seed.
- Lock status.

Hỗ trợ các zone:
- Residential.
- Commercial.
- Industrial.
- Public.
- Forest.
- Farmland.
- Empty land.

Zone được sử dụng để lọc prefab.

Không mặc định toàn bộ parcel đều phải có nhà.

Đảm bảo parcel không chồng lên road và các vùng không được phép xây dựng.

## 8. Prefab placement

Mở rộng Prefab Registry hiện tại bằng metadata nếu cần.

Mỗi prefab có thể định nghĩa:

- Footprint.
- Category.
- Allowed zones.
- Placement weight.
- Entrance position.
- Road-facing requirement.
- Minimum setback.
- Collision bounds.
- Optional decoration anchors.

Prefab placement algorithm:

1. Chọn parcel.
2. Truy vấn các prefab hợp lệ.
3. Kiểm tra footprint.
4. Xác định vị trí và hướng quay.
5. Kiểm tra collision.
6. Kiểm tra road access.
7. Sinh prefab instance.
8. Ghi lại placement metadata.

Cho phép người dùng thay prefab trên một parcel bằng editor.

Không tự động thay đổi scale công trình để ép vừa parcel.

Không được thay đổi road layout khi thay prefab.

## 9. Deterministic generation

Implement seed-based generation.

Cùng seed, layout version, generator version và prefab catalog phải tạo cùng một map.

Sử dụng PRNG có seed.

Không sử dụng Math.random trực tiếp trong generation pipeline.

Tạo stable IDs cho:
- Roads.
- Intersections.
- Parcels.
- Generated objects.

Có thể regenerate một parcel mà không làm thay đổi toàn bộ thế giới.

## 10. Editor integration

Thêm công cụ World Generator vào Map Editor hiện tại.

Chức năng cần có:

- Import reference.
- Preview layout.
- Preview road network.
- Preview parcel boundaries.
- Generate world.
- Regenerate selected parcel.
- Replace prefab.
- Lock/unlock object.
- Change seed.
- Undo/redo thông qua hệ thống hiện tại nếu có.
- Save generated world.

Phân biệt:

Generated objects
Manual objects
Locked generated objects

Object chỉnh sửa thủ công phải được bảo vệ khỏi việc regenerate ngoài ý muốn.

Không xóa hoặc ghi đè dữ liệu editor mà không có thao tác rõ ràng của người dùng.

## 11. Generation modes

Hỗ trợ ba chế độ:

LAYOUT_ONLY:
Chỉ sinh đường, khu đất và các zone.

FULL_GENERATION:
Sinh roads, buildings và environment.

SELECTIVE_REGENERATION:
Chỉ sinh lại những parcel hoặc chunk được chọn.

SELECTIVE_REGENERATION phải bảo vệ các object đã khóa.

## 12. Chunk-based world

Thiết kế hỗ trợ chia world thành các chunk.

Tái sử dụng chunk system hiện tại nếu có.

Nếu chưa có, thêm lớp phân chia dữ liệu độc lập với renderer.

Chunk ownership phải được xác định rõ cho các object nằm trên ranh giới.

Không duplicate object ở chunk boundary.

Không yêu cầu render toàn bộ world cùng lúc.

Không đưa logic generation vào game render loop.

## 13. Environment generation

Bổ sung environmental details bằng prefab:

- Trees.
- Bushes.
- Grass.
- Fences.
- Streetlights.
- Parked cars.
- Abandoned vehicles.
- Trash.
- Road debris.

Environment density phải cấu hình được.

Decoration không được:
- Chặn cửa ra vào.
- Chặn toàn bộ lối đi.
- Chồng lên công trình.
- Phá road connectivity.

Có thể sử dụng InstancedMesh cho các vật thể lặp lại nếu phù hợp.

Không cần sinh toàn bộ environment ở phase đầu tiên.

## 14. Persistence

World data phải tương thích IndexedDB save/load hiện tại.

Lưu:

- World seed.
- Layout data.
- Generator version.
- Prefab placements.
- Manual overrides.
- Locked objects.
- World metadata.

Tách base world generation data khỏi runtime gameplay state.

Không được reset các thay đổi gameplay như container loot, đồ vật bị phá hủy hoặc công trình do player xây dựng khi chỉ regenerate map trong editor.

Bổ sung versioning và migration khi thay đổi save schema.

## 15. Performance

Đảm bảo generator không làm treo main thread khi xử lý bản đồ lớn.

Ưu tiên:
- Batch generation.
- Incremental processing.
- Web Worker cho geometry/data processing nếu phù hợp.
- Chunk-based loading.
- Geometry reuse.
- Asset reuse.
- Controlled disposal.

Không gọi generate lại toàn bộ map mỗi khi React component render.

Có cơ chế hủy generation và dọn dẹp dữ liệu tạm khi cần.

## 16. Verification

Implement hoặc mở rộng automated tests cho:

1. Coordinate transformations.
2. Deterministic generation.
3. Road connectivity.
4. Parcel-road overlap.
5. Prefab collision.
6. Road-facing placement.
7. Locked object preservation.
8. Selective regeneration.
9. Save/load round trip.
10. Chunk boundary ownership.

Thực hiện build và kiểm tra các lỗi TypeScript, nếu project sử dụng TypeScript.

Kiểm tra không có regression đối với:
- Zombie navigation.
- Player movement.
- Combat.
- Loot.
- Day/night.
- Vision system.
- Existing map editing.
- IndexedDB persistence.

## 17. Implementation strategy

Triển khai theo thứ tự:

Phase A: Audit và data contracts.
Phase B: Reference import và world layout.
Phase C: Road geometry.
Phase D: Parcel generation.
Phase E: Prefab placement.
Phase F: Editor integration.
Phase G: Environment, persistence và performance.

Ưu tiên một vertical slice có thể chạy được:

Import structured road layout
→ Render roads
→ Create parcels
→ Place existing prefabs
→ Edit results
→ Save/load.

Không xây dựng AI image recognition trước khi vertical slice hoạt động ổn định.

## 18. Expected deliverables

Sau khi thực hiện, báo cáo:

- Existing systems reused.
- Architecture implemented.
- Files created.
- Files modified.
- New data schemas.
- Generator usage.
- Editor workflow.
- Test results.
- Known limitations.

Mục tiêu cuối cùng:

Một World Map Generator có thể tạo nhiều bản đồ zombie survival khác nhau từ cùng một road layout, với công trình có thể thay đổi độc lập, đồng thời giữ nguyên khả năng chỉnh sửa và lưu trữ bằng editor hiện tại.