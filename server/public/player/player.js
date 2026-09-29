(() => {
  const APP_VERSION = '1.5.0-web';
  const POLL_MS = 10_000;
  const HEARTBEAT_MS = 30_000;
  const PAIRING_MS = 3_000;
  const WAKE_LOCK_MS = 30_000;
  const CACHE_NAME = 'hw-signage-media-v2';
  const DEFAULT_IMAGE_SEC = 10;
  const DEFAULT_VIDEO_SEC = 30;
  /** ~400 days — Pi Chromium often clears localStorage more aggressively than cookies */
  const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 400;
  const COOKIE_KEYS = new Set(['deviceId', 'pairingCode', 'deviceName', 'lastPairingCode']);

  const imageView = document.getElementById('imageView');
  const videoView = document.getElementById('videoView');
  const bgImage = document.getElementById('bgImage');
  const bgVideo = document.getElementById('bgVideo');
  const bgCanvas = document.getElementById('bgCanvas');
  const waitingPanel = document.getElementById('waitingPanel');
  const waitingText = document.getElementById('waitingText');
  const codeRail = document.getElementById('codeRail');
  const codeRailLabel = document.getElementById('codeRailLabel');
  const codeRailCode = document.getElementById('codeRailCode');
  const codeRailHint = document.getElementById('codeRailHint');
  const codeRailSub = document.getElementById('codeRailSub');
  const debugPanel = document.getElementById('debugPanel');
  const debugText = document.getElementById('debugText');

  function cookieName(key) {
    return `hw_${key}`;
  }

  function readCookie(name) {
    try {
      const parts = document.cookie ? document.cookie.split(';') : [];
      for (const part of parts) {
        const idx = part.indexOf('=');
        if (idx < 0) continue;
        const k = part.slice(0, idx).trim();
        if (k !== name) continue;
        return decodeURIComponent(part.slice(idx + 1).trim());
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function writeCookie(name, value) {
    try {
      document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE_SEC}; SameSite=Lax`;
    } catch {
      /* ignore */
    }
  }

  function clearCookie(name) {
    try {
      document.cookie = `${encodeURIComponent(name)}=; path=/; max-age=0; SameSite=Lax`;
    } catch {
      /* ignore */
    }
  }

  /** Dual-write identity to localStorage + cookie so Pi kiosk survives reloads. */
  const store = {
    get(key, fallback = null) {
      let fromLs = null;
      try {
        fromLs = localStorage.getItem(key);
      } catch {
        /* ignore */
      }
      if (fromLs != null && fromLs !== '') {
        if (COOKIE_KEYS.has(key)) writeCookie(cookieName(key), fromLs);
        return fromLs;
      }
      if (COOKIE_KEYS.has(key)) {
        const fromCookie = readCookie(cookieName(key));
        if (fromCookie != null && fromCookie !== '') {
          try {
            localStorage.setItem(key, fromCookie);
          } catch {
            /* ignore */
          }
          return fromCookie;
        }
      }
      return fallback;
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* ignore quota */
      }
      if (COOKIE_KEYS.has(key)) writeCookie(cookieName(key), value);
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
      if (COOKIE_KEYS.has(key)) clearCookie(cookieName(key));
    },
  };

  let deviceId = store.get('deviceId');
  let pairingCode = store.get('pairingCode');
  let lastPairingCode = store.get('lastPairingCode');
  let deviceName = store.get('deviceName');
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
  let wakeLockTimer = null;
  /** absoluteUrl → { objectUrl, type, blob } — in-memory for current session */
  const mediaMemory = new Map();
  /** absoluteUrl → timestamp when retry is allowed */
  const downloadBackoffUntil = new Map();
  let applyingContent = false;
  let advanceGeneration = 0;

  // Re-persist identity immediately on boot (heals missing localStorage or cookie)
  if (deviceId) store.set('deviceId', deviceId);
  if (pairingCode) store.set('pairingCode', pairingCode);
  if (lastPairingCode) store.set('lastPairingCode', lastPairingCode);
  if (deviceName) store.set('deviceName', deviceName);

  /** Format as XXXX-XXXX for admin Add Screen (never a deviceId hex suffix). */
  function formatPairCode(raw) {
    if (!raw) return null;
    const alnum = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (alnum.length >= 8) {
      return `${alnum.slice(0, 4)}-${alnum.slice(4, 8)}`;
    }
    return String(raw).toUpperCase().trim();
  }

  function displayPairCode() {
    return formatPairCode(pairingCode || lastPairingCode);
  }

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

  /** Always-visible side rail: DEVICE CODE = XXXX-XXXX. Zero interaction required. */
  function updateCodeRail() {
    document.body.classList.add('has-code-rail');
    if (!codeRail) return;

    const pair = displayPairCode();
    codeRail.classList.add('code-rail--setup');
    codeRail.classList.remove('code-rail--live', 'code-rail--id-only');
    if (codeRailLabel) codeRailLabel.textContent = 'DEVICE CODE';
    if (codeRailCode) codeRailCode.textContent = pair || 'Getting…';
    if (codeRailHint) {
      codeRailHint.textContent = 'Phone → Screens → Add Screen → enter this code';
    }
    if (codeRailSub) {
      codeRailSub.textContent = isRegistered() && deviceName ? deviceName : '';
    }
  }

  function updateChrome() {
    updateCodeRail();
    if (!isRegistered()) {
      // Code rail is the primary pairing UI for kiosk (no mouse)
      setVisible(waitingPanel, false);
      return;
    }
    if (!mediaIsVisible()) {
      setVisible(waitingPanel, true);
      if (waitingText) waitingText.textContent = 'Waiting for signage…';
    } else {
      setVisible(waitingPanel, false);
    }
  }

  function showWaiting(msg) {
    if (isRegistered() && !mediaIsVisible()) {
      setVisible(waitingPanel, true);
      if (msg) waitingText.textContent = msg;
    }
    updateCodeRail();
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

  function displayMedia(url, type, options = {}) {
    const loop = options.loop !== false;
    updateCodeRail();
    if (isRegistered()) setVisible(waitingPanel, false);

    if (cachedObjectUrl && cachedObjectUrl !== url && cachedObjectUrl.startsWith('blob:')) {
      // Don't revoke URLs still held in mediaMemory
      let stillUsed = false;
      for (const entry of mediaMemory.values()) {
        if (entry.objectUrl === cachedObjectUrl) {
          stillUsed = true;
          break;
        }
      }
      if (!stillUsed) {
        try {
          URL.revokeObjectURL(cachedObjectUrl);
        } catch {
          /* ignore */
        }
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
      videoView.loop = loop;
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

  function absoluteMediaUrl(url) {
    return new URL(url, location.origin).href;
  }

  function cacheRequestForUrl(url) {
    return new Request(`${location.origin}/__signage__/media?u=${encodeURIComponent(url)}`);
  }

  async function cachePutUrl(url, type, blob) {
    if (!('caches' in window)) return;
    const cache = await caches.open(CACHE_NAME);
    const headers = new Headers({
      'Content-Type': type === 'video' ? 'video/mp4' : blob.type || 'image/jpeg',
      'X-Signage-Type': type,
      'X-Signage-Url': url,
    });
    await cache.put(cacheRequestForUrl(url), new Response(blob.slice(0), { headers }));
  }

  async function cacheGetUrl(url) {
    if (!('caches' in window)) return null;
    const cache = await caches.open(CACHE_NAME);
    const res = await cache.match(cacheRequestForUrl(url));
    if (!res) return null;
    const blob = await res.blob();
    if (!blob || blob.size <= 0) return null;
    const type =
      res.headers.get('X-Signage-Type') || (blob.type.startsWith('video') ? 'video' : 'image');
    return { blob, type, objectUrl: URL.createObjectURL(blob) };
  }

  async function cacheGetAny() {
    if (!('caches' in window)) return null;
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    const ours = keys.filter((r) => r.url.includes('/__signage__/media'));
    if (!ours.length) {
      // Migrate: try legacy single-slot cache
      const legacy = keys.filter((r) => r.url.includes('/__cached__/'));
      if (!legacy.length) return null;
      legacy.sort((a, b) => a.url.localeCompare(b.url));
      const res = await cache.match(legacy[legacy.length - 1]);
      if (!res) return null;
      const blob = await res.blob();
      const type =
        res.headers.get('X-Signage-Type') || (blob.type.startsWith('video') ? 'video' : 'image');
      return { blob, type, objectUrl: URL.createObjectURL(blob) };
    }
    const res = await cache.match(ours[ours.length - 1]);
    if (!res) return null;
    const blob = await res.blob();
    const type =
      res.headers.get('X-Signage-Type') || (blob.type.startsWith('video') ? 'video' : 'image');
    return { blob, type, objectUrl: URL.createObjectURL(blob) };
  }

  function clearMediaMemory() {
    for (const entry of mediaMemory.values()) {
      try {
        URL.revokeObjectURL(entry.objectUrl);
      } catch {
        /* ignore */
      }
    }
    mediaMemory.clear();
  }

  /**
   * Resolve media from memory → Cache API → network (with backoff).
   * Never re-downloads a URL already in memory/cache until version change clears memory
   * (Cache API still serves without network).
   */
  async function resolveItemMedia(item, { allowNetwork = true } = {}) {
    const url = absoluteMediaUrl(item.url);
    const mem = mediaMemory.get(url);
    if (mem) return { url, objectUrl: mem.objectUrl, type: mem.type || item.type, source: 'memory' };

    try {
      const hit = await cacheGetUrl(url);
      if (hit) {
        mediaMemory.set(url, { objectUrl: hit.objectUrl, type: hit.type || item.type, blob: hit.blob });
        return { url, objectUrl: hit.objectUrl, type: hit.type || item.type, source: 'cache' };
      }
    } catch (err) {
      noteError(err, 'cacheGetUrl');
    }

    if (!allowNetwork) return null;

    const until = downloadBackoffUntil.get(url) || 0;
    if (Date.now() < until) return null;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`download HTTP ${res.status}`);
      const blob = await res.blob();
      if (!blob || blob.size <= 0) throw new Error('empty download');
      const objectUrl = URL.createObjectURL(blob);
      mediaMemory.set(url, { objectUrl, type: item.type, blob });
      downloadBackoffUntil.delete(url);
      try {
        await cachePutUrl(url, item.type, blob);
      } catch (err) {
        noteError(err, 'cachePutUrl');
      }
      return { url, objectUrl, type: item.type, source: 'network' };
    } catch (err) {
      noteError(err, 'resolveItemMedia');
      const prev = downloadBackoffUntil.get(url);
      const delay = prev && Date.now() < prev + 120_000 ? 120_000 : 20_000;
      downloadBackoffUntil.set(url, Date.now() + delay);
      return null;
    }
  }

  /** Sequential preload so slow Wi‑Fi isn't flooded with parallel MP4s. */
  async function preloadItems(items, { network = true } = {}) {
    for (const item of items) {
      await resolveItemMedia(item, { allowNetwork: network });
    }
  }

  async function restoreCache() {
    try {
      const hit = await cacheGetAny();
      if (hit) {
        displayMedia(hit.objectUrl, hit.type, { loop: true });
        return true;
      }
    } catch (err) {
      noteError(err, 'restoreCache');
    }
    return false;
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

  function scheduleAdvance(item, isMulti) {
    stopSlideTimer();
    if (!isMulti) {
      videoView.onended = null;
      return;
    }
    const gen = ++advanceGeneration;
    const ms = itemDuration(item);
    if (item.type === 'video') {
      videoView.onended = () => {
        if (gen !== advanceGeneration) return;
        videoView.onended = null;
        stopSlideTimer();
        showPlaylistItem(playlistIndex + 1);
      };
    } else {
      videoView.onended = null;
    }
    slideTimer = setTimeout(() => {
      if (gen !== advanceGeneration) return;
      videoView.onended = null;
      showPlaylistItem(playlistIndex + 1);
    }, ms);
  }

  async function showPlaylistItem(index) {
    if (!playlistItems.length) return;
    const n = playlistItems.length;
    const isMulti = playMode === 'playlist' || n > 1;
    let idx = ((index % n) + n) % n;

    // Prefer ready media; skip items still downloading (don't stall forever on one video)
    let media = null;
    for (let tried = 0; tried < n; tried += 1) {
      const candidate = playlistItems[idx];
      media = await resolveItemMedia(candidate, { allowNetwork: tried === 0 });
      if (media) break;
      if (!isMulti) break;
      idx = (idx + 1) % n;
    }

    // If nothing cached yet, try network for originally requested index once more
    if (!media) {
      media = await resolveItemMedia(playlistItems[((index % n) + n) % n], { allowNetwork: true });
      if (media) idx = ((index % n) + n) % n;
    }

    if (!media) {
      updateChrome();
      if (isMulti) {
        stopSlideTimer();
        slideTimer = setTimeout(() => showPlaylistItem(playlistIndex + 1), 8_000);
      }
      return;
    }

    playlistIndex = idx;
    store.set('playlistIndex', String(playlistIndex));
    store.set('playlistItemStartedAt', String(Date.now()));
    const item = playlistItems[playlistIndex];

    displayMedia(media.objectUrl, media.type || item.type, { loop: !isMulti });
    updateChrome();
    scheduleAdvance(item, isMulti);

    // Background: ensure next item is warm (and rest of playlist eventually)
    if (isMulti) {
      const next = playlistItems[(playlistIndex + 1) % n];
      resolveItemMedia(next, { allowNetwork: true }).catch(() => {});
    }
  }

  async function applyCurrentPayload(current) {
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

    const nextVersion = Number(current.version);
    const versionChanged = nextVersion !== contentVersion;
    playMode = current.mode === 'playlist' || items.length > 1 ? 'playlist' : 'single';
    playlistItems = items;

    const savedVersion = Number(store.get('contentVersion', '-1'));
    const savedIndex = Number(store.get('playlistIndex', '0'));
    let startIndex = 0;
    if (
      nextVersion === savedVersion &&
      Number.isFinite(savedIndex) &&
      savedIndex >= 0 &&
      savedIndex < items.length
    ) {
      startIndex = savedIndex;
    }

    if (versionChanged) {
      clearMediaMemory();
      downloadBackoffUntil.clear();
      if (!mediaIsVisible()) showWaiting('Loading signage…');
      // First item ASAP on slow Wi‑Fi; rest warm in background
      await resolveItemMedia(items[startIndex], { allowNetwork: true });
      const nextIdx = (startIndex + 1) % items.length;
      if (items.length > 1) {
        resolveItemMedia(items[nextIdx], { allowNetwork: true }).catch(() => {});
      }
    } else {
      // Warm cache from disk without forcing network
      await preloadItems(items, { network: false });
    }

    playlistIndex = startIndex;
    contentVersion = nextVersion;
    store.set('contentVersion', String(contentVersion));
    store.set('playlistIndex', String(startIndex));
    store.set('lastUpdate', new Date().toISOString());
    await showPlaylistItem(startIndex);

    // Keep downloading the rest in background if not all ready
    preloadItems(items, { network: true }).catch(() => {});
  }

  async function pollOnce() {
    if (applyingContent) return;
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
        // Metadata poll only — never re-download blobs when version unchanged
        updateChrome();
        return;
      }

      applyingContent = true;
      try {
        await applyCurrentPayload(current);
      } finally {
        applyingContent = false;
      }
      updateChrome();
    } catch (err) {
      networkOk = false;
      noteError(err, 'poll');
      updateChrome();
    }
  }

  function clearLocalIdentity() {
    deviceId = null;
    pairingCode = null;
    lastPairingCode = null;
    deviceName = null;
    store.remove('deviceId');
    store.remove('pairingCode');
    store.remove('deviceName');
    store.remove('lastPairingCode');
  }

  let pairingFetchPromise = null;

  /**
   * Kiosk (no mouse): always ensure a XXXX-XXXX DEVICE CODE is on the strip.
   * If pairingCode is missing, auto-clear stale deviceId and fetch a fresh code — no tap/Reset.
   */
  async function ensurePairingCode() {
    if (formatPairCode(pairingCode)) {
      updateChrome();
      return;
    }
    if (pairingFetchPromise) return pairingFetchPromise;

    pairingFetchPromise = (async () => {
      // pairingCode missing — cannot show a usable Add Screen code yet
      if (deviceId || lastPairingCode || deviceName) {
        clearLocalIdentity();
      }
      updateChrome();
      try {
        const data = await jsonFetch('/api/devices/pairing-code', {
          method: 'POST',
          body: '{}',
        });
        pairingCode = data.pairingCode;
        store.set('pairingCode', pairingCode);
        networkOk = true;
        updateChrome();
      } catch (err) {
        networkOk = false;
        noteError(err, 'pairing-code');
        if (codeRailCode) codeRailCode.textContent = 'Retrying…';
        updateChrome();
      }
    })().finally(() => {
      pairingFetchPromise = null;
    });

    return pairingFetchPromise;
  }

  async function checkPairing() {
    if (!formatPairCode(pairingCode)) {
      await ensurePairingCode();
      return;
    }
    if (isRegistered()) {
      updateChrome();
      return;
    }
    try {
      const data = await jsonFetch(`/api/devices/pairing-status/${encodeURIComponent(pairingCode)}`);
      networkOk = true;
      if (data.status === 'registered' && data.deviceId) {
        deviceId = data.deviceId;
        store.set('deviceId', deviceId);
        if (data.name) {
          deviceName = data.name;
          store.set('deviceName', deviceName);
        }
        // Keep pairingCode so reloads still show XXXX-XXXX (never wipe to deviceId-only)
        lastPairingCode = pairingCode;
        store.set('lastPairingCode', pairingCode);
        store.set('pairingCode', pairingCode);
        updateChrome();
        sendHeartbeat();
      } else {
        updateChrome();
      }
    } catch (err) {
      networkOk = false;
      noteError(err, 'pairing-status');
      // Unknown/expired code → auto-fetch a fresh DEVICE CODE (no tap)
      if (err.status === 404 || err.status === 400) {
        clearLocalIdentity();
        await ensurePairingCode();
      } else if (!pairingCode) {
        await ensurePairingCode();
      } else {
        updateChrome();
      }
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
      // Server lost this device (e.g. ephemeral DB) — auto get a fresh DEVICE CODE
      if (err.status === 404) {
        clearLocalIdentity();
        await ensurePairingCode();
      }
    }
  }

  function resetPairing() {
    // Debug-panel only — kiosk never requires this for a visible code
    clearLocalIdentity();
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

  function startLoops() {
    clearTimers();
    updateChrome();
    // Always ensure DEVICE CODE is on the strip (no mouse / no Reset)
    ensurePairingCode();
    pollOnce();
    sendHeartbeat();
    requestWakeLock();
    pollTimer = setInterval(pollOnce, POLL_MS);
    hbTimer = setInterval(sendHeartbeat, HEARTBEAT_MS);
    pairTimer = setInterval(checkPairing, PAIRING_MS);
    wakeLockTimer = setInterval(() => {
      requestWakeLock();
    }, WAKE_LOCK_MS);
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
      `Pairing code: ${displayPairCode() || '—'}`,
      `App version: ${APP_VERSION}`,
      `Persist: localStorage+cookie`,
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
      pollOnce();
      ensurePairingCode();
    }
  });

  async function boot() {
    setVisible(debugPanel, false);
    updateChrome();
    // Immediately surface DEVICE CODE; fetch if missing — never wait for tap
    await ensurePairingCode();
    await restoreCache();
    startLoops();
    requestWakeLock();
  }

  boot();
})();
