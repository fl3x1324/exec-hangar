import { createServerFn } from '@tanstack/react-start'
import { adminConfigured, checkPassword, endSession, isAdmin, requireAdmin, startSession } from '#/server/admin.server'
import { allEvents, removeEventsByToken } from '#/server/store.server'
import { LEGACY_TOKEN_ID, legacyToken, listTokens, mintToken, revokeToken } from '#/server/tokens.server'

/**
 * Admin server functions for /admin. Every handler checks the session itself:
 * server functions are reachable endpoints, whatever page calls them.
 */

export type AdminToken = {
  id: string
  name: string
  hint: string | null
  createdAt: number | null
  lastUsedAt: number | null
  revokedAt: number | null
  /** Stored helper events sent with this token. */
  events: number
  /** The shared HELPER_TOKEN env var: not revocable from the UI. */
  legacy: boolean
}

export type AdminState =
  | { configured: false }
  | { configured: true; authed: false }
  | { configured: true; authed: true; tokens: AdminToken[] }

export const getAdminState = createServerFn({ method: 'GET' }).handler(async (): Promise<AdminState> => {
  if (!adminConfigured()) return { configured: false }
  if (!isAdmin()) return { configured: true, authed: false }
  const counts = new Map<string, number>()
  for (const e of await allEvents()) {
    const id = e.tokenId ?? LEGACY_TOKEN_ID
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  const legacy = legacyToken()
  const tokens: AdminToken[] = (await listTokens())
    .map((t) => ({ ...t, events: counts.get(t.id) ?? 0, legacy: false }))
    .sort((a, b) => Number(!!a.revokedAt) - Number(!!b.revokedAt) || (b.createdAt ?? 0) - (a.createdAt ?? 0))
  const legacyEvents = counts.get(LEGACY_TOKEN_ID) ?? 0
  if (legacy.configured || legacyEvents)
    tokens.push({
      id: LEGACY_TOKEN_ID,
      name: 'Shared token (HELPER_TOKEN)',
      hint: null,
      createdAt: null,
      lastUsedAt: legacy.lastUsedAt,
      revokedAt: legacy.configured ? null : 0,
      events: legacyEvents,
      legacy: true,
    })
  return { configured: true, authed: true, tokens }
})

// Slows password guessing; the ADMIN_TOKEN should also be long and random.
let lastFailure = 0

export const adminLogin = createServerFn({ method: 'POST' })
  .validator((data: { password: string }) => ({ password: String(data.password ?? '') }))
  .handler(async ({ data }) => {
    const wait = Math.max(0, lastFailure + 1_000 - Date.now())
    if (wait) await Bun.sleep(wait)
    if (!checkPassword(data.password)) {
      lastFailure = Date.now()
      await Bun.sleep(500)
      return { ok: false as const }
    }
    startSession()
    return { ok: true as const }
  })

export const adminLogout = createServerFn({ method: 'POST' }).handler(async () => {
  endSession()
  return { ok: true }
})

export const createHelperToken = createServerFn({ method: 'POST' })
  .validator((data: { name: string }) => ({ name: String(data.name ?? '') }))
  .handler(async ({ data }) => {
    requireAdmin()
    const { token, info } = await mintToken(data.name)
    return { token, name: info.name }
  })

export const revokeHelperToken = createServerFn({ method: 'POST' })
  .validator((data: { id: string; purge: boolean }) => ({ id: String(data.id ?? ''), purge: data.purge === true }))
  .handler(async ({ data }) => {
    requireAdmin()
    if (data.id === LEGACY_TOKEN_ID) throw new Error('The shared token is set by HELPER_TOKEN on the server.')
    await revokeToken(data.id)
    const removed = data.purge ? await removeEventsByToken(data.id) : 0
    return { removed }
  })

/** Deletes a token's stored events (also works for the shared token). */
export const purgeTokenEvents = createServerFn({ method: 'POST' })
  .validator((data: { id: string }) => ({ id: String(data.id ?? '') }))
  .handler(async ({ data }) => {
    requireAdmin()
    return { removed: await removeEventsByToken(data.id) }
  })
