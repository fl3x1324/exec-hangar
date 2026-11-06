import type { HangarReport } from '#/core/report'

/**
 * docs/fixtures/*.json keyed by basename, for previewing every UI state.
 * Dev only: empty in production builds, so the fixture data is not shipped and
 * `?fx=` cannot show fake states on the live site.
 */
export const FIXTURES: Record<string, HangarReport> = import.meta.env.DEV
  ? Object.fromEntries(
      Object.entries(
        import.meta.glob<HangarReport>('../../docs/fixtures/*.json', { eager: true, import: 'default' }),
      ).map(([path, report]) => [path.split('/').pop()!.replace(/\.json$/, ''), report]),
    )
  : {}

export const FIXTURE_NAMES = Object.keys(FIXTURES).sort()
