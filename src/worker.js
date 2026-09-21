// src/worker.js
import { computeFingerprint } from './lib/fingerprint.js';
import { sourceFileFromStack } from './lib/stack.js';

const IGNORE_STACK_FILES = ['main-world.js'];

// Synchronously-readable cache of the enabledOrigins map, kept in sync with
// chrome.storage.local. This exists so chrome.action.onClicked's listener can
// decide enable-vs-disable with zero `await`s: MV3 service workers drop the
// click event's transient user gesture the moment the handler yields to the
// event loop even once, so any async pre-check (e.g. a storage.local.get)
// before calling chrome.permissions.request(...) makes that call throw
// "This function must be called during a user gesture". Populating this
// cache at worker startup (below) means it's ready well before a real user
// click can arrive.
let enabledOriginsCache = {};
chrome.storage.local.get('enabledOrigins').then(({ enabledOrigins }) => {
  enabledOriginsCache = enabledOrigins || {};
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'CAPTURE_EVENT') return false;
  handleCaptureEvent(message)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      console.error('[web-error-monitor] failed to handle capture event', error);
      sendResponse({ ok: false, error: String(error) });
    });
  return true; // keep the message channel open for the async response
});

async function handleCaptureEvent(message) {
  const { payload, pageUrl, origin } = message;
  const sourceFile = sourceFileFromStack(payload.stack, { ignoreFiles: IGNORE_STACK_FILES });
  const fingerprint = await computeFingerprint({
    kind: payload.kind,
    message: payload.message,
    stack: payload.stack,
    sourceFile,
    ignoreFiles: IGNORE_STACK_FILES,
  });

  const record = {
    id: crypto.randomUUID(),
    kind: payload.kind,
    message: payload.message,
    stack: payload.stack,
    sourceFile,
    origin,
    url: pageUrl,
    timestamp: payload.timestamp,
    request: payload.request,
    fingerprint,
  };

  const count = await incrementDedupeCount(fingerprint);
  console.log(`[web-error-monitor] ${record.kind} (x${count}) fp=${fingerprint}`, record);
}

// Module-scope mutex serializing all read-modify-write access to the
// `dedupeCounts` key in chrome.storage.local. This holds no data itself
// (the counts remain solely in chrome.storage.local, the source of truth) —
// it only orders concurrent calls so a get()...set() pair can't interleave
// with another and lose an update. Resetting to Promise.resolve() on a
// service-worker restart is harmless: there's nothing in-flight to lose.
let dedupeQueue = Promise.resolve();

async function incrementDedupeCount(fingerprint) {
  const result = dedupeQueue.then(() => incrementDedupeCountUnsafe(fingerprint));
  // Swallow rejections in the chain itself so one failed call doesn't
  // permanently wedge the queue for subsequent calls; callers still see
  // the original rejection via `result`.
  dedupeQueue = result.catch(() => {});
  return result;
}

async function incrementDedupeCountUnsafe(fingerprint) {
  const { dedupeCounts = {} } = await chrome.storage.local.get('dedupeCounts');
  dedupeCounts[fingerprint] = (dedupeCounts[fingerprint] || 0) + 1;
  await chrome.storage.local.set({ dedupeCounts });
  return dedupeCounts[fingerprint];
}

const SCRIPT_ID_PREFIX = 'web-error-monitor';

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id || !tab.url) return;
  let origin;
  try {
    origin = new URL(tab.url).origin;
  } catch {
    return; // chrome:// pages, etc. can't be targeted
  }

  // Synchronous read (no await) so this listener reaches enableOrigin's
  // chrome.permissions.request(...) call without ever yielding to the event
  // loop first — that's what keeps the click's transient user gesture alive.
  const enabled = !!enabledOriginsCache[origin];
  const result = enabled ? disableOrigin(origin, tab.id) : enableOrigin(origin, tab.id);
  result.catch((error) => {
    console.error(`[web-error-monitor] failed to toggle ${origin}`, error);
  });
});

async function isOriginEnabled(origin) {
  const { enabledOrigins = {} } = await chrome.storage.local.get('enabledOrigins');
  return !!enabledOrigins[origin];
}

async function setOriginEnabled(origin, value) {
  const { enabledOrigins = {} } = await chrome.storage.local.get('enabledOrigins');
  enabledOrigins[origin] = value;
  await chrome.storage.local.set({ enabledOrigins });
  enabledOriginsCache = enabledOrigins;
}

function originPattern(origin) {
  return `${origin}/*`;
}

async function enableOrigin(origin, tabId) {
  const pattern = originPattern(origin);
  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) return;

  const mainId = `${SCRIPT_ID_PREFIX}-main-${origin}`;
  const contentId = `${SCRIPT_ID_PREFIX}-content-${origin}`;
  const scriptIds = [mainId, contentId];
  // Tracks whether THIS call is the one that registered the content
  // scripts, so the catch block below only ever tears down state it
  // itself just created.
  let registeredJustNow = false;

  try {
    // Guard against a stale-cache misjudgment: chrome.action.onClicked
    // reads a synchronously-cached enabledOrigins snapshot (to preserve the
    // click's transient user gesture) that can still read "disabled" for an
    // origin that a prior, still-valid session already enabled — most
    // plausibly right after the click itself wakes a terminated service
    // worker back up, before its startup cache-load promise has resolved.
    // If the scripts are already registered, there's nothing to do here;
    // registering again would throw on the duplicate ids.
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: scriptIds });
    if (existing.length < 2) {
      await chrome.scripting.registerContentScripts([
        {
          id: mainId,
          matches: [pattern],
          js: ['src/main-world.js'],
          world: 'MAIN',
          runAt: 'document_start',
        },
        {
          id: contentId,
          matches: [pattern],
          js: ['src/content.js'],
          runAt: 'document_start',
        },
      ]);
      registeredJustNow = true;
    }

    // The page already loaded before permission was granted, so inject once
    // immediately in addition to the persistent registration above.
    await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['src/main-world.js'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content.js'] });
  } catch (error) {
    console.error(`[web-error-monitor] failed to enable ${origin}`, error);

    if (!registeredJustNow) {
      // The scripts (and the permission) already existed before this call —
      // either the stale-cache race described above, or some other case
      // where they were already registered. That state predates this call
      // and may be a valid, working prior enable, so don't tear it down and
      // don't touch enabledOrigins here. A later click, or the cache
      // eventually catching up, will resolve to the correct state.
      return;
    }

    // Best-effort full rollback of state THIS call created. registerContentScripts
    // succeeded above before one of the subsequent executeScript calls threw, so
    // unregister both script ids we just registered — leaving them behind would
    // permanently break future enable attempts for this origin
    // (registerContentScripts rejects on a duplicate id, and registrations persist
    // across service-worker restarts).
    // Swallow failures here so they don't mask the original error above.
    await chrome.scripting.unregisterContentScripts({ ids: scriptIds }).catch(() => {});
    // Best-effort: revoke the permission we just got granted so we don't
    // leave a dangling grant that neither storage nor the badge reflects.
    // Swallow failures here so they don't mask the original error above.
    await chrome.permissions.remove({ origins: [pattern] }).catch(() => {});
    return;
  }

  await setOriginEnabled(origin, true);
  await refreshBadgeForTab(tabId, `${origin}/`);
}

async function disableOrigin(origin, tabId) {
  await chrome.tabs.sendMessage(tabId, { type: 'TEARDOWN' }).catch(() => {});

  await chrome.scripting
    .unregisterContentScripts({
      ids: [`${SCRIPT_ID_PREFIX}-main-${origin}`, `${SCRIPT_ID_PREFIX}-content-${origin}`],
    })
    .catch((error) => {
      console.error(`[web-error-monitor] failed to unregister content scripts for ${origin}`, error);
    });

  await chrome.permissions.remove({ origins: [originPattern(origin)] }).catch((error) => {
    console.error(`[web-error-monitor] failed to remove permission for ${origin}`, error);
  });

  await setOriginEnabled(origin, false);
  await refreshBadgeForTab(tabId, `${origin}/`);
}

async function refreshBadgeForTab(tabId, url) {
  let enabled = false;
  if (url) {
    try {
      enabled = await isOriginEnabled(new URL(url).origin);
    } catch {
      enabled = false;
    }
  }
  await chrome.action.setBadgeText({ tabId, text: enabled ? 'ON' : '' });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#2e7d32' });
  try {
    await chrome.action.setIcon({
      tabId,
      path: enabled
        ? { 16: 'icons/icon-on-16.png', 48: 'icons/icon-on-48.png', 128: 'icons/icon-on-128.png' }
        : { 16: 'icons/icon-off-16.png', 48: 'icons/icon-off-48.png', 128: 'icons/icon-off-128.png' },
    });
  } catch (error) {
    // Known MV3 timing quirk: fetching extension-local icon resources can
    // transiently fail right after the service worker wakes from idle. The
    // badge text set above remains the reliable ON/OFF signal, so this is
    // non-critical/cosmetic — just avoid unhandled-rejection console spam.
    console.warn(`[web-error-monitor] failed to set icon for tab ${tabId}`, error);
  }
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  await refreshBadgeForTab(tabId, tab?.url);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading') return;
  await refreshBadgeForTab(tabId, tab.url);
});
