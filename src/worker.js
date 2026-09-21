// src/worker.js
import { computeFingerprint } from './lib/fingerprint.js';
import { sourceFileFromStack } from './lib/stack.js';
import { applyDedupeIncrement } from './lib/dedupe.js';

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
  handleCaptureEvent(message, sender)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      console.error('[web-error-monitor] failed to handle capture event', error);
      sendResponse({ ok: false, error: String(error) });
    });
  return true; // keep the message channel open for the async response
});

async function handleCaptureEvent(message, sender) {
  // Gate on enabled state here too: injection alone doesn't guarantee "off",
  // since disableOrigin only tears down the one tab it was invoked on. A
  // sibling tab on the same origin that was already injected keeps sending
  // CAPTURE_EVENT messages until it's reloaded, so drop anything from an
  // origin that isn't currently enabled. Use sender.origin (set by Chrome
  // from the actual sending frame) rather than the page-self-reported
  // message.origin field, since the latter is just window.location.origin
  // read inside the page's own content-script bridge and could be spoofed by
  // a compromised/malicious page.
  const senderOrigin = sender?.origin;
  if (!senderOrigin || !(await isOriginEnabled(senderOrigin))) {
    return;
  }

  const { payload, pageUrl } = message;
  const sourceFile = sourceFileFromStack(payload.stack, { ignoreFiles: IGNORE_STACK_FILES });
  const fingerprint = await computeFingerprint({
    kind: payload.kind,
    message: payload.message,
    stack: payload.stack,
    ignoreFiles: IGNORE_STACK_FILES,
    status: payload.request?.status,
  });

  const record = {
    id: crypto.randomUUID(),
    kind: payload.kind,
    message: payload.message,
    stack: payload.stack,
    sourceFile,
    origin: senderOrigin,
    url: pageUrl,
    timestamp: payload.timestamp,
    request: payload.request,
    fingerprint,
  };

  const count = await incrementDedupeCount(fingerprint);
  console.log(`[web-error-monitor] ${record.kind} (x${count}) fp=${fingerprint}`, record);

  const classification = await getClassification(fingerprint);
  const tabId = sender.tab?.id;
  if (tabId) {
    chrome.tabs
      .sendMessage(tabId, { type: 'RECORD', record: { ...record, classification } })
      .catch(() => {
        // The HUD may not be initialized yet (e.g. this event fired before
        // content.js finished loading), or the tab may have navigated away.
        // Dropping the record silently is fine — the console.log above is
        // the durable record of this event either way.
      });
  }
}

async function getClassification(fingerprint) {
  // Phase 3 will look this up in a chrome.storage.local `classifications`
  // cache keyed by fingerprint (BRIEF §7: "classified exactly once, ever").
  // No classification exists yet — always null. The HUD already knows how
  // to render a record with no classification via its kind-based severity
  // fallback, so this is a placeholder that needs no caller changes when
  // Phase 3 fills it in.
  return null;
}

// Module-scope mutex serializing all read-modify-write access to the
// `dedupeCounts` key in chrome.storage.session. This holds no data itself
// (the counts remain solely in chrome.storage.session, the source of truth) —
// it only orders concurrent calls so a get()...set() pair can't interleave
// with another and lose an update. Resetting to Promise.resolve() on a
// service-worker restart is harmless: there's nothing in-flight to lose.
let dedupeQueue = Promise.resolve();

// chrome.storage.session (not .local): dedupe counts are a diagnostic
// display aid, not durable data worth keeping across browser restarts.
// Session storage is in-memory and clears automatically when the browser
// closes, which caps the previous unbounded, lifetime-across-every-origin
// growth without needing an explicit reset path.
const DEDUPE_COUNT_CAP = 1000;

async function incrementDedupeCount(fingerprint) {
  const result = dedupeQueue.then(() => incrementDedupeCountUnsafe(fingerprint));
  // Swallow rejections in the chain itself so one failed call doesn't
  // permanently wedge the queue for subsequent calls; callers still see
  // the original rejection via `result`.
  dedupeQueue = result.catch(() => {});
  return result;
}

async function incrementDedupeCountUnsafe(fingerprint) {
  const { dedupeCounts = {} } = await chrome.storage.session.get('dedupeCounts');
  const updated = applyDedupeIncrement(dedupeCounts, fingerprint, DEDUPE_COUNT_CAP);
  await chrome.storage.session.set({ dedupeCounts: updated });
  return updated[fingerprint];
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

    if (registeredJustNow) {
      // The page already loaded before permission was granted, so inject once
      // immediately in addition to the persistent registration above. Only do
      // this when THIS call is the one that freshly registered the scripts:
      // if they were already registered (stale-cache race, or re-enabling
      // without a reload), the current page already has both scripts running
      // from its original document_start injection, and re-injecting content.js
      // here would install a second, un-tearable-down isolated-world listener
      // (content.js's own re-injection guard now protects against that too,
      // but skipping the redundant injection is the more correct fix).
      await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['src/main-world.js'] });
      await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content.js'] });
    }
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
