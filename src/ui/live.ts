import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  hangarStateAt,
  periodMs,
  type Calibration,
  type HangarState,
} from '#/core/cycle'
import type { HangarReport } from '#/core/report'
import { HOUR } from './format'

const STATE_POLL_MS = 60_000
const CLOCK_RESYNC_MS = 10 * 60_000

export type HangarWindow = { openAtMs: number; closeAtMs: number; current: boolean }

/**
 * Coarse emotional state of the hangar, used for emphasis:
 * charging → soon (opens in ≤10 min) → open → closing (1 light left) → blackout.
 */
export type Mood = 'none' | 'charging' | 'soon' | 'open' | 'closing' | 'blackout'

export type Live = {
  report: HangarReport
  cal: Calibration | null
  /** Server-corrected (and, in preview, time-warped) "now". */
  now: number
  state: HangarState | null
  mood: Mood
  /** ms until the current phase ends (0 when no data). */
  remainingMs: number
  /** 0..1 progress through the current phase. */
  phaseProgress: number
  /** Current (if open) and upcoming open windows, 24 h ahead. */
  windows: HangarWindow[]
  offline: boolean
  /** False during SSR and the hydration render. Gate locale/timezone-dependent text on it. */
  hydrated: boolean
  preview: boolean
}

export function upcomingWindows(now: number, cal: Calibration, horizonMs = 24 * HOUR): HangarWindow[] {
  const s = hangarStateAt(now, cal)
  const period = periodMs(cal)
  const out: HangarWindow[] = []
  let open = s.phase === 'open' ? s.cycleStartMs : s.phaseEndsAtMs
  while (open < now + horizonMs) {
    out.push({ openAtMs: open, closeAtMs: open + cal.openMs, current: open <= now })
    open += period
  }
  return out
}

export function moodOf(state: HangarState | null, now: number): Mood {
  if (!state) return 'none'
  if (state.subPhase === 'blackout') return 'blackout'
  if (state.phase === 'open') return state.lights.filter((l) => l === 'green').length <= 1 ? 'closing' : 'open'
  return state.phaseEndsAtMs - now <= 10 * 60_000 ? 'soon' : 'charging'
}

async function measureOffset(): Promise<number> {
  const t0 = Date.now()
  const res = await fetch('/api/time', { cache: 'no-store' })
  const { serverTimeMs } = (await res.json()) as { serverTimeMs: number }
  const t1 = Date.now()
  return serverTimeMs - (t0 + t1) / 2
}

/**
 * Runs the hangar clock locally from one calibration, per docs/FRONTEND.md §4:
 * clock offset from /api/time, ticks from absolute time, polls /api/state every
 * 60 s and on focus. In preview mode (fixture), time starts at the fixture's
 * serverTimeMs and nothing is fetched. `speed` time-warps either mode.
 */
export function useHangar(initial: HangarReport, opts: { preview: boolean; speed: number }): Live {
  const { preview, speed } = opts
  const [report, setReport] = useState(initial)
  const [now, setNow] = useState(initial.serverTimeMs)
  const [offline, setOffline] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  // real "now" = Date.now() + offset; simulated = simBase + (real - realBase) * speed
  const clock = useRef({ offset: 0, realBase: 0, simBase: 0 })

  const realNow = useCallback(() => Date.now() + clock.current.offset, [])
  const simNow = useCallback(() => {
    const c = clock.current
    return c.simBase + (realNow() - c.realBase) * speed
  }, [realNow, speed])

  // (Re)initialise on new data source or speed.
  useEffect(() => {
    setReport(initial)
    setOffline(false)
    const c = clock.current
    c.offset = preview ? initial.serverTimeMs - Date.now() : c.offset || initial.serverTimeMs - Date.now()
    c.realBase = realNow()
    c.simBase = preview ? initial.serverTimeMs : c.realBase
    setNow(simNow())
    setHydrated(true)
  }, [initial, preview, speed, realNow, simNow])

  // Tick from absolute time; 4 Hz keeps time-warped previews smooth.
  useEffect(() => {
    const tick = () => setNow(simNow())
    const id = window.setInterval(tick, speed > 1 ? 100 : 250)
    return () => window.clearInterval(id)
  }, [simNow, speed])

  // Live data: clock offset + state polling.
  useEffect(() => {
    if (preview) return
    let cancelled = false

    const syncClock = async () => {
      try {
        const offset = await measureOffset()
        if (cancelled) return
        // Keep the simulated timeline continuous when the offset changes.
        const c = clock.current
        const sim = c.simBase + (Date.now() + c.offset - c.realBase) * speed
        c.offset = offset
        c.realBase = Date.now() + offset
        c.simBase = speed === 1 ? c.realBase : sim
        setNow(c.simBase)
      } catch {
        /* keep previous offset */
      }
    }
    const refresh = async () => {
      try {
        const res = await fetch('/api/state', { cache: 'no-store' })
        if (!res.ok) throw new Error(String(res.status))
        const next = (await res.json()) as HangarReport
        if (!cancelled) {
          setReport(next)
          setOffline(false)
        }
      } catch {
        if (!cancelled) setOffline(true)
      }
    }

    void syncClock()
    const poll = window.setInterval(refresh, STATE_POLL_MS)
    const resync = window.setInterval(syncClock, CLOCK_RESYNC_MS)
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      setNow(simNow())
      void refresh()
      void syncClock()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(poll)
      window.clearInterval(resync)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [preview, speed, simNow])

  const cal = report.calibration.calibration
  const state = useMemo(() => (cal ? hangarStateAt(now, cal) : null), [now, cal])
  // Windows only change at phase boundaries; recompute per minute bucket.
  const minute = Math.floor(now / 60_000)
  const windows = useMemo(() => (cal ? upcomingWindows(now, cal) : []), [cal, minute, state?.phase]) // eslint-disable-line react-hooks/exhaustive-deps

  const phaseLen = state && cal ? (state.phase === 'open' ? cal.openMs : cal.closeMs) : 1
  const remainingMs = state ? Math.max(0, state.phaseEndsAtMs - now) : 0

  return {
    report,
    cal,
    now,
    state,
    mood: moodOf(state, now),
    remainingMs,
    phaseProgress: state ? 1 - remainingMs / phaseLen : 0,
    windows,
    offline,
    hydrated,
    preview,
  }
}

/** UTC display preference, persisted per browser. */
export function useUtcPref(): [boolean, (v: boolean) => void] {
  const [utc, setUtc] = useState(false)
  useEffect(() => {
    try {
      setUtc(localStorage.getItem('exec-hangars:utc') === '1')
    } catch {
      /* storage unavailable */
    }
  }, [])
  const set = useCallback((v: boolean) => {
    setUtc(v)
    try {
      localStorage.setItem('exec-hangars:utc', v ? '1' : '0')
    } catch {
      /* storage unavailable */
    }
  }, [])
  return [utc, set]
}
