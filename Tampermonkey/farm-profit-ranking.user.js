// ==UserScript==
// @name         HYB Farm Helper
// @namespace    https://cdk.hybgzs.com/
// @version      2.8.0
// @description  轻量展示最划算的作物收益排行、全部地块成熟时间和好友农场状态。
// @author       gcnanmu
// @match        https://cdk.hybgzs.com/*
// @connect      cdk.hybgzs.com
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const SEEDS_URL = "https://cdk.hybgzs.com/api/farm/codex/seeds?";
  const PRICES_URL =
    "https://cdk.hybgzs.com/api/farm/recycle/prices?includeTrend=1&granularity=day&trendRange=7";
  const CROPS_URL = "https://cdk.hybgzs.com/api/farm/crops";
  const HARVEST_ALL_URL = "https://cdk.hybgzs.com/api/farm/harvest-all";
  const FRIENDS_STEALABLE_URL = "https://cdk.hybgzs.com/api/farm/friends/stealable";
  const STEAL_FRIEND_AUTO_URL = "https://cdk.hybgzs.com/api/farm/steal/friend-auto";
  const STEAL_COOLDOWN_MS = 5000;
  const PRICE_DIVISOR = 500000;
  const ROOT_ID = "hyb-farm-profit-widget";
  const THEME_STORAGE_KEY = "hyb-farm-profit-theme";

  /**
   * 将接口返回的作物图片相对路径转换为可直接展示的小图 URL。
   *
   * 接口返回类似 `/farm/crops/carrot`，实际轻量图标资源需要追加 `_s4.png`。
   *
   * @param {string} imagePath 作物图片相对路径。
   * @returns {string} 完整图标 URL；没有路径时返回空字符串。
   */
  function buildCropIconUrl(imagePath) {
    if (!imagePath) {
      return "";
    }

    const normalizedPath = imagePath.startsWith("/") ? imagePath : `/${imagePath}`;
    return `https://cdk.hybgzs.com${normalizedPath}_s4.png`;
  }

  /**
   * 根据好友 ID 构造好友农场详情接口地址。
   *
   * @param {string} friendId 好友列表接口返回的好友 ID。
   * @returns {string} 好友农场详情接口 URL。
   */
  function buildFriendFarmUrl(friendId) {
    return `https://cdk.hybgzs.com/api/farm/friends/${encodeURIComponent(friendId)}`;
  }

  /**
   * 根据好友 ID 构造好友农场访问页面地址。
   *
   * @param {string} friendId 好友列表接口返回的好友 ID。
   * @returns {string} 好友农场页面 URL。
   */
  function buildFriendFarmPageUrl(friendId) {
    return `https://cdk.hybgzs.com/entertainment/farm/friends/${encodeURIComponent(friendId)}`;
  }

  /**
   * 全局 UI 与接口状态。
   *
   * 注意：`loading` 只表示当前面板页正在加载；右下角悬浮按钮的成熟提醒使用
   * `cropStatusLoading` 静默刷新，避免为了按钮变色影响用户正在看的收益/好友页面。
   */
  let state = {
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
    updatedAt: "",
  };

  /**
   * 读取上次保存的界面主题；默认保持浅色，避免安装后突兀改变现有界面。
   *
   * @returns {"light" | "dark"} 当前主题。
   */
  function getInitialTheme() {
    try {
      return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  }

  /**
   * 持久化主题选择。localStorage 不可用时只影响当前页面生命周期。
   *
   * @param {"light" | "dark"} theme 要保存的主题。
   */
  function saveTheme(theme) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // 忽略存储失败，Tampermonkey 脚本仍可在当前页面内切换主题。
    }
  }

  /**
   * 下一块地成熟时触发的单次定时器。
   *
   * 这里不用 setInterval 轮询；每次拿到新的地块数据后只安排下一次成熟点，到点后
   * 重渲染一次，让悬浮按钮从绿色切到金黄色。
   */
  let cropReadyTimer = 0;

  /**
   * 通过 Tampermonkey 的 GM_xmlhttpRequest 请求 JSON 接口。
   *
   * 使用 `anonymous: false` 让浏览器带上当前站点 Cookie，避免在脚本里保存登录态。
   *
   * @param {string} url 要请求的接口地址。
   * @param {object} [options] 请求配置。
   * @param {string} [options.method="GET"] HTTP 请求方法。
   * @param {object|string|null} [options.body] 请求体；对象会被 JSON.stringify。
   * @returns {Promise<object>} 解析后的 JSON 对象。
   */
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
            // 业务失败也保留原始响应，偷菜失败后要据此刷新好友状态但不覆盖提示。
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

  /**
   * 归一化种子图鉴接口数据。
   *
   * 输出只保留收益计算和 UI 展示需要的字段：作物 ID、名称、图标、成熟耗时、
   * 成熟数量以及 VIP 标记。
   *
   * @param {object} payload `/api/farm/codex/seeds` 的响应 JSON。
   * @returns {Array<object>} 归一化后的种子列表。
   */
  function normalizeSeeds(payload) {
    const seeds = payload?.data?.seeds;

    if (!Array.isArray(seeds)) {
      throw new Error("种子接口数据结构异常");
    }

    return seeds.map((seed) => ({
      id: seed.id,
      name: seed.name || seed.id,
      iconUrl: buildCropIconUrl(seed.image),
      growthTimeSeconds: Number(seed.growthTime),
      harvestQuantity: Number(seed.harvestQuantity),
      isVipOnly: Boolean(seed.isVipOnly),
    }));
  }

  /**
   * 归一化实时回收价格接口数据。
   *
   * 价格接口可能同时返回 `data` 主列表和 `market.items` 市场列表。这里统一转成
   * `Map<seedId, unitPrice>`，其中真实美元价格 = 接口显示整数 / PRICE_DIVISOR。
   *
   * @param {object} payload `/api/farm/recycle/prices` 的响应 JSON。
   * @returns {Map<string, number>} 作物 ID 到真实美元单价的映射。
   */
  function normalizePrices(payload) {
    const directPrices = Array.isArray(payload?.data) ? payload.data : [];
    const marketPrices = Array.isArray(payload?.market?.items)
      ? payload.market.items
      : Array.isArray(payload?.data?.market?.items)
        ? payload.data.market.items
        : [];

    const prices = new Map();

    for (const item of [...directPrices, ...marketPrices]) {
      const seedId = item.seedId || item.id;
      const displayPrice = Number(item.recyclePrice ?? item.unitPrice ?? item.price);

      if (seedId && Number.isFinite(displayPrice)) {
        prices.set(seedId, displayPrice / PRICE_DIVISOR);
      }
    }

    return prices;
  }

  /**
   * 按中文数字格式输出数值。
   *
   * @param {number} value 要格式化的数字。
   * @param {number} [fractionDigits=4] 最多保留的小数位。
   * @returns {string} 本地化后的数字字符串。
   */
  function formatNumber(value, fractionDigits = 4) {
    return Number(value).toLocaleString("zh-CN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: fractionDigits,
    });
  }

  /**
   * 将数值格式化为美元展示文本。
   *
   * @param {number} value 美元数值。
   * @returns {string} 带 `$` 前缀的美元字符串。
   */
  function formatUsd(value) {
    return `$${formatNumber(value)}`;
  }

  /**
   * 将作物固定成熟耗时格式化为小时/分钟。
   *
   * 用于收益排行页展示种子本身的成长周期。
   *
   * @param {number} seconds 成熟耗时秒数。
   * @returns {string} 例如 `10小时0分钟` 或 `30分钟`。
   */
  function formatGrowthTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}小时${minutes}分钟`;
    }

    return `${minutes}分钟`;
  }

  /**
   * 将地块剩余时间格式化为倒计时文本。
   *
   * 小于等于 0 时视为可收获；不足 1 分钟时按 1 分钟展示，避免出现 `0分钟`。
   *
   * @param {number} seconds 剩余秒数。
   * @returns {string} 倒计时文本或 `可收获`。
   */
  function formatCountdown(seconds) {
    if (seconds <= 0) {
      return "可收获";
    }

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}小时${minutes}分钟`;
    }

    return `${Math.max(1, minutes)}分钟`;
  }

  /**
   * 将 UTC 时间对象格式化为北京时间。
   *
   * 后端返回的 `maturesAt` 带 `Z`，表示 UTC；UI 统一按 Asia/Shanghai 展示。
   *
   * @param {Date | null} date 成熟时间。
   * @returns {string} 北京时间的 `MM/DD HH:mm` 文本，非法日期返回 `未知时间`。
   */
  function formatDateTime(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return "未知时间";
    }

    return date.toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  /**
   * 按当前时间计算地块成熟状态，避免只依赖接口返回时刻的 remainingTime。
   *
   * @param {object} crop 归一化后的地块作物数据。
   * @returns {object} 带实时成熟状态和剩余秒数的地块数据。
   */
  function getLiveCrop(crop) {
    const maturesAtTime = crop.maturesAt?.getTime?.();
    // 后端 remainingTime 是请求时刻的快照；悬浮按钮和成熟页需要按当前时间重算。
    const remainingTime =
      Number.isFinite(maturesAtTime)
        ? Math.max(0, Math.ceil((maturesAtTime - Date.now()) / 1000))
        : crop.remainingTime;

    return {
      ...crop,
      isMature: crop.isMature || remainingTime <= 0,
      remainingTime,
    };
  }

  /**
   * 返回按当前时间更新过成熟状态的地块列表。
   *
   * @returns {Array<object>} 实时地块列表。
   */
  function getLiveCrops() {
    return state.crops
      .map((crop) => getLiveCrop(crop))
      .sort((a, b) => {
        // 重新计算成熟状态后再排序，避免刚成熟的地块仍停在列表后面。
        if (a.isMature !== b.isMature) {
          return a.isMature ? -1 : 1;
        }

        return a.remainingTime - b.remainingTime;
      });
  }

  /**
   * 判断我的农场当前是否有可收获作物。
   *
   * @returns {boolean} 有成熟地块时返回 true。
   */
  function hasReadyCrops() {
    return getLiveCrops().some((crop) => crop.isMature);
  }

  /**
   * 安排下一块地成熟时自动重渲染，保证悬浮按钮颜色能自动转为金黄色。
   *
   * @param {object} api createRoot 返回的 DOM 引用集合。
   * @returns {void}
   */
  function scheduleNextCropReadyRender(api) {
    if (cropReadyTimer) {
      window.clearTimeout(cropReadyTimer);
      cropReadyTimer = 0;
    }

    if (hasReadyCrops()) {
      // 已经有成熟作物时按钮已经是金色，不需要再安排下一次转色。
      return;
    }

    const nextDelay = state.crops.reduce((minDelay, crop) => {
      const maturesAtTime = crop.maturesAt?.getTime?.();
      if (!Number.isFinite(maturesAtTime)) {
        return minDelay;
      }

      const delay = maturesAtTime - Date.now();
      return delay > 0 ? Math.min(minDelay, delay) : minDelay;
    }, Number.POSITIVE_INFINITY);

    if (!Number.isFinite(nextDelay)) {
      return;
    }

    cropReadyTimer = window.setTimeout(() => {
      cropReadyTimer = 0;
      render(api);
    }, Math.max(0, nextDelay) + 250);
  }

  /**
   * 返回偷菜接口剩余冷却秒数。
   *
   * @returns {number} 冷却剩余秒数。
   */
  function getStealCooldownSeconds() {
    return Math.max(0, Math.ceil((state.stealCooldownUntil - Date.now()) / 1000));
  }

  /**
   * 根据偷菜成功响应构造完整结果文案。
   *
   * @param {object} friend 好友农场状态。
   * @param {object} payload `/api/farm/steal/friend-auto` 成功响应。
   * @returns {string} 可展示的偷菜结果。
   */
  function formatStealSuccessMessage(friend, payload) {
    const farmName = `${friend?.username || "好友"}农场`;
    const message = payload?.message;

    if (message) {
      return `${farmName}：${message}`;
    }

    const stolenCrops = Array.isArray(payload?.stolenCrops) ? payload.stolenCrops : [];
    const totalQuantity = stolenCrops.reduce((sum, crop) => sum + Math.max(0, Number(crop.quantity) || 0), 0);

    return totalQuantity > 0 ? `${farmName}：偷菜成功，获得 ${totalQuantity} 个作物` : `${farmName}：偷菜成功`;
  }

  /**
   * 根据偷菜失败响应构造完整结果文案。
   *
   * @param {object} friend 好友农场状态。
   * @param {Error} error 偷菜接口错误。
   * @returns {string} 可展示的偷菜失败结果。
   */
  function formatStealErrorMessage(friend, error) {
    return `${friend?.username || "好友"}农场${error.message || "偷菜失败"}`;
  }

  /**
   * 根据种子参数和实时价格构建收益排行榜。
   *
   * 核心排序指标是每小时收益：
   * `revenuePerHour = unitPrice * harvestQuantity / growthTimeSeconds * 3600`。
   *
   * @param {object} seedsPayload 种子图鉴接口响应。
   * @param {object} pricesPayload 实时回收价格接口响应。
   * @returns {Array<object>} 按每小时收益从高到低排序的作物列表。
   */
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

  /**
   * 归一化当前地块作物数据。
   *
   * 未收获的成熟地块排在最前面，其他地块按剩余时间从短到长排序。`remainingTime <= 0`
   * 会被当作成熟兜底，避免后端 `isMature` 延迟刷新导致 UI 不提示可收获。
   *
   * @param {object} payload `/api/farm/crops` 的响应 JSON。
   * @returns {Array<object>} 归一化并排序后的地块作物列表。
   */
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

  /**
   * 归一化可偷菜好友列表。
   *
   * 好友列表接口只提供基础信息和偷菜摘要；实际成熟时间仍以后续好友详情接口的
   * `crops[0]` 为准。
   *
   * @param {object} payload `/api/farm/friends/stealable` 的响应 JSON。
   * @returns {Array<object>} 好友基础信息列表。
   */
  function normalizeFriendList(payload) {
    const friends = Array.isArray(payload?.data?.friends) ? payload.data.friends : [];

    return friends
      .filter((friend) => friend?.id)
      .map((friend) => ({
        id: friend.id,
        username: friend.username || "未知好友",
        avatar: friend.avatar || "",
        stealableSummary: friend.stealable || {},
      }));
  }

  /**
   * 根据好友详情接口构建单个好友农场状态。
   *
   * 业务规则按需求只看第一块地：第一块地成熟则认为该好友农场可偷菜。
   *
   * @param {object} friend 好友基础信息。
   * @param {object} payload `/api/farm/friends/{id}` 的响应 JSON。
   * @returns {object} 好友农场状态。
   */
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

  /**
   * 拉取好友列表，并并发获取每个好友的农场详情。
   *
   * @returns {Promise<Array<object>>} 按可偷菜优先、成熟时间升序排序的好友农场状态。
   */
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

  /**
   * 创建挂载节点、Shadow DOM、样式和静态结构，并绑定所有 UI 事件。
   *
   * 返回的 api 对象缓存了常用 DOM 节点，后续渲染时避免重复查询页面。
   *
   * @returns {object} UI 渲染和事件处理需要的 DOM 引用集合。
   */
  function createRoot() {
    const existing = document.getElementById(ROOT_ID);
    if (existing) {
      existing.remove();
    }

    const host = document.createElement("div");
    host.id = ROOT_ID;
    document.documentElement.appendChild(host);

    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          color-scheme: light;
          --bg: #ffffff;
          --text: #182230;
          --muted: #667085;
          --line: #e6e9ef;
          --soft: #f7f9fb;
          --accent: #138a5b;
          --accent-strong: #087443;
          --gold: #b7791f;
          --warn: #b42318;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

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

        .trigger {
          position: fixed;
          right: 18px;
          bottom: 18px;
          z-index: 2147483647;
          width: 46px;
          height: 46px;
          border: 1px solid rgba(23, 32, 51, 0.12);
          border-radius: 999px;
          background: #138a5b;
          color: #fff;
          box-shadow: 0 10px 28px rgba(23, 32, 51, 0.18);
          cursor: pointer;
          display: grid;
          place-items: center;
          font-size: 20px;
          line-height: 1;
        }

        .trigger.has-ready-crops {
          border-color: rgba(183, 121, 31, 0.36);
          background: #d99a1e;
          box-shadow: 0 10px 28px rgba(183, 121, 31, 0.3);
        }

        :host(.theme-dark) .trigger {
          border-color: rgba(100, 216, 154, 0.28);
          background: #16845a;
          box-shadow: 0 12px 34px rgba(0, 0, 0, 0.42);
        }

        :host(.theme-dark) .trigger.has-ready-crops {
          border-color: rgba(246, 184, 75, 0.42);
          background: #c8871e;
          box-shadow: 0 12px 34px rgba(246, 184, 75, 0.2);
        }

        .panel {
          position: fixed;
          right: 18px;
          bottom: 76px;
          z-index: 2147483647;
          width: min(620px, calc(100vw - 28px));
          max-height: calc(100vh - 104px);
          background: var(--bg);
          color: var(--text);
          border: 1px solid rgba(23, 32, 51, 0.12);
          border-radius: 10px;
          box-shadow: 0 18px 60px rgba(23, 32, 51, 0.2);
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        :host(.theme-dark) .panel {
          border-color: rgba(148, 163, 184, 0.22);
          box-shadow: 0 22px 70px rgba(0, 0, 0, 0.55);
        }

        .hidden {
          display: none !important;
        }

        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 14px;
          border-bottom: 1px solid var(--line);
          background: linear-gradient(180deg, #ffffff 0%, #fafbfc 100%);
        }

        :host(.theme-dark) .header {
          background: linear-gradient(180deg, #172033 0%, #111827 100%);
        }

        .title {
          min-width: 0;
        }

        .title strong {
          display: block;
          font-size: 15px;
          line-height: 20px;
          font-weight: 700;
          letter-spacing: 0;
        }

        .title span {
          display: block;
          margin-top: 2px;
          color: var(--muted);
          font-size: 12px;
          line-height: 16px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: none;
        }

        button {
          font: inherit;
        }

        .icon-btn,
        .refresh {
          height: 32px;
          border: 1px solid var(--line);
          border-radius: 7px;
          background: #fff;
          color: var(--text);
          cursor: pointer;
        }

        :host(.theme-dark) .icon-btn,
        :host(.theme-dark) .refresh,
        :host(.theme-dark) .chip {
          background: #172033;
        }

        .icon-btn {
          width: 32px;
          display: grid;
          place-items: center;
          font-size: 16px;
        }

        .refresh {
          padding: 0 10px;
          font-size: 13px;
          font-weight: 650;
        }

        .refresh:disabled {
          cursor: wait;
          opacity: 0.65;
        }

        .filters {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 10px 14px;
          border-bottom: 1px solid var(--line);
          background: var(--soft);
        }

        .tabs {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 10px 14px 0;
          background: var(--soft);
        }

        .chip,
        .tab {
          height: 28px;
          padding: 0 10px;
          border: 1px solid var(--line);
          border-radius: 999px;
          background: #fff;
          color: var(--muted);
          cursor: pointer;
          font-size: 12px;
          font-weight: 650;
        }

        .tab {
          border-radius: 7px 7px 0 0;
          background: transparent;
        }

        .chip.active,
        .tab.active {
          border-color: rgba(31, 143, 95, 0.35);
          background: rgba(31, 143, 95, 0.1);
          color: var(--accent-strong);
        }

        .summary {
          margin-left: auto;
          color: var(--muted);
          font-size: 12px;
        }

        .body {
          min-height: 0;
          flex: 1 1 auto;
          overflow: auto;
          overscroll-behavior: contain;
          padding: 12px 12px 18px;
          background: #f7f9fb;
        }

        :host(.theme-dark) .body {
          background: #0b1120;
        }

        .hero {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 12px;
          padding: 14px;
          margin-bottom: 10px;
          border: 1px solid rgba(19, 138, 91, 0.2);
          border-radius: 8px;
          background: #ffffff;
          box-shadow: 0 8px 24px rgba(24, 34, 48, 0.08);
        }

        :host(.theme-dark) .hero {
          border-color: rgba(100, 216, 154, 0.22);
          background: #111827;
          box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);
        }

        .hero-label {
          margin-bottom: 6px;
          color: var(--accent-strong);
          font-size: 12px;
          font-weight: 800;
        }

        .hero-name {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .crop-icon {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          object-fit: contain;
          background: #f1f5f9;
          border: 1px solid rgba(24, 34, 48, 0.08);
          flex: none;
        }

        :host(.theme-dark) .crop-icon {
          background: #0f172a;
          border-color: rgba(148, 163, 184, 0.2);
        }

        .crop-icon.small {
          width: 30px;
          height: 30px;
        }

        .crop-icon.tiny {
          width: 28px;
          height: 28px;
          border-radius: 7px;
        }

        .hero-name strong {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 22px;
          line-height: 28px;
        }

        .hero-money {
          text-align: right;
        }

        .hero-money strong {
          display: block;
          font-size: 24px;
          line-height: 30px;
          color: var(--accent-strong);
          font-variant-numeric: tabular-nums;
        }

        .hero-money span,
        .hero-sub {
          color: var(--muted);
          font-size: 12px;
        }

        .hero-actions {
          display: flex;
          justify-content: flex-end;
          margin-top: 10px;
        }

        .harvest-all {
          height: 30px;
          padding: 0 10px;
          border: 1px solid rgba(19, 138, 91, 0.28);
          border-radius: 7px;
          background: var(--accent);
          color: #fff;
          cursor: pointer;
          font-size: 12px;
          font-weight: 750;
        }

        .harvest-all:disabled {
          border-color: var(--line);
          background: #eef2f6;
          color: #98a2b3;
          cursor: not-allowed;
        }

        :host(.theme-dark) .harvest-all:disabled,
        :host(.theme-dark) .friend-action:disabled {
          background: #1f2937;
          color: #64748b;
        }

        .cards {
          display: grid;
          gap: 8px;
        }

        .plot-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
          gap: 8px;
        }

        .friend-list {
          display: grid;
          gap: 8px;
        }

        .crop-card {
          display: grid;
          grid-template-columns: 34px 34px minmax(0, 1fr) 120px;
          gap: 10px;
          align-items: center;
          padding: 10px 12px;
          border: 1px solid var(--line);
          border-radius: 8px;
          background: #fff;
        }

        :host(.theme-dark) .crop-card,
        :host(.theme-dark) .plot-card,
        :host(.theme-dark) .friend-bar {
          background: #111827;
        }

        .crop-card.top {
          border-color: rgba(183, 121, 31, 0.28);
          background: #fffdf7;
        }

        :host(.theme-dark) .crop-card.top {
          border-color: rgba(246, 184, 75, 0.32);
          background: #1f1a12;
        }

        .rank {
          display: grid;
          place-items: center;
          width: 28px;
          height: 28px;
          border-radius: 999px;
          background: #eef2f6;
          color: #475467;
          font-size: 12px;
          font-weight: 800;
          font-variant-numeric: tabular-nums;
        }

        :host(.theme-dark) .rank,
        :host(.theme-dark) .plot-index,
        :host(.theme-dark) .badge {
          background: #1f2937;
          color: #cbd5e1;
        }

        .crop-card.top .rank {
          background: rgba(183, 121, 31, 0.14);
          color: var(--gold);
        }

        .crop-main {
          min-width: 0;
        }

        .crop-title {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
        }

        .crop-title strong {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 14px;
          line-height: 20px;
        }

        .metrics {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 12px;
          margin-top: 5px;
          color: var(--muted);
          font-size: 11px;
          line-height: 16px;
        }

        .metric {
          white-space: nowrap;
        }

        .profit {
          text-align: right;
          min-width: 0;
        }

        .profit strong {
          display: block;
          color: var(--accent-strong);
          font-size: 16px;
          line-height: 20px;
          font-variant-numeric: tabular-nums;
        }

        .profit span {
          color: var(--muted);
          font-size: 11px;
        }

        .bar {
          grid-column: 3 / 5;
          height: 6px;
          overflow: hidden;
          border-radius: 999px;
          background: #e9eef3;
        }

        :host(.theme-dark) .bar {
          background: #263241;
        }

        .bar span {
          display: block;
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(90deg, #138a5b, #42b883);
        }

        .plot-card {
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-height: 132px;
          padding: 10px;
          border: 1px solid var(--line);
          border-radius: 8px;
          background: #fff;
        }

        .plot-card.ready {
          border-color: rgba(19, 138, 91, 0.28);
          background: #f6fef9;
          box-shadow: inset 0 0 0 1px rgba(19, 138, 91, 0.12);
        }

        :host(.theme-dark) .plot-card.ready,
        :host(.theme-dark) .friend-bar.stealable {
          border-color: rgba(100, 216, 154, 0.32);
          background: #10251d;
          box-shadow: inset 0 0 0 1px rgba(100, 216, 154, 0.12);
        }

        .plot-index {
          display: grid;
          place-items: center;
          width: 34px;
          height: 24px;
          border-radius: 999px;
          background: #eef2f6;
          color: #475467;
          font-size: 11px;
          font-weight: 800;
          font-variant-numeric: tabular-nums;
        }

        .plot-card.ready .plot-index {
          background: rgba(19, 138, 91, 0.12);
          color: var(--accent-strong);
        }

        .plot-card.ready .crop-icon {
          border-color: rgba(19, 138, 91, 0.32);
          background: #ecfdf3;
        }

        :host(.theme-dark) .plot-card.ready .crop-icon {
          border-color: rgba(100, 216, 154, 0.32);
          background: #0f3024;
        }

        .plot-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
        }

        .plot-title {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
        }

        .plot-title strong {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 13px;
          line-height: 20px;
        }

        .plot-sub {
          color: var(--muted);
          font-size: 11px;
          line-height: 16px;
        }

        .countdown {
          margin-top: auto;
        }

        .countdown strong {
          display: block;
          color: var(--accent-strong);
          font-size: 14px;
          line-height: 20px;
          font-variant-numeric: tabular-nums;
        }

        .plot-card.ready .countdown strong {
          color: var(--accent-strong);
          font-weight: 850;
        }

        .friend-bar {
          display: grid;
          grid-template-columns: 42px minmax(0, 1fr) 150px 116px;
          gap: 10px;
          align-items: center;
          padding: 10px 12px;
          border: 1px solid var(--line);
          border-radius: 8px;
          background: #fff;
        }

        .friend-bar.stealable {
          border-color: rgba(19, 138, 91, 0.28);
          background: #f6fef9;
          box-shadow: inset 0 0 0 1px rgba(19, 138, 91, 0.12);
        }

        .friend-avatar {
          width: 40px;
          height: 40px;
          border-radius: 999px;
          object-fit: cover;
          background: #eef2f6;
          border: 1px solid rgba(24, 34, 48, 0.1);
        }

        :host(.theme-dark) .friend-avatar {
          background: #1f2937;
          border-color: rgba(148, 163, 184, 0.22);
        }

        .friend-avatar.fallback {
          display: grid;
          place-items: center;
          color: #475467;
          font-size: 14px;
          font-weight: 800;
        }

        .friend-main {
          min-width: 0;
        }

        .friend-name {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
        }

        .friend-name strong {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 14px;
          line-height: 20px;
        }

        .friend-sub {
          margin-top: 3px;
          color: var(--muted);
          font-size: 11px;
          line-height: 16px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .friend-time {
          text-align: right;
        }

        .friend-time strong {
          display: block;
          color: var(--accent-strong);
          font-size: 15px;
          line-height: 20px;
          font-variant-numeric: tabular-nums;
        }

        .friend-time span {
          color: var(--muted);
          font-size: 11px;
        }

        .friend-actions {
          display: grid;
          grid-template-columns: 1fr;
          gap: 6px;
        }

        .friend-action {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 0;
          height: 28px;
          padding: 0 8px;
          border: 1px solid rgba(19, 138, 91, 0.28);
          border-radius: 7px;
          background: #fff;
          color: var(--accent-strong);
          cursor: pointer;
          font-size: 12px;
          font-weight: 750;
          line-height: 1;
          text-decoration: none;
          white-space: nowrap;
        }

        :host(.theme-dark) .friend-action {
          background: #172033;
        }

        .friend-action.steal {
          background: var(--accent);
          color: #fff;
        }

        .friend-action:disabled {
          border-color: var(--line);
          background: #eef2f6;
          color: #98a2b3;
          cursor: not-allowed;
        }

        .steal-notice {
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 8px;
          padding: 9px 10px;
          border: 1px solid rgba(19, 138, 91, 0.22);
          border-radius: 8px;
          background: #f6fef9;
          color: var(--accent-strong);
          text-align: center;
          font-size: 12px;
          font-weight: 700;
          line-height: 18px;
          min-height: 38px;
        }

        :host(.theme-dark) .steal-notice {
          border-color: rgba(100, 216, 154, 0.26);
          background: #10251d;
        }

        .steal-notice.error {
          border-color: rgba(180, 35, 24, 0.2);
          background: #fff7f5;
          color: var(--warn);
        }

        :host(.theme-dark) .steal-notice.error {
          border-color: rgba(249, 112, 102, 0.26);
          background: #2a1416;
        }

        .countdown span {
          color: var(--muted);
          font-size: 11px;
        }

        .badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 18px;
          padding: 0 6px;
          border-radius: 999px;
          background: #eef2f6;
          color: #475467;
          font-size: 10px;
          font-weight: 700;
          flex: none;
        }

        .badge.yes {
          background: rgba(31, 143, 95, 0.1);
          color: var(--accent-strong);
        }

        .empty,
        .error {
          padding: 28px 18px;
          color: var(--muted);
          text-align: center;
          font-size: 13px;
        }

        .error {
          color: var(--warn);
        }

        @media (max-width: 640px) {
          .panel {
            right: 10px;
            bottom: 68px;
            width: calc(100vw - 20px);
          }

          .header,
          .filters,
          .tabs {
            padding-left: 10px;
            padding-right: 10px;
          }

          .body {
            padding: 10px;
          }

          .hero {
            grid-template-columns: 1fr;
          }

          .hero-money {
            text-align: left;
          }

          .hero-actions {
            justify-content: flex-start;
          }

          .crop-card {
            grid-template-columns: 32px 32px minmax(0, 1fr);
          }

          .profit {
            grid-column: 3;
            text-align: left;
          }

          .bar {
            grid-column: 1 / 4;
          }

          .plot-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .friend-bar {
            grid-template-columns: 42px minmax(0, 1fr);
          }

          .friend-time {
            grid-column: 2;
            text-align: left;
          }

          .friend-actions {
            grid-column: 2;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .summary {
            display: none;
          }
        }
      </style>
      <button class="trigger" type="button" title="作物收益排行榜" aria-label="打开作物收益排行榜">$</button>
      <section class="panel hidden" aria-label="作物收益排行榜">
        <div class="header">
          <div class="title">
            <strong>作物收益排行榜</strong>
            <span class="status">等待加载</span>
          </div>
          <div class="actions">
            <button class="icon-btn theme-toggle" type="button" title="切换暗色主题" aria-label="切换暗色主题">🌙</button>
            <button class="refresh" type="button">刷新</button>
            <button class="icon-btn close" type="button" title="收起" aria-label="收起">×</button>
          </div>
        </div>
        <div class="tabs">
          <button class="tab active" type="button" data-page="profit">收益排行</button>
          <button class="tab" type="button" data-page="crops">成熟时间</button>
          <button class="tab" type="button" data-page="friends">好友农场</button>
        </div>
        <div class="filters">
          <button class="chip active" type="button" data-vip="all">全部</button>
          <button class="chip" type="button" data-vip="normal">普通</button>
          <button class="chip" type="button" data-vip="vip">VIP</button>
          <span class="summary"></span>
        </div>
        <div class="body"></div>
      </section>
    `;

    const api = {
      host,
      shadow,
      trigger: shadow.querySelector(".trigger"),
      panel: shadow.querySelector(".panel"),
      status: shadow.querySelector(".status"),
      themeToggle: shadow.querySelector(".theme-toggle"),
      refresh: shadow.querySelector(".refresh"),
      close: shadow.querySelector(".close"),
      body: shadow.querySelector(".body"),
      summary: shadow.querySelector(".summary"),
      filters: shadow.querySelector(".filters"),
      chips: Array.from(shadow.querySelectorAll(".chip")),
      tabs: Array.from(shadow.querySelectorAll(".tab")),
    };

    api.trigger.addEventListener("click", () => {
      state.expanded = !state.expanded;
      render(api);
      if (state.expanded && needsData() && !state.loading) {
        refreshData(api);
      }
    });

    api.close.addEventListener("click", () => {
      state.expanded = false;
      render(api);
    });

    api.themeToggle.addEventListener("click", () => {
      state.theme = state.theme === "dark" ? "light" : "dark";
      saveTheme(state.theme);
      render(api);
    });

    api.refresh.addEventListener("click", () => refreshData(api));

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

    for (const chip of api.chips) {
      chip.addEventListener("click", () => {
        state.vipMode = chip.dataset.vip;
        render(api);
      });
    }

    for (const tab of api.tabs) {
      tab.addEventListener("click", () => {
        state.page = tab.dataset.page;
        render(api);
        if (state.expanded && !state.loading && needsData()) {
          refreshData(api);
        }
      });
    }

    return api;
  }

  /**
   * 根据当前 VIP 筛选条件返回收益排行页要展示的作物。
   *
   * @returns {Array<object>} 当前筛选下的收益排行数据。
   */
  function getVisibleRows() {
    if (state.vipMode === "vip") {
      return state.rows.filter((row) => row.isVipOnly);
    }

    if (state.vipMode === "normal") {
      return state.rows.filter((row) => !row.isVipOnly);
    }

    return state.rows;
  }

  /**
   * 判断当前页面是否缺少首次渲染所需数据。
   *
   * 展开面板和切换页签时会调用它，以决定是否触发接口请求。
   *
   * @returns {boolean} 当前页缺少数据时返回 true。
   */
  function needsData() {
    if (state.page === "crops") {
      return state.crops.length === 0;
    }

    if (state.page === "friends") {
      return state.friends.length === 0;
    }

    return state.rows.length === 0;
  }

  /**
   * 主渲染入口。
   *
   * 负责同步展开状态、加载状态、页签状态、错误状态，然后分发到具体页面渲染函数。
   *
   * @param {object} api createRoot 返回的 DOM 引用集合。
   */
  function render(api) {
    const readyCrops = hasReadyCrops();
    const isDarkTheme = state.theme === "dark";
    api.host.classList.toggle("theme-dark", isDarkTheme);
    api.panel.classList.toggle("hidden", !state.expanded);
    api.trigger.textContent = state.expanded ? "×" : "$";
    // 悬浮按钮承担成熟提醒职责：有成熟作物时金黄色，收获后随 crops 状态恢复绿色。
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

  /**
   * 渲染收益排行页。
   *
   * 顶部 hero 展示当前筛选下最划算的作物，列表卡片展示相对收益进度条。
   *
   * @param {object} api createRoot 返回的 DOM 引用集合。
   */
  function renderProfitPage(api) {
    const rows = getVisibleRows();
    api.summary.textContent = rows.length > 0 ? `${rows.length} 个作物` : "";

    if (rows.length === 0) {
      api.body.innerHTML = `<div class="empty">暂无可排行数据</div>`;
      return;
    }

    const best = rows[0];
    const maxProfit = Math.max(...rows.map((row) => row.revenuePerHour));

    api.body.innerHTML = `
      <section class="hero">
        <div>
          <div class="hero-label">当前最划算</div>
          <div class="hero-name">
            ${renderCropIcon(best.iconUrl, best.name)}
            <strong>${escapeHtml(best.name)}</strong>
            ${renderVipBadge(best)}
          </div>
          <div class="hero-sub">
            ${formatGrowthTime(best.growthTimeSeconds)}成熟 · ${best.harvestQuantity}个/次 · 单次${formatUsd(
              best.harvestRevenue,
            )}
          </div>
        </div>
        <div class="hero-money">
          <strong>${formatUsd(best.revenuePerHour)}</strong>
          <span>每小时收益</span>
        </div>
      </section>
      <div class="cards">
        ${rows.map((row, index) => renderCropCard(row, index, maxProfit)).join("")}
      </div>
    `;
  }

  /**
   * 渲染成熟时间页。
   *
   * 顶部 hero 优先展示可收获数量；没有成熟地块时展示下一块成熟的北京时间。
   * 下方使用自适应 grid 小卡片展示每块地的作物、状态、成熟时间和剩余时间。
   *
   * @param {object} api createRoot 返回的 DOM 引用集合。
   */
  function renderCropsPage(api) {
    const crops = getLiveCrops();
    const readyCount = crops.filter((crop) => crop.isMature).length;
    const nextCrop = crops.find((crop) => !crop.isMature);
    const heroCrop = readyCount > 0 ? crops.find((crop) => crop.isMature) : nextCrop;

    api.summary.textContent =
      crops.length > 0
        ? `${readyCount} 可收获 · ${crops.length} 块地`
        : "";

    if (crops.length === 0) {
      api.body.innerHTML = `<div class="empty">暂无种植中的作物</div>`;
      return;
    }

    api.body.innerHTML = `
      <section class="hero">
        <div>
          <div class="hero-label">${readyCount > 0 ? "现在可以收获" : "下一块成熟"}</div>
          <div class="hero-name">
            ${heroCrop ? renderCropIcon(heroCrop.iconUrl, heroCrop.seedName) : ""}
            <strong>${escapeHtml(readyCount > 0 ? `${readyCount} 块地可收获` : heroCrop.seedName)}</strong>
            ${readyCount > 0 ? '<span class="badge yes">可收获</span>' : ""}
          </div>
          <div class="hero-sub">
            ${
              readyCount > 0
                ? `最前面显示成熟地块 · 最近成熟记录 ${formatDateTime(heroCrop.maturesAt)}`
                : `第 ${heroCrop.plotIndex + 1} 块地 · 剩余 ${formatCountdown(heroCrop.remainingTime)}`
            }
          </div>
        </div>
        <div class="hero-money">
          <strong>${readyCount > 0 ? "现在" : formatDateTime(heroCrop.maturesAt)}</strong>
          <span>${readyCount > 0 ? "可收获" : "北京时间成熟"}</span>
          <div class="hero-actions">
            <button class="harvest-all" type="button" data-action="harvest-all" ${
              readyCount > 0 && !state.harvesting ? "" : "disabled"
            }>
              ${state.harvesting ? "收菜中" : "一键收菜"}
            </button>
          </div>
        </div>
      </section>
      <div class="plot-grid">
        ${crops.map((crop) => renderPlotCard(crop)).join("")}
      </div>
    `;
  }

  /**
   * 渲染好友农场状态页。
   *
   * 好友是否可偷菜按第一块地判断；列表使用横向 bar 展示头像、名字和成熟时间。
   *
   * @param {object} api createRoot 返回的 DOM 引用集合。
   */
  function renderFriendsPage(api) {
    const friends = state.friends;
    const stealableCount = friends.filter((friend) => friend.isStealable).length;
    const nextFriend = friends.find((friend) => !friend.isStealable && friend.firstCrop);
    // 偷菜结果是好友页内提示，不走全局 error，避免业务失败时清空好友列表。
    const noticeHtml = state.stealNotice
      ? `<div class="steal-notice ${state.stealNoticeType === "error" ? "error" : ""}">${escapeHtml(
          state.stealNotice,
        )}</div>`
      : "";

    api.summary.textContent =
      friends.length > 0
        ? `${stealableCount} 可偷菜 · ${friends.length} 位好友`
        : "";

    if (friends.length === 0) {
      api.body.innerHTML = `<div class="empty">暂无好友农场数据</div>`;
      return;
    }

    api.body.innerHTML = `
      <section class="hero">
        <div>
          <div class="hero-label">${stealableCount > 0 ? "现在可以偷菜" : "下一位好友成熟"}</div>
          <div class="hero-name">
            <strong>${escapeHtml(
              stealableCount > 0
                ? `${stealableCount} 位好友可偷菜`
                : nextFriend?.username || "暂无成熟作物",
            )}</strong>
            ${stealableCount > 0 ? '<span class="badge yes">可偷菜</span>' : ""}
          </div>
          <div class="hero-sub">
            ${
              stealableCount > 0
                ? "可偷菜好友已排在列表最前"
                : nextFriend
                  ? `第一块地 · ${nextFriend.firstCrop.seedName} · 剩余 ${formatCountdown(nextFriend.firstCrop.remainingTime)}`
                  : "好友第一块地暂无作物"
            }
          </div>
        </div>
        <div class="hero-money">
          <strong>${stealableCount > 0 ? "现在" : nextFriend ? formatDateTime(nextFriend.firstCrop.maturesAt) : "-"}</strong>
          <span>${stealableCount > 0 ? "可偷菜" : "北京时间成熟"}</span>
        </div>
      </section>
      ${noticeHtml}
      <div class="friend-list">
        ${friends.map((friend) => renderFriendBar(friend)).join("")}
      </div>
    `;
  }

  /**
   * 渲染作物 VIP/普通徽标。
   *
   * @param {object} row 收益排行作物数据。
   * @returns {string} 徽标 HTML 字符串。
   */
  function renderVipBadge(row) {
    return `<span class="badge ${row.isVipOnly ? "yes" : ""}">${
      row.isVipOnly ? "VIP" : "普通"
    }</span>`;
  }

  /**
   * 渲染作物图标。
   *
   * 图标使用 lazy loading 和 async decoding，降低展开面板时对主页面的影响。
   *
   * @param {string} iconUrl 图标 URL。
   * @param {string} name 作物名称，用于 alt 文本。
   * @param {string} [sizeClass=""] 额外尺寸类名，例如 small/tiny。
   * @returns {string} 图片 HTML；没有 URL 时返回空字符串。
   */
  function renderCropIcon(iconUrl, name, sizeClass = "") {
    if (!iconUrl) {
      return "";
    }

    return `<img class="crop-icon ${sizeClass}" src="${escapeHtml(iconUrl)}" alt="${escapeHtml(
      name,
    )}" loading="lazy" decoding="async">`;
  }

  /**
   * 渲染好友头像。
   *
   * 好友没有头像时使用用户名首字符作为 fallback，避免 UI 出现空白头像。
   *
   * @param {object} friend 好友农场状态。
   * @returns {string} 头像 HTML。
   */
  function renderFriendAvatar(friend) {
    if (friend.avatar) {
      return `<img class="friend-avatar" src="${escapeHtml(friend.avatar)}" alt="${escapeHtml(
        friend.username,
      )}" loading="lazy" decoding="async">`;
    }

    return `<div class="friend-avatar fallback">${escapeHtml(friend.username.slice(0, 1).toUpperCase())}</div>`;
  }

  /**
   * 渲染单个收益排行卡片。
   *
   * 进度条宽度相对于当前列表最高每小时收益计算，仅用于视觉比较，不触发动画。
   *
   * @param {object} row 收益排行作物数据。
   * @param {number} index 当前排序索引。
   * @param {number} maxProfit 当前列表最高每小时收益。
   * @returns {string} 作物排行卡片 HTML。
   */
  function renderCropCard(row, index, maxProfit) {
    const percent = maxProfit > 0 ? Math.max(4, (row.revenuePerHour / maxProfit) * 100) : 0;

    return `
      <article class="crop-card ${index < 3 ? "top" : ""}" title="${escapeHtml(row.name)} - ${escapeHtml(row.id)}">
        <div class="rank">${index + 1}</div>
        ${renderCropIcon(row.iconUrl, row.name, "small")}
        <div class="crop-main">
          <div class="crop-title">
            <strong>${escapeHtml(row.name)}</strong>
            ${renderVipBadge(row)}
          </div>
          <div class="metrics">
            <span class="metric">成熟 ${formatGrowthTime(row.growthTimeSeconds)}</span>
            <span class="metric">产量 ${row.harvestQuantity}</span>
            <span class="metric">单价 ${formatUsd(row.unitPrice)}</span>
            <span class="metric">单次 ${formatUsd(row.harvestRevenue)}</span>
          </div>
        </div>
        <div class="profit">
          <strong>${formatUsd(row.revenuePerHour)}</strong>
          <span>$/小时</span>
        </div>
        <div class="bar" aria-hidden="true"><span style="width: ${percent.toFixed(2)}%"></span></div>
      </article>
    `;
  }

  /**
   * 渲染单个地块成熟时间卡片。
   *
   * 成熟地块会添加 ready class，并显示绿色背景、绿色图标边框、可收获徽标和 `现在` 文案。
   *
   * @param {object} crop 归一化后的地块作物数据。
   * @returns {string} 地块卡片 HTML。
   */
  function renderPlotCard(crop) {
    const conditionText =
      crop.conditions.length > 0 ? `状态 ${crop.conditions.join("、")}` : "状态正常";

    return `
      <article class="plot-card ${crop.isMature ? "ready" : ""}" title="第 ${crop.plotIndex + 1} 块地 - ${escapeHtml(
        crop.seedName,
      )}">
        <div class="plot-head">
          <div class="plot-index">#${crop.plotIndex + 1}</div>
          <span class="badge ${crop.isMature ? "yes" : ""}">${crop.isMature ? "可收获" : "生长中"}</span>
        </div>
        <div>
          <div class="plot-title">
            ${renderCropIcon(crop.iconUrl, crop.seedName, "tiny")}
            <strong>${escapeHtml(crop.seedName)}</strong>
          </div>
          <div class="plot-sub">${escapeHtml(conditionText)}</div>
        </div>
        <div class="countdown">
          <strong>${crop.isMature ? "现在" : formatDateTime(crop.maturesAt)}</strong>
          <span>${crop.isMature ? "可收获" : `剩余 ${formatCountdown(crop.remainingTime)}`}</span>
        </div>
      </article>
    `;
  }

  /**
   * 渲染单个好友农场状态 bar。
   *
   * 只展示第一块地的成熟状态；成熟时显示 `现在 / 可偷菜`，未成熟时显示北京时间成熟点。
   *
   * @param {object} friend 好友农场状态。
   * @returns {string} 好友状态 bar HTML。
   */
  function renderFriendBar(friend) {
    const crop = friend.firstCrop;
    const cropText = crop
      ? `${crop.seedName} · ${friend.isStealable ? "第一块地可偷菜" : `剩余 ${formatCountdown(crop.remainingTime)}`}`
      : "第一块地暂无作物";
    const isStealing = state.stealingFriendId === friend.id;
    const cooldownSeconds = getStealCooldownSeconds();
    const isCoolingDown = cooldownSeconds > 0;
    // 偷菜接口不允许短时间重复访问，所以所有好友共用一个全局冷却。
    const canSteal = friend.isStealable && !state.stealingFriendId && !isCoolingDown;
    const stealButtonText = isStealing ? "偷菜中" : isCoolingDown ? `冷却中${cooldownSeconds}s` : "偷菜";

    return `
      <article class="friend-bar ${friend.isStealable ? "stealable" : ""}" title="${escapeHtml(friend.username)}">
        ${renderFriendAvatar(friend)}
        <div class="friend-main">
          <div class="friend-name">
            <strong>${escapeHtml(friend.username)}</strong>
            <span class="badge ${friend.isStealable ? "yes" : ""}">${friend.isStealable ? "可偷菜" : "等待"}</span>
          </div>
          <div class="friend-sub">${escapeHtml(cropText)}</div>
        </div>
        <div class="friend-time">
          <strong>${friend.isStealable ? "现在" : crop ? formatDateTime(crop.maturesAt) : "-"}</strong>
          <span>${friend.isStealable ? "可偷菜" : "成熟时间"}</span>
        </div>
        <div class="friend-actions">
          <a class="friend-action" href="${escapeHtml(buildFriendFarmPageUrl(friend.id))}" target="_blank" rel="noopener noreferrer">访问农场</a>
          <button class="friend-action steal" type="button" data-action="steal-friend" data-friend-id="${escapeHtml(
            friend.id,
          )}" ${canSteal ? "" : "disabled"}>${stealButtonText}</button>
        </div>
      </article>
    `;
  }

  /**
   * 转义 HTML 文本，避免接口字段或作物名称破坏插入的 HTML 结构。
   *
   * @param {*} value 要插入 HTML 的原始值。
   * @returns {string} 转义后的安全文本。
   */
  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  /**
   * 对指定好友执行偷菜。
   *
   * 按好友详情归一化后的第一块地成熟状态作为前置条件；成功后刷新好友状态列表。
   *
   * @param {object} api createRoot 返回的 DOM 引用集合。
   * @param {string} friendId 好友 ID。
   * @returns {Promise<void>}
   */
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
    // 冷却结束时主动刷新一次按钮文案，不需要用户点击或切页触发。
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
        // 成功后尽量刷新好友状态，让已偷过的好友从“可偷菜”里退出来。
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
          // success:false 通常表示已被偷完；仍刷新好友状态，减少列表继续显示可偷的概率。
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

  /**
   * 执行一键收菜。
   *
   * 该操作会改变农场数据，因此点击后先二次确认。接口成功后只刷新成熟时间页数据，
   * 不重新请求收益排行或好友详情。
   *
   * @param {object} api createRoot 返回的 DOM 引用集合。
   * @returns {Promise<void>}
   */
  async function handleHarvestAll(api) {
    if (state.harvesting) {
      return;
    }

    // 使用实时成熟状态，避免地块到点后按钮仍因旧 remainingTime 被判定为不可收。
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
      // 收菜后重新安排下一块成熟提醒；如果没有成熟作物，悬浮按钮会在 render 中恢复绿色。
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

  /**
   * 静默刷新我的地块成熟状态，只用于更新悬浮按钮颜色和下一次成熟定时器。
   *
   * 这个请求失败时不影响当前面板页面，也不展示错误。
   *
   * @param {object} api createRoot 返回的 DOM 引用集合。
   * @returns {Promise<void>}
   */
  async function refreshCropStatus(api) {
    if (state.cropStatusLoading || (state.loading && state.page === "crops")) {
      return;
    }

    // 这个状态只防止后台重复请求，不驱动主面板 loading 文案。
    state = {
      ...state,
      cropStatusLoading: true,
    };

    try {
      const cropsPayload = await requestJson(CROPS_URL);

      state = {
        ...state,
        cropStatusLoading: false,
        crops: normalizeCrops(cropsPayload),
      };
      // 静默刷新后只更新成熟提醒和必要的页面渲染，不改变当前页签。
      scheduleNextCropReadyRender(api);
      render(api);
    } catch {
      state = {
        ...state,
        cropStatusLoading: false,
      };
    }
  }

  /**
   * 根据当前页签拉取所需数据并刷新全局状态。
   *
   * 收益页只请求种子和价格接口；成熟时间页只请求自己的地块接口；好友农场页
   * 请求好友列表和好友详情。这样可以避免好友详情请求拖慢其他页面。
   *
   * @param {object} api createRoot 返回的 DOM 引用集合。
   * @returns {Promise<void>}
   */
  async function refreshData(api) {
    state = {
      ...state,
      loading: true,
      error: "",
    };
    render(api);

    try {
      const nextState = await loadCurrentPageData();

      state = {
        ...state,
        ...nextState,
        loading: false,
        updatedAt: new Date().toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      };
    } catch (error) {
      state = {
        ...state,
        loading: false,
        error: error.message || "加载失败",
      };
    }

    render(api);
    scheduleNextCropReadyRender(api);
    if (state.page !== "crops") {
      refreshCropStatus(api);
    }
  }

  /**
   * 按当前页签加载接口数据。
   *
   * @returns {Promise<object>} 可合并进 state 的局部状态对象。
   */
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

  const api = createRoot();
  render(api);
  refreshCropStatus(api);
})();
