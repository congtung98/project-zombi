import type { ArchitectureStyle, LibraryGroup } from '../map/schema'

/** Prefab library P1: labels of the library groups and architecture styles (panel, Inspector, Generator tab). */
export const GROUP_LABEL: Record<LibraryGroup, string> = { residential: 'Nhà ở', commercial: 'Thương mại', public: 'Công cộng', industrial: 'Công nghiệp', landscape: 'Cảnh quan' }
export const STYLE_LABEL: Record<ArchitectureStyle, string> = { vietnamese: 'Việt Nam', american: 'Mỹ', generic: 'Chung' }
