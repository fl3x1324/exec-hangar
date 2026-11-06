import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { deleteCookie, getCookie, getRequestProtocol, setCookie } from '@tanstack/react-start/server'

/**
 * Admin sign-in for the /admin page. The password is the ADMIN_TOKEN env var;
 * a signed, HttpOnly cookie keeps the session. Changing ADMIN_TOKEN signs
 * everyone out.
 */
const COOKIE = 'eh_admin'
const SESSION_MS = 7 * 24 * 3_600_000

const secret = () => process.env.ADMIN_TOKEN ?? ''
export const adminConfigured = () => secret().length > 0

const sign = (exp: number) => createHmac('sha256', secret()).update(`exec-hangars-admin:${exp}`).digest('base64url')

function safeEqual(a: string, b: string) {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

export function checkPassword(password: string): boolean {
  return adminConfigured() && safeEqual(password, secret())
}

export function startSession() {
  const exp = Date.now() + SESSION_MS
  setCookie(COOKIE, `${exp}.${sign(exp)}`, {
    httpOnly: true,
    sameSite: 'strict',
    secure: getRequestProtocol() === 'https',
    path: '/',
    maxAge: SESSION_MS / 1000,
  })
}

export function endSession() {
  deleteCookie(COOKIE, { path: '/' })
}

export function isAdmin(): boolean {
  if (!adminConfigured()) return false
  const value = getCookie(COOKIE)
  if (!value) return false
  const [expStr, sig] = value.split('.')
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || exp < Date.now() || !sig) return false
  return safeEqual(sig, sign(exp))
}

export function requireAdmin() {
  if (!isAdmin()) throw new Error('Not signed in.')
}
