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
收益排行 / 我的农场 / 好友农场 — event delegation on `.body`, tab selection in `state.page`.

**我的农场 tab** is structured as: overview hero → three collapsible `<details>` panels:

- **Overview hero** (总览): focus card with big number (harvest count or next maturity countdown via `formatCountdown`, 跨天带天档位如 `3天4小时39分钟`; 每 60s 由 `refreshCountdownDom` DOM 直更新不触发全量 render), action buttons (一键务农 above 一键收菜, vertical stack), and a 3-grid stats strip (生长中·空地 / 待务农 / 仓库). Stats are clickable `<button class="stat-card">` elements that scroll to the corresponding panel via `data-action="scroll-to-panel"`. The `overview-note` shows the exact Beijing time `MM/DD HH:mm` via `formatDateTime` for disambiguation.
- **农场情况 panel**: plot grid + 一键务农 + 一键收菜 buttons in `.farm-care-actions`
- **自动操作 panel**: auto-harvest toggle + replant select + auto-care toggle (独立轮询处理 debuff)
- **我的仓库 panel**: inventory grid + 一键卖出/一键种植

**Scroll-to-panel**: event handler opens the target `<details>` panel by setting `state.*PanelOpen`, re-renders, then `scrollIntoView({smooth})`. Uses `data-scroll-anchor` attribute on button containers for precise targeting (e.g. `.inventory-actions`, `.farm-care-actions`); falls back to the panel element when no anchor exists.

### Auto-harvest / auto-care system (v3.2.0)

**Auto-harvest (自动收菜)**:
- **Trigger**: maturity `cropReadyTimer` fires → `runAutoHarvestCycle(api)` + 60s polling fallback + `visibilitychange` wake
- **Harvest**: `performHarvestAll(api)` (no confirm) extracted from `handleHarvestAll` (with confirm) — returns `{ok, crops, inventory, error}`
- **Replant**: delayed 10s after harvest; uses `state.replantSeedId` from inventory; persisted via `localStorage` (`hyb-farm-profit-replant-seed`)
- **Guards**: `state.harvesting` / `autoHarvestBusy` / `careBusy` / `autoCareBusy` lock + 30s min interval
- **localStorage keys**: `hyb-farm-profit-auto-harvest`, `hyb-farm-profit-replant-seed`

**Auto-care (自动务农, v3.2.0)**:
- **Trigger**: independent 5min polling (`AUTO_CARE_POLL_MS`) + `visibilitychange` wake
- **Core**: `performCareAll()` (extracted from `handleCareAll`) — POST `care/all`, returns `{ok, message, processed, error, crops}`; used by manual `handleCareAll` and auto `runAutoCarePoll`
- **Daily stat (v3.2.1)**: only `runAutoCarePoll` accumulates `processed` into `state.autoCareDaily` (Beijing-time day boundary, `hyb-farm-profit-auto-care-daily` key); manual care not counted. Shown in 自动操作 panel hint as `今日已处理 N 处 debuff`
- **Guards**: `state.autoCareBusy` / `careBusy` / `harvesting` / `autoHarvestBusy` lock + 30s min interval
- **localStorage keys**: `hyb-farm-profit-auto-care`, `hyb-farm-profit-auto-care-daily`

### Material Symbols icon system (v3.2.6+)
Header buttons, trigger, and notice-close use Google Material Symbols glyphs with an emoji fallback:
- **Constants**: `MATERIAL_SYMBOLS_FONT_URL` (woff2 served from `gstatic.loli.net` — a China-accessible mirror; `fonts.googleapis.com` is blocked in CN, do NOT revert) + `MATERIAL_SYMBOLS_FONT_FAMILY` (`"Material Symbols Outlined"`)
- **CRITICAL**: @font-face declared inside the Shadow DOM `<style>` does **NOT** load in Chromium on real pages (silently renders the ligature text, e.g. "light_mode"). Fonts must be loaded via `new FontFace(...).load()` → `document.fonts.add()` in `createRoot`. Do not reintroduce a shadow `<style>` @font-face or a `<link>` in the shadow root.
- **Dual-state CSS**: `.material-symbols-outlined` is `display:none` by default and `.emoji-fallback` shown; `:host(.icons-ready)` swaps them. The class is added only after the font actually loads — failure keeps emoji so the UI is never blank.
- **Button pattern**: every icon button carries two spans `<span class="material-symbols-outlined">glyph</span><span class="emoji-fallback">emoji</span>`. JS swaps the **span's** `textContent` (e.g. `dark_mode`↔`light_mode`), never the button's.
- **Glyphs in use**: theme `dark_mode`/`light_mode`, refresh `refresh`, close `close`, trigger `paid`/`close`, notice-close `close`.
- **Exceptions**: debuff icons (💧🌿🐛) stay plain emoji and are rendered WITHOUT the `.emoji-fallback` class (so they show regardless of `.icons-ready`); crop images are `<img>`, not glyphs.

### Debuff display system
- **Constants**: `DEBUFF_META = { thirsty: {name:"缺水",icon:"💧"}, weed: {name:"杂草",icon:"🌿"}, pest: {name:"虫害",icon:"🐛"} }`, `CROP_PLACEHOLDER_URL = "https://cdk.hybgzs.com/farm/crops/starfruit_s2.png"`
- **Normalization**: `normalizeCrops` maps raw API `conditions: [{kind:"thirsty"}]` → `conditions: [{kind, name, icon}]` (filtered through `DEBUFF_META`, unknown kinds dropped)
- **Icon rules** (in `renderPlotCard`): mature → real crop icon `crop.iconUrl`; else has debuff → emoji span; else → starfruit placeholder
- **Status text**: debuff → red `var(--warn)` text with names joined by `、`; no debuff → "状态正常"

### 一键务农 (`care/all`)
- **Endpoint**: `POST /api/farm/care/all` — no body, returns `{processed, skipped, energySpent, byKind}`
- **Buttons** (two locations, same handler): overview hero (`.overview-care` class, outline style) and 农场情况 panel (`.inventory-sell-selected` class, filled style). Both use `data-action="care-all"`. Disabled when no crops have debuffs (`careNeeded = careCount > 0`), label shows `一键务农 (N)` when active, `务农中` while busy.
- **Handler**: `handleCareAll(api)` → `performCareAll()` → POST → `fetchCropsData({force:true})` → `renderNotice()` with `DEBUFF_META`-based message
- **Shared core**: `performCareAll()` extracted for reuse by both `handleCareAll` (manual) and `runAutoCarePoll` (auto) — returns `{ok, message, error, crops}`
- **Rendering**: centralized in `renderCareButton(careCount, careNeeded, className)` — takes className param to differentiate location styles (overview vs panel), zero HTML duplication.

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
- Refresh button is a static icon (Material `refresh` + `🔄` fallback) — do NOT set `api.refresh.textContent` (it was removed)
- Header layout: title left, `.actions` group (theme-toggle / refresh / close, all 32px icon buttons) right-aligned via flex `justify-content: space-between`
- UI controls inside `innerHTML` bodies use body event delegation, not direct element bindings
- Repeated buttons use shared render functions: `renderHarvestButton(readyCount)` for 一键收菜, `renderCareButton(careCount, careNeeded, className)` for 一键务农. Overview hero buttons (`.overview-action .harvest-all`, `.overview-action .overview-care`) are BOTH outline style (white/transparent bg + themed border); panel buttons (`.farm-care-actions` context) are filled (`.inventory-sell-selected`). Always use these render functions instead of inlining button HTML.
- Button styles shared across panels: `.inventory-sell-selected` reused by 一键务农, `.inventory-actions` layout reused by farm-care area
- New notice features should use `renderNotice(…)` with a unique `noticeKey`; the dismiss handler automatically clears `{noticeKey}` and `{noticeKey}Type` from state
- New format helpers: `formatCountdown(seconds)` — remaining time countdown, 天档位跨天带 `X天Y小时Z分钟` (used by overview focus number and plot cards); `formatDateTime(date)` — Beijing time `MM/DD HH:mm` (used by overview-note and auto-harvest hint). No bare `HH:mm` clock text without a date prefix
- Overview stats are clickable `stat-card` buttons using `data-action="scroll-to-panel"` + `data-panel`. Precise scroll targeting uses `data-scroll-anchor` on button containers (e.g. `.inventory-actions`, `.farm-care-actions`); falls back to the panel `<details>` element.

## 版本号规则

- 遵循 SemVer（语义化版本）`MAJOR.MINOR.PATCH`，与 Conventional Commits 联动：
  - 小修小补（`fix:` 等，无新功能）→ PATCH +1（最后一位）
  - 新功能（`feat:`，非革命性）→ MINOR +1（中间位）
  - 重大/破坏性变更（`!` 或 BREAKING）→ MAJOR +1（首位，由用户决定）
- 混合模式：
  - userscript `@version` 每次改动顺手 +1（Tampermonkey 靠它检测更新）
  - CHANGELOG 补条目 + 正式发版：攒到里程碑集中做，集中定大版本
- 发版时机由用户显式触发：agent 每次改动只机械执行 `@version` +1，不做任何发版动作；用户明确说「发版 / 更新 CHANGELOG」时 agent 才补 CHANGELOG、定大版本。agent 检测到破坏性变更只提示用户，不擅自 bump MAJOR
- 版本号记录位置：userscript `@version` + `doc/CHANGELOG.md`（发布时同步）
- `package.json` 版本号不维护，以 userscript `@version` 为准（当前已脱节，不影响使用）

## Known sharp edges

1. **`npm run rank` is broken** — correct path is `node script/crop-profit-ranking.js`
2. **No tests** — all validation is manual via README checklist or browser smoke testing
3. **`conditions` field is NOT `string[]`**: API returns objects `{kind: "thirsty"}`. `normalizeCrops` maps them to `{kind, name, icon}` via `DEBUFF_META`. Don't call `.join("、")` on raw conditions.
4. **Icon font MUST load via FontFace API**: shadow-root `@font-face` (in `<style>` or via `<link>`) silently fails to load in Chromium on the real game page — icons render as raw ligature text (`light_mode`). This is verified behavior; do not "simplify" back to CSS `@font-face`.
5. **`normalizeFriendFarm`**: friend with `firstCrop === null` is wrongly marked stealable
6. **`fetchFriendStatuses`** uses unbounded `Promise.all` — one failure rejects entire friends page
7. **Mutation paths** (harvest/recycle/plant/steal/auto-harvest/care) change server state with zero automated coverage
8. **Background refresh failures** (`refreshCropStatus`) silently swallowed — no stale indicator
9. **`cookie.txt`** is gitignored but still in repo root — easy to leak via zip/screenshot
10. **npm audit** must use official registry (`--registry=https://registry.npmjs.org`) — configured mirror doesn't support audit
