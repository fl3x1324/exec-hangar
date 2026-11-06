import { MIN } from './format'
import type { HangarWindow } from './live'

export const TRAVEL_OPTIONS = [15, 30, 45, 60, 90, 120]
/** Least time inside before blackout for a window to be worth it at all. Below this you're too late. */
export const MIN_INSIDE_MS = 3 * MIN
/** Below this much time inside before blackout, it's doable but a close call. */
export const CLOSE_CALL_MS = 15 * MIN
/** Blackout length: you must be out before it ends. */
export const BLACKOUT_MS = 5 * MIN

export const travelLabel = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}`)

/** A window is catchable if you'd still get MIN_INSIDE_MS inside, before blackout, after travelling. */
export function catchInfo(w: HangarWindow, now: number, travelMs: number) {
  const arrive = now + travelMs
  const enter = Math.max(arrive, w.openAtMs)
  const inside = w.closeAtMs - BLACKOUT_MS - enter
  return { arrive, inside, ok: inside >= MIN_INSIDE_MS, leaveBy: w.closeAtMs - BLACKOUT_MS - MIN_INSIDE_MS - travelMs }
}

export type SkipReason =
  /** You'd get there during blackout: anyone inside at close is killed. */
  | 'blackout'
  /** Still before blackout, but with less than MIN_INSIDE_MS to get in and out. */
  | 'late'

/**
 * Picks the first window worth travelling for (≥ MIN_INSIDE_MS inside), flags it as a
 * close call when under CLOSE_CALL_MS, and explains the window you'd still reach while
 * it's open but too late for (so the UI can say why it's skipped).
 */
export function planRun(windows: HangarWindow[], now: number, travelMs: number) {
  const idx = windows.findIndex((w) => catchInfo(w, now, travelMs).ok)
  const target = idx >= 0 ? windows[idx] : undefined
  const info = target && catchInfo(target, now, travelMs)
  const arrive = now + travelMs
  const prev = windows.slice(0, idx >= 0 ? idx : windows.length).findLast((w) => arrive < w.closeAtMs)
  const skipped = prev && {
    window: prev,
    reason: (arrive >= prev.closeAtMs - BLACKOUT_MS ? 'blackout' : 'late') as SkipReason,
    /** Usable time before blackout (may be ≤ 0). */
    insideMs: prev.closeAtMs - BLACKOUT_MS - Math.max(arrive, prev.openAtMs),
    blackoutAtMs: prev.closeAtMs - BLACKOUT_MS,
  }
  /** The chosen window works, but with less than CLOSE_CALL_MS inside. */
  const closeCall = !!info && info.inside < CLOSE_CALL_MS
  return { target, info, skipped, closeCall, blackoutAtMs: target && target.closeAtMs - BLACKOUT_MS }
}
