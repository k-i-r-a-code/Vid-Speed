// Content script: detects <video>/<audio> on the page, downloads them,
// and applies playback-rate control across all videos in the tab.

(() => {
  if (window.__vgLoaded) return;
  window.__vgLoaded = true;

  let currentRate = 1;
  let watchdogTimer = null;

  // Restore the saved speed as early as possible on every page load,
  // so navigating to the "next episode" keeps your speed.
  try {
    chrome.storage.local.get('rate', (res) => {
      const saved = res?.rate;
      if (saved && saved !== currentRate) {
        setRate(saved);
        showFloatingBadge(saved);
      } else if (saved && saved !== 1) {
        showFloatingBadge(saved);
      }
    });
  } catch { /* storage unavailable */ }

  // ---------- Media discovery ----------

  function absoluteUrl(src) {
    if (!src || src.startsWith('blob:') || src.startsWith('data:')) return src;
    try {
      return new URL(src, location.href).href;
    } catch {
      return null;
    }
  }

  function collect() {
    const found = [];
    const seen = new Set();

    // Direct media elements
    document.querySelectorAll('video, audio').forEach((el, i) => {
      const src = absoluteUrl(el.currentSrc || el.src);
      const kind = el.tagName.toLowerCase() === 'video' ? 'video' : 'audio';
      const entry = {
        id: `el-${i}`,
        kind,
        url: src || null,
        blobUrl: src && src.startsWith('blob:') ? src : null,
        title: el.title || el.getAttribute('aria-label') || filenameGuess(src, kind),
        duration: isFinite(el.duration) ? el.duration : null,
        playing: !!(el.currentTime > 0 && !el.paused && !el.ended),
      };
      if (entry.url) {
        const key = entry.url + kind;
        if (!seen.has(key)) {
          seen.add(key);
          found.push(entry);
        }
      }
    });

    // <source> tags inside video/audio elements
    document.querySelectorAll('video source, audio source').forEach((s) => {
      const url = absoluteUrl(s.src);
      if (!url) return;
      const kind = s.closest('audio') ? 'audio' : 'video';
      const key = url + kind;
      if (!seen.has(key)) {
        seen.add(key);
        found.push({
          id: `src-${seen.size}`,
          kind,
          url,
          blobUrl: null,
          title: filenameGuess(url, kind),
          duration: null,
          playing: false,
        });
      }
    });

    return found;
  }

  function filenameGuess(url, kind) {
    try {
      const name = decodeURIComponent(new URL(url).pathname.split('/').pop());
      if (name && name.includes('.')) return name;
    } catch { /* ignore */ }
    return `page-${kind}.${kind === 'video' ? 'mp4' : 'mp3'}`;
  }

  // ---------- Speed control ----------

  function setRate(rate) {
    currentRate = rate;
    document.querySelectorAll('video, audio').forEach((el) => {
      try {
        el.playbackRate = rate;
      } catch { /* some elements reject >16 or <0.0625 */ }
    });
    startWatchdog();
  }

  // Many sites (and their players) actively reset playbackRate back to 1
  // when an episode/segment changes. Two defenses:
  //   1. 'ratechange' listener: if the rate was changed to something we
  //      did not set, snap it back immediately.
  //   2. Frequent watchdog polling while speed != 1, to catch sites that
  //      assign playbackRate without firing a rate change we can trust.

  function enforceRate(el) {
    if (currentRate === 1) return;
    try {
      if (Number(el.playbackRate.toFixed(2)) !== Number(currentRate.toFixed(2))) {
        el.playbackRate = currentRate;
      }
    } catch { /* ignore */ }
  }

  document.addEventListener('ratechange', (e) => {
    const el = e.target;
    if (el instanceof HTMLMediaElement) {
      // Ignore rate changes that are exactly our own write-back.
      enforceRate(el);
    }
  }, true);

  function startWatchdog() {
    if (currentRate === 1) {
      if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
      return;
    }
    if (watchdogTimer) return;
    watchdogTimer = setInterval(() => {
      document.querySelectorAll('video, audio').forEach(enforceRate);
    }, 500);
  }

  function showFloatingBadge(rate) {
    let badge = document.getElementById('vg-speed-badge');
    if (rate === 1) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'vg-speed-badge';
      badge.style.cssText = [
        'position: fixed', 'bottom: 16px', 'right: 16px', 'z-index: 2147483647',
        'background: linear-gradient(135deg, #ff472b, #9f1b0e)', 'color: #fff',
        'padding: 8px 14px', 'border-radius: 20px', 'font: 600 14px system-ui, sans-serif',
        'box-shadow: 0 4px 16px rgba(0,0,0,.35)', 'cursor: default', 'user-select: none',
        'opacity: .95', 'pointer-events: none',
      ].join(';');
      document.documentElement.appendChild(badge);
    }
    badge.textContent = `${rate}x`;
  }

  // Keep new videos in sync with the chosen speed
  const observer = new MutationObserver(() => {
    setRate(currentRate);
    startWatchdog();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  ['play', 'loadedmetadata', 'canplay'].forEach((evt) =>
    document.addEventListener(evt, (e) => {
      if (e.target instanceof HTMLMediaElement && currentRate !== 1) {
        e.target.playbackRate = currentRate;
      }
    }, true)
  );

  // Re-check the saved speed each time the document gains focus (single-page
  // apps and "next episode" clicks both go through here).
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      try {
        chrome.storage.local.get('rate', (res) => {
          if (res?.rate && Number(res.rate.toFixed(2)) !== Number(currentRate.toFixed(2))) {
            setRate(res.rate);
          }
        });
      } catch { /* ignore */ }
    }
  });

  // ---------- Messages ----------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'VG_COLLECT') {
      sendResponse({ media: collect(), rate: currentRate });
    } else if (msg.type === 'VG_SET_RATE') {
      setRate(msg.rate);
      sendResponse({ ok: true, rate: currentRate });
    } else if (msg.type === 'VG_GET_RATE') {
      sendResponse({ rate: currentRate });
    } else if (msg.type === 'VG_SHOW_BADGE') {
      showFloatingBadge(msg.rate);
      sendResponse({ ok: true });
    } else if (msg.type === 'VG_BLOB_DOWNLOAD' && msg.blobUrl) {
      // Blob URLs live in the page context; download via anchor click.
      const a = document.createElement('a');
      a.href = msg.blobUrl;
      a.download = msg.filename || 'video.mp4';
      document.documentElement.appendChild(a);
      a.click();
      a.remove();
      sendResponse({ ok: true });
    }
    return true;
  });
})();