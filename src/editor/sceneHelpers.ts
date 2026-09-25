import { BufferGeometry, CanvasTexture, Float32BufferAttribute, LineBasicMaterial, MeshBasicMaterial, SRGBColorSpace } from 'three'
import type { Rect } from '../map/schema'

/** Drawing helpers shared by the world viewport and the prefab editor scene. */

export function lineGeometry(points: number[]): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(points, 3))
  return g
}

export function rectPoints(r: Rect, y: number): number[] {
  const { minX: a, minZ: b, maxX: c, maxZ: d } = r
  return [a, y, b, c, y, b, c, y, b, c, y, d, c, y, d, a, y, d, a, y, d, a, y, b]
}

export const SELECT_MAT = new LineBasicMaterial({ color: '#ffd23f' })
export const MARQUEE_MAT = new LineBasicMaterial({ color: '#7fd4ff' })
export const GRID_MAT = new LineBasicMaterial({ color: '#56624a', transparent: true, opacity: 0.35 })

/** Text painted on the ground (a texture: DOM labels would need extra React roots). */
const labels = new Map<string, MeshBasicMaterial>()
export function labelMaterial(text: string, color = '#8fb8e8'): MeshBasicMaterial {
  const key = `${color}:${text}`
  let m = labels.get(key)
  if (!m) {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 64
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = color
    ctx.font = 'bold 40px monospace'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 8, 32)
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    m = new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })
    labels.set(key, m)
  }
  return m
}
