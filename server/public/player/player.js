(() => {
  const APP_VERSION = '1.2.1-web';
  const POLL_MS = 10_000;
  const HEARTBEAT_MS = 30_000;
  const PAIRING_MS = 3_000;
  const WAKE_LOCK_MS = 30_000;
  const PAGE_RELOAD_MS = 60_000;
  const CACHE_NAME = 'hw-signage-media-v1';
  const DEFAULT_IMAGE_SEC = 10;
  const DEFAULT_VIDEO_SEC = 30;

  const imageView = document.getElementById('imageView');
  const videoView = document.getElementById('videoView');
  const bgImage = document.getElementById('bgImage');
  const bgVideo = document.getElementById('bgVideo');
  const bgCanvas = document.getElementById('bgCanvas');
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
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
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
  let playlistItems = [];
  let playlistIndex = 0;
  let playMode = 'single';
  let slideTimer = null;
  let bgRaf = 0;
  let useCanvasBg = true;
  let reloadTimer = null;
  let wakeLockTimer = null;

  function setVisible(el, visible) {
    if (!el) return;
    el.hidden = !visible;
    el.style.display = visible ? '' : 'none';
  }

  function isRegistered() {
    return !!(deviceId && String(deviceId).trim());
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
    const imgOk =
      imageView.style.display !== 'none' && !imageView.hidden && !!imageView.getAttribute('src');
    const vidOk =
      videoView.style.display !== 'none' && !videoView.hidden && !!videoView.getAttribute('src');
    return imgOk || vidOk;
  }

  /** Unregistered TVs must always see the DEVICE CODE on top. */
  function updateChrome() {
    if (!isRegistered()) {
      setVisible(waitingPanel, false);
      setVisible(pairingPanel, true);
      pairingCodeEl.textContent = pairingCode || 'Getting code…';
      return;
    }
    setVisible(pairingPanel, false);
    if (!mediaIsVisible()) {
      setVisible(waitingPanel, true);
      if (waitingText) waitingText.textContent = 'Waiting for signage…';
    } else {
      setVisible(waitingPanel, false);
    }
  }

  function showWaiting(msg) {
    if (isRegistered() && !mediaIsVisible()) {
      setVisible(pairingPanel, false);
      setVisible(waitingPanel, true);
      if (msg) waitingText.textContent = msg;
    }
  }

  function stopBgCanvas() {
    if (bgRaf) {
      cancelAnimationFrame(bgRaf);
      bgRaf = 0;
    }
    setVisible(bgCanvas, false);
  }

  function drawCoverBlur(ctx, source, cw, ch) {
    const sw = source.videoWidth || source.naturalWidth || source.width;
    const sh = source.videoHeight || source.naturalHeight || source.height;
    if (!sw || !sh) return false;
    const scale = Math.max(cw / sw, ch / sh) * 1.2;
    const dw = sw * scale;
    const dh = sh * scale;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;
    try {
      ctx.filter = 'blur(32px) saturate(1.2)';
    } catch {
      /* older browsers */
    }
    ctx.drawImage(source, dx, dy, dw, dh);
    try {
      ctx.filter = 'none';
    } catch {
      /* ignore */
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.fillRect(0, 0, cw, ch);
    return true;
  }

  function startBgCanvasFromVideo(video) {
    stopBgCanvas();
    if (!bgCanvas || !video) return;
    setVisible(bgCanvas, true);
    setVisible(bgVideo, false);
    setVisible(bgImage, false);
    const ctx = bgCanvas.getContext('2d', { alpha: false });
    if (!ctx) {
      useCanvasBg = false;
      setVisible(bgCanvas, false);
      setVisible(bgVideo, true);
      bgVideo.src = video.src || cachedObjectUrl || '';
      bgVideo.muted = true;
      bgVideo.loop = true;
      bgVideo.play().catch(() => {});
      return;
    }

    const tick = () => {
      bgRaf = 0;
      if (!showingMedia || cachedType !== 'video') return;
      const cw = Math.max(1, window.innerWidth || document.documentElement.clientWidth);
      const ch = Math.max(1, window.innerHeight || document.documentElement.clientHeight);
      if (bgCanvas.width !== cw) bgCanvas.width = cw;
      if (bgCanvas.height !== ch) bgCanvas.height = ch;
      try {
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, cw, ch);
        if (video.readyState >= 2) {
          drawCoverBlur(ctx, video, cw, ch);
        }
      } catch (err) {
        noteError(err, 'bgCanvas');
      }
      bgRaf = requestAnimationFrame(tick);
    };
    bgRaf = requestAnimationFrame(tick);
  }

  function stopVideo() {
    stopBgCanvas();
    try {
      videoView.pause();
      videoView.removeAttribute('src');
      videoView.load();
    } catch {
      /* ignore */
    }
    try {
      bgVideo.pause();
      bgVideo.removeAttribute('src');
      bgVideo.load();
    } catch {
      /* ignore */
    }
  }

  function syncBackground(url, type) {
    if (type === 'video') {
      setVisible(bgImage, false);
      // Prefer canvas blur drawn from the foreground video (works on TVs that ignore CSS filter on <video>)
      if (useCanvasBg && bgCanvas) {
        setVisible(bgVideo, false);
        // canvas starts after foreground video has a frame
      } else {
        stopBgCanvas();
        setVisible(bgVideo, true);
        bgVideo.src = url;
        bgVideo.muted = true;
        bgVideo.defaultMuted = true;
        bgVideo.volume = 0;
        bgVideo.loop = true;
        bgVideo.playsInline = true;
        bgVideo.setAttribute('playsinline', '');
        bgVideo.setAttribute('webkit-playsinline', '');
        const playBg = () => {
          bgVideo.play().catch(() => {});
          try {
            if (Math.abs((bgVideo.currentTime || 0) - (videoView.currentTime || 0)) > 0.35) {
              bgVideo.currentTime = videoView.currentTime || 0;
            }
          } catch {
            /* ignore seek errors */
          }
        };
        bgVideo.onloadeddata = playBg;
        playBg();
      }
    } else {
      stopBgCanvas();
      try {
        bgVideo.pause();
        bgVideo.removeAttribute('src');
        bgVideo.load();
      } catch {
        /* ignore */
      }
      setVisible(bgVideo, false);
      setVisible(bgImage, true);
      bgImage.src = url;
    }
  }

  function displayMedia(url, type) {
    // Never hide pairing for unregistered devices — keep code on top
    if (isRegistered()) {
      setVisible(waitingPanel, false);
      setVisible(pairingPanel, false);
    } else {
      setVisible(waitingPanel, false);
      setVisible(pairingPanel, true);
      pairingCodeEl.textContent = pairingCode || 'Getting code…';
    }

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
      videoView.defaultMuted = true;
      videoView.volume = 0;
      videoView.loop = true;
      videoView.playsInline = true;
      videoView.setAttribute('playsinline', '');
      videoView.setAttribute('webkit-playsinline', '');

      const onFrame = () => {
        syncBackground(url, 'video');
        if (useCanvasBg) startBgCanvasFromVideo(videoView);
      };
      videoView.onloadeddata = onFrame;
      videoView.onplaying = () => {
        if (useCanvasBg) startBgCanvasFromVideo(videoView);
        if (!useCanvasBg && bgVideo && !bgVideo.paused) {
          try {
            bgVideo.currentTime = videoView.currentTime || 0;
          } catch {
            /* ignore */
          }
        }
      };
      videoView.play().catch((err) => noteError(err, 'video.play'));
      // Kick background immediately (canvas waits for frames)
      syncBackground(url, 'video');
    } else {
      stopVideo();
      setVisible(videoView, false);
      setVisible(imageView, true);
      syncBackground(url, 'image');
      imageView.src = url;
      imageView.onload = () => {
        showingMedia = true;
      };
      imageView.onerror = () => {
        noteError(new Error('image failed to load'), 'image');
        if (url.startsWith('blob:')) showingMedia = false;
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
    if (isRegistered()) return;
    if (pairingCode) {
      pairingCodeEl.textContent = pairingCode;
      updateChrome();
      return;
    }
    pairingCodeEl.textContent = 'Getting code…';
    updateChrome();
    try {
      const data = await jsonFetch('/api/devices/pairing-code', {
        method: 'POST',
        body: '{}',
      });
      pairingCode = data.pairingCode;
      store.set('pairingCode', pairingCode);
      pairingCodeEl.textContent = pairingCode;
      networkOk = true;
      updateChrome();
    } catch (err) {
      networkOk = false;
      noteError(err, 'pairing-code');
      pairingCodeEl.textContent = 'Retrying…';
      updateChrome();
    }
  }

  async function checkPairing() {
    if (isRegistered()) {
      updateChrome();
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
        store.remove('pairingCode');
        pairingCode = null;
        updateChrome();
        sendHeartbeat();
      } else {
        updateChrome();
      }
    } catch (err) {
      networkOk = false;
      noteError(err, 'pairing-status');
      if (!pairingCode) await ensurePairingCode();
      else updateChrome();
    }
  }

  function stopSlideTimer() {
    if (slideTimer) {
      clearTimeout(slideTimer);
      slideTimer = null;
    }
  }

  function itemDuration(item) {
    if (item.durationSec != null && Number(item.durationSec) > 0) {
      return Number(item.durationSec) * 1000;
    }
    return (item.type === 'video' ? DEFAULT_VIDEO_SEC : DEFAULT_IMAGE_SEC) * 1000;
  }

  async function showPlaylistItem(index) {
    if (!playlistItems.length) return;
    playlistIndex = ((index % playlistItems.length) + playlistItems.length) % playlistItems.length;
    store.set('playlistIndex', String(playlistIndex));
    store.set('playlistItemStartedAt', String(Date.now()));
    const item = playlistItems[playlistIndex];
    const absoluteUrl = new URL(item.url, location.origin).href;

    try {
      const res = await fetch(absoluteUrl);
      if (!res.ok) throw new Error(`download HTTP ${res.status}`);
      const blob = await res.blob();
      if (!blob || blob.size <= 0) throw new Error('empty download');
      const objectUrl = URL.createObjectURL(blob);
      displayMedia(objectUrl, item.type);
      try {
        await cachePut(`${contentVersion}-${playlistIndex}`, item.type, blob);
      } catch (err) {
        noteError(err, 'cachePut');
      }
    } catch (err) {
      noteError(err, 'playlist-item');
      displayMedia(absoluteUrl, item.type);
    }

    updateChrome();

    const shouldRotate = playMode === 'playlist' || playlistItems.length > 1;
    if (!shouldRotate) {
      // Classic single publish: hold until version changes
      stopSlideTimer();
      videoView.onended = null;
      return;
    }

    stopSlideTimer();
    const ms = itemDuration(item);
    if (item.type === 'video') {
      videoView.onended = () => {
        videoView.onended = null;
        // If video ends before duration, wait remaining or advance
        stopSlideTimer();
        showPlaylistItem(playlistIndex + 1);
      };
    } else {
      videoView.onended = null;
    }
    slideTimer = setTimeout(() => {
      videoView.onended = null;
      showPlaylistItem(playlistIndex + 1);
    }, ms);
  }

  function applyCurrentPayload(current) {
    const items =
      Array.isArray(current.items) && current.items.length
        ? current.items
        : current.url
          ? [
              {
                type: current.type,
                url: current.url,
                durationSec: current.durationSec ?? null,
                filename: current.filename,
              },
            ]
          : [];

    if (!items.length) {
      stopSlideTimer();
      playlistItems = [];
      if (!mediaIsVisible()) showWaiting('Waiting for signage…');
      updateChrome();
      return;
    }

    playMode = current.mode === 'playlist' || items.length > 1 ? 'playlist' : 'single';
    playlistItems = items;

    const savedVersion = Number(store.get('contentVersion', '-1'));
    const savedIndex = Number(store.get('playlistIndex', '0'));
    let startIndex = 0;
    if (
      Number(current.version) === savedVersion &&
      Number.isFinite(savedIndex) &&
      savedIndex >= 0 &&
      savedIndex < items.length
    ) {
      startIndex = savedIndex;
    }

    playlistIndex = startIndex;
    contentVersion = current.version;
    store.set('contentVersion', String(contentVersion));
    store.set('playlistIndex', String(startIndex));
    store.set('lastUpdate', new Date().toISOString());
    showPlaylistItem(startIndex);
  }

  async function pollOnce() {
    try {
      const current = await jsonFetch('/api/screen/current');
      networkOk = true;

      const hasContent =
        (Array.isArray(current.items) && current.items.length > 0) ||
        (current.url && current.type);

      if (!hasContent) {
        stopSlideTimer();
        if (!mediaIsVisible()) showWaiting('Waiting for signage…');
        updateChrome();
        return;
      }

      const sameVersion = current.version === contentVersion;
      if (sameVersion && mediaIsVisible() && playlistItems.length) {
        updateChrome();
        return;
      }

      applyCurrentPayload(current);
      updateChrome();
    } catch (err) {
      networkOk = false;
      noteError(err, 'poll');
      updateChrome();
    }
  }

  async function sendHeartbeat() {
    if (!isRegistered()) return;
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

  function resetPairing() {
    deviceId = null;
    pairingCode = null;
    store.remove('deviceId');
    store.remove('pairingCode');
    updateChrome();
    ensurePairingCode();
  }

  let pollTimer = null;
  let hbTimer = null;
  let pairTimer = null;

  function clearTimers() {
    if (pollTimer) clearInterval(pollTimer);
    if (hbTimer) clearInterval(hbTimer);
    if (pairTimer) clearInterval(pairTimer);
    if (wakeLockTimer) clearInterval(wakeLockTimer);
    stopSlideTimer();
    pollTimer = hbTimer = pairTimer = wakeLockTimer = null;
  }

  function schedulePageReload() {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      location.reload();
    }, PAGE_RELOAD_MS);
  }

  function startLoops() {
    clearTimers();
    updateChrome();
    if (!isRegistered()) {
      ensurePairingCode();
    }
    pollOnce();
    sendHeartbeat();
    requestWakeLock();
    pollTimer = setInterval(pollOnce, POLL_MS);
    hbTimer = setInterval(sendHeartbeat, HEARTBEAT_MS);
    pairTimer = setInterval(checkPairing, PAIRING_MS);
    wakeLockTimer = setInterval(() => {
      requestWakeLock();
    }, WAKE_LOCK_MS);
    schedulePageReload();
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        if (wakeLock) {
          try {
            await wakeLock.release();
          } catch {
            /* ignore */
          }
          wakeLock = null;
        }
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
    debugText.innerHTML = '';
    const pre = document.createElement('pre');
    pre.textContent = [
      'H&W Signage Web Player',
      `Device ID: ${deviceId || '(not registered)'}`,
      `Pairing code: ${pairingCode || '—'}`,
      `App version: ${APP_VERSION}`,
      `Server: ${location.origin}`,
      `Signage version: ${contentVersion}`,
      `Mode: ${playMode} (${playlistItems.length} item(s), index ${playlistIndex})`,
      `Showing media: ${mediaIsVisible()}`,
      `Cached type: ${cachedType || '—'}`,
      `Last update: ${store.get('lastUpdate') || '—'}`,
      `Last heartbeat: ${store.get('lastHeartbeat') || '—'}`,
      `Network: ${networkOk ? 'OK' : 'Unavailable (using cache)'}`,
      `Last error: ${lastError || '—'}`,
      '',
      'Tap 3× or Esc to close',
    ].join('\n');
    debugText.appendChild(pre);

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.textContent = 'Reset pairing (new device code)';
    resetBtn.style.cssText =
      'margin-top:1.25rem;padding:0.85rem 1.25rem;font-size:1.1rem;font-weight:700;cursor:pointer;background:#1B5E3B;color:#fff;border:none;border-radius:8px;';
    resetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      resetPairing();
      setVisible(debugPanel, false);
    });
    debugText.appendChild(resetBtn);

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Use Reset if you need a new code for Screens → Add Screen';
    debugText.appendChild(hint);

    setVisible(debugPanel, true);
  }

  document.addEventListener('click', (e) => {
    if (e.target && (e.target.closest('button') || e.target.closest('#debugPanel'))) {
      return;
    }
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
      schedulePageReload();
      pollOnce();
      if (!isRegistered()) ensurePairingCode();
    }
  });

  window.addEventListener('pagehide', () => {
    if (reloadTimer) {
      clearTimeout(reloadTimer);
      reloadTimer = null;
    }
  });

  async function boot() {
    setVisible(debugPanel, false);
    updateChrome();
    await restoreCache();
    startLoops();
    requestWakeLock();
    schedulePageReload();
  }

  boot();
})();
