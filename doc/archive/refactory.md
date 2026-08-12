# HYB Farm Helper 重构预览版说明

## 文件位置

重构预览版位于：

```text
Tampermonkey/refactor.js
```

它不会替换当前主脚本：

```text
Tampermonkey/farm-profit-ranking.user.js
```

`refactor.js` 是基于当前主脚本复制出来的可安装预览版本，用于验证审计报告中优先级较高、风险较明确的修复点。它仍然保持单文件 Tampermonkey 脚本形态，不引入构建工具，也不改变发布主线。

## 元数据差异

预览版的脚本名称改为：

```js
// @name         HYB Farm Helper Refactor Preview
```

描述改为：

```js
// @description  重构预览版：保留原功能，并改进好友加载、种植校验和后台刷新诊断。
```

这样在 Tampermonkey 中安装时可以和正式版区分开，避免误以为它就是当前发布脚本。

## 本次重构目标

本次不是彻底模块化重写，而是一个保守重构版本，目标是：

1. 保持脚本可直接安装，不引入打包步骤。
2. 修复审计报告里已确认的稳定性问题。
3. 把高风险逻辑收敛到更明确的辅助函数。
4. 为后续模块化拆分提供较小、可验证的中间状态。

后续如果项目加入构建流程，可以继续把 API 客户端、数据归一化器、操作流程和渲染辅助函数拆成独立模块，再打包成最终用户脚本。

## 已落实的审计项

### 1. 好友空详情误判可偷菜

原逻辑中，好友详情没有第一块地时，`firstCrop` 为 `null`，但 `remainingTime` 会被计算为 `0`，从而让 `isStealable` 变成 `true`。

预览版改为：

```js
const isStealable = Boolean(firstCrop) && (Boolean(firstCrop.isMature) || remainingTime <= 0);
```

现在必须存在 `firstCrop`，才允许进入可偷菜判断。

### 2. 好友详情请求全有全无

原逻辑在 `fetchFriendStatuses()` 中直接对所有好友详情使用 `Promise.all`。只要任意一个好友详情请求失败，整个好友页都会失败。

预览版新增：

```js
const FRIEND_DETAIL_CONCURRENCY = 5;
async function mapLimitSettled(items, limit, mapper) { ... }
```

新行为：

- 好友详情最多 5 个并发请求。
- 单个好友详情失败不会影响其它好友显示。
- 成功加载的好友继续正常排序和渲染。
- 失败数量会进入 `state.friendStatusFailures`。

### 3. 好友页局部失败提示

当部分好友详情加载失败时，好友页会显示提示：

```text
有 N 位好友状态加载失败，其余好友已正常显示。
```

当所有好友详情都失败时，不再误显示“暂无好友农场数据”，而是显示：

```text
好友状态加载失败 N 个，请稍后刷新重试。
```

### 4. 种植容量快速失败

原逻辑中，如果 `/api/farm/plots` 没有返回有效 `totalSlots`，会继续回退到 `freeSlots` 或根据空地数量猜测容量。

这对展示可以接受，但对 `plant-batch` 这种会改变账号状态的操作风险较高。

预览版改为：

```js
if (!Number.isFinite(totalSlots)) {
  throw new Error("无法确认当前土地容量，已取消种植操作");
}
```

现在无法确认权威土地容量时，会直接取消种植操作，不再继续调用 `plant-batch`。

### 5. 后台刷新失败可观测

原逻辑中，`refreshCropStatus()` 失败时只清除 `cropStatusLoading`，不会留下任何状态。

预览版新增：

```js
lastBackgroundRefreshErrorAt: ""
```

刷新失败时记录失败时间，并在顶部状态栏显示：

```text
后台刷新失败 HH:mm:ss
```

刷新成功后会清空该诊断状态。

### 6. 状态栏文案集中处理

预览版新增：

```js
function getStatusText() { ... }
```

顶部状态栏文案统一由这个函数生成，避免刷新失败提示散落在主渲染函数里。

## 主要新增状态字段

```js
friendStatusFailures: 0,
lastBackgroundRefreshErrorAt: "",
```

字段含义：

| 字段 | 含义 |
| --- | --- |
| `friendStatusFailures` | 本次好友详情加载失败数量 |
| `lastBackgroundRefreshErrorAt` | 最近一次后台成熟状态刷新失败时间 |

## 行为变化

| 场景 | 原主脚本行为 | refactor.js 行为 |
| --- | --- | --- |
| 好友无第一块地作物 | 可能被误判为可偷菜 | 不会被判为可偷菜 |
| 某个好友详情请求失败 | 整个好友页失败 | 成功的好友继续显示，失败数量单独提示 |
| 好友数量较多 | 所有详情一次性并发 | 最多 5 个并发 |
| 种植容量接口缺少 `totalSlots` | 使用兜底值继续判断 | 直接取消种植操作 |
| 后台成熟状态刷新失败 | 完全静默 | 状态栏显示失败时间 |

## 验证方式

语法检查：

```powershell
node --check .\Tampermonkey\refactor.js
```

当前检查结果：已通过。

建议人工验证：

1. 在 Tampermonkey 中安装 `Tampermonkey/refactor.js`。
2. 打开 `https://cdk.hybgzs.com/`。
3. 确认 Tampermonkey 脚本名称显示为 `HYB Farm Helper Refactor Preview`。
4. 展开右下角 `$` 面板。
5. 检查收益排行页是否正常加载。
6. 检查我的农场页是否正常显示地块、库存和一键收菜按钮。
7. 检查好友农场页是否正常显示好友列表。
8. 如果部分好友详情接口失败，应看到局部失败提示，而不是整页加载失败。
9. 在无法确认土地容量时，一键种植应显示“无法确认当前土地容量，已取消种植操作”。
10. 如果后台成熟状态刷新失败，顶部状态栏应显示后台刷新失败时间。

## 未完成的长期重构

预览版仍然保留当前单文件结构，尚未解决以下结构性问题：

- 主脚本仍然超过 3000 行。
- CSS、DOM、状态、接口和操作流程仍在一个文件内。
- 还没有自动化测试。
- 还没有构建步骤。
- 还没有把 API 客户端、归一化器、操作服务、渲染层拆成独立模块。

这些问题适合下一阶段处理。建议顺序：

1. 先添加 `check` 脚本，自动运行 `node --check`。
2. 抽出纯数据函数，优先覆盖 `normalizeFriendFarm`、`fetchPlantCapacity`、库存选择逻辑。
3. 加入测试运行器。
4. 引入轻量打包流程，将模块打包回 Tampermonkey 单文件。
5. 再拆分 UI 渲染和操作流程。

## 与正式版的关系

`refactor.js` 只是预览版。确认行为稳定后，可以选择：

1. 将修复点合并回 `farm-profit-ranking.user.js`。
2. 或者继续以 `refactor.js` 为基础做第二阶段模块化拆分。

在正式替换主脚本前，应至少完成：

- `node --check Tampermonkey/refactor.js`
- 好友页人工验证
- 一键种植失败保护验证
- 一键收菜、一键卖出、一键种植和偷菜的基本流程验证
- `@version` 递增

