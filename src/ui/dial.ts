import { LIGHT_COUNT, lightChangeOffsets, periodMs, type Calibration } from '#/core/cycle'

/** SVG geometry for a cycle dial: 400×400 viewBox, fraction 0 = top, clockwise. */
export const C = 200
export const R = 170
export const RW = 22

export function polar(r: number, frac: number): [number, number] {
  const a = frac * 2 * Math.PI
  return [C + r * Math.sin(a), C - r * Math.cos(a)]
}

/** Clockwise arc from f0 to f1. Empty for zero/negative spans (SVG would draw those the wrong way round). */
export function arc(r: number, f0: number, f1: number): string {
  if (f1 - f0 <= 1e-6) return ''
  const [x0, y0] = polar(r, f0)
  const [x1, y1] = polar(r, f1)
  const large = f1 - f0 > 0.5 ? 1 : 0
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

export type Seg = { f0: number; f1: number; kind: 'open' | 'blackout' | 'closed' }

export function segments(cal: Calibration): Seg[] {
  const P = periodMs(cal)
  const bounds = [0, ...lightChangeOffsets(cal)]
  const segs: Seg[] = []
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i]
    const b = bounds[i + 1]
    const kind = a >= cal.openMs ? 'closed' : i === LIGHT_COUNT ? 'blackout' : 'open'
    segs.push({ f0: a / P, f1: b / P, kind })
  }
  return segs
}

