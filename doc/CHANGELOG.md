# CHANGELOG

## [3.2.0] — 2026-08-12

### Added
- 自动务农：独立 5min 轮询（`AUTO_CARE_POLL_MS`）+ `visibilitychange` 唤醒，自动检测并处理地块 debuff（缺水💧/杂草🌿/虫害🐛）
- 自动务农今日统计：仅自动务农轮询累加 `processed` 到 `state.autoCareDaily`（北京时间日界，localStorage `hyb-farm-profit-auto-care-daily`），面板提示「今日已处理 N 处 debuff」
- `performCareAll()` 共享核心（POST `care/all`，返回 `{ok, message, processed, crops}`），手动一键务农与自动务农复用

### Changed
- 「自动收菜」面板更名为「自动操作」，新增「自动务农」开关（同款 toggle 样式 + 独立 hint）
- 自动收菜 / 自动务农 / 手动务农互相并发互斥（guard 全部加 `autoCareBusy`）

## [3.1.0] — 2026-08-12

### Added
- 我的农场总览 hero 重新设计：焦点大数字（可收获数量/下一块成熟 HH:mm）+ 一键行动区 + 三格统计条（生长中·空地 / 待务农 / 仓库·总回收价值）
- 统计条点击滚动定位到对应面板按钮（`data-action="scroll-to-panel"` + `data-scroll-anchor` 精确锚点）
- `formatClock(date)` 工具函数（北京时间 HH:mm 短格式）
- `renderHarvestButton(readyCount)` / `renderCareButton(careCount, careNeeded, className)` 共享渲染函数，消除按钮 HTML 重复

### Changed
- 一键务农按钮同时出现在总览 hero（描边样式）和农场情况面板（填充样式）
- 一键收菜按钮同时出现在总览 hero 和农场情况面板（务农按钮右侧）
- 一键收菜按钮显示可收获个数：`一键收菜 (N)`
- 总览两个行动按钮统一尺寸（36px），靠颜色区分主次
- AGENTS.md 同步更新架构说明和新增约定

## [3.0.0] — 2026-08-12

### Added
- 自动收菜 + 可配置补种（60s 轮询 + 成熟定时器 + 页面可见性唤醒）
- 一键务农（`POST /api/farm/care/all`），处理所有地块 debuff
- Debuff 显示系统（缺水💧/杂草🌿/虫害🐛 emoji + 红色状态文字）
- 统一可关闭通知条系统（`renderNotice`），替换旧的分散通知样式
- 一键务农按钮：有 debuff 时显示「一键务农 (N)」，无 debuff 置灰

### Fixed
- 修复作物 conditions 字段变更为对象数组后面板显示 `[object Object]`

### Changed
- 通知条 CSS 统一为 `.notice` 类（替换旧 `.inventory-recycle-notice`、`.steal-notice`、`.auto-harvest-notice`）
- `handleHarvestAll`（含确认）拆分为 `performHarvestAll`（无确认）+ 外部分支，复用给自动收菜

## [2.8.15] — 2026-06-09

### Added
- 我的仓库面板：多选 + 数量步进器 + 小计
- 一键卖出（逐个 request quote + recycle）
- 一键种植（种植前校验空闲土地数量）

## [2.5.0] — 2026-06-09

### Added
- 农场情况面板：一键收菜（含二次确认）
- 好友偷菜功能

## [2.0.0] — 2026-06-07

### Added
- 初始版本
- 收益排行（种子图鉴 + 实时回收价格）
- 我的农场（当前地块展示）
- 好友农场（偷菜判断）
- Shadow DOM 隔离 UI
- 亮色 / 暗色主题切换（localStorage 持久化）
