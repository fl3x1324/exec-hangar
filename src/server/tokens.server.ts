import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataDir } from './store.server'

/**
 * Per-player helper tokens, minted from the /admin page. Only a SHA-256 of each
 * token is stored (tokens are 192-bit random, so a plain hash is enough).
 * The shared HELPER_TOKEN env var keeps working as the 'legacy' token.
 */
export type TokenRecord = {
  id: string
  name: string
  /** sha256(token), hex */
  hash: string
  /** Last 4 characters, to tell tokens apart in the UI. */
  hint: string
  createdAt: number
  lastUsedAt: number | null
  revokedAt: number | null
}
export type TokenInfo = Omit<TokenRecord, 'hash'>

export const LEGACY_TOKEN_ID = 'legacy'
const TOUCH_PERSIST_MS = 5 * 60_000

const file = () => join(dataDir(), 'tokens.json')
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const info = ({ hash: _hash, ...rest }: TokenRecord): TokenInfo => rest

let cache: TokenRecord[] | null = null
let legacyLastUsedAt: number | null = null

async function load(): Promise<TokenRecord[]> {
  if (cache) return cache
  try {
    cache = JSON.parse(await readFile(file(), 'utf8')) as TokenRecord[]
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    cache = []
  }
  return cache
}

async function save(records: TokenRecord[]) {
  await mkdir(dataDir(), { recursive: true })
  const tmp = `${file()}.tmp`
  await writeFile(tmp, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 })
  await rename(tmp, file())
}

export async function listTokens(): Promise<TokenInfo[]> {
  return (await load()).map(info)
}

/** The shared env-var token, if configured (shown read-only in the admin page). */
export function legacyToken(): { configured: boolean; lastUsedAt: number | null } {
  return { configured: !!process.env.HELPER_TOKEN, lastUsedAt: legacyLastUsedAt }
}

/** Creates a token for a player. The plain token is returned once and never stored. */
export async function mintToken(name: string): Promise<{ token: string; info: TokenInfo }> {
  const clean = name.trim().replace(/\s+/g, ' ')
  if (!clean || clean.length > 40) throw new Error('Name must be 1–40 characters.')
  const records = await load()
  const token = `eh_${randomBytes(24).toString('base64url')}`
  const record: TokenRecord = {
    id: randomBytes(6).toString('hex'),
    name: clean,
    hash: sha256(token),
    hint: token.slice(-4),
    createdAt: Date.now(),
    lastUsedAt: null,
    revokedAt: null,
  }
  await save([...records, record])
  cache = [...records, record]
  return { token, info: info(record) }
}

export async function revokeToken(id: string): Promise<void> {
  const records = await load()
  const next = records.map((r) => (r.id === id && !r.revokedAt ? { ...r, revokedAt: Date.now() } : r))
  await save(next)
  cache = next
}

/** Token id for a valid, non-revoked bearer token; null otherwise. */
export async function verifyToken(raw: string): Promise<string | null> {
  if (!raw) return null
  const legacy = process.env.HELPER_TOKEN
  if (legacy) {
    const a = Buffer.from(sha256(raw))
    const b = Buffer.from(sha256(legacy))
    if (timingSafeEqual(a, b)) {
      legacyLastUsedAt = Date.now()
      return LEGACY_TOKEN_ID
    }
  }
  const hash = sha256(raw)
  const records = await load()
  const record = records.find((r) => r.hash === hash)
  if (!record || record.revokedAt) return null
  const now = Date.now()
  const persist = !record.lastUsedAt || now - record.lastUsedAt > TOUCH_PERSIST_MS
  record.lastUsedAt = now
  if (persist) await save(records).catch(() => {})
  return record.id
}

/** Whether any helper can authenticate at all (for a clearer 503). */
export async function ingestConfigured(): Promise<boolean> {
  return !!process.env.HELPER_TOKEN || (await load()).some((r) => !r.revokedAt)
}
