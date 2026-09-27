import type { LandUseZone, RestrictedKind, RoadClass } from '../layout/schema.ts'

/** WG6: colours and labels of the Bản vẽ tab (viewport lines, legend, pickers). */

export const TRACE_COLORS: { road: Record<RoadClass, string>; zone: Record<LandUseZone, string>; restricted: Record<RestrictedKind, string> } = {
  // Vivid colours: they must read over any map picture (1 px lines).
  road: { arterial: '#ff3b30', collector: '#ff9f1c', local: '#ffe600', service: '#00e5ff', track: '#c77dff', path: '#e0e0e0' },
  zone: { residential: '#6fcf6f', commercial: '#4aa8ff', industrial: '#b07cff', public: '#ff6b9d', forest: '#2e9d42', farmland: '#d4c05a', empty: '#aaaaaa' },
  restricted: { water: '#3fa9f5', railway: '#a0704a', 'no-build': '#ff5a5a' },
}

export const ROAD_CLASS_LABEL: Record<RoadClass, string> = { arterial: 'Đường chính', collector: 'Đường gom', local: 'Đường khu dân cư', service: 'Đường nội bộ', track: 'Đường đất', path: 'Lối đi bộ' }
export const ZONE_LABEL: Record<LandUseZone, string> = { residential: 'Dân cư', commercial: 'Thương mại', industrial: 'Công nghiệp', public: 'Công cộng', forest: 'Rừng', farmland: 'Ruộng', empty: 'Đất trống' }
export const RESTRICTED_LABEL: Record<RestrictedKind, string> = { water: 'Sông, hồ', railway: 'Đường sắt', 'no-build': 'Cấm xây' }
