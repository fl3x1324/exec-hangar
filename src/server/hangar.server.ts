import { buildReport, type HangarReport } from '#/core/report'
import { allEvents } from './store.server'
import { getUpstream } from './upstream.server'

export type { HangarReport }

export async function getHangarReport(nowMs?: number): Promise<HangarReport> {
  const [{ sources, status }, stored] = await Promise.all([getUpstream(), allEvents()])
  // Take "now" after the (possibly slow) upstream fetch so serverTimeMs is
  // fresh when the response leaves, and usable for client clock correction.
  return buildReport({ nowMs: nowMs ?? Date.now(), upstream: sources, sourceStatus: status, stored })
}
