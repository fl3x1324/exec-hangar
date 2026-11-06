import type { Calibration } from './cycle'

/**
 * Parsers for community tracker data. Each returns null on anything unexpected
 * so a format change reads as "source unavailable", never as a wrong timer.
 */

export const ARKANIS_CONFIG_URL =
  'https://raw.githubusercontent.com/ArkanisCorporation/Exec-Hangar/main/config.json'
export const XYXYLL_APP_URL = 'https://exec.xyxyll.com/app.js'

/** Reject values outside sane bounds (catches unit mistakes and garbage). */
function plausible(cal: Calibration): boolean {
  const near = (v: number, nominal: number) => Math.abs(v - nominal) < 60_000
  return (
    Number.isFinite(cal.anchorMs) &&
    cal.anchorMs > Date.UTC(2024, 0, 1) &&
    near(cal.openMs, 65 * 60_000) &&
    near(cal.closeMs, 120 * 60_000)
  )
}

export type ParsedUpstream = { calibration: Calibration; label: string }

export function parseArkanisConfig(json: unknown): ParsedUpstream | null {
  if (!json || typeof json !== 'object') return null
  const j = json as Record<string, unknown>
  const s = j.serverStartTimes as Record<string, unknown> | undefined
  if (!s) return null
  const anchorMs = typeof s.initialOpenTime === 'string' ? Date.parse(s.initialOpenTime) : NaN
  const cal = { anchorMs, openMs: Number(s.openDurationMs), closeMs: Number(s.closeDurationMs) }
  if (!plausible(cal)) return null
  return { calibration: cal, label: typeof j.versionInfo === 'string' ? j.versionInfo : 'Arkanis' }
}

export function parseXyxyllAppJs(src: string): ParsedUpstream | null {
  const num = (name: string) => {
    const m = new RegExp(`const\\s+${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)\\s*;`).exec(src)
    return m ? Number(m[1]) : NaN
  }
  const drift = num('CYCLE_DRIFT_MS')
  const onlineMin = num('DESIGN_ONLINE_MIN')
  const offlineMin = num('DESIGN_OFFLINE_MIN')
  const anchor = /const\s+INITIAL_OPEN_TIME\s*=\s*new Date\(\s*['"]([^'"]+)['"]\s*\)/.exec(src)
  if (!anchor || ![drift, onlineMin, offlineMin].every(Number.isFinite)) return null
  // Mirrors xyxyll's own split of the drifted cycle into open/close.
  const designCycle = (onlineMin + offlineMin) * 60_000
  const cycle = designCycle + drift
  const openMs = Math.round((cycle * onlineMin * 60_000) / designCycle)
  const cal = { anchorMs: Date.parse(anchor[1]), openMs, closeMs: cycle - openMs }
  if (!plausible(cal)) return null
  const version = /@version\s+(\S+)/.exec(src)?.[1]
  return { calibration: cal, label: `xyxyll${version ? ` v${version}` : ''}` }
}
