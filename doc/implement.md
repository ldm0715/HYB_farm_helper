# HYB Farm 油猴脚本实现文档

## 文件位置

主脚本：

```text
Tampermonkey/farm-profit-ranking.user.js
```

这是一个 Tampermonkey 用户脚本，只匹配：

```text
https://cdk.hybgzs.com/*
```

脚本元数据当前约定：

```text
@version 2.8.15
@license MIT
```

后续只要修改脚本行为或用户可见能力，都需要同步递增 `@version`。许可证固定声明为 MIT。

脚本不依赖 React/Vue 等框架，不引入远程库。界面使用原生 DOM、Shadow DOM 和内联 CSS 实现。

## 功能概览

脚本在页面右下角创建一个 `$` 悬浮按钮。点击后展开一个轻量面板，面板包含三个页面：

```text
收益排行
我的农场
好友农场
```

收益排行页用于判断“种什么最划算”，核心展示每小时收益。

我的农场页用于查看自己的农场状态，核心包含“农场情况”和“我的仓库”两个折叠面板。

农场情况面板使用 `/api/farm/crops` 一次性获取最大田地数量和种植数据，按 `maxSlots` 补齐空地，并以每行 6 块地展示。

我的仓库面板使用 `/api/farm/inventory` 展示库存作物。默认卡片显示图标、名称、数量和回收价格；进入多选模式后卡片显示图标、名称、库存、数量输入步进器和小计，并提供一键卖出、一键种植按钮。

当自己的农场存在可收获作物时，右下角悬浮按钮会从绿色切换为金黄色；收获后如果没有成熟作物，会恢复绿色。

好友农场页用于查看好友第一块地是否成熟，成熟则提示可偷菜，并为每个好友提供访问农场和偷菜按钮。

脚本不会轮询接口。只有以下场景会请求接口：

```text
脚本启动后静默请求一次自己的地块状态，用于判断悬浮按钮是否金黄
首次展开面板
切换到当前缺少数据的页面
点击刷新按钮
点击我的农场页的一键收菜按钮
点击我的仓库多选状态下的一键卖出按钮
点击我的仓库多选状态下的一键种植按钮
点击好友农场页的偷菜按钮
```

## 接口

### 通用请求约定

所有接口都由 `requestJson(url, options)` 发起请求。查询类接口使用 `GET`，一键收菜、好友偷菜、回收报价、回收卖出和批量种植接口使用 `POST`。

请求实现：

```js
function requestJson(url, options = {}) {
  const method = options.method || "GET";
  const hasBody = options.body !== undefined && options.body !== null;
  const data =
    hasBody && typeof options.body === "object"
      ? JSON.stringify(options.body)
      : options.body;

  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method,
      url,
      anonymous: false,
      headers: {
        accept: "application/json",
        ...(hasBody ? { "content-type": "application/json" } : {}),
      },
      ...(hasBody ? { data } : {}),
      timeout: 15000,
      onload(response) {
        let json;

        try {
          json = JSON.parse(response.responseText);
        } catch {
          reject(new Error(`接口返回的不是 JSON：${url}`));
          return;
        }

        if (response.status < 200 || response.status >= 300 || json.success === false) {
          const message = json.error?.message || response.statusText || "请求失败";
          const error = new Error(message);
          error.code = json.error?.code;
          error.payload = json;
          reject(error);
          return;
        }

        resolve(json);
      },
      onerror() {
        reject(new Error("网络请求失败"));
      },
      ontimeout() {
        reject(new Error("网络请求超时"));
      },
    });
  });
}
```

认证方式：

```text
依赖浏览器当前登录态 Cookie
```

`anonymous: false` 表示请求会携带当前站点 Cookie。脚本不会读取、保存或硬编码 Cookie。

通用成功响应外层：

```ts
type ApiSuccess<T> = {
  success: true;
  data: T;
};
```

通用失败响应外层：

```ts
type ApiFailure = {
  success: false;
  error?: {
    code?: number;
    message?: string;
  };
};
```

失败处理规则：

```text
HTTP 状态码不在 200-299 范围内，视为失败
JSON 解析失败，视为失败
success === false，视为失败
onerror / ontimeout，视为失败
```

失败后 `refreshData(api)` 会写入：

```js
state.error = error.message || "加载失败";
```

UI 会展示错误文本，不会继续渲染旧页面内容。

POST 请求说明：

```text
/api/farm/harvest-all 使用 POST，不需要请求体
/api/farm/steal/friend-auto 使用 POST，需要 JSON 请求体
/api/farm/recycle/quote 使用 POST，需要 JSON 请求体
/api/farm/recycle 使用 POST，需要 JSON 请求体
/api/farm/plant-batch 使用 POST，需要 JSON 请求体
需要 JSON body 时通过 requestJson(url, { method: "POST", body: {...} }) 发送
```

### 种子图鉴接口

用途：

```text
获取所有作物的静态配置，用于收益排行计算和作物图标展示。
```

请求：

```http
GET https://cdk.hybgzs.com/api/farm/codex/seeds?
Accept: application/json
Cookie: 浏览器自动携带
```

路径参数：

```text
无
```

查询参数：

```text
无。URL 末尾的 ? 当前不传任何参数。
```

脚本调用位置：

```js
loadCurrentPageData()
buildRanking(seedsPayload, pricesPayload)
normalizeSeeds(payload)
```

响应结构：

```ts
type SeedsResponse = ApiSuccess<{
  seeds: Seed[];
}>;

type Seed = {
  id: string;
  name: string;
  description?: string;
  image: string;
  price?: string;
  growthTime: number;
  harvestQuantity: number;
  harvestValue?: string;
  experienceValue?: number;
  isVipOnly: boolean;
  sortOrder?: number;
};
```

脚本实际使用字段：

```text
data.seeds[].id 作物 ID，用于和价格 seedId 关联
data.seeds[].name 作物中文名，用于 UI 展示
data.seeds[].image 作物图片相对路径，用于拼接小图标
data.seeds[].growthTime 成熟耗时，单位秒
data.seeds[].harvestQuantity 单次成熟数量
data.seeds[].isVipOnly 是否 VIP 作物，用于收益页筛选
```

图标 URL 拼接规则：

```text
https://cdk.hybgzs.com + image + _s4.png
```

示例：

```text
image = /farm/crops/carrot
iconUrl = https://cdk.hybgzs.com/farm/crops/carrot_s4.png
```

### 实时价格接口

用途：

```text
获取作物实时回收价格，用于计算单价、单次成熟收益和每小时收益。
```

请求：

```http
GET https://cdk.hybgzs.com/api/farm/recycle/prices?includeTrend=1&granularity=day&trendRange=7
Accept: application/json
Cookie: 浏览器自动携带
```

路径参数：

```text
无
```

查询参数：

```text
includeTrend=1 请求返回趋势数据
granularity=day 趋势粒度为天
trendRange=7 趋势范围为 7 天
```

当前脚本不会使用趋势数据，只使用实时价格字段。保留这些查询参数是因为接口当前调用来源沿用了包含趋势的价格接口。

脚本调用位置：

```js
loadCurrentPageData()
buildRanking(seedsPayload, pricesPayload)
normalizePrices(payload)
```

响应结构：

```ts
type PricesResponse = ApiSuccess<RecyclePrice[]> & {
  market?: {
    items?: MarketItem[];
  };
};

type RecyclePrice = {
  seedId: string;
  recyclePrice: string;
};

type MarketItem = {
  seedId: string;
  seedName?: string;
  seedImage?: string;
  unitPrice: string;
  totalSupply?: number;
  trend?: Array<{
    bucketStartedAt: string;
    avgUnitPrice: string;
    avgTotalSupply?: number;
    sampleCount?: number;
  }>;
};
```

脚本实际使用字段：

```text
data[].seedId 作物 ID
data[].recyclePrice 回收价格显示整数
market.items[].seedId 备用作物 ID
market.items[].unitPrice 备用市场单价显示整数
```

价格归一化规则：

```text
真实美元单价 = 接口显示价格 / 500000
```

代码位置：

```js
prices.set(seedId, displayPrice / PRICE_DIVISOR);
```

其中：

```js
const PRICE_DIVISOR = 500000;
```

### 当前地块接口

用途：

```text
获取自己农场的最大田地数量、种植数据和地块等级，用于我的农场页的农场情况面板和悬浮按钮成熟提醒。
```

请求：

```http
GET https://cdk.hybgzs.com/api/farm/crops
Accept: application/json
Cookie: 浏览器自动携带
```

路径参数：

```text
无
```

查询参数：

```text
无
```

脚本调用位置：

```js
loadCurrentPageData()
normalizeCrops(payload)
renderCropsPage(api)
renderPlotCard(crop)
```

响应结构：

```ts
type CropsResponse = {
  success: true;
  data?: Crop[];
  crops?: Crop[];
  baseSlots?: number;
  maxSlots?: number;
  isVip?: boolean;
  plotLevels?: PlotLevel[];
};

type Crop = {
  id: string;
  seedId: string;
  seedName: string;
  seedImage: string;
  plantedAt: string;
  maturesAt: string;
  isHarvested: boolean;
  isMature: boolean;
  remainingTime: number;
  plotIndex: number;
  thirstyStartedAt?: string | null;
  weedStartedAt?: string | null;
  pestStartedAt?: string | null;
  thirstyHealedAt?: string | null;
  weedHealedAt?: string | null;
  pestHealedAt?: string | null;
  debuffDelaySeconds?: number;
  lastDelayFlushAt?: string | null;
  conditions?: string[];
};

type PlotLevel = {
  plotIndex: number;
  level: number;
  theme: string;
};
```

脚本实际使用字段：

```text
data[].id 地块作物记录 ID
data[].plotIndex 地块序号，UI 展示为 #plotIndex+1
data[].seedId 作物 ID
data[].seedName 作物名称
data[].seedImage 作物图标相对路径
data[].maturesAt UTC 成熟时间点
data[].isHarvested 是否已收获；已收获会作为空地处理
data[].isMature 是否成熟
data[].remainingTime 剩余成熟秒数
data[].conditions 异常状态列表
maxSlots 当前账号最大田地数量，优先作为农场情况要展示的田地总数
plotLevels[].plotIndex 地块等级数据里的地块序号，作为 maxSlots 缺失时的兜底来源
```

时间处理：

```text
maturesAt 是 UTC 时间，通常带 Z 后缀
UI 使用 Asia/Shanghai 转换为北京时间
remainingTime 单位为秒
```

成熟判断：

```js
isMature = Boolean(crop.isMature) || remainingTime <= 0;
```

排序规则：

```text
农场情况面板最终按 plotIndex 从小到大展示，保证空地和已种植地块位置稳定
摘要和下一块成熟逻辑使用实时成熟状态，成熟地块优先，其余按 remainingTime 从小到大排序
maxSlots 内没有种植数据的位置会由 createEmptyPlot(plotIndex) 补成空地
```

### 我的仓库接口

用途：

```text
获取自己仓库中的作物库存，用于我的农场页的我的仓库折叠面板。
```

请求：

```http
GET https://cdk.hybgzs.com/api/farm/inventory
Accept: application/json
Cookie: 浏览器自动携带
```

脚本调用位置：

```js
loadFarmPageData()
fetchInventoryData()
normalizeInventory(payload)
renderInventoryCard(item)
```

响应结构：

```ts
type InventoryResponse = ApiSuccess<InventoryItem[]>;

type InventoryItem = {
  seedId: string;
  seedName: string;
  seedImage: string;
  quantity: number;
  recyclePrice: string;
};
```

脚本实际使用字段：

```text
data[].seedId 作物 ID，用于多选数量、报价和回收请求
data[].seedName 作物名称
data[].seedImage 作物图标相对路径
data[].quantity 当前库存数量
data[].recyclePrice 当前回收价格显示整数
```

仓库价格处理和收益排行一致，统一使用：

```js
normalizeDisplayPrice(item.recyclePrice)
formatUsd(value)
```

也就是：

```text
真实美元价格 = 接口价格整数 / 500000
UI 固定展示 2 位小数，并按浏览器数字格式化四舍五入
```

UI 行为：

```text
我的仓库是我的农场页内的折叠面板，取消多选不会自动收起
默认状态每行 6 个卡片，显示图标、名称、数量、回收价格
多选状态每行 6 个卡片，显示图标、名称、库存、数量输入步进器、小计
数量输入只限制单项范围：0 <= selectedQuantity <= 当前作物库存数量
一键卖出不限制所有选中作物数量之和与田地数量的关系
一键种植会在点击后重新校验所有选中数量之和不能大于当前空闲土地数量
多选操作栏左侧是“多选”，右侧依次是“一键卖出”“一键种植”
```

### 农场地块容量接口

用途：

```text
一键种植前获取当前总土地数量，用于计算还能种多少个作物。
```

请求：

```http
GET https://cdk.hybgzs.com/api/farm/plots
Accept: application/json
Cookie: 浏览器自动携带
```

响应结构：

```ts
type FarmPlotsResponse = ApiSuccess<{
  totalSlots: number;
  freeSlots: number;
  unlockedSlots: number;
  vipBonusSlots: number;
  maxUnlockable: number;
  unlockedPlotIndexes: number[];
  nextUnlock?: {
    plotIndex: number;
    requiredLevel: number;
    cost: string;
    canUnlock: boolean;
    reason?: string;
  };
  vipPlotStartIndex?: number;
  vipPlotEndIndex?: number;
  unlockedPlotLevels?: Record<string, number>;
}>;
```

脚本实际使用字段：

```text
data.totalSlots 当前总土地数量
data.freeSlots 仅作为 totalSlots 缺失时的兜底
```

空闲土地计算：

```text
当前已种植数量 = 最新 /api/farm/crops 归一化后 !isEmpty 的地块数量
当前空闲土地数量 = data.totalSlots - 当前已种植数量
```

脚本不会直接信任旧的页面状态。一键种植前会并发请求 `/api/farm/plots` 和强制刷新 `/api/farm/crops`，用最新数据做最终校验。

### 回收报价接口

用途：

```text
在真正卖出前获取当前最新市场单价，作为回收接口的 expectedUnitPrice。
```

请求：

```http
POST https://cdk.hybgzs.com/api/farm/recycle/quote
Accept: application/json
Content-Type: application/json
Cookie: 浏览器自动携带
```

请求体：

```json
{
  "seedId": "pumpkin",
  "quantity": 1
}
```

响应结构：

```ts
type RecycleQuoteResponse = ApiSuccess<{
  seedId: string;
  quantity: number;
  unitPrice: string;
  totalQuota: string;
  quotedAt: string;
}>;
```

脚本实际使用字段：

```text
data.unitPrice 最新市场单价原始整数，直接作为回收接口 expectedUnitPrice
```

注意：`unitPrice` 在传给回收接口时保持原始字符串，不做 `/ 500000` 归一化。只有 UI 展示金额时才归一化。

### 作物回收接口

用途：

```text
按我的仓库多选数量卖出作物。
```

请求：

```http
POST https://cdk.hybgzs.com/api/farm/recycle
Accept: application/json
Content-Type: application/json
Cookie: 浏览器自动携带
```

请求体：

```json
{
  "seedId": "pumpkin",
  "quantity": 1,
  "expectedUnitPrice": "612581",
  "maxSlippageBps": 300
}
```

字段说明：

```text
seedId 作物 ID
quantity 当前作物选中的卖出数量
expectedUnitPrice 来自回收报价接口 data.unitPrice
maxSlippageBps 固定为 300
```

响应结构：

```ts
type RecycleResponse = ApiSuccess<{
  seedId: string;
  quantity: number;
  unitPrice: string;
  totalQuota: string;
  slippageBps: number;
}>;
```

脚本调用位置：

```js
getSelectedInventoryItems()
fetchRecycleQuote(seedId, quantity)
recycleInventoryItem(item)
formatRecycleSuccessMessage(item, recycleData)
handleRecycleSelectedInventory(api)
```

UI 行为：

```text
一键卖出按钮在多选状态下显示在仓库操作栏右侧
只有多选状态、选中数量大于 0、且当前没有回收请求时按钮可点击
点击后一项一项执行：先 quote，再 recycle
成功后强制刷新仓库，清空已选数量，保持我的仓库面板展开
每个成功结果格式化为“卖出{quantity}个{seedName}获得{formatUsd(totalQuota / 500000)}”
多条成功结果用换行拼接，提示条使用 white-space: pre-line 保留换行
如果中途失败，已成功的消息会保留，并在最后追加错误信息
```

### 批量种植接口

用途：

```text
按我的仓库多选数量种植作物。一次请求只能种植一种作物，选中多种作物时需要逐个 seedId 发送多次请求。
```

请求：

```http
POST https://cdk.hybgzs.com/api/farm/plant-batch
Accept: application/json
Content-Type: application/json
Cookie: 浏览器自动携带
```

请求体：

```json
{
  "seedId": "pumpkin",
  "quantity": 1
}
```

字段说明：

```text
seedId 作物 ID
quantity 当前作物选中的种植数量
```

响应结构：

```ts
type PlantBatchResponse = ApiSuccess<{
  plantedCount: number;
  experience: number;
  purchasedCount: number;
  totalCost: string;
}>;
```

脚本调用位置：

```js
fetchPlantCapacity()
plantInventoryItem(item)
formatPlantSuccessMessage(item, plantData)
handlePlantSelectedInventory(api)
```

UI 行为：

```text
一键种植按钮在多选状态下显示在一键卖出按钮右侧
只有多选状态、选中数量大于 0、且当前没有卖出/种植请求时按钮可点击
点击后先请求 plots 和最新 crops，计算 totalSlots - 已种植数量
如果已选总数大于当前空闲土地数量，直接显示错误，不发送 plant-batch
如果空地足够，按选中作物逐个请求 plant-batch
每个成功结果格式化为“种植 {quantity} 个{seedName}成功”
多条成功结果用换行拼接，复用仓库提示区域展示
成功后强制刷新地块和仓库，清空已选数量，保持我的仓库面板展开
如果中途失败，已成功的消息会保留，并在最后追加错误信息
```

### 一键收菜接口

用途：

```text
收获自己农场中所有已经成熟的作物，用于我的农场页的一键收菜按钮。
```

请求：

```http
POST https://cdk.hybgzs.com/api/farm/harvest-all
Accept: application/json
Cookie: 浏览器自动携带
```

路径参数：

```text
无
```

查询参数：

```text
无
```

请求体：

```text
无
```

脚本调用位置：

```js
handleHarvestAll(api)
requestJson(HARVEST_ALL_URL, { method: "POST" })
```

响应结构：

```ts
type HarvestAllResponse = ApiSuccess<unknown>;
```

脚本不依赖该接口返回的具体业务字段。请求成功后会立即重新请求当前地块接口：

```js
const cropsPayload = await requestJson(CROPS_URL);
state.crops = normalizeCrops(cropsPayload);
```

UI 行为：

```text
我的农场页 readyCount > 0 时按钮可点击
readyCount === 0 时按钮禁用
点击后弹出二次确认
请求期间按钮显示“收菜中”并禁用
成功后刷新我的农场页地块数据；如果仓库已经加载，也会同步刷新仓库数据
失败后展示错误信息
```

### 好友列表接口

用途：

```text
获取可以查看偷菜状态的好友列表，并拿到后续请求好友详情所需的 id。
```

请求：

```http
GET https://cdk.hybgzs.com/api/farm/friends/stealable
Accept: application/json
Cookie: 浏览器自动携带
```

路径参数：

```text
无
```

查询参数：

```text
无
```

脚本调用位置：

```js
fetchFriendStatuses()
normalizeFriendList(payload)
```

响应结构：

```ts
type FriendsStealableResponse = ApiSuccess<{
  friends: FriendSummary[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}>;

type FriendSummary = {
  id: string;
  username: string;
  avatar: string;
  stealable?: {
    isStealable: boolean;
    ripeCount: number;
    stealableCount: number;
  };
};
```

脚本实际使用字段：

```text
data.friends[].id 好友 ID，用于请求 /api/farm/friends/{id}
data.friends[].username 好友名，用于 UI 展示
data.friends[].avatar 好友头像 URL，用于 UI 展示
data.friends[].stealable 当前仅保留到状态对象，实际是否可偷菜以后续详情第一块地为准
```

注意：

```text
好友列表里的 stealable 是摘要信息，不作为最终判断依据。
最终判断使用好友详情 crops 中第一块地的成熟状态。
```

### 好友农场详情接口

用途：

```text
获取单个好友农场的地块详情，用第一块地判断该好友是否可以偷菜。
```

请求：

```http
GET https://cdk.hybgzs.com/api/farm/friends/{id}
Accept: application/json
Cookie: 浏览器自动携带
```

路径参数：

```text
id 好友列表接口 data.friends[].id
```

查询参数：

```text
无
```

脚本调用位置：

```js
fetchFriendStatuses()
buildFriendFarmUrl(friendId)
buildFriendFarmPageUrl(friendId)
normalizeFriendFarm(friend, payload)
renderFriendsPage(api)
renderFriendBar(friend)
```

响应结构：

```ts
type FriendFarmResponse = ApiSuccess<{
  friend: {
    id: string;
    username: string;
    avatar: string;
  };
  crops: Crop[];
  baseSlots?: number;
  maxSlots?: number;
  isVip?: boolean;
}>;
```

`Crop` 字段与“当前地块接口”里的 `Crop` 基本一致。

脚本实际使用字段：

```text
data.friend.id 好友 ID
data.friend.username 好友名
data.friend.avatar 好友头像
data.crops[].plotIndex 地块序号
data.crops[].seedName 第一块地作物名称
data.crops[].seedImage 第一块地作物图标相对路径
data.crops[].maturesAt 第一块地 UTC 成熟时间点
data.crops[].isMature 第一块地是否成熟
data.crops[].remainingTime 第一块地剩余成熟秒数
```

第一块地选择规则：

```js
const firstCrop =
  crops.find((crop) => Number(crop.plotIndex) === 0) || crops[0] || null;
```

好友可偷菜判断：

```js
isStealable = Boolean(firstCrop?.isMature) || remainingTime <= 0;
```

排序规则：

```text
可偷菜好友排最前
不可偷菜好友按第一块地 maturesAt 从早到晚排序
```

好友农场访问页面：

```http
https://cdk.hybgzs.com/entertainment/farm/friends/{id}
```

脚本通过 `buildFriendFarmPageUrl(friendId)` 构造该 URL，并在每个好友 bar 中渲染为 `访问农场` 链接按钮。

### 好友偷菜接口

用途：

```text
对指定好友执行偷菜。脚本只允许第一块地成熟的好友触发该请求。
```

请求：

```http
POST https://cdk.hybgzs.com/api/farm/steal/friend-auto
Accept: application/json
Content-Type: application/json
Cookie: 浏览器自动携带
```

请求体：

```json
{
  "friendId": "cmo5swxfz71sfvjhqmupbhb0j"
}
```

字段说明：

```text
friendId 好友列表接口 data.friends[].id
```

成功响应示例：

```json
{
  "success": true,
  "victimId": "cmo5swxfz71sfvjhqmupbhb0j",
  "stolenCrops": [
    {
      "seedId": "starfruit",
      "quantity": 46
    }
  ],
  "watchdogTriggered": false,
  "cropsReturned": 0,
  "quotaPenalty": "0",
  "message": "一键偷菜完成：获得 46 个作物"
}
```

失败响应示例：

```json
{
  "success": false,
  "error": {
    "code": 20053,
    "message": "已经被偷的毛都不剩了，下次再来吧"
  }
}
```

脚本调用位置：

```js
handleStealFriend(api, friendId)
requestJson(STEAL_FRIEND_AUTO_URL, {
  method: "POST",
  body: { friendId },
})
```

UI 行为：

```text
每个好友 bar 都显示“访问农场”和“偷菜”两个按钮
访问农场按钮始终可点，并在新标签页打开好友农场页面
偷菜按钮只有 friend.isStealable 为 true、当前没有偷菜请求且接口不在冷却期时可点
请求期间当前好友按钮显示“偷菜中”，其他好友偷菜按钮禁用
短时间重复点击会被 5 秒冷却拦截，按钮显示“冷却中”
成功时展示“好友名农场：接口 message”，缺少 message 时按 stolenCrops 汇总数量
失败时展示“好友名农场 + 接口 error.message”，不清空好友列表
成功和失败提示使用同一套提示条样式，文字统一居中
请求成功后重新请求好友列表和好友详情，刷新好友农场页状态
请求失败后展示错误信息
```

## 数据流

### 请求层

`requestJson(url, options)` 使用 Tampermonkey 的 `GM_xmlhttpRequest` 请求接口。

关键配置：

```js
anonymous: false
```

这样浏览器会携带当前站点 Cookie，不需要在脚本里保存 Cookie。

完整实现：

```js
function requestJson(url, options = {}) {
  const method = options.method || "GET";
  const hasBody = options.body !== undefined && options.body !== null;
  const data =
    hasBody && typeof options.body === "object"
      ? JSON.stringify(options.body)
      : options.body;

  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method,
      url,
      anonymous: false,
      headers: {
        accept: "application/json",
        ...(hasBody ? { "content-type": "application/json" } : {}),
      },
      ...(hasBody ? { data } : {}),
      timeout: 15000,
      onload(response) {
        let json;

        try {
          json = JSON.parse(response.responseText);
        } catch {
          reject(new Error(`接口返回的不是 JSON：${url}`));
          return;
        }

        if (response.status < 200 || response.status >= 300 || json.success === false) {
          const message = json.error?.message || response.statusText || "请求失败";
          const error = new Error(message);
          error.code = json.error?.code;
          error.payload = json;
          reject(error);
          return;
        }

        resolve(json);
      },
      onerror() {
        reject(new Error("网络请求失败"));
      },
      ontimeout() {
        reject(new Error("网络请求超时"));
      },
    });
  });
}
```

细节说明：

```text
anonymous: false 让请求带上浏览器当前 Cookie
timeout: 15000 避免接口无响应时一直卡在加载态
JSON.parse 放在 try/catch 中，接口返回 HTML 或 Cloudflare 页面时会走错误分支
success === false 会读取 error.message 展示给用户
```

### 按页加载

脚本不会每次刷新都请求所有接口，而是根据当前页签只加载需要的数据。

完整实现：

```js
async function loadFarmPageData({ force = false } = {}) {
  const cropsPromise =
    force || state.crops.length === 0 ? fetchCropsData({ force }) : Promise.resolve(state.crops);
  const inventoryPromise =
    force || !state.inventoryLoaded ? fetchInventoryData({ force }) : Promise.resolve(state.inventory);
  const [crops, inventory] = await Promise.all([cropsPromise, inventoryPromise]);

  return {
    crops,
    inventory,
    inventoryLoaded: true,
    inventorySelections: normalizeInventorySelections(inventory, state.inventorySelections),
  };
}

async function loadCurrentPageData({ force = false } = {}) {
  if (state.page === "friends") {
    return {
      friends: await fetchFriendStatuses(),
    };
  }

  if (state.page === "crops") {
    return loadFarmPageData({ force });
  }

  const [seedsPayload, pricesPayload] = await Promise.all([
    requestJson(SEEDS_URL),
    requestJson(PRICES_URL),
  ]);

  return {
    rows: buildRanking(seedsPayload, pricesPayload),
  };
}
```

细节说明：

```text
friends 页才请求好友列表和好友详情，避免拖慢收益页
crops 页是“我的农场”，并发请求自己的地块状态和仓库数据
profit 页并发请求种子图鉴和价格接口
函数返回局部 state，refreshData 负责合并进全局 state
```

### 数据归一化

`normalizeSeeds(payload)` 将种子图鉴转换成收益计算需要的静态数据。

`normalizePrices(payload)` 将实时价格转换成：

```js
Map<seedId, unitPrice>
```

`normalizeCrops(payload)` 将地块数据转换成我的农场页面需要的数据。它不会猜测田地数量，优先使用接口返回的 `maxSlots`，再用 `plotLevels.length`、作物里的最大 `plotIndex + 1`、地块等级里的最大 `plotIndex + 1` 兜底。

接口没有返回作物的位置会用 `createEmptyPlot(plotIndex)` 补成空地，保证农场情况面板显示完整田地。

`normalizeInventory(payload)` 将仓库数据转换成我的仓库面板需要的数据，并把 `recyclePrice` 归一化成真实美元价格。

`normalizeInventorySelections(inventory, selections)` 会在仓库刷新后按最新库存修正多选数量，避免卖出后保留超过库存的选择值。

`getLiveCrop(crop)` 会基于 `maturesAt` 和当前时间重新计算 `isMature` 与 `remainingTime`，避免地块数据加载后停留一段时间导致成熟状态不更新。

`getLiveCrops()` 会返回按当前时间更新并重新排序后的地块列表。

`hasReadyCrops()` 用于判断右下角悬浮按钮是否需要切换为金黄色。

`scheduleNextCropReadyRender(api)` 会在下一块地成熟时自动触发一次 `render(api)`，让按钮从绿色自动转为金黄色。

`refreshCropStatus(api)` 会静默请求 `CROPS_URL`，只更新自己的地块成熟状态、悬浮按钮颜色和下一次成熟定时器；失败时不影响当前面板页面。

`normalizeFriendList(payload)` 将好友列表接口转换成好友基础信息。

`normalizeFriendFarm(friend, payload)` 将单个好友详情转换成好友农场状态。

`fetchFriendStatuses()` 会先请求好友列表，再并发请求每个好友的详情接口。

好友农场状态排序：

```text
可偷菜好友排最前
其余好友按第一块地成熟时间从早到晚排序
```

好友状态加载完整实现：

```js
async function fetchFriendStatuses() {
  const friendsPayload = await requestJson(FRIENDS_STEALABLE_URL);
  const friends = normalizeFriendList(friendsPayload);
  const statuses = await Promise.all(
    friends.map(async (friend) => {
      const detailPayload = await requestJson(buildFriendFarmUrl(friend.id));
      return normalizeFriendFarm(friend, detailPayload);
    }),
  );

  return statuses.sort((a, b) => {
    if (a.isStealable !== b.isStealable) {
      return a.isStealable ? -1 : 1;
    }

    const aTime = a.firstCrop?.maturesAt?.getTime?.() || Number.POSITIVE_INFINITY;
    const bTime = b.firstCrop?.maturesAt?.getTime?.() || Number.POSITIVE_INFINITY;
    return aTime - bTime;
  });
}
```

细节说明：

```text
先请求好友列表，因为详情接口需要好友 id
Promise.all 并发请求好友详情，减少等待时间
可偷菜好友排在最前
不可偷菜好友按第一块地成熟时间排序
没有第一块地时间的好友会排到最后
```

## 收益计算

收益排行页的核心指标是每小时收益：

```text
单次成熟收益 = 真实美元单价 * 成熟数量
每小时收益 = 单次成熟收益 / 成熟时间秒数 * 3600
```

排序规则：

```text
每小时收益从高到低
```

UI 中顶部 hero 显示当前筛选条件下每小时收益最高的作物。

完整实现：

```js
function buildRanking(seedsPayload, pricesPayload) {
  const seeds = normalizeSeeds(seedsPayload);
  const prices = normalizePrices(pricesPayload);

  return seeds
    .map((seed) => {
      const unitPrice = prices.get(seed.id);

      if (
        !Number.isFinite(unitPrice) ||
        !Number.isFinite(seed.growthTimeSeconds) ||
        !Number.isFinite(seed.harvestQuantity) ||
        seed.growthTimeSeconds <= 0
      ) {
        return null;
      }

      const harvestRevenue = unitPrice * seed.harvestQuantity;
      const revenuePerHour = (harvestRevenue / seed.growthTimeSeconds) * 3600;

      return {
        ...seed,
        unitPrice,
        harvestRevenue,
        revenuePerHour,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.revenuePerHour - a.revenuePerHour);
}
```

细节说明：

```text
prices 是 Map<seedId, unitPrice>，通过 seed.id 匹配实时价格
缺价格、成熟时间异常、产量异常的数据不参与排行
harvestRevenue 是单次成熟收益
revenuePerHour 是跨作物对比最核心的指标
最后按 revenuePerHour 降序排序
```

## 成熟判断

地块是否成熟使用以下规则：

```js
isMature = Boolean(crop.isMature) || remainingTime <= 0
```

原因是接口中的 `isMature` 可能比倒计时归零稍晚刷新。使用 `remainingTime <= 0` 兜底可以避免 UI 漏提示可收获。

成熟地块展示效果：

```text
在摘要和下一块成熟逻辑中排在已种植地块前面
农场情况面板仍按 plotIndex 展示，避免地块位置跳动
卡片添加 ready class
浅绿色背景
绿色边框
绿色作物图标边框
显示“可收获”徽标
时间位置显示“现在 / 可收获”
```

地块归一化完整实现：

```js
function normalizeCrops(payload) {
  const crops = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.data?.crops)
      ? payload.data.crops
      : [];

  const normalizedCrops = crops
    .map((crop) => {
      const isEmpty = Boolean(crop.isHarvested);
      const remainingTime = isEmpty ? Number.POSITIVE_INFINITY : Math.max(0, Number(crop.remainingTime || 0));
      const maturesAt = !isEmpty && crop.maturesAt ? new Date(crop.maturesAt) : null;

      return {
        id: crop.id,
        plotIndex: Number(crop.plotIndex),
        seedId: crop.seedId,
        seedName: isEmpty ? "空地" : crop.seedName || crop.seedId || "未知作物",
        iconUrl: isEmpty ? "" : buildCropIconUrl(crop.seedImage),
        maturesAt,
        isMature: !isEmpty && (Boolean(crop.isMature) || remainingTime <= 0),
        remainingTime,
        isEmpty,
        conditions: Array.isArray(crop.conditions) ? crop.conditions : [],
      };
    })
    .sort((a, b) => {
      if (a.isEmpty !== b.isEmpty) {
        return a.isEmpty ? 1 : -1;
      }

      if (a.isMature !== b.isMature) {
        return a.isMature ? -1 : 1;
      }

      if (a.remainingTime !== b.remainingTime) {
        return a.remainingTime - b.remainingTime;
      }

      return a.plotIndex - b.plotIndex;
    });

  const maxPlotIndexFromCrops = normalizedCrops.reduce((maxIndex, crop) => {
    return Number.isFinite(crop.plotIndex) ? Math.max(maxIndex, crop.plotIndex) : maxIndex;
  }, -1);
  const plotLevels = Array.isArray(payload?.plotLevels) ? payload.plotLevels : [];
  const maxPlotIndexFromLevels = plotLevels.reduce((maxIndex, plot) => {
    const plotIndex = Number(plot?.plotIndex);
    return Number.isFinite(plotIndex) ? Math.max(maxIndex, plotIndex) : maxIndex;
  }, -1);
  const maxSlots = Number(payload?.maxSlots);
  const plotCount = Math.max(
    Number.isFinite(maxSlots) ? maxSlots : 0,
    plotLevels.length,
    maxPlotIndexFromCrops + 1,
    maxPlotIndexFromLevels + 1,
  );
  const cropsByPlotIndex = new Map();

  for (const crop of normalizedCrops) {
    if (!Number.isFinite(crop.plotIndex)) {
      continue;
    }

    const existingCrop = cropsByPlotIndex.get(crop.plotIndex);
    if (!existingCrop || (existingCrop.isEmpty && !crop.isEmpty)) {
      cropsByPlotIndex.set(crop.plotIndex, crop);
    }
  }

  for (let plotIndex = 0; plotIndex < plotCount; plotIndex += 1) {
    if (!cropsByPlotIndex.has(plotIndex)) {
      cropsByPlotIndex.set(plotIndex, createEmptyPlot(plotIndex));
    }
  }

  return Array.from(cropsByPlotIndex.values()).sort((a, b) => {
    if (a.isEmpty !== b.isEmpty) {
      return a.isEmpty ? 1 : -1;
    }

    if (a.isMature !== b.isMature) {
      return a.isMature ? -1 : 1;
    }

    if (a.remainingTime !== b.remainingTime) {
      return a.remainingTime - b.remainingTime;
    }

    return a.plotIndex - b.plotIndex;
  });
}
```

细节说明：

```text
接口目前 data 是数组，但兼容 data.crops 数组结构
maxSlots 是田地总数的首选来源；缺失时才使用 plotLevels 和 plotIndex 兜底
接口没有返回作物的位置会补 createEmptyPlot(plotIndex)，空地必须显示
已收获记录会作为空地处理，不再直接过滤掉
remainingTime 做 Math.max(0, ...) 避免负数影响 UI；空地使用 Infinity 排到最后
maturesAt 转成 Date，渲染时再格式化为北京时间
isMature 用 remainingTime <= 0 兜底
农场情况渲染前会再按 plotIndex 排序，保证每块地固定显示在自己的位置
```

## 好友偷菜判断

好友农场页只检查好友农场的第一块地。

判断规则：

```js
isStealable = Boolean(firstCrop.isMature) || remainingTime <= 0
```

如果第一块地成熟，好友 bar 显示：

```text
可偷菜
现在
```

如果第一块地未成熟，好友 bar 显示：

```text
等待
北京时间成熟时间
剩余时间
```

如果好友没有头像，则使用用户名首字符作为 fallback 头像。

好友详情归一化完整实现：

```js
function normalizeFriendFarm(friend, payload) {
  const detailFriend = payload?.data?.friend || payload?.friend || {};
  const crops = Array.isArray(payload?.data?.crops)
    ? payload.data.crops
    : Array.isArray(payload?.crops)
      ? payload.crops
      : [];
  const firstCrop =
    crops.find((crop) => Number(crop.plotIndex) === 0) || crops[0] || null;
  const remainingTime = Math.max(0, Number(firstCrop?.remainingTime || 0));
  const maturesAt = firstCrop?.maturesAt ? new Date(firstCrop.maturesAt) : null;
  const isStealable = Boolean(firstCrop?.isMature) || remainingTime <= 0;

  return {
    id: friend.id,
    username: detailFriend.username || friend.username,
    avatar: detailFriend.avatar || friend.avatar,
    isStealable,
    firstCrop: firstCrop
      ? {
          seedName: firstCrop.seedName || firstCrop.seedId || "未知作物",
          iconUrl: buildCropIconUrl(firstCrop.seedImage),
          maturesAt,
          remainingTime,
        }
      : null,
  };
}
```

细节说明：

```text
优先使用详情接口里的 friend 信息，缺失时回退好友列表信息
第一块地优先找 plotIndex === 0，找不到则回退 crops[0]
判断可偷菜只看第一块地
firstCrop 为 null 时 UI 会展示“第一块地暂无作物”
```

## UI 结构

脚本使用 Shadow DOM 隔离样式：

```js
const shadow = host.attachShadow({ mode: "open" });
```

Shadow DOM 的作用：

```text
避免脚本样式影响原网站
避免原网站 CSS 覆盖脚本面板
```

主要 DOM 区域：

```text
.trigger 右下角悬浮按钮
.trigger.has-ready-crops 自己农场存在可收获作物时的金黄色悬浮按钮状态
.panel 展开面板
.header 标题、更新时间、主题切换、刷新、关闭；顶部标题固定显示“黑与白农场小助手”
.theme-toggle 标题栏主题切换按钮，浅色时显示 🌙，暗色时显示 ☀️
.tabs 收益排行 / 我的农场 / 好友农场
.filters 收益页专用的 全部 / 普通 / VIP 筛选
.body 当前页面内容
```

面板初始结构中，悬浮按钮和面板都使用同一名称做无障碍标签：

```html
<button class="trigger" type="button" title="黑与白农场小助手" aria-label="打开黑与白农场小助手">$</button>
<section class="panel hidden" aria-label="黑与白农场小助手">
  <div class="header">
    <div class="title">
      <strong>黑与白农场小助手</strong>
      <span class="status">等待加载</span>
    </div>
  </div>
</section>
```

如果悬浮按钮变为可收获提醒状态，`title` 会临时改为“有作物可以收获”，但 `aria-label` 仍保留“打开黑与白农场小助手”作为入口名称。

`filters` 只在收益排行页显示：

```js
api.filters.classList.toggle("hidden", state.page !== "profit");
```

`hidden` 使用：

```css
display: none !important;
```

这是为了覆盖 `.filters { display: flex; }`。

主题样式也在 Shadow DOM 的 `<style>` 中维护。默认浅色主题直接使用 `:host` 上的 CSS 变量；暗色主题通过给 host 增加 `theme-dark` 类触发：

```css
:host(.theme-dark) {
  color-scheme: dark;
  --bg: #111827;
  --text: #e5e7eb;
  --muted: #9ca3af;
  --line: #263241;
  --soft: #0f172a;
  --accent: #22a66f;
  --accent-strong: #64d89a;
  --gold: #f6b84b;
  --warn: #f97066;
}
```

卡片、按钮、提示条、成熟状态和好友状态使用 `:host(.theme-dark) ...` 做必要覆盖，避免只改变量后仍残留浅色背景。

## 状态对象

全局状态在 `state` 中：

```js
{
  expanded: false,
  loading: false,
  cropStatusLoading: false,
  harvesting: false,
  stealingFriendId: "",
  stealCooldownUntil: 0,
  stealNotice: "",
  stealNoticeType: "",
  page: "profit",
  vipMode: "all",
  theme: getInitialTheme(),
  rows: [],
  crops: [],
  farmStatusPanelOpen: false,
  inventory: [],
  inventoryLoaded: false,
  inventoryPanelOpen: false,
  inventorySelectMode: false,
  inventorySelections: {},
  inventoryRecycling: false,
  inventoryPlanting: false,
  inventoryRecycleNotice: "",
  inventoryRecycleNoticeType: "",
  friends: [],
  error: "",
  updatedAt: ""
}
```

字段说明：

```text
expanded 面板是否展开
loading 是否正在请求接口
cropStatusLoading 是否正在静默刷新自己的地块成熟状态
harvesting 是否正在执行一键收菜
stealingFriendId 当前正在执行偷菜的好友 ID，空字符串表示没有偷菜请求
stealCooldownUntil 偷菜接口冷却结束时间戳
stealNotice 好友页展示的偷菜成功或失败文案
stealNoticeType 偷菜提示类型，success / error
page 当前页签，profit / crops / friends
vipMode 收益排行筛选，all / normal / vip
theme 当前 UI 主题，light / dark；初始值来自 localStorage
rows 收益排行数据
crops 我的农场地块数据，包含已种植地块和补齐后的空地
farmStatusPanelOpen 农场情况折叠面板是否展开；切换主题等重渲染不能重置这个状态
inventory 我的仓库作物库存数据
inventoryLoaded 仓库数据是否已加载
inventoryPanelOpen 我的仓库折叠面板是否展开
inventorySelectMode 我的仓库是否处于多选模式
inventorySelections 仓库多选数量，键为 seedId，值为选择数量
inventoryRecycling 是否正在执行一键卖出
inventoryPlanting 是否正在执行一键种植
inventoryRecycleNotice 我的仓库一键卖出或一键种植成功/失败提示文案，支持换行
inventoryRecycleNoticeType 仓库操作提示类型，success / error
friends 好友农场状态数据
error 当前错误信息
updatedAt 最近一次成功更新时间
```

主题持久化使用浏览器 `localStorage`，键名为：

```js
const THEME_STORAGE_KEY = "hyb-farm-profit-theme";
```

`getInitialTheme()` 只接受保存值 `dark`，其他情况都回退到 `light`。`saveTheme(theme)` 保存用户选择；如果 `localStorage` 不可用，只影响当前页面内的切换，不阻断脚本运行。

## 渲染函数

`render(api)` 是主渲染入口，负责同步全局 UI 状态，并按当前页分发：

```js
if (state.page === "crops") {
  renderCropsPage(api);
  return;
}

if (state.page === "friends") {
  renderFriendsPage(api);
  return;
}

renderProfitPage(api);
```

`renderProfitPage(api)` 渲染收益排行页。

`renderCropsPage(api)` 渲染我的农场页，包括顶部摘要、农场情况面板和我的仓库面板。

`renderFriendsPage(api)` 渲染好友农场页。

`renderCropCard(row, index, maxProfit)` 渲染单个收益排行作物卡片。

`renderPlotCard(crop)` 渲染单个地块卡片。

`renderInventoryCard(item)` 渲染单个仓库作物卡片，按 `inventorySelectMode` 切换默认视图和多选视图。

`renderFriendBar(friend)` 渲染单个好友农场状态条。

`handleHarvestAll(api)` 执行一键收菜操作。

`handleRecycleSelectedInventory(api)` 执行我的仓库多选一键卖出操作。

`handlePlantSelectedInventory(api)` 执行我的仓库多选一键种植操作。

`handleStealFriend(api, friendId)` 执行好友偷菜操作。

`refreshCropStatus(api)` 静默刷新自己的地块成熟状态，用于悬浮按钮金黄色提醒。

`renderCropIcon(iconUrl, name, sizeClass)` 渲染作物图标，使用：

```html
loading="lazy"
decoding="async"
```

以降低图片加载对页面的影响。

主渲染分发完整实现：

```js
function render(api) {
  const readyCrops = hasReadyCrops();
  const isDarkTheme = state.theme === "dark";
  api.host.classList.toggle("theme-dark", isDarkTheme);
  api.panel.classList.toggle("hidden", !state.expanded);
  api.trigger.textContent = state.expanded ? "×" : "$";
  api.trigger.classList.toggle("has-ready-crops", readyCrops);
  api.trigger.title = readyCrops ? "有作物可以收获" : "黑与白农场小助手";
  api.trigger.setAttribute("aria-label", readyCrops ? "打开黑与白农场小助手，有作物可以收获" : "打开黑与白农场小助手");
  api.themeToggle.textContent = isDarkTheme ? "☀️" : "🌙";
  api.themeToggle.title = isDarkTheme ? "切换浅色主题" : "切换暗色主题";
  api.themeToggle.setAttribute("aria-label", isDarkTheme ? "切换浅色主题" : "切换暗色主题");
  api.refresh.disabled = state.loading;
  api.refresh.textContent = state.loading ? "加载中" : "刷新";
  api.filters.classList.toggle("hidden", state.page !== "profit");

  for (const chip of api.chips) {
    chip.classList.toggle("active", chip.dataset.vip === state.vipMode);
  }

  for (const tab of api.tabs) {
    tab.classList.toggle("active", tab.dataset.page === state.page);
  }

  if (state.error) {
    api.status.textContent = "加载失败";
    api.summary.textContent = "";
    api.body.innerHTML = `<div class="error">${escapeHtml(state.error)}</div>`;
    return;
  }

  api.status.textContent = state.updatedAt
    ? `更新于 ${state.updatedAt}`
    : state.loading
      ? "正在获取实时价格"
      : "展开后加载实时数据";

  if (state.loading && needsData()) {
    api.summary.textContent = "";
    api.body.innerHTML = `<div class="empty">正在加载...</div>`;
    return;
  }

  if (state.page === "crops") {
    renderCropsPage(api);
    return;
  }

  if (state.page === "friends") {
    renderFriendsPage(api);
    return;
  }

  renderProfitPage(api);
}
```

细节说明：

```text
render 是唯一主入口，所有状态变更后都调用它
收益页才显示 普通/VIP 筛选
错误状态优先级最高，会直接覆盖 body
loading 且当前页缺数据时展示加载占位
最后按 page 分发到具体页面渲染函数
```

### 操作按钮事件

我的农场页的 `一键收菜`、仓库多选步进器、仓库 `一键卖出`、仓库 `一键种植` 和好友农场页的 `偷菜` 按钮都通过事件委托绑定在 `.body` 上。这样页面重渲染后，不需要重新查询按钮再绑定事件。

事件绑定：

```js
api.themeToggle.addEventListener("click", () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  saveTheme(state.theme);
  render(api);
});

api.body.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const button = event.target.closest("[data-action]");
  if (!button) {
    return;
  }

  if (button.dataset.action === "harvest-all") {
    handleHarvestAll(api);
    return;
  }

  if (button.dataset.action === "steal-friend" && !button.disabled) {
    handleStealFriend(api, button.dataset.friendId);
    return;
  }

  if (button.dataset.action === "inventory-step" && !button.disabled) {
    stepInventorySelection(api, button.dataset.seedId, Number(button.dataset.delta) || 0);
    return;
  }

  if (button.dataset.action === "inventory-recycle-selected" && !button.disabled) {
    handleRecycleSelectedInventory(api);
    return;
  }

  if (button.dataset.action === "inventory-plant-selected" && !button.disabled) {
    handlePlantSelectedInventory(api);
  }
});

api.body.addEventListener("change", (event) => {
  if (!(event.target instanceof HTMLInputElement)) {
    return;
  }

  if (event.target.matches(".inventory-select-input")) {
    setInventorySelection(api, event.target.dataset.seedId, event.target.value);
    return;
  }

  if (event.target.matches(".inventory-select-checkbox")) {
    setInventorySelectMode(api, event.target.checked);
  }
});

api.body.addEventListener(
  "toggle",
  (event) => {
    if (!(event.target instanceof HTMLDetailsElement)) {
      return;
    }

    if (event.target.dataset.panel === "farm-status") {
      state.farmStatusPanelOpen = event.target.open;
      return;
    }

    if (event.target.dataset.panel === "inventory") {
      state.inventoryPanelOpen = event.target.open;
    }
  },
  true,
);
```

`.theme-toggle` 是固定标题栏按钮，不随 `.body` 内容重渲染，因此直接绑定 click 事件。切换时只更新 `state.theme`、保存到 `localStorage`，然后交给 `render(api)` 同步 `theme-dark` 类和 🌙 / ☀️ 图标。

### 一键收菜实现

完整实现：

```js
async function handleHarvestAll(api) {
  if (state.harvesting) {
    return;
  }

  const readyCount = getLiveCrops().filter((crop) => crop.isMature).length;
  if (readyCount === 0) {
    return;
  }

  const confirmed = window.confirm(`确认一键收获 ${readyCount} 块成熟地吗？`);
  if (!confirmed) {
    return;
  }

  state = {
    ...state,
    harvesting: true,
    error: "",
  };
  render(api);

  try {
    await requestJson(HARVEST_ALL_URL, { method: "POST" });
    const [crops, inventory] = await Promise.all([
      fetchCropsData({ force: true }),
      state.inventoryLoaded ? fetchInventoryData({ force: true }) : Promise.resolve(state.inventory),
    ]);

    state = {
      ...state,
      harvesting: false,
      crops,
      inventory,
      inventorySelections: normalizeInventorySelections(inventory, state.inventorySelections),
      updatedAt: new Date().toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    };
    scheduleNextCropReadyRender(api);
  } catch (error) {
    state = {
      ...state,
      harvesting: false,
      error: error.message || "一键收菜失败",
    };
  }

  render(api);
}
```

细节说明：

```text
state.harvesting 防止重复点击
readyCount 使用 getLiveCrops() 计算，避免地块到点后旧 remainingTime 还没刷新导致按钮不可用
readyCount === 0 时直接返回，按钮本身也会禁用
window.confirm 是二次确认，避免误触改变农场状态
POST 成功后刷新 CROPS_URL；如果仓库已加载，也刷新 INVENTORY_URL
成功后重新安排下一块成熟提醒
失败时设置 state.error，由 render(api) 统一展示错误
```

### 仓库一键卖出实现

仓库一键卖出只在我的仓库多选状态下可用。多选数量来自 `state.inventorySelections`，每个作物只限制在 `0` 到该作物当前库存数量之间。

核心流程：

```js
async function recycleInventoryItem(item) {
  const quote = await fetchRecycleQuote(item.seedId, item.selectedQuantity);
  const payload = await requestJson(RECYCLE_URL, {
    method: "POST",
    body: {
      seedId: item.seedId,
      quantity: item.selectedQuantity,
      expectedUnitPrice: String(quote.unitPrice),
      maxSlippageBps: RECYCLE_MAX_SLIPPAGE_BPS,
    },
  });

  return payload?.data || {};
}
```

`handleRecycleSelectedInventory(api)` 会按选中作物顺序逐项执行：

```text
1. getSelectedInventoryItems() 取出 selectedQuantity > 0 的仓库作物
2. fetchRecycleQuote(seedId, quantity) 获取最新 unitPrice
3. recycleInventoryItem(item) 使用 unitPrice 作为 expectedUnitPrice 发起回收
4. formatRecycleSuccessMessage(item, recycleData) 格式化每条成功消息
5. 成功后强制刷新仓库、清空 selections、保持仓库面板展开
```

金额展示：

```js
const totalPrice = normalizeDisplayPrice(recycleData.totalQuota);
formatUsd(totalPrice);
```

失败处理：

```text
已成功卖出的作物消息会保留
最后追加接口错误消息或“一键卖出失败”
卖出失败后仍尽量刷新仓库，并按最新库存修正已选数量
```

### 仓库一键种植实现

仓库一键种植和一键卖出共用多选数量，但种植前会额外校验空闲土地数量。这个限制只作用于种植动作，不会限制一键卖出的选择数量。

空地校验：

```js
async function fetchPlantCapacity() {
  const [plotsPayload, crops] = await Promise.all([
    requestJson(PLOTS_URL),
    fetchCropsData({ force: true }),
  ]);
  const totalSlots = Number(plotsPayload?.data?.totalSlots ?? plotsPayload?.totalSlots);
  const plantedCount = crops.filter((crop) => !crop.isEmpty).length;
  const freeSlots = Math.max(0, totalSlots - plantedCount);

  return { crops, freeSlots, plantedCount, totalSlots };
}
```

核心流程：

```js
async function plantInventoryItem(item) {
  const payload = await requestJson(PLANT_BATCH_URL, {
    method: "POST",
    body: {
      seedId: item.seedId,
      quantity: item.selectedQuantity,
    },
  });

  return payload?.data || {};
}
```

`handlePlantSelectedInventory(api)` 会按以下顺序执行：

```text
1. getSelectedInventoryItems() 取出 selectedQuantity > 0 的仓库作物
2. 求和得到 selectedQuantity 总数
3. fetchPlantCapacity() 获取最新 totalSlots 和已种植数量，计算 freeSlots
4. 如果 selectedQuantity > freeSlots，显示“空闲土地不足”错误，不发送 plant-batch
5. 空地足够时，按选中作物顺序逐项请求 plant-batch
6. formatPlantSuccessMessage(item, plantData) 格式化每条成功消息
7. 成功后强制刷新地块和仓库、清空 selections、保持仓库面板展开
```

提示文案：

```text
种植 2 个杨桃成功
```

失败处理：

```text
已成功种植的作物消息会保留
最后追加接口错误消息或“一键种植失败”
种植失败后仍尽量刷新地块和仓库，并按最新库存修正已选数量
```

### 好友偷菜实现

好友偷菜按钮渲染在 `renderFriendBar(friend)` 中：

```js
const isStealing = state.stealingFriendId === friend.id;
const cooldownSeconds = getStealCooldownSeconds();
const isCoolingDown = cooldownSeconds > 0;
const canSteal = friend.isStealable && !state.stealingFriendId && !isCoolingDown;
const stealButtonText = isStealing ? "偷菜中" : isCoolingDown ? `冷却中${cooldownSeconds}s` : "偷菜";
```

按钮 HTML：

```html
<a class="friend-action" href="好友农场页面 URL" target="_blank" rel="noopener noreferrer">访问农场</a>
<button class="friend-action steal" type="button" data-action="steal-friend" data-friend-id="好友 ID">
  偷菜
</button>
```

完整实现：

```js
async function handleStealFriend(api, friendId) {
  if (state.stealingFriendId || !friendId) {
    return;
  }

  const cooldownSeconds = getStealCooldownSeconds();
  if (cooldownSeconds > 0) {
    state = {
      ...state,
      stealNotice: `偷菜接口冷却中，请 ${cooldownSeconds} 秒后再试`,
      stealNoticeType: "error",
    };
    render(api);
    return;
  }

  const friend = state.friends.find((item) => item.id === friendId);
  if (!friend?.isStealable) {
    return;
  }

  const cooldownUntil = Date.now() + STEAL_COOLDOWN_MS;
  state = {
    ...state,
    stealingFriendId: friendId,
    stealCooldownUntil: cooldownUntil,
    stealNotice: "",
    stealNoticeType: "",
    error: "",
  };
  render(api);
  window.setTimeout(() => {
    if (state.page === "friends" && Date.now() >= state.stealCooldownUntil) {
      render(api);
    }
  }, STEAL_COOLDOWN_MS + 100);

  try {
    const stealPayload = await requestJson(STEAL_FRIEND_AUTO_URL, {
      method: "POST",
      body: { friendId },
    });
    let nextFriends = state.friends;

    try {
      nextFriends = await fetchFriendStatuses();
    } catch {
      // 偷菜已经成功时，不让后续刷新失败覆盖成功结果。
    }

    state = {
      ...state,
      stealingFriendId: "",
      stealNotice: formatStealSuccessMessage(friend, stealPayload),
      stealNoticeType: "success",
      friends: nextFriends,
      updatedAt: new Date().toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    };
  } catch (error) {
    let nextFriends = state.friends;

    if (error.payload) {
      try {
        nextFriends = await fetchFriendStatuses();
      } catch {
        // 业务失败提示优先，刷新失败不额外覆盖提示。
      }
    }

    state = {
      ...state,
      stealingFriendId: "",
      stealNotice: formatStealErrorMessage(friend, error),
      stealNoticeType: "error",
      friends: nextFriends,
    };
  }

  render(api);
}
```

细节说明：

```text
state.stealingFriendId 防止并发偷菜
stealCooldownUntil 提供 5 秒全局冷却，避免接口短时间重复访问
friend.isStealable 是接口调用前的成熟状态门槛
POST 请求体只传 { friendId }
成功响应优先展示 “好友名农场：message”，缺少 message 时按 stolenCrops 汇总数量
成功后刷新好友状态，不影响收益排行页和我的农场页数据
成功后的好友状态刷新失败时保留成功提示，不覆盖为刷新错误
success === false 属于业务失败，会展示 “好友名农场 + error.message”，并尽量刷新好友状态
失败时设置 stealNotice，由好友页内提示展示完整错误消息，不清空列表
成功和失败提示共用 .steal-notice 布局，使用 flex 居中保证大小和对齐一致
```

## 性能策略

脚本控制资源占用的方式：

```text
不使用前端框架
不使用 setInterval 轮询
不做动画
主面板数据请求只在展开、切页缺数据、手动刷新时触发
脚本启动时会额外静默请求一次自己的地块状态，用于悬浮按钮成熟提醒
不用 setInterval 轮询；下一块地成熟只安排一次定时 render
按当前页签请求所需接口，好友详情不会拖慢收益页和我的农场页
一键收菜成功后刷新当前地块接口；仓库已加载时同步刷新仓库接口
一键卖出成功或失败后只刷新仓库接口，不重新请求收益排行或好友详情
一键种植会先请求 plots 和最新地块数据校验空地数量，成功或失败后只刷新地块和仓库
好友偷菜成功后只刷新好友列表和好友详情
图标使用小规格 _s4.png
图片 lazy loading + async decoding
面板内容区独立滚动，避免撑开页面
```

## 修改建议

如果要改价格计算，优先看：

```js
PRICE_DIVISOR
normalizeDisplayPrice()
formatUsd()
normalizePrices()
buildRanking()
```

如果要改收益排序，优先看：

```js
buildRanking()
renderProfitPage()
renderCropCard()
```

如果要改我的农场地块展示，优先看：

```js
normalizeCrops()
createEmptyPlot()
getLiveCrop()
getLiveCrops()
hasReadyCrops()
scheduleNextCropReadyRender()
refreshCropStatus()
formatCountdown()
formatDateTime()
renderCropsPage()
renderPlotCard()
```

如果要改我的仓库展示或多选数量，优先看：

```js
INVENTORY_URL
fetchInventoryData()
normalizeInventory()
normalizeInventorySelections()
renderInventoryCard()
setInventorySelectMode()
setInventorySelection()
stepInventorySelection()
```

如果要改一键卖出，优先看：

```js
RECYCLE_QUOTE_URL
RECYCLE_URL
RECYCLE_MAX_SLIPPAGE_BPS
getSelectedInventoryItems()
fetchRecycleQuote()
recycleInventoryItem()
formatRecycleSuccessMessage()
handleRecycleSelectedInventory()
```

如果要改一键种植，优先看：

```js
PLOTS_URL
PLANT_BATCH_URL
fetchPlantCapacity()
plantInventoryItem()
formatPlantSuccessMessage()
handlePlantSelectedInventory()
```

如果要改一键收菜，优先看：

```js
HARVEST_ALL_URL
requestJson()
handleHarvestAll()
renderCropsPage()
```

如果要改好友农场展示，优先看：

```js
FRIENDS_STEALABLE_URL
STEAL_FRIEND_AUTO_URL
buildFriendFarmUrl()
buildFriendFarmPageUrl()
normalizeFriendList()
normalizeFriendFarm()
fetchFriendStatuses()
renderFriendsPage()
renderFriendBar()
handleStealFriend()
```

如果要改界面样式，优先看 `createRoot()` 中 Shadow DOM 的 `<style>`。

## 验证

语法检查命令：

```powershell
node --check .\Tampermonkey\farm-profit-ranking.user.js
```

浏览器验证步骤：

```text
1. 在 Tampermonkey 中安装或更新 farm-profit-ranking.user.js
2. 打开 https://cdk.hybgzs.com/
3. 点击右下角 $ 按钮
4. 确认面板最顶部标题显示“黑与白农场小助手”
5. 检查收益排行页是否显示作物图标、收益和进度条
6. 切到我的农场页，确认 普通/VIP 筛选隐藏
7. 展开农场情况，确认田地按每行 6 块展示，并且空地正常显示
8. 农场情况保持展开时切换主题，确认农场情况不会自动折叠
9. 确认农场情况田地数量来自接口 maxSlots，不因为当前只种了少量作物而缺格子
10. 检查成熟地块是否显示可收获绿色样式
11. 有成熟地块时确认右下角悬浮按钮为金黄色；没有成熟地块时为绿色
12. 有成熟地块时检查一键收菜按钮可点击；没有成熟地块时按钮禁用
13. 点击一键收菜时应先出现确认弹窗
14. 一键收菜成功后，如果没有成熟地块，确认右下角悬浮按钮恢复绿色
15. 展开我的仓库，确认默认卡片显示图标、名称、数量和回收价格
16. 勾选多选，确认卡片切换为图标、名称、库存、数量输入和小计
17. 确认数量输入框可输入，且不能小于 0 或大于当前作物库存
18. 确认多选取消后我的仓库仍保持展开，并恢复默认卡片显示
19. 在多选状态选择数量后，确认一键卖出按钮可点击；未选择数量时按钮禁用
20. 点击一键卖出后，确认成功提示按行展示“卖出N个作物获得$X.XX”，并刷新仓库库存
21. 在多选状态选择数量后，确认一键种植按钮显示在一键卖出右侧
22. 选择数量不超过空地时点击一键种植，确认提示按行展示“种植 N 个作物成功”，并刷新农场情况和仓库库存
23. 选择数量超过空地时点击一键种植，确认显示“空闲土地不足”错误，不应发起种植
24. 切到好友农场页，确认好友头像、名字、状态和成熟时间显示
25. 如果好友第一块地已成熟，确认该好友显示可偷菜状态并排在前面
26. 确认每个好友都有“访问农场”和“偷菜”两个按钮
27. 点击访问农场，确认新标签页打开 /entertainment/farm/friends/{id}
28. 未成熟好友的偷菜按钮应禁用
29. 成熟好友的偷菜按钮可点击，请求期间显示“偷菜中”
30. 偷菜成功后好友农场页应刷新，数据更新时间变化
31. 点击刷新，确认数据更新时间变化
32. 点击标题栏 🌙 按钮，确认面板切换到暗色主题并且按钮变为 ☀️
33. 点击 ☀️ 按钮，确认面板切回浅色主题并且按钮变为 🌙
34. 切到暗色主题后刷新页面，确认脚本仍保持暗色主题
```
