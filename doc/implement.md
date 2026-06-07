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

脚本不依赖 React/Vue 等框架，不引入远程库。界面使用原生 DOM、Shadow DOM 和内联 CSS 实现。

## 功能概览

脚本在页面右下角创建一个 `$` 悬浮按钮。点击后展开一个轻量面板，面板包含三个页面：

```text
收益排行
成熟时间
好友农场
```

收益排行页用于判断“种什么最划算”，核心展示每小时收益。

成熟时间页用于查看所有未收获地块的成熟状态，核心展示具体北京时间成熟时间。

当自己的农场存在可收获作物时，右下角悬浮按钮会从绿色切换为金黄色；收获后如果没有成熟作物，会恢复绿色。

好友农场页用于查看好友第一块地是否成熟，成熟则提示可偷菜，并为每个好友提供访问农场和偷菜按钮。

脚本不会轮询接口。只有以下场景会请求接口：

```text
脚本启动后静默请求一次自己的地块状态，用于判断悬浮按钮是否金黄
首次展开面板
切换到当前缺少数据的页面
点击刷新按钮
点击成熟时间页的一键收菜按钮
点击好友农场页的偷菜按钮
```

## 接口

### 通用请求约定

所有接口都由 `requestJson(url, options)` 发起请求。查询类接口使用 `GET`，一键收菜和好友偷菜接口使用 `POST`。

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
获取自己农场所有未收获作物的成熟时间，用于成熟时间页。
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
type CropsResponse = ApiSuccess<Crop[]>;

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
```

脚本实际使用字段：

```text
data[].id 地块作物记录 ID
data[].plotIndex 地块序号，UI 展示为 #plotIndex+1
data[].seedId 作物 ID
data[].seedName 作物名称
data[].seedImage 作物图标相对路径
data[].maturesAt UTC 成熟时间点
data[].isHarvested 是否已收获；已收获会被过滤
data[].isMature 是否成熟
data[].remainingTime 剩余成熟秒数
data[].conditions 异常状态列表
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
成熟地块排最前
未成熟地块按 remainingTime 从小到大排序
```

### 一键收菜接口

用途：

```text
收获自己农场中所有已经成熟的作物，用于成熟时间页的一键收菜按钮。
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
成熟时间页 readyCount > 0 时按钮可点击
readyCount === 0 时按钮禁用
点击后弹出二次确认
请求期间按钮显示“收菜中”并禁用
成功后刷新成熟时间页数据
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
async function loadCurrentPageData() {
  if (state.page === "friends") {
    return {
      friends: await fetchFriendStatuses(),
    };
  }

  if (state.page === "crops") {
    const cropsPayload = await requestJson(CROPS_URL);

    return {
      crops: normalizeCrops(cropsPayload),
    };
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
crops 页只请求自己的地块成熟时间
profit 页并发请求种子图鉴和价格接口
函数返回局部 state，refreshData 负责合并进全局 state
```

### 数据归一化

`normalizeSeeds(payload)` 将种子图鉴转换成收益计算需要的静态数据。

`normalizePrices(payload)` 将实时价格转换成：

```js
Map<seedId, unitPrice>
```

`normalizeCrops(payload)` 将地块数据转换成成熟时间页面需要的数据，并过滤已收获地块：

```js
.filter((crop) => !crop.isHarvested)
```

成熟地块排序在最前，其余按剩余时间从短到长排序。

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
排在成熟时间列表最前
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

  return crops
    .filter((crop) => !crop.isHarvested)
    .map((crop) => {
      const remainingTime = Math.max(0, Number(crop.remainingTime || 0));
      const maturesAt = crop.maturesAt ? new Date(crop.maturesAt) : null;

      return {
        id: crop.id,
        plotIndex: Number(crop.plotIndex),
        seedId: crop.seedId,
        seedName: crop.seedName || crop.seedId || "未知作物",
        iconUrl: buildCropIconUrl(crop.seedImage),
        maturesAt,
        isMature: Boolean(crop.isMature) || remainingTime <= 0,
        remainingTime,
        conditions: Array.isArray(crop.conditions) ? crop.conditions : [],
      };
    })
    .sort((a, b) => {
      if (a.isMature !== b.isMature) {
        return a.isMature ? -1 : 1;
      }

      return a.remainingTime - b.remainingTime;
    });
}
```

细节说明：

```text
接口目前 data 是数组，但兼容 data.crops 数组结构
已收获地块不展示
remainingTime 做 Math.max(0, ...) 避免负数影响 UI
maturesAt 转成 Date，渲染时再格式化为北京时间
isMature 用 remainingTime <= 0 兜底
成熟地块排最前，未成熟地块按剩余时间排序
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
.header 标题、更新时间、主题切换、刷新、关闭
.theme-toggle 标题栏主题切换按钮，浅色时显示 🌙，暗色时显示 ☀️
.tabs 收益排行 / 成熟时间 / 好友农场
.filters 收益页专用的 全部 / 普通 / VIP 筛选
.body 当前页面内容
```

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
crops 地块成熟时间数据
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

`renderCropsPage(api)` 渲染成熟时间页。

`renderFriendsPage(api)` 渲染好友农场页。

`renderCropCard(row, index, maxProfit)` 渲染单个收益排行作物卡片。

`renderPlotCard(crop)` 渲染单个地块卡片。

`renderFriendBar(friend)` 渲染单个好友农场状态条。

`handleHarvestAll(api)` 执行一键收菜操作。

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
  api.trigger.title = readyCrops ? "有作物可以收获" : "作物收益排行榜";
  api.trigger.setAttribute("aria-label", readyCrops ? "打开作物收益排行榜，有作物可以收获" : "打开作物收益排行榜");
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

成熟时间页的 `一键收菜` 按钮和好友农场页的 `偷菜` 按钮都通过事件委托绑定在 `.body` 上。这样页面重渲染后，不需要重新查询按钮再绑定事件。

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
  }
});
```

`.theme-toggle` 是固定标题栏按钮，不随 `.body` 内容重渲染，因此直接绑定 click 事件。切换时只更新 `state.theme`、保存到 `localStorage`，然后交给 `render(api)` 同步 `theme-dark` 类和 🌙 / ☀️ 图标。

### 一键收菜实现

完整实现：

```js
async function handleHarvestAll(api) {
  if (state.harvesting) {
    return;
  }

  const readyCount = state.crops.filter((crop) => crop.isMature).length;
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
    const cropsPayload = await requestJson(CROPS_URL);

    state = {
      ...state,
      harvesting: false,
      crops: normalizeCrops(cropsPayload),
      updatedAt: new Date().toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    };
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
readyCount === 0 时直接返回，按钮本身也会禁用
window.confirm 是二次确认，避免误触改变农场状态
POST 成功后只刷新 CROPS_URL，不重新请求收益排行或好友详情
失败时设置 state.error，由 render(api) 统一展示错误
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
成功后刷新好友状态，不影响收益排行页和成熟时间页数据
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
按当前页签请求所需接口，好友详情不会拖慢收益页和成熟时间页
一键收菜成功后只刷新当前地块接口
好友偷菜成功后只刷新好友列表和好友详情
图标使用小规格 _s4.png
图片 lazy loading + async decoding
面板内容区独立滚动，避免撑开页面
```

## 修改建议

如果要改价格计算，优先看：

```js
PRICE_DIVISOR
normalizePrices()
buildRanking()
```

如果要改收益排序，优先看：

```js
buildRanking()
renderProfitPage()
renderCropCard()
```

如果要改成熟时间展示，优先看：

```js
normalizeCrops()
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
4. 检查收益排行页是否显示作物图标、收益和进度条
5. 切到成熟时间页，确认 普通/VIP 筛选隐藏
6. 检查成熟地块是否显示可收获绿色样式
7. 有成熟地块时确认右下角悬浮按钮为金黄色；没有成熟地块时为绿色
8. 有成熟地块时检查一键收菜按钮可点击；没有成熟地块时按钮禁用
9. 点击一键收菜时应先出现确认弹窗
10. 一键收菜成功后，如果没有成熟地块，确认右下角悬浮按钮恢复绿色
11. 切到好友农场页，确认好友头像、名字、状态和成熟时间显示
12. 如果好友第一块地已成熟，确认该好友显示可偷菜状态并排在前面
13. 确认每个好友都有“访问农场”和“偷菜”两个按钮
14. 点击访问农场，确认新标签页打开 /entertainment/farm/friends/{id}
15. 未成熟好友的偷菜按钮应禁用
16. 成熟好友的偷菜按钮可点击，请求期间显示“偷菜中”
17. 偷菜成功后好友农场页应刷新，数据更新时间变化
18. 点击刷新，确认数据更新时间变化
19. 点击标题栏 🌙 按钮，确认面板切换到暗色主题并且按钮变为 ☀️
20. 点击 ☀️ 按钮，确认面板切回浅色主题并且按钮变为 🌙
21. 切到暗色主题后刷新页面，确认脚本仍保持暗色主题
```
