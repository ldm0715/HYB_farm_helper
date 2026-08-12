# 自动收菜 + 可配置补种 — 执行计划

## 1. 目标

为 HYB Farm Helper（`Tampermonkey/farm-profit-ranking.user.js`）新增：

- **自动收菜**：作物成熟时自动收获，默认关闭，设置中开启。
- **自动补种**：可选。玩家在设置里从仓库选一个作物；收完后补种到空闲地。仓库没有所选作物则记"补种失败"；库存不足则种完现有库存（能种多少种多少）。

## 2. 现状与可复用点

| 位置 | 说明 |
|---|---|
| `farm-profit-ranking.user.js:452` `cropReadyTimer` | 现有"下一块地成熟时刻"单次定时器，到点仅 `render(api)`。改造为主触发点 |
| `:3196` `handleHarvestAll` | 一键收菜，含 `window.confirm`。抽出无 confirm 的核心逻辑 |
| `:2744` `fetchPlantCapacity` | 返回 `{ freeSlots, totalSlots, ... }`，补种前校验空闲地 |
| `:2834` `plantInventoryItem` | POST `plant-batch`，按 `{ seedId, quantity }` 种植 |
| `:3259` `refreshCropStatus` | 静默刷新地块状态，可作轮询基础 |
| `:371` `getLiveCrop` / `:417` `hasReadyCrops` | 按当前时间重算成熟状态 |

## 3. 方案设计

### 3.1 触发机制

1. **成熟触发（主）**：`cropReadyTimer` 回调改为 `render(api)` 后，若 `state.autoHarvestEnabled` 则调用 `runAutoHarvestCycle(api)`
2. **兜底轮询**：初始化时启动 60s `setInterval`，每次调 `runAutoHarvestCycle`（无成熟作物时空转）
3. **唤醒检查**：`visibilitychange` 事件，标签页重新可见时立即检查一次

### 3.2 新增常量

```js
const AUTO_HARVEST_STORAGE_KEY = "hyb-farm-profit-auto-harvest";
const REPLANT_SEED_STORAGE_KEY = "hyb-farm-profit-replant-seed";
const AUTO_HARVEST_MIN_INTERVAL_MS = 30000;
const AUTO_HARVEST_POLL_MS = 60000;
```

### 3.3 新增 state

```js
autoHarvestEnabled: getInitialAutoHarvest(), // localStorage，默认 false
autoHarvestBusy: false,   // 自动流程防重入
lastAutoHarvestAt: 0,     // 距上次收获间隔
autoHarvestNotice: "",    // 最近一次自动收菜/补种结果
autoHarvestNoticeType: "",// "success" | "error" | ""
settingsOpen: false,      // 设置面板展开态
replantSeedId: "",        // localStorage，"" = 不补种
```

### 3.4 核心函数

- `getInitialAutoHarvest()` / `saveAutoHarvest(enabled)` / `saveReplantSeed(seedId)` — localStorage 读写
- `performHarvestAll(api)` — 从 `handleHarvestAll` 抽出，去掉 `window.confirm`
- `runAutoHarvestCycle(api)` — guard → 拉 crops → 收获 → 补种 → 刷新 → render

### 3.5 UI

- 头部 `.actions` 加"设置"按钮（⚙️），打开/收起设置面板
- 设置面板含：自动收菜开关 + 补种作物下拉（选项来自库存 + "不补种"）
- 结果 notice 复用 `.steal-notice` 模式
- 全部颜色走 CSS 变量，dark 用 `:host(.theme-dark)` 覆盖

## 4. 防护与边界

- `state.harvesting` / `autoHarvestBusy` 双重 guard
- 30s 最小收获间隔
- 自动路径不弹 `window.confirm`
- 睡眠/节流只延迟，不遗漏

## 5. 验证

1. `node --check Tampermonkey/farm-profit-ranking.user.js`
2. 浏览器冒烟（亮/暗双主题）：开设定→选作物→成熟→收菜+补种；清空库存→补种失败；库存不足→部分补种；不选→只收；持久化；互不干扰
