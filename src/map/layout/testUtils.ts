import { importGeoJsonLayout, type LayoutImportOptions } from './importer'

/** GeoJSON builders for layout tests: local metres (x east, y north), so Z = −y. */

export type Coord = [number, number]

export function fc(features: object[], crs: string | null = 'local-metres'): Record<string, unknown> {
  return crs ? { type: 'FeatureCollection', 'worldgen:crs': crs, features } : { type: 'FeatureCollection', features }
}

export function road(id: string | null, coords: Coord[], props: Record<string, unknown> = {}): object {
  return { type: 'Feature', ...(id ? { id } : {}), properties: { highway: 'residential', ...props }, geometry: { type: 'LineString', coordinates: coords } }
}

export function area(id: string | null, rings: Coord[][], props: Record<string, unknown>): object {
  return { type: 'Feature', ...(id ? { id } : {}), properties: props, geometry: { type: 'Polygon', coordinates: rings.map((r) => [...r, r[0]]) } }
}

export function rect(x0: number, y0: number, x1: number, y1: number): Coord[] {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
}

export function imp(features: object[], opts: Partial<LayoutImportOptions> = {}) {
  return importGeoJsonLayout(fc(features), { layoutId: 't', name: 't', origin: { x: 0, y: 0 }, ...opts })
}

/** A street grid: `n` × `n` streets `spacing` apart, rotated by `deg`, each street one way through every crossing. */
export function gridStreets(n: number, spacing: number, deg = 0, jitter = 0): object[] {
  const t = (deg * Math.PI) / 180
  const noise = (i: number, j: number) => (jitter ? Math.sin(i * 12.9898 + j * 78.233) * jitter : 0)
  const at = (x: number, y: number, i: number, j: number): Coord => {
    const px = x + noise(i, j)
    const py = y + noise(j + 7, i + 3)
    return [Math.round((px * Math.cos(t) - py * Math.sin(t)) * 1000) / 1000, Math.round((px * Math.sin(t) + py * Math.cos(t)) * 1000) / 1000]
  }
  const half = ((n - 1) * spacing) / 2
  const out: object[] = []
  // Crossing points are shared exactly: both streets use at(i, j).
  const point = (i: number, j: number) => at(i * spacing - half, j * spacing - half, i, j)
  for (let j = 0; j < n; j++) out.push(road(`way/ew-${j}`, Array.from({ length: n }, (_, i) => point(i, j))))
  for (let i = 0; i < n; i++) out.push(road(`way/ns-${i}`, Array.from({ length: n }, (_, j) => point(i, j))))
  return out
}
