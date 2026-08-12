# AGENTS.md — hyubai_farm

## Project overview

Tampermonkey userscript + Node CLI helper for HYB Farm (黑与白农场). Pure JS, no build/bundle/test/CI.

- **Main artifact**: `Tampermonkey/farm-profit-ranking.user.js` (single IIFE, Shadow DOM UI)
- **CLI**: `script/crop-profit-ranking.js` (uses `cli-table3`)
- **Docs**: `doc/api.md` (API contracts), `doc/implement.md` (impl details), `doc/CHANGELOG.md` (version history)
- **Archive**: `doc/archive/auto-harvest-plan.md`, `doc/archive/debuff-display-plan.md`, `doc/archive/refactory.md`
- **Refactor preview**: `Tampermonkey/refactor.js`
- **Also read**: `.claude/CLAUDE.md` (communication rules, git rules, red-line ops)

## Commands

```bash
# Syntax check (the only automated check)
node --check Tampermonkey/farm-profit-ranking.user.js
node --check script/crop-profit-ranking.js

# CLI ranking (requires cookie.txt at repo root)
node script/crop-profit-ranking.js

# Dependency install (Chinese mirror)
npm install
```

**Note**: `npm run rank` in `package.json` is broken — it points to `node crop-profit-ranking.js` instead of `node script/crop-profit-ranking.js`.

## Architecture

### Userscript entry
IIFE at `document-idle`, calls `createRoot()` → `render(api)` → `refreshCropStatus(api)`. Shadow DOM isolation, CSS variables for light/dark theme, `innerHTML` full re-render on state change.

### State management
Single mutable global `state` object. All handlers mutate `state` directly then call `render(api)`. Theme persisted via `localStorage` (`hyb-farm-profit-theme` key).

### API layer
`requestJson()` wraps `GM_xmlhttpRequest` with 15s timeout, `anonymous: false` to carry browser cookies. 13 endpoints all under `https://cdk.hybgzs.com/api/farm/`. Price normalization: `real_price = api_value / 500000` (`PRICE_DIVISOR`).

### Three tabs (plus panels)
收益排行 / 我的农场 / 好友农场 — event delegation on `.body`, tab selection in `state.page`. 我的农场 tab contains collapsible `<details>` panels: 农场情况 (with 一键务农 button and plot grid), 自动收菜, 我的仓库 (with 一键卖出/一键种植).

### Auto-harvest system (v3.0.0)
- **Trigger**: maturity `cropReadyTimer` fires → `runAutoHarvestCycle(api)` + 60s polling fallback + `visibilitychange` wake
- **Harvest**: `performHarvestAll(api)` (no confirm) extracted from `handleHarvestAll` (with confirm) — returns `{ok, crops, inventory, error}`
- **Replant**: delayed 10s after harvest; uses `state.replantSeedId` from inventory; persisted via `localStorage` (`hyb-farm-profit-replant-seed`)
- **Guards**: `state.harvesting` / `autoHarvestBusy` / `careBusy` triple lock + 30s min interval
- **localStorage keys**: `hyb-farm-profit-auto-harvest`, `hyb-farm-profit-replant-seed`

### Debuff display system
- **Constants**: `DEBUFF_META = { thirsty: {name:"缺水",icon:"💧"}, weed: {name:"杂草",icon:"🌿"}, pest: {name:"虫害",icon:"🐛"} }`, `CROP_PLACEHOLDER_URL = "https://cdk.hybgzs.com/farm/crops/starfruit_s2.png"`
- **Normalization**: `normalizeCrops` maps raw API `conditions: [{kind:"thirsty"}]` → `conditions: [{kind, name, icon}]` (filtered through `DEBUFF_META`, unknown kinds dropped)
- **Icon rules** (in `renderPlotCard`): mature → real crop icon `crop.iconUrl`; else has debuff → emoji span; else → starfruit placeholder
- **Status text**: debuff → red `var(--warn)` text with names joined by `、`; no debuff → "状态正常"

### 一键务农 (`care/all`)
- **Endpoint**: `POST /api/farm/care/all` — no body, returns `{processed, skipped, energySpent, byKind}`
- **Button**: in 农场情况 panel bottom, reuses `.inventory-sell-selected` class. Disabled when no crops have debuffs (`careNeeded = careCount > 0`), label shows `一键务农 (N)` when active, `务农中` while busy
- **Handler**: `handleCareAll(api)` → POST → `fetchCropsData({force:true})` → `renderNotice()` with `DEBUFF_META`-based message

### Shared notice system
- **Helper**: `renderNotice(message, type, noticeKey)` — produces `<div class="notice">` with an X close button (`data-action="dismiss-notice"`). Returns `""` when message is empty.
- **Dismiss**: event delegation clears `state[noticeKey]` and `state[noticeKey + "Type"]` then re-renders.
- **Used by**: inventory (`inventoryRecycleNotice`), auto-harvest (`autoHarvestNotice`), steal (`stealNotice`), care (`careNotice`).
- **CSS**: single unified `.notice` class (replaced old `.inventory-recycle-notice`, `.steal-notice`, `.auto-harvest-notice` blocks).

## Key conventions

- No framework, no bundler, no TypeScript — all plain JS
- `escapeHtml` for dynamic content before `innerHTML`
- API constants centralized near top of script
- `@match` and `@connect` scoped to `cdk.hybgzs.com` only
- Historical `.user-v*.js` files are archives; only `farm-profit-ranking.user.js` is active
- Refresh button uses `🔄` emoji — do NOT set `api.refresh.textContent` (it was removed)
- UI controls inside `innerHTML` bodies use body event delegation, not direct element bindings
- Button styles shared across panels: `.inventory-sell-selected` reused by 一键务农, `.inventory-actions` layout reused by farm-care area
- New notice features should use `renderNotice(…)` with a unique `noticeKey`; the dismiss handler automatically clears `{noticeKey}` and `{noticeKey}Type` from state

## Known sharp edges

1. **`npm run rank` is broken** — correct path is `node script/crop-profit-ranking.js`
2. **No tests** — all validation is manual via README checklist or browser smoke testing
3. **`conditions` field is NOT `string[]`**: API returns objects `{kind: "thirsty"}`. `normalizeCrops` maps them to `{kind, name, icon}` via `DEBUFF_META`. Don't call `.join("、")` on raw conditions.
4. **`normalizeFriendFarm`**: friend with `firstCrop === null` is wrongly marked stealable
5. **`fetchFriendStatuses`** uses unbounded `Promise.all` — one failure rejects entire friends page
6. **Mutation paths** (harvest/recycle/plant/steal/auto-harvest/care) change server state with zero automated coverage
7. **Background refresh failures** (`refreshCropStatus`) silently swallowed — no stale indicator
8. **`cookie.txt`** is gitignored but still in repo root — easy to leak via zip/screenshot
9. **npm audit** must use official registry (`--registry=https://registry.npmjs.org`) — configured mirror doesn't support audit
