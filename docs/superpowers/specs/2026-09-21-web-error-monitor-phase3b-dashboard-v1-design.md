# Phase 3b (v1): Dashboard HUD — Tabs, Cost Tracking, Jev Detail Drill-Down

## Goal

Expand the existing on-page HUD (`src/hud/hud.js`) from a single flat error
list into a small dashboard: errors organized into tabs by urgency, a live
running total of what this session has cost in Jev API spend, and a richer
per-error drill-down that shows Jev's actual classification answers (not
just the summary color dot). This is the first shippable slice of the
"fancy dashboard" the user asked for — ship this, use it for real, then
decide what (if anything) from the deferred visual polish (charts) is
worth adding, informed by actual usage rather than upfront guessing.

## Background

Phase 3a (already shipped, see
`docs/superpowers/plans/2026-09-21-web-error-monitor-phase3a-jev-pipeline.md`)
built the classification pipeline: every captured error gets a Jev
classification (once, ever, per fingerprint — cached in
`chrome.storage.local` under `classifications`), which sets a
`displayColor` (grey/amber/red) and a `muted` flag on the record, consumed
by the existing HUD. That pipeline's Jev response already includes a
`usage: { input_tokens, output_tokens }` block that is currently parsed and
discarded (`src/worker/classification.js`'s success branch never reads
`json.usage`) — this plan is the first thing to actually consume it.

Confirmed real Jev 1.13 pricing (from TypeSafe's pricing page, given
directly by the user, not the docs site): **$0.042 per million input
tokens. Output tokens are free.** Cost for any single classification is
`usage.input_tokens / 1_000_000 * 0.042`.

The visual design (tab layout, panel shape, drill-down as inline-expand
rather than a separate view) was validated with the user via the
brainstorming skill's visual companion tool before this spec was written —
see the conversation for the mockups; this document specifies the
underlying data/message architecture needed to build it, which was not a
visual question.

## Scope (v1 — this plan)

In scope:

- Three tabs in the HUD panel — **Needs attention** (default), **All**,
  **Muted** — replacing the current single list + collapsed muted section.
- A cost/token badge in the panel header: total Jev spend and input token
  count for the current browser session (resets when the service worker
  restarts or the browser closes — same scoping as the existing
  `sessionCap` classification counter), aggregated **globally across every
  monitored origin**, not per-origin.
- Inline row drill-down (extending the existing expand-on-click pattern)
  showing Jev's actual answers: priority score + legend + confidence,
  origin choice + confidence, silent-bug probability — not just the
  summary color dot.

Explicitly deferred (not this plan, revisit after real usage):

- The donut chart (origin breakdown) and the spend-over-time bar chart
  from the visual mockups. The data both would need (per-record
  `classification.origin.choice`, and the usage log this plan adds) is
  already available once this plan ships — adding the charts later is a
  rendering-only change, no new plumbing.
- Any UI for browsing/exporting the raw usage log.
- Per-origin cost breakdown (v1 is a single global number).

## Global Constraints

(Carried forward from Phase 3a's plan, still binding.)

- The Jev API key must never be in the repo or the built bundle. Options
  page only, stored in `chrome.storage.local`.
- Never send the API key or usage data anywhere except
  `https://api.typesafe.ai`.
- No new host permissions needed — this plan adds no new network calls of
  its own; it only reads a field already present in Phase 3a's existing
  `POST /v1/systemone` response.
- Extension pages (options.html) may use ES module imports; content
  scripts (`src/hud/*.js`, `src/content.js`) may not — they are classic
  scripts sharing state via `window.__webErrorMonitor*` globals, listed in
  `src/worker/injection.js`'s `registerContentScripts` call.

## Architecture

### New: `src/lib/usage.js` (pure, tested with `node --test`)

```js
export const COST_PER_MILLION_INPUT_TOKENS_USD = 0.042;

export function computeCostUsd(inputTokens) {
  return (inputTokens / 1_000_000) * COST_PER_MILLION_INPUT_TOKENS_USD;
}

export function sumInputTokens(usageLog) {
  return usageLog.reduce((total, entry) => total + entry.inputTokens, 0);
}

export function formatCostUsd(costUsd) {
  // 4 decimal places: at real Jev pricing, a single classification costs a
  // few thousandths of a cent, so 2-3 decimals would show "$0.00" for most
  // of a normal session.
  return `$${costUsd.toFixed(4)}`;
}

export function formatTokenCount(tokens) {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k tok`;
  return `${tokens} tok`;
}
```

### New: `src/worker/usage.js` (chrome.\* glue, no automated tests — live-verified like classification.js)

Responsibilities:

1. `recordUsage(usage)` — called by `classification.js` after every
   successful (`response.ok`) Jev call, passed `json.usage` directly.
   Appends `{ timestamp: Date.now(), inputTokens: usage.input_tokens }` to
   `chrome.storage.session.usageLog` (array, starts `[]`). Guard:
   no-op if `usage` or `usage.input_tokens` is missing (matches the
   existing "never throw, degrade gracefully" contract — a malformed
   response already degrades classification gracefully via the
   `json.answers || {}` guard; usage recording must degrade the same way,
   silently, rather than throwing and breaking the classification it rode
   in on).
   - Uses its own module-scope promise-chain mutex (mirrors
     `cacheQueue`/`sessionCountQueue` in `classification.js`) serializing
     read-modify-write access to `usageLog`, for the same reason: `flush()`
     in `classification.js` can resolve several classifications
     concurrently in one batch, each calling `recordUsage`.
   - No cap/eviction logic needed on `usageLog`: it only grows on a
     *successful* classification, and classifications are already capped
     at `sessionCap` (default 200) per session and never repeated for the
     same fingerprint (the Phase 3a "classify once, ever" cache). So
     `usageLog` self-bounds at roughly `sessionCap` entries per browser
     session.
   - After a successful append, broadcasts `USAGE_UPDATE` (see Messages
     below).
2. `getUsageSummary()` — reads `usageLog`, returns
   `{ totalCostUsd, totalInputTokens }` via `sumInputTokens` +
   `computeCostUsd` from `src/lib/usage.js`.
3. A `chrome.runtime.onMessage` listener answering `{ type: 'GET_USAGE' }`
   with `getUsageSummary()`'s result, for a HUD that just initialized and
   needs the current total before any new classification happens in that
   tab. `getUsageSummary()` is async (reads `chrome.storage.session`), so
   this must `return true` to keep the message channel open for
   `sendResponse`, exactly like `capture.js`'s existing `CAPTURE_EVENT`
   listener already does — a very easy Chrome-extension footgun to miss
   (the response silently never arrives if you don't):

   ```js
   chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
     if (!message || message.type !== 'GET_USAGE') return false;
     getUsageSummary().then(sendResponse);
     return true; // keep the channel open for the async sendResponse above
   });
   ```

`src/worker.js` gains a third import: `import './worker/usage.js';`
alongside the existing `injection.js`/`capture.js` imports.

### Modified: `src/worker/classification.js`

In the `response.ok` branch of `classifyWithRetry`, after parsing
`answers`, also call (fire-and-forget, matching how classification results
themselves are cached before notifying tabs):

```js
import { recordUsage } from './usage.js';
// ...inside the response.ok branch, before constructing the return value:
if (json.usage) recordUsage(json.usage);
```

### Messages (new)

- **`USAGE_UPDATE`** — broadcast from `usage.js` to every open tab
  whenever a new entry is recorded:
  `{ type: 'USAGE_UPDATE', totalCostUsd, totalInputTokens }`.
  Unlike `CLASSIFICATION_UPDATE` (origin-filtered via
  `chrome.tabs.query({ url: pattern })`), this is **not** origin-filtered
  — cost is global, so every tab with the HUD installed needs it. Query
  `chrome.tabs.query({})` (all tabs), send to each, `.catch(() => {})` per
  tab (tabs without the content script installed will reject harmlessly —
  same defensive pattern as `notifyTabs` in `classification.js`).
- **`GET_USAGE`** (request/response) — sent by `hud.js` once, from
  `init()`, so the badge has a real number before the first
  `USAGE_UPDATE` arrives in that tab. `content.js` does not need to relay
  this one: `hud.js` already talks to `chrome.storage` directly elsewhere
  (e.g. reading `hudState` in `init()`), so it can call
  `chrome.runtime.sendMessage({ type: 'GET_USAGE' })` directly too — no
  new content.js plumbing needed for the request side.

`src/content.js`'s existing `chrome.runtime.onMessage` listener gains one
more branch for the broadcast side:

```js
} else if (message.type === 'USAGE_UPDATE') {
  window.__webErrorMonitorHud.updateUsage(message.totalCostUsd, message.totalInputTokens);
}
```

### Modified: `src/hud/hud.js`

Classification record shape reminder (from `classification.js`'s
successful return value, unchanged by this plan):
`record.classification = { priority, origin, silentBug, displayColor, muted, classifiedAt }`
where `priority = { score, legend, probabilities, confidence }` (or
`null`), `origin = { choice, probabilities, confidence }` (or `null`),
`silentBug = { probability }` (or `null`).

New/changed pieces:

1. **Tab state**: new module-scope `let activeTab = 'needsAttention';`
   (one of `'needsAttention' | 'all' | 'muted'`), reset to
   `'needsAttention'` in `teardown()` alongside the existing state resets.
2. **`needsAttention(record)`**: new predicate,

   ```js
   function needsAttention(record) {
     if (isMuted(record)) return false;
     const color = severityColor(record);
     if (color === 'red' || color === 'amber') return true;
     const silentProb = record.classification?.silentBug?.probability;
     return typeof silentProb === 'number' && silentProb > 0.5;
   }
   ```

   The `> 0.5` threshold matches the existing threshold already used by
   `applySilentBugPromotion` in `src/lib/jev.js`, for consistency.
3. **Tab bar**: three buttons rendered in the panel between the header and
   the list (new DOM built once in `buildDom()`, like the existing
   header/list). Clicking a tab sets `activeTab` and calls `renderList()`;
   the active tab gets a visual highlight (underline, per the validated
   mockup). Tab labels show live counts: `Needs attention (N)`,
   `All (N)`, `Muted (N)`.
4. **`renderList()`** rewrite: instead of always splitting into
   main/muted, filter `groups` by `activeTab`
   (`needsAttention`/no-filter/`isMuted`) and render just that filtered
   set. The old `buildMutedSection`/`mutedSectionExpanded` toggle-section
   machinery is removed — Muted is now a first-class tab, not a collapsed
   subsection of the main list.
5. **`renderCounts()`**: unchanged in spirit (still tallies red/amber/grey
   for the pill), but now also needs the `needsAttention`/`all`/`muted`
   counts for the tab labels — extend it to compute all of these in one
   pass over `groups`.
6. **Header cost badge**: new DOM element in the header
   (`buildDom()`), text content set by a new function
   `renderUsage(totalCostUsd, totalInputTokens)` using
   `formatCostUsd`/`formatTokenCount` — wait, `hud.js` is a classic
   script and cannot `import` from `src/lib/usage.js` (same constraint
   `hud.js` already works around for Jev-specific logic, per its own
   comment: "this file never does Jev-specific bucketing itself, since
   it's a classic script and can't import src/lib/jev.js's ES module
   exports"). **Resolution**: `usage.js`'s worker-side messages
   (`USAGE_UPDATE`/`GET_USAGE` response) send the already-formatted
   display strings, not raw numbers — i.e. `getUsageSummary()` in
   `src/worker/usage.js` calls `formatCostUsd`/`formatTokenCount` itself
   (it's an ES module, can import from `src/lib/usage.js` freely) and
   includes both the raw numbers and the formatted strings in its result,
   the same way `classification.js` precomputes `displayColor`/`muted`
   worker-side so the HUD never needs Jev-specific logic. So
   `getUsageSummary()` returns
   `{ totalCostUsd, totalInputTokens, costLabel, tokenLabel }`, and
   `USAGE_UPDATE` carries the same four fields; `hud.js`'s
   `updateUsage(costLabel, tokenLabel)` just sets `textContent` directly.
7. **`init(origin)`**: after `buildDom()`, add
   `chrome.runtime.sendMessage({ type: 'GET_USAGE' }).then((summary) => updateUsage(summary.costLabel, summary.tokenLabel)).catch(() => {});`
   (harmless if the worker is asleep/restarting — the next
   `USAGE_UPDATE` broadcast will catch it up).
8. **Row drill-down** (`buildRow`): the existing `detail` block (stack
   trace + copy button) gains a new section when `record.classification`
   is present and not a failure marker (i.e. has a `priority`/`origin`/
   `silentBug` shape, not `{failed: true, ...}` — check
   `!record.classification.failed`), rendering each present answer:
   - Priority: `record.classification.priority.legend[Math.round(score)]`
     if a legend is present (fallback to the raw score), plus
     `confidence` as a percentage.
   - Origin: `choice` (human-readable, e.g. swap underscores for spaces)
     plus `confidence` as a percentage.
   - Silent bug: `probability` as a percentage.
   - If `record.classification` is null (not yet classified) or a failure
     marker, show nothing new here — the existing stack/copy content is
     unaffected either way.

### Modified: `src/hud/styles.js`

New CSS for: the tab bar (three buttons, active-state underline), the
header cost badge (small pill, reuses the existing `.wem-pill`-style
visual language but doesn't reuse the class itself since the pill is a
different element), and the new drill-down answer rows (label + value,
small text, consistent with the existing `.wem-row-source` sizing).
Remove the now-unused `.wem-muted-section`/`.wem-muted-toggle`/
`.wem-muted-list` rules (superseded by the Muted tab).

### `src/worker/injection.js`

No changes needed — `usage.js` has no content-script component to
register (it's worker-only), and `hud.js`/`content.js`'s registered
script list is unchanged (no new content-script file is being added in
v1, since charts — which would have justified a separate
`src/hud/charts.js` — are deferred).

## Error Handling

- `recordUsage` never throws: missing/malformed `usage` is a silent no-op
  (mirrors `classification.js`'s existing `json.answers || {}` guard for
  the classification itself — a usage-recording failure must never take
  down classification, which already succeeded by the time `recordUsage`
  is called).
- `GET_USAGE` response when `usageLog` doesn't exist yet (fresh session,
  zero classifications so far): `getUsageSummary()` treats a missing key
  as `[]`, returning `{ totalCostUsd: 0, totalInputTokens: 0, costLabel: '$0.0000', tokenLabel: '0 tok' }` — not an error.
- `USAGE_UPDATE` broadcast failures (a tab with no content script
  installed) are swallowed per-tab, same as `notifyTabs` today — one
  unreachable tab must never block the others.

## Testing

- `src/lib/usage.js`: full `node --test` coverage — `computeCostUsd` at
  zero/typical/large token counts, `sumInputTokens` over an empty and a
  populated log, `formatCostUsd`/`formatTokenCount` at boundary values
  (0, 999, 1000, 1_000_000 tokens).
- `src/worker/usage.js`, `hud.js` tab/drill-down changes: no `node --test`
  coverage (both depend on `chrome.*` APIs unavailable under plain Node,
  consistent with `classification.js`/existing `hud.js` today) — verified
  live via the browser tool (stubbed `chrome.storage`/`chrome.runtime` for
  `usage.js`, as already done ad hoc for `classification.js`'s bug-fix
  round) plus manual verification in the actual unpacked extension by the
  user, same division of labor as Phase 3a's Task 5.
