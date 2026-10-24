// Background service worker: performs downloads via chrome.downloads.

const BLOB_PREFIX = 'blob:';

async function guessFilename(url, kind) {
  try {
    const pathname = new URL(url).pathname;
    const name = decodeURIComponent(pathname.split('/').pop());
    if (name && /\.[a-z0-9]{2,5}$/i.test(name)) return name;
  } catch { /* ignore */ }
  return `video-grabber-${Date.now()}.${kind === 'audio' ? 'mp3' : 'mp4'}`;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'VG_DOWNLOAD') return;

  (async () => {
    const { url, kind } = msg;

    if (!url) {
      sendResponse({
        ok: false,
        error: 'No URL on this media element. It may be DRM-protected (e.g. Netflix) or loaded from a source we cannot access.',
      });
      return;
    }

    if (url.startsWith(BLOB_PREFIX)) {
      // Blob: URLs can't be passed to chrome.downloads; ask the page to
      // trigger the download with an <a download> click instead.
      const tabId = sender.tab?.id;
      if (tabId != null) {
        await chrome.tabs.sendMessage(tabId, {
          type: 'VG_BLOB_DOWNLOAD',
          blobUrl: url,
          filename: msg.filename || (await guessFilename(url, kind)),
        });
        sendResponse({ ok: true, via: 'anchor' });
      } else {
        sendResponse({ ok: false, error: 'Cannot download blob media without a tab.' });
      }
      return;
    }

    const filename = msg.filename || (await guessFilename(url, kind));
    chrome.downloads.download(
      { url, filename, saveAs: false },
      (downloadId) => {
        if (downloadId === undefined) {
          sendResponse({ ok: false, error: chrome.runtime.lastError?.message || 'Download failed.' });
        } else {
          sendResponse({ ok: true, downloadId });
        }
      }
    );
  })();

  return true; // async sendResponse
});