/**
 * Writes the helper's .exe icon (five door lights on a dark plate) as a
 * multi-size .ico, for `bun build --windows-icon`. Generated, so no binary
 * asset lives in the repo.
 *
 *   bun scripts/helper-icon.ts [out.ico]   (default dist-helper/icon.ico)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { iconDib } from '../helper/tray'

const out = process.argv[2] ?? 'dist-helper/icon.ico'
const SIZES = [16, 24, 32, 48, 64, 128, 256]

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Signed distance to a rounded rectangle centred at (cx, cy). */
function roundRect(x: number, y: number, cx: number, cy: number, hw: number, hh: number, r: number) {
  const qx = Math.abs(x - cx) - (hw - r)
  const qy = Math.abs(y - cy) - (hh - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

function pixel(size: number) {
  const s = size
  const plate = { r: s * 0.2 }
  // Lights: 3 lit green, 2 red, like the hangar door mid-cycle.
  const lights = [0, 1, 2, 3, 4].map((i) => ({ cx: s * (0.2 + i * 0.15), lit: i < 3 }))
  const lw = s * 0.055
  const lh = s * 0.25
  return (x: number, y: number): [number, number, number, number] => {
    const dPlate = roundRect(x, y, s / 2, s / 2, s * 0.48, s * 0.48, plate.r)
    const aPlate = clamp01(0.5 - dPlate)
    if (aPlate <= 0) return [0, 0, 0, 0]
    // plate with a subtle top-down gradient and a rim
    const g = 18 + 10 * (1 - y / s)
    let col: [number, number, number] = dPlate > -Math.max(1, s / 32) ? [58, 64, 74] : [g, g + 2, g + 6]
    for (const l of lights) {
      const d = roundRect(x, y, l.cx, s * 0.5, lw, lh, lw)
      const a = clamp01(0.5 - d)
      const glow = l.lit ? clamp01(1 - Math.max(0, d) / (s * 0.08)) * 0.35 : 0
      const c: [number, number, number] = l.lit ? [52, 211, 153] : [220, 38, 38]
      const k = Math.max(a, glow)
      col = [col[0] + (c[0] - col[0]) * k, col[1] + (c[1] - col[1]) * k, col[2] + (c[2] - col[2]) * k]
    }
    return [Math.round(col[0]), Math.round(col[1]), Math.round(col[2]), Math.round(aPlate * 255)]
  }
}

const images = SIZES.map((s) => iconDib(s, pixel(s)))
const header = Buffer.alloc(6 + 16 * images.length)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2) // icon
header.writeUInt16LE(images.length, 4)
let offset = header.length
images.forEach((img, i) => {
  const s = SIZES[i]
  const e = 6 + i * 16
  header[e] = s === 256 ? 0 : s
  header[e + 1] = s === 256 ? 0 : s
  header.writeUInt16LE(1, e + 4) // planes
  header.writeUInt16LE(32, e + 6) // bpp
  header.writeUInt32LE(img.length, e + 8)
  header.writeUInt32LE(offset, e + 12)
  offset += img.length
})
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, Buffer.concat([header, ...images]))
console.log(`wrote ${out} (${SIZES.join(', ')} px)`)
