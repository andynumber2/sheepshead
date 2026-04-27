// Shared helpers for Pages Functions

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function err(message, status = 400) {
  return json({ error: message }, status)
}

// Retrieve the current user from the session cookie
export async function getUser(request, DB) {
  const cookie = request.headers.get('Cookie') ?? ''
  const match = cookie.match(/session=([^;]+)/)
  if (!match) return null

  const token = match[1]
  const now = new Date().toISOString()
  const row = await DB.prepare(
    `SELECT s.user_id, u.username, u.is_admin, u.is_bot
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`
  ).bind(token, now).first()

  return row ?? null
}

export async function requireUser(request, DB) {
  const user = await getUser(request, DB)
  if (!user) throw new AuthError('Not authenticated.')
  return user
}

export async function requireAdmin(request, DB) {
  const user = await requireUser(request, DB)
  if (!user.is_admin) throw new AuthError('Admin access required.')
  return user
}

export class AuthError extends Error {}

// PBKDF2-SHA256 password hashing via Web Crypto
export async function hashPassword(password, saltHex) {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  )
  const salt = hexToBytes(saltHex)
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 },
    keyMaterial,
    256
  )
  return bytesToHex(new Uint8Array(bits))
}

export function randomHex(bytes = 32) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)))
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

export function sessionCookie(token, expire = false) {
  if (expire) {
    return 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
  }
  const maxAge = 7 * 24 * 60 * 60
  return `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
}

/**
 * Returns [startISO, endISO] as UTC ISO strings bounding "today" in the given timezone.
 * Uses Intl for DST-correct boundary calculation.
 *
 * @param {string} timezone  IANA timezone name, e.g. 'America/Chicago'
 * @returns {[string, string]}
 */
export function getDayScoreRange(timezone) {
  const now = new Date()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now)
  const [y, m, d] = today.split('-').map(Number)
  const start = _localMidnightUTC(y, m, d,     timezone)
  const end   = _localMidnightUTC(y, m, d + 1, timezone)
  return [start.toISOString(), end.toISOString()]
}

function _localMidnightUTC(y, m, d, timezone) {
  // Noon UTC of the given date (JS handles day-overflow in Date.UTC, e.g. day=32 → next month)
  const noonRef = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  // What local time does noon UTC correspond to in the timezone?
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(noonRef)
  const h   = parseInt(parts.find(p => p.type === 'hour').value)
  const min = parseInt(parts.find(p => p.type === 'minute').value)
  const sec = parseInt(parts.find(p => p.type === 'second').value)
  // Local midnight = noonRef minus the local time at noonRef
  return new Date(noonRef.getTime() - (h * 3600 + min * 60 + sec) * 1000)
}

let cachedScoreTimezone = null

export async function getScoreTimezone(db) {
  if (cachedScoreTimezone) return cachedScoreTimezone
  const row = await db.prepare(
    "SELECT value FROM config WHERE key = 'score_timezone'"
  ).first()
  cachedScoreTimezone = row?.value ?? 'America/Chicago'
  return cachedScoreTimezone
}
