const BASE = '/api'

async function request(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
  }
  if (body !== undefined) opts.body = JSON.stringify(body)

  const res = await fetch(`${BASE}${path}`, opts)
  const data = await res.json().catch(() => ({}))

  if (!res.ok) throw Object.assign(new Error(data.error ?? 'Request failed'), { status: res.status, data })
  return data
}

export const api = {
  auth: {
    register:      (username, password) => request('POST', '/auth/register', { username, password }),
    login:         (username, password) => request('POST', '/auth/login', { username, password }),
    logout:        ()                   => request('POST', '/auth/logout'),
    me:            ()                   => request('GET',  '/auth/me'),
  },
  games: {
    list:           ()                              => request('GET',   '/games'),
    create:         (name, noPickVariant, testMode) => request('POST',  '/games', { name, no_pick_variant: noPickVariant, test_mode: testMode }),
    get:            (id)                            => request('GET',   `/games/${id}`),
    join:           (id)                            => request('POST',  `/games/${id}/join`),
    leave:          (id)                            => request('POST',  `/games/${id}/leave`),
    action:         (id, type, payload, actAs)      => request('POST',  `/games/${id}/action`, { type, payload, ...(actAs ? { act_as: actAs } : {}) }),
    updateSettings: (id, settings)                  => request('PATCH', `/games/${id}/settings`, settings),
  },
  admin: {
    listUsers:  ()          => request('GET',   '/admin/users'),
    getUser:    (id)        => request('GET',   `/admin/users/${id}`),
    updateUser: (id, patch) => request('PATCH', `/admin/users/${id}`, patch),
  },
}
