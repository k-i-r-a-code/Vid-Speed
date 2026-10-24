// Popup logic: scan the active tab for media, wire downloads and speed control.

const listEl = document.getElementById('list');
const countEl = document.getElementById('count');
const rateEl = document.getElementById('rate');
const rateVal = document.getElementById('rateVal');
const toastEl = document.getElementById('toast');

let currentTab = null;
let mediaList = [];

function toast(msg, ok) {
  toastEl.textContent = msg;
  toastEl.className = 'toast ' + (ok ? 'ok' : 'err');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (toastEl.className = 'toast'), 4000);
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function fmtDuration(d) {
  if (d == null) return '';
  const s = Math.round(d);
  return ` · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function render() {
  if (!mediaList.length) {
    listEl.innerHTML = '<div class="empty">No downloadable videos found on this page yet. If a video plays but isn\'t listed, it may be DRM-protected or stream-protected.</div>';
    countEl.textContent = '';
    return;
  }
  countEl.textContent = `(${mediaList.length})`;
  listEl.innerHTML = '';
  for (const m of mediaList) {
    const row = document.createElement('div');
    row.className = 'media';

    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = m.kind === 'audio' ? '🎧' : '🎬';

    const info = document.createElement('div');
    info.className = 'info';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = m.title || m.url;
    name.title = m.title || m.url;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = (m.blobUrl ? 'in-page stream (blob)' : new URL(m.url).hostname) + fmtDuration(m.duration);
    info.append(name, meta);

    const btn = document.createElement('button');
    btn.className = 'dl';
    btn.textContent = 'Download';
    if (!m.url) btn.disabled = true;
    btn.addEventListener('click', () => download(m, btn));

    row.append(icon, info, btn);
    listEl.appendChild(row);
  }
}

async function download(m, btn) {
  btn.disabled = true;
  const result = await chrome.runtime.sendMessage({
    type: 'VG_DOWNLOAD',
    url: m.url,
    kind: m.kind,
    filename: m.title,
  }).catch((e) => ({ ok: false, error: String(e) }));

  if (result?.ok) {
    toast('Download started ✓', true);
    btn.textContent = 'Started';
  } else {
    toast(result?.error || 'Download failed.', false);
    btn.disabled = false;
  }
}

async function applyRate(rate) {
  rateEl.value = rate;
  rateVal.textContent = `${rate}x`;
  document.querySelectorAll('.preset').forEach((b) =>
    b.classList.toggle('active', Number(b.dataset.rate) === Number(rate))
  );
  await chrome.tabs.sendMessage(currentTab.id, { type: 'VG_SET_RATE', rate }).catch(() => {});
  chrome.storage.local.set({ rate });
  await chrome.tabs.sendMessage(currentTab.id, { type: 'VG_SHOW_BADGE', rate }).catch(() => {});
}

rateEl.addEventListener('input', () => applyRate(Number(rateEl.value)));
document.querySelectorAll('.preset').forEach((b) =>
  b.addEventListener('click', () => applyRate(Number(b.dataset.rate)))
);

async function scan() {
  currentTab = await getActiveTab();
  if (!currentTab || !currentTab.id) return;

  // Inject the content script if the page predates extension install/reload.
  try {
    await chrome.tabs.sendMessage(currentTab.id, { type: 'VG_COLLECT' });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: currentTab.id }, files: ['content.js'] }).catch(() => {});
  }

  const res = await chrome.tabs.sendMessage(currentTab.id, { type: 'VG_COLLECT' }).catch(() => null);
  mediaList = res?.media || [];
  const savedRate = (await chrome.storage.local.get('rate')).rate ?? res?.rate ?? 1;
  rateEl.value = savedRate;
  rateVal.textContent = `${savedRate}x`;
  render();
}

// Re-scan when the popup reopens or the tab changes page
document.addEventListener('visibilitychange', scan);
scan();
setInterval(scan, 2500);// Popup logic: scan the active tab for media, wire downloads and speed control.
