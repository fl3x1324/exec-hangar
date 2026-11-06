import { EXEC_LOCATION_PREFIX, type LogEvent } from './logParser'

/** Helper → server payload for POST /api/events. */
export type EventBatch = {
  helperId: string
  helperVersion: string
  /**
   * server clock − helper clock, ms. Event `at` values are raw log (helper
   * clock) times; the server adds this offset. Keeping them raw makes resent
   * events identical even when the measured offset jitters between syncs.
   */
  clockOffsetMs: number
  events: LogEvent[]
}

export const MAX_BATCH = 500

const WORD = /^\w{1,64}$/
const ID = /^[\w.-]{1,128}$/

const okTime = (at: unknown): at is number =>
  typeof at === 'number' && Number.isFinite(at) && at > Date.UTC(2024, 0, 1) && at < Date.now() + 3_600_000

/** Strict whitelist check; anything unexpected is dropped, never stored. */
export function validateEvent(x: unknown): LogEvent | null {
  if (!x || typeof x !== 'object') return null
  const e = x as Record<string, unknown>
  if (!okTime(e.at)) return null
  const at = e.at
  switch (e.type) {
    case 'log_start':
      return e.clientBuild === undefined || (typeof e.clientBuild === 'string' && /^\d{1,12}$/.test(e.clientBuild))
        ? { type: 'log_start', at, clientBuild: e.clientBuild as string | undefined }
        : null
    case 'env':
      return typeof e.env === 'string' && ID.test(e.env) ? { type: 'env', at, env: e.env } : null
    case 'join_pu':
      return typeof e.shard === 'string' && ID.test(e.shard) ? { type: 'join_pu', at, shard: e.shard } : null
    case 'location':
      return typeof e.location === 'string' &&
        (e.location === 'other' || (e.location.startsWith(EXEC_LOCATION_PREFIX) && ID.test(e.location)))
        ? { type: 'location', at, location: e.location }
        : null
    case 'elevator_state': {
      if (typeof e.state !== 'string' || !WORD.test(e.state)) return null
      if (e.dup === undefined) return { type: 'elevator_state', at, state: e.state }
      return Number.isInteger(e.dup) && (e.dup as number) > 0 && (e.dup as number) < 100
        ? { type: 'elevator_state', at, state: e.state, dup: e.dup as number }
        : null
    }
    default:
      return null
  }
}

export function validateBatch(x: unknown): EventBatch | null {
  if (!x || typeof x !== 'object') return null
  const b = x as Record<string, unknown>
  if (typeof b.helperId !== 'string' || !ID.test(b.helperId)) return null
  if (typeof b.helperVersion !== 'string' || b.helperVersion.length > 32) return null
  if (typeof b.clockOffsetMs !== 'number' || !Number.isFinite(b.clockOffsetMs)) return null
  if (!Array.isArray(b.events) || b.events.length > MAX_BATCH) return null
  return {
    helperId: b.helperId,
    helperVersion: b.helperVersion,
    clockOffsetMs: b.clockOffsetMs,
    events: b.events.map(validateEvent).filter((e): e is LogEvent => e !== null),
  }
}
