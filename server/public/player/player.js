(() => {
  const APP_VERSION = '1.0.0-web';
  const POLL_MS = 10_000;
  const HEARTBEAT_MS = 30_000;
  const PAIRING_MS = 3_000;
  const CACHE_NAME = 'hw-signage-media-v1';

  const imageView = document.getElementById('imageView');
  const videoView = document.getElementById('videoView');
  const waitingPanel = document.getElementById('waitingPanel');
  const waitingText = document.getElementById('waitingText');
  const pairingPanel = document.getElementById('pairingPanel');
  const pairingCodeEl = document.getElementById('pairingCode');
  const debugPanel = document.getElementById('debugPanel');
  const debugText = document.getElementById('debugText');

  const store = {
    get(key, fallback = null) {
      try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : v;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* ignore quota */
      }
    },
  };

  let deviceId = store.get('deviceId');
  let pairingCode = store.get('pairingCode');
  let contentVersion = Number(store.get('contentVersion', '-1'));
  let cachedType = store.get('cachedType');
  let cachedObjectUrl = null;
  let networkOk = false;
  let wakeLock = null;
  let tapCount = 0;
  let tapTimer = null;

  function apiUrl(path) {
    // Same origin on Railway (or local server)
    return path.startsWith('http') ? path : path;
  }

  async function jsonFetch(path, options = {}) {
    const res = await fetch(apiUrl(path), {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const err = new Error(data?.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function showWaiting(msg) {
    waitingPanel.hidden = false;
    pairingPanel.hidden = true;
    imageView.hidden = true;
    videoView.hidden = true;
    stopVideo();
    if (msg) waitingText.textContent = msg;
  }

  function showPairing() {
    waitingPanel.hidden = true;
    pairingPanel.hidden = false;
    imageView.hidden = true;
    videoView.hidden = true;
    stopVideo();
    pairingCodeEl.textContent = pairingCode || '---- ----';
  }

  function stopVideo() {
    try {
      videoView.pause();
      videoView.removeAttribute('src');
      videoView.load();
    } catch {
      /* ignore */
    }
  }

  function displayMedia(objectUrl, type) {
    waitingPanel.hidden = true;
    pairingPanel.hidden = true;
    if (cachedObjectUrl && cachedObjectUrl !== objectUrl) {
      try {
        URL.revokeObjectURL(cachedObjectUrl);
      } catch {
        /* ignore */
      }
    }
    cachedObjectUrl = objectUrl;
    cachedType = type;
    store.set('cachedType', type);

    if (type === 'video') {
      imageView.hidden = true;
      videoView.hidden = false;
      videoView.src = objectUrl;
      videoView.muted = true;
      videoView.loop = true;
      videoView.play().catch(() => {
        /* autoplay may require a gesture on some browsers */
      });
    } else {
      stopVideo();
      videoView.hidden = true;
      imageView.hidden = false;
      imageView.src = objectUrl;
    }
  }

  async function cachePut(version, type, blob) {
    const cache = await caches.open(CACHE_NAME);
    const key = `/__cached__/v${version}`;
    const headers = new Headers({
      'Content-Type': type === 'video' ? 'video/mp4' : 'image/jpeg',
      'X-Signage-Type': type,
      'X-Signage-Version': String(version),
    });
    await cache.put(key, new Response(blob, { headers }));
    // Drop older entries
    const keys = await cache.keys();
    await Promise.all(
      keys
        .filter((r) => r.url.includes('/__cached__/') && !r.url.endsWith(`/v${version}`))
        .map((r) => cache.delete(r))
    );
  }

  async function cacheGetLatest() {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    const cached = keys.filter((r) => r.url.includes('/__cached__/'));
    if (!cached.length) return null;
    cached.sort((a, b) => a.url.localeCompare(b.url));
    const req = cached[cached.length - 1];
    const res = await cache.match(req);
    if (!res) return null;
    const blob = await res.blob();
    const type = res.headers.get('X-Signage-Type') || (blob.type.startsWith('video') ? 'video' : 'image');
    const version = Number(res.headers.get('X-Signage-Version') || '-1');
    return { blob, type, version, objectUrl: URL.createObjectURL(blob) };
  }

  async function restoreCache() {
    try {
      const hit = await cacheGetLatest();
      if (hit) {
        if (hit.version >= 0) {
          contentVersion = hit.version;
          store.set('contentVersion', String(contentVersion));
        }
        displayMedia(hit.objectUrl, hit.type);
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  async function ensurePairingCode() {
    if (pairingCode) {
      pairingCodeEl.textContent = pairingCode;
      return;
    }
    try {
      const data = await jsonFetch('/api/devices/pairing-code', {
        method: 'POST',
        body: '{}',
      });
      pairingCode = data.pairingCode;
      store.set('pairingCode', pairingCode);
      pairingCodeEl.textContent = pairingCode;
      networkOk = true;
    } catch {
      networkOk = false;
    }
  }

  async function checkPairing() {
    if (deviceId) {
      startPlayerLoops();
      return;
    }
    if (!pairingCode) {
      await ensurePairingCode();
      return;
    }
    try {
      const data = await jsonFetch(`/api/devices/pairing-status/${encodeURIComponent(pairingCode)}`);
      networkOk = true;
      if (data.status === 'registered' && data.deviceId) {
        deviceId = data.deviceId;
        store.set('deviceId', deviceId);
        startPlayerLoops();
      }
    } catch {
      networkOk = false;
      if (!pairingCode) await ensurePairingCode();
    }
  }

  async function pollOnce() {
    if (!deviceId) return;
    try {
      const current = await jsonFetch('/api/screen/current');
      networkOk = true;
      if (!current.url || !current.type) return;
      if (current.version === contentVersion) return;

      const res = await fetch(apiUrl(current.url));
      if (!res.ok) return;
      const blob = await res.blob();
      if (!blob || blob.size <= 0) return;

      await cachePut(current.version, current.type, blob);
      contentVersion = current.version;
      store.set('contentVersion', String(contentVersion));
      store.set('lastUpdate', new Date().toISOString());

      const objectUrl = URL.createObjectURL(blob);
      displayMedia(objectUrl, current.type);
    } catch {
      networkOk = false;
      // Keep showing cached content silently
    }
  }

  async function sendHeartbeat() {
    if (!deviceId) return;
    try {
      await jsonFetch('/api/screen/heartbeat', {
        method: 'POST',
        body: JSON.stringify({
          deviceId,
          currentVersion: Math.max(contentVersion, 0),
          appVersion: APP_VERSION,
        }),
      });
      store.set('lastHeartbeat', new Date().toISOString());
      networkOk = true;
    } catch {
      networkOk = false;
    }
  }

  let pollTimer = null;
  let hbTimer = null;
  let pairTimer = null;

  function clearTimers() {
    if (pollTimer) clearInterval(pollTimer);
    if (hbTimer) clearInterval(hbTimer);
    if (pairTimer) clearInterval(pairTimer);
    pollTimer = hbTimer = pairTimer = null;
  }

  function startPlayerLoops() {
    clearTimers();
    pairingPanel.hidden = true;
    pollOnce();
    sendHeartbeat();
    pollTimer = setInterval(pollOnce, POLL_MS);
    hbTimer = setInterval(sendHeartbeat, HEARTBEAT_MS);
  }

  function startPairingLoop() {
    clearTimers();
    showPairing();
    ensurePairingCode();
    pairTimer = setInterval(checkPairing, PAIRING_MS);
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => {
          wakeLock = null;
        });
      }
    } catch {
      /* unsupported / denied */
    }
  }

  function enterFullscreen() {
    const el = document.documentElement;
    const req =
      el.requestFullscreen ||
      el.webkitRequestFullscreen ||
      el.msRequestFullscreen;
    if (req) {
      req.call(el).catch(() => {});
    }
  }

  function toggleDebug() {
    if (!debugPanel.hidden) {
      debugPanel.hidden = true;
      return;
    }
    debugText.textContent = [
      'H&W Signage Web Player',
      `Device ID: ${deviceId || '(not registered)'}`,
      `App version: ${APP_VERSION}`,
      `Server: ${location.origin}`,
      `Signage version: ${contentVersion}`,
      `Cached type: ${cachedType || '—'}`,
      `Last update: ${store.get('lastUpdate') || '—'}`,
      `Last heartbeat: ${store.get('lastHeartbeat') || '—'}`,
      `Network: ${networkOk ? 'OK' : 'Unavailable (using cache)'}`,
      '',
      'Tap 3× or Esc to close',
    ].join('\n');
    debugPanel.hidden = false;
  }

  document.addEventListener('click', () => {
    enterFullscreen();
    requestWakeLock();
    tapCount += 1;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => {
      tapCount = 0;
    }, 800);
    if (tapCount >= 3) {
      tapCount = 0;
      toggleDebug();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !debugPanel.hidden) {
      debugPanel.hidden = true;
    }
    if (e.key === 'f' || e.key === 'F') enterFullscreen();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
  });

  async function boot() {
    const hasCache = await restoreCache();
    if (!hasCache) showWaiting('Waiting for signage…');

    if (!deviceId) {
      startPairingLoop();
    } else {
      startPlayerLoops();
    }
    requestWakeLock();
  }

  boot();
})();
