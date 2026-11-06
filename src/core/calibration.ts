import {
  NOMINAL_CLOSE_MS,
  NOMINAL_OPEN_MS,
  periodMs,
  residualToNearestClose,
  type Calibration,
} from './cycle'
import type { LogEvent } from './logParser'

/**
 * The exec elevator starts lowering slightly before the cycle boundary the
 * community trackers use. Measured once (2026-11-06): LoweringPlatform at
 * 06:51:25.602Z vs predicted close 06:51:29.146Z → 3.5 s lead. Refine as more
 * observations arrive (see `residualMs` in the calibration report).
 */
export const ELEVATOR_CLOSE_LEAD_MS = 3_500

/** Several elevators lower within a second or so of each other; one cluster = one close. */
const CLOSE_CLUSTER_MS = 60_000
/**
 * Elevators that start lowering this close to the cluster's first one count as
 * moving together. At the 2026-11-06 close two started 67 ms apart. A player
 * claiming or storing a ship would move a single elevator, so 2+ moving
 * together is a lifecycle signature.
 */
const SIMULTANEOUS_MS = 1_000
/** Elevators lowering together needed for an observation to stand on its own. */
export const STRONG_ELEVATOR_COUNT = 2
/** An observation within this distance of a predicted close agrees with that prediction. */
export const AGREE_TOLERANCE_MS = 2 * 60_000

export type UpstreamSource = {
  id: string
  label: string
  calibration: Calibration
}

export type CloseObservation = {
  /** Clock-corrected UTC ms of the first LoweringPlatform in the cluster. */
  atMs: number
  /** Cycle boundary implied by the observation. */
  boundaryMs: number
  /** Elevators that started lowering together (within SIMULTANEOUS_MS). Defaults to 1. */
  elevators?: number
}

const isStrong = (o: CloseObservation) => (o.elevators ?? 1) >= STRONG_ELEVATOR_COUNT

export type CalibrationStatus =
  /** A fresh elevator observation agrees with the model. */
  | 'verified'
  /** Only upstream trackers back the model; no newer observation. */
  | 'upstream'
  /**
   * Observations override upstream, which disagrees: either two cycle-consistent
   * observations, or one where several elevators lowered together.
   */
  | 'observed'
  /** The newest observation disagrees with upstream and nothing confirms it yet. */
  | 'conflict'
  | 'none'

export type CalibrationReport = {
  status: CalibrationStatus
  calibration: Calibration | null
  /** Which source the active calibration came from. */
  basis: string | null
  upstream: {
    id: string
    label: string
    calibration: Calibration
    agreesWithPrimary: boolean
  }[]
  observations: {
    atMs: number
    elevators: number
    /** Distance to the nearest close predicted by the primary upstream source. */
    residualMs: number | null
    agrees: boolean | null
  }[]
  notes: string[]
}

/** Elevator state events → one close observation per lowering cluster. */
export function detectCloses(events: LogEvent[]): CloseObservation[] {
  const lowerings = events
    .filter((e) => e.type === 'elevator_state' && e.state === 'LoweringPlatform')
    .map((e) => e.at)
    .sort((a, b) => a - b)
  const out: CloseObservation[] = []
  let last = -Infinity
  for (const at of lowerings) {
    const current = out.at(-1)
    if (at - last > CLOSE_CLUSTER_MS) {
      out.push({ atMs: at, boundaryMs: at + ELEVATOR_CLOSE_LEAD_MS, elevators: 1 })
    } else if (current && at - current.atMs <= SIMULTANEOUS_MS) {
      current.elevators = (current.elevators ?? 1) + 1
    }
    last = at
  }
  return out
}

/**
 * Merges close observations from several helpers (players). Elevator counts
 * are per helper, so they are never summed across helpers: the merged
 * observation takes the highest count and the median time.
 */
export function mergeCloses(perHelper: CloseObservation[][]): CloseObservation[] {
  const all = perHelper.flat().sort((a, b) => a.atMs - b.atMs)
  const groups: CloseObservation[][] = []
  for (const o of all) {
    const g = groups.at(-1)
    if (g && o.atMs - g[0].atMs <= CLOSE_CLUSTER_MS) g.push(o)
    else groups.push([o])
  }
  return groups.map((g) => {
    const mid = g[Math.floor((g.length - 1) / 2)]
    return {
      atMs: mid.atMs,
      boundaryMs: mid.boundaryMs,
      elevators: Math.max(...g.map((o) => o.elevators ?? 1)),
    }
  })
}

function closeAgrees(boundaryMs: number, cal: Calibration): boolean {
  return Math.abs(residualToNearestClose(boundaryMs, cal)) <= AGREE_TOLERANCE_MS
}

function calibrationFromClose(boundaryMs: number, base: Pick<Calibration, 'openMs' | 'closeMs'>): Calibration {
  return { anchorMs: boundaryMs - base.openMs, openMs: base.openMs, closeMs: base.closeMs }
}

/**
 * Combine upstream trackers and elevator observations into one calibration.
 *
 * Rules:
 * - Upstream sources are ordered by preference; the first is primary. Others
 *   are cross-checks (they may share an anchor and so not be independent).
 * - Every server build deploy resets the cycle at an arbitrary point, so the
 *   newest trustworthy evidence wins.
 * - A single-elevator observation can be a false positive (a player claiming
 *   or storing a ship), so it only overrides upstream when a second one
 *   confirms it. Several elevators lowering together is a lifecycle close and
 *   stands on its own.
 * - Phase lengths always come from upstream when available (measured per
 *   build); otherwise nominal 65/120 min.
 */
export function buildCalibration(
  upstream: UpstreamSource[],
  closes: CloseObservation[],
): CalibrationReport {
  const notes: string[] = []
  const primary = upstream[0] ?? null
  const base = primary?.calibration ?? { anchorMs: 0, openMs: NOMINAL_OPEN_MS, closeMs: NOMINAL_CLOSE_MS }
  if (!primary) notes.push('No upstream source available; using nominal 65/120 min phases.')

  const upstreamReport = upstream.map((u) => ({
    id: u.id,
    label: u.label,
    calibration: u.calibration,
    agreesWithPrimary: primary
      ? closeAgrees(u.calibration.anchorMs + u.calibration.openMs, primary.calibration)
      : false,
  }))
  for (const u of upstreamReport) {
    if (!u.agreesWithPrimary) notes.push(`Upstream source ${u.id} disagrees with ${primary!.id}.`)
  }

  const sorted = [...closes].sort((a, b) => a.atMs - b.atMs)
  const observations = sorted.map((o) => {
    const residual = primary ? residualToNearestClose(o.boundaryMs, primary.calibration) : null
    return {
      atMs: o.atMs,
      elevators: o.elevators ?? 1,
      residualMs: residual,
      agrees: residual === null ? null : Math.abs(residual) <= AGREE_TOLERANCE_MS,
    }
  })

  // Only observations newer than the primary anchor can say anything about the
  // current server build's cycle (older ones may predate a reset).
  const relevant = primary
    ? sorted.filter((o) => o.atMs > primary.calibration.anchorMs)
    : sorted
  const newest = relevant.at(-1)

  if (!newest) {
    if (!primary) return { status: 'none', calibration: null, basis: null, upstream: upstreamReport, observations, notes }
    return { status: 'upstream', calibration: primary.calibration, basis: primary.id, upstream: upstreamReport, observations, notes }
  }

  if (primary && closeAgrees(newest.boundaryMs, primary.calibration)) {
    // Observation confirms upstream. Re-anchor on the observation: it is newer
    // and measured locally, so it carries less accumulated period error.
    return {
      status: 'verified',
      calibration: calibrationFromClose(newest.boundaryMs, base),
      basis: 'elevator',
      upstream: upstreamReport,
      observations,
      notes,
    }
  }

  // Newest observation disagrees with upstream (or there is no upstream).
  // Look for an earlier observation that is cycle-consistent with it.
  const candidate = calibrationFromClose(newest.boundaryMs, base)
  const confirmedBy = relevant
    .slice(0, -1)
    .filter((o) => newest.atMs - o.atMs > CLOSE_CLUSTER_MS)
    .some((o) => closeAgrees(o.boundaryMs, candidate))

  if (confirmedBy) {
    notes.push('Two elevator observations agree with each other and not with upstream; upstream looks stale.')
    return { status: 'observed', calibration: candidate, basis: 'elevator', upstream: upstreamReport, observations, notes }
  }

  if (isStrong(newest)) {
    notes.push(
      `${newest.elevators} elevators lowered together (lifecycle close) at a time upstream does not predict; upstream looks stale.`,
    )
    return { status: 'observed', calibration: candidate, basis: 'elevator', upstream: upstreamReport, observations, notes }
  }

  if (!primary) {
    notes.push('Single unconfirmed elevator observation with no upstream to check against.')
    return { status: 'conflict', calibration: candidate, basis: 'elevator', upstream: upstreamReport, observations, notes }
  }

  notes.push('Newest elevator observation disagrees with upstream; waiting for confirmation.')
  return { status: 'conflict', calibration: primary.calibration, basis: primary.id, upstream: upstreamReport, observations, notes }
}

export function describePeriod(cal: Calibration): string {
  const extra = periodMs(cal) - NOMINAL_OPEN_MS - NOMINAL_CLOSE_MS
  return `${periodMs(cal)} ms (${extra >= 0 ? '+' : ''}${extra} ms vs nominal)`
}
