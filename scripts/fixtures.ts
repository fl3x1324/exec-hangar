/**
 * Generates docs/fixtures/*.json: example GET /api/state responses for every
 * status and phase, built with the same buildReport() the server uses.
 *
 *   bun run fixtures        # regenerate
 *
 * core.test.ts fails if the committed fixtures drift from this output.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { UpstreamSource } from '../src/core/calibration'
import { parseLogLine, type LogEvent } from '../src/core/logParser'
import { buildReport, type HangarReport, type HelperEvent, type SourceStatus } from '../src/core/report'
import { ARKANIS_CONFIG_URL, XYXYLL_APP_URL, parseArkanisConfig, parseXyxyllAppJs } from '../src/core/upstream'

const root = join(import.meta.dir, '..')
const coreFixture = (n: string) => readFileSync(join(root, 'src/core/__fixtures__', n), 'utf8')
const iso = (s: string) => Date.parse(s)
const MIN = 60_000

export const FIXTURE_DIR = join(root, 'docs/fixtures')

export function buildFixtures(): Record<string, HangarReport> {
  const ark = parseArkanisConfig(JSON.parse(coreFixture('arkanis-config.json')))!
  const xy = parseXyxyllAppJs(coreFixture('xyxyll-app.js'))!
  const upstreamBoth: UpstreamSource[] = [
    { id: 'arkanis', label: ark.label, calibration: ark.calibration },
    { id: 'xyxyll', label: xy.label, calibration: xy.calibration },
  ]
  const status = (nowMs: number, down: string[] = []): SourceStatus[] => [
    { id: 'arkanis', url: ARKANIS_CONFIG_URL, ok: !down.includes('arkanis'), fetchedAt: down.includes('arkanis') ? null : nowMs - MIN, error: down.includes('arkanis') ? 'HTTP 503' : null },
    { id: 'xyxyll', url: XYXYLL_APP_URL, ok: !down.includes('xyxyll'), fetchedAt: down.includes('xyxyll') ? null : nowMs - MIN, error: down.includes('xyxyll') ? 'HTTP 503' : null },
  ]

  const realClose = iso('2026-11-06T06:51:25.602Z')
  const asHelper = (events: LogEvent[], receivedAt: number): HelperEvent[] =>
    events.map((event) => ({ event, receivedAt, clockOffsetMs: 1, helperId: 'demo-helper' }))
  const realEvents = asHelper(
    coreFixture('exec-close-2026-11-06.log')
      .split('\n')
      .map(parseLogLine)
      .filter((e): e is LogEvent => e !== null),
    realClose + 40_000,
  )
  const lowering = (at: number): LogEvent => ({ type: 'elevator_state', at, state: 'LoweringPlatform' })
  const offClose = realClose + 40 * MIN // a close upstream does not predict

  const closedNow = iso('2026-11-06T07:20:00Z')
  const openNow = iso('2026-11-06T09:10:00Z') // ~19 min into the next open phase
  const blackoutNow = iso('2026-11-06T09:53:30Z') // ~62 min into it
  const laterNow = iso('2026-11-06T07:40:00Z')

  return {
    'verified-closed': buildReport({ nowMs: closedNow, upstream: upstreamBoth, sourceStatus: status(closedNow), stored: realEvents }),
    'verified-open': buildReport({ nowMs: openNow, upstream: upstreamBoth, sourceStatus: status(openNow), stored: realEvents }),
    'verified-blackout': buildReport({ nowMs: blackoutNow, upstream: upstreamBoth, sourceStatus: status(blackoutNow), stored: realEvents }),
    upstream: buildReport({ nowMs: closedNow, upstream: upstreamBoth, sourceStatus: status(closedNow), stored: [] }),
    'upstream-one-source-down': buildReport({
      nowMs: closedNow,
      upstream: upstreamBoth.slice(0, 1),
      sourceStatus: status(closedNow, ['xyxyll']),
      stored: [],
    }),
    observed: buildReport({
      nowMs: laterNow,
      upstream: upstreamBoth,
      sourceStatus: status(laterNow),
      stored: asHelper([lowering(offClose), lowering(offClose + 70)], offClose + 30_000),
    }),
    conflict: buildReport({
      nowMs: laterNow,
      upstream: upstreamBoth,
      sourceStatus: status(laterNow),
      stored: asHelper([lowering(offClose)], offClose + 30_000),
    }),
    none: buildReport({ nowMs: closedNow, upstream: [], sourceStatus: status(closedNow, ['arkanis', 'xyxyll']), stored: [] }),
  }
}

export const serialize = (r: HangarReport) => JSON.stringify(r, null, 2) + '\n'

if (import.meta.main) {
  mkdirSync(FIXTURE_DIR, { recursive: true })
  for (const [name, report] of Object.entries(buildFixtures())) {
    writeFileSync(join(FIXTURE_DIR, `${name}.json`), serialize(report))
    console.log(`${name}.json  status=${report.calibration.status} phase=${report.state?.phase ?? '-'}`)
  }
}
