import {
  buildCalibration,
  detectCloses,
  mergeCloses,
  type CalibrationReport,
  type UpstreamSource,
} from './calibration'
import { hangarStateAt, schedule, type HangarState, type ScheduleEntry } from './cycle'
import type { LogEvent } from './logParser'

/** Response of GET /api/state. See docs/SPEC.md §4.2 and docs/FRONTEND.md. */
export type HangarReport = {
  serverTimeMs: number
  calibration: CalibrationReport
  state: HangarState | null
  /** Open/close boundaries for the next 24 h. */
  schedule: ScheduleEntry[]
  sources: SourceStatus[]
  helper: {
    lastEventAt: number | null
    lastEnv: string | null
    lastShard: string | null
    lastClientBuild: string | null
  }
}

export type SourceStatus = {
  id: string
  url: string
  ok: boolean
  fetchedAt: number | null
  error: string | null
}

/** One stored helper event (raw log time + that helper's clock offset). */
export type HelperEvent = {
  event: LogEvent
  receivedAt: number
  clockOffsetMs: number
  helperId: string
}

export const SCHEDULE_HORIZON_MS = 24 * 3_600_000

/** Pure assembly of the /api/state response. */
export function buildReport(input: {
  nowMs: number
  upstream: UpstreamSource[]
  sourceStatus: SourceStatus[]
  stored: HelperEvent[]
}): HangarReport {
  const { nowMs, upstream, sourceStatus, stored } = input
  const toServerTime = (s: HelperEvent): LogEvent => ({ ...s.event, at: s.event.at + s.clockOffsetMs })

  // Detect per helper so one player's elevators are never added to another's.
  const byHelper = Map.groupBy(stored, (s) => s.helperId)
  const closes = mergeCloses([...byHelper.values()].map((list) => detectCloses(list.map(toServerTime))))
  const calibration = buildCalibration(upstream, closes)
  const cal = calibration.calibration

  const events = stored.map(toServerTime)
  const last = <T extends LogEvent['type']>(type: T) =>
    events.filter((e) => e.type === type).sort((a, b) => a.at - b.at).at(-1) as
      | Extract<LogEvent, { type: T }>
      | undefined

  return {
    serverTimeMs: nowMs,
    calibration,
    state: cal ? hangarStateAt(nowMs, cal) : null,
    schedule: cal ? schedule(nowMs, nowMs + SCHEDULE_HORIZON_MS, cal) : [],
    sources: sourceStatus,
    helper: {
      lastEventAt: stored.length ? Math.max(...stored.map((s) => s.receivedAt)) : null,
      lastEnv: last('env')?.env ?? null,
      lastShard: last('join_pu')?.shard ?? null,
      lastClientBuild: last('log_start')?.clientBuild ?? null,
    },
  }
}
