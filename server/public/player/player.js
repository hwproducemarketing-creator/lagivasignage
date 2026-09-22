(() => {
  const APP_VERSION = '1.0.1-web';
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
  let showingMedia = false;
  let networkOk = false;
  let lastError = '';
  let wakeLock = null;
  let tapCount = 0;
  let tapTimer = null;

  function setVisible(el, visible) {
    if (!el) return;
    el.hidden = !visible;
    el.style.display = visible ? '' : 'none';
  }

  function apiUrl(path) {
    if (!path) return path;
    if (path.startsWith('http')) return path;
    return path;
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

  function noteError(err, context) {
    const msg = `${context}: ${err && err.message ? err.message : String(err)}`;
    lastError = `${new Date().toISOString()} ${msg}`;
    console.warn('[hw-signage]', msg, err);
  }

  function mediaIsVisible() {
    if (showingMedia && cachedObjectUrl) return true;
    const imgOk = imageView.style.display !== 'none' && !imageView.hidden && !!imageView.getAttribute('src');
    const vidOk = videoView.style.display !== 'none' && !videoView.hidden && !!videoView.getAttribute('src');
    return imgOk || vidOk;
  }

  function showWaiting(msg) {
    if (mediaIsVisible()) return;
    setVisible(waitingPanel, true);
    setVisible(pairingPanel, false);
    if (msg) waitingText.textContent = msg;
  }

  function showPairing() {
    // Don't cover content once media is on screen
    if (mediaIsVisible()) {
      setVisible(pairingPanel, false);
      return;
    }
    setVisible(waitingPanel, false);
    setVisible(pairingPanel, true);
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

  function displayMedia(url, type) {
    setVisible(waitingPanel, false);
    setVisible(pairingPanel, false);

    if (cachedObjectUrl && cachedObjectUrl !== url && cachedObjectUrl.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(cachedObjectUrl);
      } catch {
        /* ignore */
      }
    }
    cachedObjectUrl = url;
    cachedType = type;
    showingMedia = true;
    store.set('cachedType', type);

    if (type === 'video') {
      setVisible(imageView, false);
      setVisible(videoView, true);
      videoView.src = url;
      videoView.muted = true;
      videoView.loop = true;
      videoView.playsInline = true;
      videoView.play().catch((err) => noteError(err, 'video.play'));
    } else {
      stopVideo();
      setVisible(videoView, false);
      setVisible(imageView, true);
      imageView.src = url;
      imageView.onload = () => {
        showingMedia = true;
      };
      imageView.onerror = () => {
        noteError(new Error('image failed to load'), 'image');
        // Fallback: try absolute URL without blob
        if (url.startsWith('blob:')) {
          showingMedia = false;
        }
      };
    }
  }

  async function cachePut(version, type, blob) {
    if (!('caches' in window)) return;
    const cache = await caches.open(CACHE_NAME);
    const key = new Request(`${location.origin}/__cached__/v${version}`);
    const headers = new Headers({
      'Content-Type': type === 'video' ? 'video/mp4' : blob.type || 'image/jpeg',
      'X-Signage-Type': type,
      'X-Signage-Version': String(version),
    });
    await cache.put(key, new Response(blob.slice(0), { headers }));
    const keys = await cache.keys();
    await Promise.all(
      keys
        .filter((r) => r.url.includes('/__cached__/') && !r.url.endsWith(`/v${version}`))
        .map((r) => cache.delete(r))
    );
  }

  async function cacheGetLatest() {
    if (!('caches' in window)) return null;
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    const cached = keys.filter((r) => r.url.includes('/__cached__/'));
    if (!cached.length) return null;
    cached.sort((a, b) => a.url.localeCompare(b.url));
    const req = cached[cached.length - 1];
    const res = await cache.match(req);
    if (!res) return null;
    const blob = await res.blob();
    const type =
      res.headers.get('X-Signage-Type') || (blob.type.startsWith('video') ? 'video' : 'image');
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
    } catch (err) {
      noteError(err, 'restoreCache');
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
    } catch (err) {
      networkOk = false;
      noteError(err, 'pairing-code');
    }
  }

  async function checkPairing() {
    if (deviceId) return;
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
        setVisible(pairingPanel, false);
      }
    } catch (err) {
      networkOk = false;
      noteError(err, 'pairing-status');
      if (!pairingCode) await ensurePairingCode();
    }
  }

  async function pollOnce() {
    try {
      const current = await jsonFetch('/api/screen/current');
      networkOk = true;
      if (!current.url || !current.type) {
        if (!mediaIsVisible()) showWaiting('Waiting for signage…');
        return;
      }

      const sameVersion = current.version === contentVersion;
      if (sameVersion && mediaIsVisible()) return;

      // Prefer direct URL first (most reliable on TV browsers), then blob cache
      const absoluteUrl = new URL(current.url, location.origin).href;

      try {
        const res = await fetch(absoluteUrl);
        if (!res.ok) throw new Error(`download HTTP ${res.status}`);
        const blob = await res.blob();
        if (!blob || blob.size <= 0) throw new Error('empty download');

        // Show immediately — never block display on Cache API
        const objectUrl = URL.createObjectURL(blob);
        displayMedia(objectUrl, current.type);

        contentVersion = current.version;
        store.set('contentVersion', String(contentVersion));
        store.set('lastUpdate', new Date().toISOString());

        try {
          await cachePut(current.version, current.type, blob);
        } catch (err) {
          noteError(err, 'cachePut');
        }
      } catch (dlErr) {
        noteError(dlErr, 'download');
        // Last resort: point <img>/<video> at the server URL directly
        displayMedia(absoluteUrl, current.type);
        contentVersion = current.version;
        store.set('contentVersion', String(contentVersion));
        store.set('lastUpdate', new Date().toISOString());
      }
    } catch (err) {
      networkOk = false;
      noteError(err, 'poll');
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
    } catch (err) {
      networkOk = false;
      noteError(err, 'heartbeat');
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

  function startLoops() {
    clearTimers();
    pollOnce();
    sendHeartbeat();
    if (!deviceId) {
      ensurePairingCode().then(() => {
        if (!mediaIsVisible()) showPairing();
      });
    } else {
      setVisible(pairingPanel, false);
    }
    pollTimer = setInterval(pollOnce, POLL_MS);
    hbTimer = setInterval(sendHeartbeat, HEARTBEAT_MS);
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
    } catch (err) {
      noteError(err, 'wakeLock');
    }
  }

  function enterFullscreen() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (req) {
      req.call(el).catch((err) => noteError(err, 'fullscreen'));
    }
  }

  function toggleDebug() {
    if (debugPanel.style.display !== 'none' && !debugPanel.hidden) {
      setVisible(debugPanel, false);
      return;
    }
    debugText.textContent = [
      'H&W Signage Web Player',
      `Device ID: ${deviceId || '(not registered)'}`,
      `App version: ${APP_VERSION}`,
      `Server: ${location.origin}`,
      `Signage version: ${contentVersion}`,
      `Showing media: ${mediaIsVisible()}`,
      `Cached type: ${cachedType || '—'}`,
      `Last update: ${store.get('lastUpdate') || '—'}`,
      `Last heartbeat: ${store.get('lastHeartbeat') || '—'}`,
      `Network: ${networkOk ? 'OK' : 'Unavailable (using cache)'}`,
      `Last error: ${lastError || '—'}`,
      '',
      'Tap 3× or Esc to close',
    ].join('\n');
    setVisible(debugPanel, true);
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
    if (e.key === 'Escape') setVisible(debugPanel, false);
    if (e.key === 'f' || e.key === 'F') enterFullscreen();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      requestWakeLock();
      pollOnce();
    }
  });

  async function boot() {
    setVisible(debugPanel, false);
    const hasCache = await restoreCache();
    if (!hasCache) showWaiting('Waiting for signage…');
    startLoops();
    requestWakeLock();
  }

  boot();
})();
