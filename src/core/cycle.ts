/**
 * PYAM executive hangar cycle math. Pure functions over integer UTC milliseconds.
 *
 * A cycle starts the moment the hangar opens (5th light turns green):
 *
 *   open phase   (~65 min): 5 green, one light goes dark every ~12 min,
 *                           last ~5 min all dark ("blackout"), then close.
 *   closed phase (~120 min): 5 red, one light turns green every ~24 min,
 *                           5th green = next cycle opens.
 *
 * The measured cycle is a little longer than the nominal 185 min (a few hundred
 * ms per cycle, varies per server build), so light offsets are scaled by the
 * measured phase lengths rather than using exact minutes.
 */

export const MINUTE_MS = 60_000

export const NOMINAL_OPEN_MS = 65 * MINUTE_MS
export const NOMINAL_CLOSE_MS = 120 * MINUTE_MS
export const LIGHT_COUNT = 5
/** Nominal minutes between lights going dark in the open phase. */
const OPEN_LIGHT_STEP_MIN = 12
/** Nominal minutes between lights turning green in the closed phase. */
const CLOSE_LIGHT_STEP_MIN = 24

export type Calibration = {
  /** UTC ms at which some cycle opened. Any cycle works; the math is periodic. */
  anchorMs: number
  openMs: number
  closeMs: number
}

export type Light = 'green' | 'red' | 'off'
export type Phase = 'open' | 'closed'
export type SubPhase = 'open' | 'blackout' | 'charging'

export type HangarState = {
  phase: Phase
  subPhase: SubPhase
  lights: Light[]
  /** Index of the cycle relative to the anchor (anchor cycle = 0). */
  cycleIndex: number
  cycleStartMs: number
  msIntoCycle: number
  /** When the current phase (open/closed) ends. */
  phaseEndsAtMs: number
  /** When the lights next change (light step, blackout, close or open). */
  nextChangeAtMs: number
}

export function periodMs(cal: Calibration): number {
  return cal.openMs + cal.closeMs
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n
}

/** Offsets (ms into cycle) at which the light pattern changes, in order, excluding 0. */
export function lightChangeOffsets(cal: Calibration): number[] {
  const openStep = (cal.openMs * OPEN_LIGHT_STEP_MIN) / 65
  const closeStep = (cal.closeMs * CLOSE_LIGHT_STEP_MIN) / 120
  const offsets: number[] = []
  // Open phase: lights go dark at 1..5 steps (5th = blackout start).
  for (let i = 1; i <= LIGHT_COUNT; i++) offsets.push(Math.round(openStep * i))
  // Close at openMs (all red).
  offsets.push(cal.openMs)
  // Closed phase: lights go green at 1..4 steps; the 5th is the next cycle's open.
  for (let i = 1; i < LIGHT_COUNT; i++) offsets.push(cal.openMs + Math.round(closeStep * i))
  offsets.push(periodMs(cal))
  return offsets
}

export function lightsAt(msIntoCycle: number, cal: Calibration): Light[] {
  const openStep = (cal.openMs * OPEN_LIGHT_STEP_MIN) / 65
  const closeStep = (cal.closeMs * CLOSE_LIGHT_STEP_MIN) / 120
  if (msIntoCycle < cal.openMs) {
    const dark = Math.min(LIGHT_COUNT, Math.floor(msIntoCycle / openStep))
    return Array.from({ length: LIGHT_COUNT }, (_, i) =>
      i < LIGHT_COUNT - dark ? 'green' : 'off',
    )
  }
  const green = Math.min(
    LIGHT_COUNT - 1,
    Math.floor((msIntoCycle - cal.openMs) / closeStep),
  )
  return Array.from({ length: LIGHT_COUNT }, (_, i) => (i < green ? 'green' : 'red'))
}

export function hangarStateAt(nowMs: number, cal: Calibration): HangarState {
  const period = periodMs(cal)
  const elapsed = nowMs - cal.anchorMs
  const msIntoCycle = mod(elapsed, period)
  const cycleIndex = Math.floor(elapsed / period)
  const cycleStartMs = cal.anchorMs + cycleIndex * period
  const open = msIntoCycle < cal.openMs
  const lights = lightsAt(msIntoCycle, cal)
  const nextOffset =
    lightChangeOffsets(cal).find((o) => o > msIntoCycle) ?? period
  return {
    phase: open ? 'open' : 'closed',
    subPhase: !open ? 'charging' : lights.every((l) => l === 'off') ? 'blackout' : 'open',
    lights,
    cycleIndex,
    cycleStartMs,
    msIntoCycle,
    phaseEndsAtMs: cycleStartMs + (open ? cal.openMs : period),
    nextChangeAtMs: cycleStartMs + nextOffset,
  }
}

export type ScheduleEntry = { kind: 'open' | 'close'; atMs: number; cycleIndex: number }

/** Open/close boundaries in [fromMs, untilMs). */
export function schedule(fromMs: number, untilMs: number, cal: Calibration): ScheduleEntry[] {
  const period = periodMs(cal)
  const out: ScheduleEntry[] = []
  let i = Math.floor((fromMs - cal.anchorMs) / period)
  for (;;) {
    const start = cal.anchorMs + i * period
    if (start >= untilMs) break
    if (start >= fromMs) out.push({ kind: 'open', atMs: start, cycleIndex: i })
    const close = start + cal.openMs
    if (close >= fromMs && close < untilMs) out.push({ kind: 'close', atMs: close, cycleIndex: i })
    i++
  }
  return out
}

/**
 * Signed distance (ms) from `atMs` to the nearest close boundary predicted by `cal`.
 * Positive = the event happened after the predicted close.
 */
export function residualToNearestClose(atMs: number, cal: Calibration): number {
  const period = periodMs(cal)
  const r = mod(atMs - (cal.anchorMs + cal.openMs), period)
  return r > period / 2 ? r - period : r
}
