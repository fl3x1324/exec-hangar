import type { CalibrationStatus } from '#/core/calibration'

export type TrustTone = 'good' | 'neutral' | 'info' | 'warn' | 'none'

export const TRUST: Record<CalibrationStatus, { tone: TrustTone; label: string; detail: string }> = {
  verified: {
    tone: 'good',
    label: 'Confirmed in-game',
    detail: "A player's game log recently confirmed this timer.",
  },
  upstream: {
    tone: 'neutral',
    label: 'Community timer',
    detail: 'Based on community trackers. No in-game confirmation yet.',
  },
  observed: {
    tone: 'info',
    label: 'Updated from in-game data',
    detail: 'In-game data overrides the community trackers, which may be outdated after a game update.',
  },
  conflict: {
    tone: 'warn',
    label: 'May be off',
    detail: 'An unconfirmed in-game report disagrees with the community trackers. Waiting for confirmation.',
  },
  none: {
    tone: 'none',
    label: 'No timer data',
    detail: 'No tracker or in-game data is available right now, so the timer cannot be shown.',
  },
}
