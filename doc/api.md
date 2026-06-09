# HYB Farm 接口文档

本文档独立记录 `Tampermonkey/farm-profit-ranking.user.js` 当前使用的 HYB Farm 接口。

## 通用约定

### 基础地址

```text
https://cdk.hybgzs.com
```

### 认证方式

接口依赖浏览器当前登录态 Cookie。用户脚本通过 `GM_xmlhttpRequest` 发起请求，并使用：

```js
anonymous: false
```

脚本不会读取、保存或硬编码 Cookie。

### 请求头

GET 请求：

```http
Accept: application/json
```

POST 请求：

```http
Accept: application/json
Content-Type: application/json
```

### 成功响应

大多数接口使用以下外层结构：

```ts
type ApiSuccess<T> = {
  success: true;
  data: T;
};
```

部分接口还会在外层直接返回兼容字段，例如 `/api/farm/crops` 可能同时返回 `data`、`crops`、`maxSlots`。

### 失败响应

```ts
type ApiFailure = {
  success: false;
  error?: {
    code?: number;
    message?: string;
  };
};
```

脚本失败判断：

```text
HTTP 状态码不在 200-299 范围内，视为失败
JSON 解析失败，视为失败
success === false，视为失败
onerror / ontimeout，视为失败
```

### 价格单位

农场接口中的价格通常是字符串形式的整数，脚本统一按以下方式转成界面展示金额：

```text
展示金额 = 接口价格整数 / 500000
```

代码常量：

```js
const PRICE_DIVISOR = 500000;
```

界面金额固定展示 2 位小数。

### 作物图标

接口返回的作物图片通常是相对路径，例如：

```text
/farm/crops/pumpkin
```

脚本拼接小图标 URL：

```text
https://cdk.hybgzs.com + seedImage + _s4.png
```

示例：

```text
https://cdk.hybgzs.com/farm/crops/pumpkin_s4.png
```

## 接口总览

| 功能 | 方法 | 路径 |
| --- | --- | --- |
| 种子图鉴 | GET | `/api/farm/codex/seeds?` |
| 实时回收价格 | GET | `/api/farm/recycle/prices?includeTrend=1&granularity=day&trendRange=7` |
| 当前地块 | GET | `/api/farm/crops` |
| 农场地块容量 | GET | `/api/farm/plots` |
| 我的仓库 | GET | `/api/farm/inventory` |
| 一键收菜 | POST | `/api/farm/harvest-all` |
| 回收报价 | POST | `/api/farm/recycle/quote` |
| 作物回收 | POST | `/api/farm/recycle` |
| 批量种植 | POST | `/api/farm/plant-batch` |
| 好友列表 | GET | `/api/farm/friends/stealable` |
| 好友农场详情 | GET | `/api/farm/friends/{id}` |
| 好友偷菜 | POST | `/api/farm/steal/friend-auto` |

## 种子图鉴

获取所有作物静态配置，用于收益排行计算和图标展示。

```http
GET https://cdk.hybgzs.com/api/farm/codex/seeds?
```

### 请求参数

无。

### 响应结构

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

### 脚本使用字段

```text
data.seeds[].id 作物 ID
data.seeds[].name 作物名称
data.seeds[].image 作物图标相对路径
data.seeds[].growthTime 成熟时间，单位秒
data.seeds[].harvestQuantity 单次成熟产量
data.seeds[].isVipOnly 是否 VIP 作物
```

## 实时回收价格

获取作物实时回收价格，用于收益排行和价格展示。

```http
GET https://cdk.hybgzs.com/api/farm/recycle/prices?includeTrend=1&granularity=day&trendRange=7
```

### 查询参数

| 参数 | 值 | 说明 |
| --- | --- | --- |
| `includeTrend` | `1` | 请求返回趋势数据 |
| `granularity` | `day` | 趋势粒度为天 |
| `trendRange` | `7` | 趋势范围为 7 天 |

脚本当前只使用实时价格字段，不使用趋势数据。

### 响应结构

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

### 脚本使用字段

```text
data[].seedId 作物 ID
data[].recyclePrice 回收价格整数
market.items[].seedId 备用作物 ID
market.items[].unitPrice 备用市场单价整数
```

## 当前地块

获取自己农场当前地块、种植作物、最大田地数量和地块等级。

```http
GET https://cdk.hybgzs.com/api/farm/crops
```

### 请求参数

无。

### 响应结构

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

### 脚本使用字段

```text
data[] / crops[] 当前种植或地块作物数据
plotIndex 地块序号，界面展示为 #plotIndex+1
seedId 作物 ID
seedName 作物名称
seedImage 作物图标相对路径
maturesAt UTC 成熟时间
isHarvested 是否已收获；已收获会作为空地处理
isMature 是否成熟
remainingTime 剩余成熟秒数
conditions 异常状态列表
maxSlots 当前最大田地数量，农场情况优先使用它补齐空地
plotLevels[].plotIndex maxSlots 缺失时的田地数量兜底来源
```

### 处理规则

```text
成熟判断：isMature || remainingTime <= 0
田地数量优先使用 maxSlots
maxSlots 缺失时使用 plotLevels 和最大 plotIndex 兜底
接口未返回作物的位置会补为空地
农场情况按 plotIndex 展示，避免位置跳动
```

## 农场地块容量

获取当前土地容量。脚本在一键种植前使用它计算空闲土地数量。

```http
GET https://cdk.hybgzs.com/api/farm/plots
```

### 请求参数

无。

### 响应结构

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

### 脚本使用字段

```text
data.totalSlots 当前总土地数量
data.freeSlots totalSlots 缺失时的兜底
```

### 空闲土地计算

脚本不直接使用页面旧状态。一键种植前会同时请求：

```text
/api/farm/plots
/api/farm/crops
```

然后计算：

```text
已种植数量 = 最新 crops 中 !isEmpty 的数量
空闲土地数量 = totalSlots - 已种植数量
```

如果选中种植总数大于空闲土地数量，则不发送种植请求。

## 我的仓库

获取自己仓库中的作物库存。

```http
GET https://cdk.hybgzs.com/api/farm/inventory
```

### 请求参数

无。

### 响应结构

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

### 脚本使用字段

```text
seedId 作物 ID，用于卖出、种植和多选数量
seedName 作物名称
seedImage 作物图标相对路径
quantity 当前库存数量
recyclePrice 当前回收价格整数
```

### 数量规则

仓库多选数量只限制单项范围：

```text
0 <= selectedQuantity <= quantity
```

一键种植时会额外校验所有选中数量之和不能大于空闲土地数量。一键卖出不使用这个限制。

## 一键收菜

收获自己农场中所有已经成熟的作物。

```http
POST https://cdk.hybgzs.com/api/farm/harvest-all
```

### 请求体

无。

### 响应结构

```ts
type HarvestAllResponse = ApiSuccess<unknown>;
```

### 脚本处理

```text
点击前按实时成熟状态判断是否有成熟地块
点击后先弹出二次确认
成功后刷新当前地块
如果仓库已经加载，也同步刷新仓库
```

## 回收报价

卖出前获取当前最新市场单价。

```http
POST https://cdk.hybgzs.com/api/farm/recycle/quote
```

### 请求体

```json
{
  "seedId": "pumpkin",
  "quantity": 1
}
```

### 响应结构

```ts
type RecycleQuoteResponse = ApiSuccess<{
  seedId: string;
  quantity: number;
  unitPrice: string;
  totalQuota: string;
  quotedAt: string;
}>;
```

### 脚本使用字段

```text
data.unitPrice 最新市场单价整数
```

`unitPrice` 会原样作为作物回收接口的 `expectedUnitPrice`，不做价格归一化。

## 作物回收

按我的仓库多选数量卖出作物。

```http
POST https://cdk.hybgzs.com/api/farm/recycle
```

### 请求体

```json
{
  "seedId": "pumpkin",
  "quantity": 1,
  "expectedUnitPrice": "612581",
  "maxSlippageBps": 300
}
```

### 请求字段

```text
seedId 作物 ID
quantity 卖出数量
expectedUnitPrice 来自回收报价接口 data.unitPrice
maxSlippageBps 固定为 300
```

### 响应结构

```ts
type RecycleResponse = ApiSuccess<{
  seedId: string;
  quantity: number;
  unitPrice: string;
  totalQuota: string;
  slippageBps: number;
}>;
```

### 脚本处理

```text
一次请求只能卖出一种作物
多选多个作物时按作物逐个请求
每个作物先请求 quote，再请求 recycle
成功消息格式：卖出10个蓝莓获得$1.02
多条消息用换行拼接
成功后刷新仓库并清空多选数量
```

## 批量种植

按我的仓库多选数量种植作物。

```http
POST https://cdk.hybgzs.com/api/farm/plant-batch
```

### 请求体

```json
{
  "seedId": "pumpkin",
  "quantity": 1
}
```

### 响应结构

```ts
type PlantBatchResponse = ApiSuccess<{
  plantedCount: number;
  experience: number;
  purchasedCount: number;
  totalCost: string;
}>;
```

### 脚本处理

```text
一次请求只能种植一种作物
多选多个作物时按作物逐个请求
请求前使用 /api/farm/plots 和 /api/farm/crops 校验空闲土地数量
选中总数大于空闲土地数量时不发送 plant-batch
成功消息格式：种植 2 个杨桃成功
多条消息用换行拼接
成功后刷新当前地块和仓库，并清空多选数量
```

## 好友列表

获取可以查看偷菜状态的好友列表。

```http
GET https://cdk.hybgzs.com/api/farm/friends/stealable
```

### 请求参数

无。

### 响应结构

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

### 脚本使用字段

```text
friends[].id 好友 ID，用于请求好友农场详情
friends[].username 好友名称
friends[].avatar 好友头像
friends[].stealable 仅作为摘要保留，最终能否偷菜以好友详情第一块地为准
```

## 好友农场详情

获取单个好友的农场地块详情。

```http
GET https://cdk.hybgzs.com/api/farm/friends/{id}
```

### 路径参数

```text
id 好友列表接口返回的朋友 ID
```

### 响应结构

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

`Crop` 字段与当前地块接口基本一致。

### 脚本使用字段

```text
data.friend.id 好友 ID
data.friend.username 好友名称
data.friend.avatar 好友头像
data.crops[].plotIndex 地块序号
data.crops[].seedName 第一块地作物名称
data.crops[].seedImage 第一块地作物图标
data.crops[].maturesAt 第一块地 UTC 成熟时间
data.crops[].isMature 第一块地是否成熟
data.crops[].remainingTime 第一块地剩余成熟秒数
```

### 偷菜判断

脚本只检查好友农场第一块地：

```text
优先找 plotIndex === 0
找不到则使用 crops[0]
```

判断规则：

```text
isStealable = firstCrop.isMature || remainingTime <= 0
```

## 好友偷菜

对指定好友执行偷菜。

```http
POST https://cdk.hybgzs.com/api/farm/steal/friend-auto
```

### 请求体

```json
{
  "friendId": "cmo5swxfz71sfvjhqmupbhb0j"
}
```

### 响应结构

成功响应可能包含：

```ts
type StealFriendResponse = {
  success: true;
  victimId?: string;
  stolenCrops?: Array<{
    seedId: string;
    quantity: number;
  }>;
  watchdogTriggered?: boolean;
  cropsReturned?: number;
  quotaPenalty?: string;
  message?: string;
};
```

失败响应使用通用失败结构：

```ts
type StealFriendFailure = ApiFailure;
```

### 脚本处理

```text
只允许第一块地成熟的好友触发偷菜请求
所有好友共用 5 秒冷却
请求期间禁用其他偷菜按钮
成功后优先展示接口 message
缺少 message 时按 stolenCrops 汇总数量
成功或业务失败后都会尽量刷新好友状态
```

## 调用时机

脚本不会轮询接口，只有以下场景会请求接口：

```text
脚本启动后静默请求一次 /api/farm/crops，用于悬浮按钮成熟提醒
首次展开面板
切换到当前缺少数据的页签
点击刷新按钮
点击一键收菜
点击一键卖出
点击一键种植
点击好友偷菜
```

## 维护注意

```text
新增或修改用户脚本接口时，应同步更新本文档
用户可见功能变化时，应同步递增脚本 @version
涉及价格展示时，继续使用 PRICE_DIVISOR = 500000
涉及种植数量时，必须重新校验最新空闲土地数量
涉及卖出价格时，必须先请求 quote 再 recycle
```
