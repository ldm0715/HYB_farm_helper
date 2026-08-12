# 网络请求优化执行计划

## 背景

2026-08-12 用户手动刷新页面数次并进入好友农场后，触发 HYB Farm 网站风控。排查脚本请求模式后定位出多处突发式并发设计，形成本计划的 P1-P5 优化项。

## 问题分析

脚本常态请求量不高，风险集中在**突发式并发**：

| 风险 | 位置 | 说明 |
|---|---|---|
| 🔴 好友农场 N+1 并发风暴 | `fetchFriendStatuses` 内 `Promise.all(friends.map(...))` | 1 次列表 + N 个详情请求同时发出，无上限 |
| 🔴 收菜 + 补种流水线 | `performHarvestAll` + 补种段 | 一轮约 8-10 个请求集中在 15s 内，含 2 次重复 GET crops |
| 🟠 一键种植多选 | `handlePlantSelectedInventory` | POST 串行 for 循环，选 N 种 = N 个 POST |
| 🟡 无全局节流 | `requestJson` | 同 URL 并发 GET 无 in-flight 合并，多触发源（60s 轮询 + visibilitychange + 成熟定时器 + 手动点击）可叠加 |
| 🟡 切 tab 不刷新 | tab handler `needsData()` | 仅首次进入某页才拉数据，之后切 tab 复用旧数据 |
| 🟡 刷新按钮顺带拉别的页 | `refreshData` | 非我的农场页点刷新会额外静默 `refreshCropStatus` |

## 方案设计与落地

全部改动已随 v3.2.9 合入 `Tampermonkey/farm-profit-ranking.user.js`（单文件，无构建）。

### P1 补种链瘦身

- `fetchPlantCapacity(cropsOverride)` 参数化（`farm-profit-ranking.user.js:3636`）：传入调用方已拉取的 crops 则跳过内部重复的 force GET crops；不传保持原行为（一键种植 `handlePlantSelectedInventory` 不传参，行为不变）
- 补种段（`runAutoHarvestCycle`）删掉一次多余的 `fetchCropsData({ force: true })`，改复用 `performHarvestAll` 返回的 `harvestResult.crops`（`:4312`）
- 收尾两连 fetch（crops + inventory）保留：harvest/plant 确实改了数据，必须重拉
- 效果：自动收菜每轮 10 → 8 请求，手动 9 → 7

### P2 好友分页 + 详情缓存

- 新增常量：`FRIENDS_PAGE_SIZE = 5`、`FRIEND_DETAIL_CACHE_MS = 30000`
- `fetchFriendStatuses({ forceDetails })` 改为**返回对象** `{ statuses, total, totalPages, page, fromCache }`（非数组），调用方须读 `.statuses`（偷菜 handler 已适配）
- 详情请求分页：只并发拉当前页好友，`fetchFriendDetails` 用 3 并发 worker 池；好友列表接口始终重拉
- 详情缓存：`state.friendDetailCache[friendId] = { status, fetchedAt }`，TTL 30s；该好友偷菜成功/业务失败后 `delete state.friendDetailCache[friendId]` 强制重拉；刷新按钮 `forceFriendDetails: true` 全量绕过缓存
- `state.friendFromCache` 驱动过期提示（`.friend-stale-hint`），引导用户点顶部刷新按钮
- 分页 UI：`data-action="friend-prev-page"` / `friend-next-page` + `.friend-pagination`
- 排序变化：成熟时间升序仅**当前页内**生效，跨页全局排序取消；可偷优先仍有效
- 效果：好友页请求 1+N → 1+5 封顶

### P3 requestJson 层 GET 去重

- `requestJson` 拆分出 `performRequest`；同 URL 的 GET 已有 in-flight 请求时复用（`inflightGetRequests` Map），POST 与带 body 请求永不合并
- `force: true` 语义保留：`fetchCropsData`/`fetchInventoryData` 的 force 只绕过各自 per-call promise 复用，不绕过 requestJson GET 去重（同一时刻极端并发时仍合并，数据为幂等查询，影响可忽略）

### P4 刷新按钮只刷当前页

- `refreshData` 删除非我的农场页时顺带的 `refreshCropStatus(api)` 调用
- 效果：收益页刷新 3 → 2 请求，好友页 2+N → 1+5
- 边界：悬浮按钮成熟金色状态不再靠刷新按钮"捎带"更新，改由成熟定时器 `cropReadyTimer` + 切回我的农场页 + visibilitychange 兜底

### P5 切 tab 自动刷新当前页

- tab handler 删除 `needsData()` "仅首次"门控，改为 `if (state.expanded && !state.loading) refreshData(api, { force: true })`
- 我的农场页 = crops + inventory 重拉；收益页 = SEEDS + PRICES；好友页 = 列表 force + 详情命中 30s 缓存
- `needsData()` 仍被面板展开与 loading 文案使用，未删除
- 代价：切 tab 从"零请求"变为"每次当前页 2-6 请求"，属低频主动操作，配合 P1-P3 总量可控

## 验证

无自动化测试框架，验证方式：

1. `node --check Tampermonkey/farm-profit-ranking.user.js` 语法校验（已通过）
2. 浏览器冒烟清单：
   - 一键收菜（手动/自动/补种）：补种正常，Network 请求数下降
   - 一键种植多选：行为与改动前一致
   - 好友页：分页、翻页、缓存过期提示、刷新按钮强制刷新
   - 偷菜成功/失败后该好友从可偷列表退出
   - 切 tab 每次刷新、刷新按钮各页请求数
   - 悬浮按钮成熟转金色

## 存档说明

本文档为已落地计划的存档记录，改动均已合入 v3.2.9（`@version` 3.2.9）。CHANGELOG 正式条目待用户发版时统一补充。
