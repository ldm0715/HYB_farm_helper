# AGENTS.md — hyubai_farm

## Project overview

Tampermonkey userscript + Node CLI helper for HYB Farm (黑与白农场). Pure JS, no build/bundle/test/CI.

- **Main artifact**: `Tampermonkey/farm-profit-ranking.user.js` (~3300 lines, single IIFE, Shadow DOM UI)
- **CLI**: `script/crop-profit-ranking.js` (uses `cli-table3`)
- **Docs**: `doc/api.md` (API contracts), `doc/implement.md` (impl details)
- **Audit**: `audit-report-hyubai-farm-ranking-2026-06-11.md` (known issues, fix roadmap)

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

**Note**: `npm run rank` in `package.json` is broken — it points to `node crop-profit-ranking.js` instead of `node script/crop-profit-ranking.js`. The README command is correct.

## Architecture

### Userscript entry
IIFE at `document-idle`, calls `createRoot()` → `render(api)` → `refreshCropStatus(api)`. Shadow DOM isolation, CSS variables for light/dark theme, `innerHTML` full re-render on state change.

### State management
Single mutable global `state` object. All handlers mutate `state` directly then call `render(api)`. Theme persisted via `localStorage` (`hyb-farm-profit-theme` key).

### API layer
`requestJson()` wraps `GM_xmlhttpRequest` with 15s timeout, `anonymous: false` to carry browser cookies. 12 endpoints all under `https://cdk.hybgzs.com/api/farm/`. Price normalization: `real_price = api_value / 500000` (`PRICE_DIVISOR`).

### Three tabs
收益排行 / 我的农场 / 好友农场 — event delegation on `.body`, tab selection in `state.currentPage`.

## Key conventions

- No framework, no bundler, no TypeScript — all plain JS
- `escapeHtml` for dynamic content before `innerHTML`
- API constants centralized near top of script
- `@match` and `@connect` scoped to `cdk.hybgzs.com` only
- Historical `.user-v*.js` files are archives; only `farm-profit-ranking.user.js` is active

## Known sharp edges

1. **`npm run rank` is broken** — correct path is `node script/crop-profit-ranking.js`
2. **No tests** — all validation is manual via README checklist or browser smoke testing
3. **`normalizeFriendFarm`**: friend with `firstCrop === null` is wrongly marked stealable (`isStealable` computed as `remainingTime <= 0` → `true`)
4. **`fetchFriendStatuses`** uses unbounded `Promise.all` — one failure rejects entire friends page
5. **Mutation paths** (harvest/recycle/plant/steal) change server state with zero automated coverage
6. **Background refresh failures** (`refreshCropStatus`) silently swallowed — no stale indicator
7. **`cookie.txt`** is gitignored but still in repo root — easy to leak via zip/screenshot
8. **npm audit** must use official registry (`--registry=https://registry.npmjs.org`) — configured mirror doesn't support audit
