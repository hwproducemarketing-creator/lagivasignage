const API_BASE = '';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  });

  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text || 'Unexpected response' };
  }

  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  login: (username, password) =>
    request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request('/api/auth/me'),
  status: () => request('/api/admin/status'),
  media: () => request('/api/media'),
  upload: (formData) =>
    request('/api/media/upload', { method: 'POST', body: formData, headers: {} }),
  deleteMedia: (id) => request(`/api/media/${id}`, { method: 'DELETE' }),
  setDefault: (id) => request(`/api/media/${id}/default`, { method: 'POST' }),
  publish: (mediaId) =>
    request('/api/admin/publish', {
      method: 'POST',
      body: JSON.stringify({ mediaId }),
    }),
  devices: () => request('/api/devices'),
  registerDevice: (pairingCode, name) =>
    request('/api/devices/register', {
      method: 'POST',
      body: JSON.stringify({ pairingCode, name }),
    }),
  renameDevice: (id, name) =>
    request(`/api/devices/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  deleteDevice: (id) => request(`/api/devices/${id}`, { method: 'DELETE' }),
  promotions: () => request('/api/promotions'),
  createPromotion: (formData) =>
    request('/api/promotions', { method: 'POST', body: formData, headers: {} }),
  deletePromotion: (id) => request(`/api/promotions/${id}`, { method: 'DELETE' }),
  schedules: () => request('/api/schedules'),
  createSchedule: (body) =>
    request('/api/schedules', { method: 'POST', body: JSON.stringify(body) }),
  deleteSchedule: (id) => request(`/api/schedules/${id}`, { method: 'DELETE' }),
  settings: () => request('/api/settings'),
  updateSettings: (body) =>
    request('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),
  activity: () => request('/api/activity'),
  playlists: () => request('/api/playlists'),
  createPlaylist: (body) =>
    request('/api/playlists', { method: 'POST', body: JSON.stringify(body) }),
  updatePlaylist: (id, body) =>
    request(`/api/playlists/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deletePlaylist: (id) => request(`/api/playlists/${id}`, { method: 'DELETE' }),
  publishPlaylist: (playlistId) =>
    request(`/api/playlists/${playlistId}/publish`, { method: 'POST', body: '{}' }),
};

export function mediaUrl(url) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  return url;
}

export function formatBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatRelative(iso) {
  if (!iso) return 'Never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec} second${sec === 1 ? '' : 's'} ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const days = Math.floor(hr / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}
