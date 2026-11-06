/**
 * Star Citizen Game.log → the small set of events this project cares about.
 *
 * Privacy: only these whitelisted facts ever leave the player's PC. Player
 * names, IPs, session IDs and everything else in the log are dropped here.
 */

export const EXEC_ELEVATOR_MANAGER =
  'LoadingPlatformManager_ShipElevator_HangarMediumFront_Dungeon_Exec_Rund'
export const EXEC_LOCATION_PREFIX = 'AsteroidClusterBase_Pyro_Dungeon_Executive'

export type LogEvent =
  /** A new Game.log began (game launched). */
  | { type: 'log_start'; at: number; clientBuild?: string }
  /** Environment/server build the client connected to, e.g. pub-sc-alpha-4102-12881860. */
  | { type: 'env'; at: number; env: string }
  /** Joined a PU shard, e.g. pub_euw1b_12881860_470. */
  | { type: 'join_pu'; at: number; shard: string }
  /** Player location changed to a named location (only exec-hangar locations are kept). */
  | { type: 'location'; at: number; location: string }
  /**
   * Exec hangar ship elevator state change (e.g. OpenIdle, LoweringPlatform, ClosedIdle).
   * The hangar has several elevators logged under one name; `dup` numbers
   * otherwise-identical lines (same ms, same state) so they stay distinct.
   */
  | { type: 'elevator_state'; at: number; state: string; dup?: number }

const TS_RE = /^<(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)>/
const BUILD_RE = /BackupNameAttachment=" Build\((\d+)\)/
const ENV_RE = /@env_session:\s+'([^']+)'/
const JOIN_RE = /<Join PU> .*?shard\[([^\]]+)\]/
const LOCATION_RE = /<RequestLocationInventory> .*?Location\[([^\]]+)\]/
const ELEVATOR_RE = new RegExp(
  `<CSCLoadingPlatformManager::OnLoadingPlatformStateChanged> .*?\\[${EXEC_ELEVATOR_MANAGER}\\] Platform state changed to (\\w+)`,
)

export function parseLogLine(line: string): LogEvent | null {
  const ts = TS_RE.exec(line)
  if (!ts) return null
  const at = Date.parse(ts[1])
  if (!Number.isFinite(at)) return null

  let m: RegExpExecArray | null
  if ((m = ELEVATOR_RE.exec(line))) return { type: 'elevator_state', at, state: m[1] }
  if ((m = LOCATION_RE.exec(line))) {
    // Only exec-hangar locations; everything else is the player's business.
    return m[1].startsWith(EXEC_LOCATION_PREFIX)
      ? { type: 'location', at, location: m[1] }
      : { type: 'location', at, location: 'other' }
  }
  if ((m = JOIN_RE.exec(line))) return { type: 'join_pu', at, shard: m[1] }
  if ((m = ENV_RE.exec(line))) return { type: 'env', at, env: m[1] }
  if ((m = BUILD_RE.exec(line))) return { type: 'log_start', at, clientBuild: m[1] }
  return null
}

/**
 * Numbers repeated identical elevator lines within one log file (see `dup`).
 * Deterministic per file, so re-reading or backfilling yields the same events
 * and server-side dedupe still works. Create one per Game.log file.
 */
export class DupCounter {
  private counts = new Map<string, number>()
  tag(e: LogEvent): LogEvent {
    if (e.type !== 'elevator_state') return e
    const key = `${e.at}|${e.state}`
    const n = this.counts.get(key) ?? 0
    this.counts.set(key, n + 1)
    return n === 0 ? e : { ...e, dup: n }
  }
}

/**
 * Incremental line splitter for a growing file. Feed raw chunks, get complete
 * lines; a trailing partial line is held until its newline arrives.
 */
export class LineBuffer {
  private rest = ''
  push(chunk: string): string[] {
    const text = this.rest + chunk
    const lines = text.split(/\r?\n/)
    this.rest = lines.pop() ?? ''
    return lines
  }
  reset() {
    this.rest = ''
  }
}
