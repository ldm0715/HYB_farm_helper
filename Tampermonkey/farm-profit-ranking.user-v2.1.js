// ==UserScript==
// @name         HYB Farm 作物收益排行榜
// @namespace    https://cdk.hybgzs.com/
// @version      2.1.0
// @description  轻量展示最划算的作物收益排行。
// @author       Codex
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
  const PRICE_DIVISOR = 500000;
  const ROOT_ID = "hyb-farm-profit-widget";

  let state = {
    expanded: false,
    loading: false,
    vipMode: "all",
    rows: [],
    error: "",
    updatedAt: "",
  };

  function requestJson(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        anonymous: false,
        headers: {
          accept: "application/json",
        },
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
            reject(new Error(message));
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

  function normalizeSeeds(payload) {
    const seeds = payload?.data?.seeds;

    if (!Array.isArray(seeds)) {
      throw new Error("种子接口数据结构异常");
    }

    return seeds.map((seed) => ({
      id: seed.id,
      name: seed.name || seed.id,
      growthTimeSeconds: Number(seed.growthTime),
      harvestQuantity: Number(seed.harvestQuantity),
      isVipOnly: Boolean(seed.isVipOnly),
    }));
  }

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

  function formatNumber(value, fractionDigits = 4) {
    return Number(value).toLocaleString("zh-CN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: fractionDigits,
    });
  }

  function formatUsd(value) {
    return `$${formatNumber(value)}`;
  }

  function formatGrowthTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}小时${minutes}分钟`;
    }

    return `${minutes}分钟`;
  }

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

        .panel {
          position: fixed;
          right: 18px;
          bottom: 76px;
          z-index: 2147483647;
          width: min(620px, calc(100vw - 28px));
          max-height: min(680px, calc(100vh - 104px));
          background: var(--bg);
          color: var(--text);
          border: 1px solid rgba(23, 32, 51, 0.12);
          border-radius: 10px;
          box-shadow: 0 18px 60px rgba(23, 32, 51, 0.2);
          overflow: hidden;
        }

        .hidden {
          display: none;
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

        .chip {
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

        .chip.active {
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
          max-height: min(560px, calc(100vh - 230px));
          overflow: auto;
          overscroll-behavior: contain;
          padding: 12px;
          background: #f7f9fb;
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

        .cards {
          display: grid;
          gap: 8px;
        }

        .crop-card {
          display: grid;
          grid-template-columns: 36px minmax(0, 1fr) 120px;
          gap: 10px;
          align-items: center;
          padding: 10px 12px;
          border: 1px solid var(--line);
          border-radius: 8px;
          background: #fff;
        }

        .crop-card.top {
          border-color: rgba(183, 121, 31, 0.28);
          background: #fffdf7;
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
          grid-column: 2 / 4;
          height: 6px;
          overflow: hidden;
          border-radius: 999px;
          background: #e9eef3;
        }

        .bar span {
          display: block;
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(90deg, #138a5b, #42b883);
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
          .filters {
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

          .crop-card {
            grid-template-columns: 32px minmax(0, 1fr);
          }

          .profit {
            grid-column: 2;
            text-align: left;
          }

          .bar {
            grid-column: 1 / 3;
          }

          .summary {
            display: none;
          }
        }
      </style>
      <button class="trigger" type="button" title="作物收益排行榜" aria-label="打开作物收益排行榜">⌘</button>
      <section class="panel hidden" aria-label="作物收益排行榜">
        <div class="header">
          <div class="title">
            <strong>作物收益排行榜</strong>
            <span class="status">等待加载</span>
          </div>
          <div class="actions">
            <button class="refresh" type="button">刷新</button>
            <button class="icon-btn close" type="button" title="收起" aria-label="收起">×</button>
          </div>
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
      refresh: shadow.querySelector(".refresh"),
      close: shadow.querySelector(".close"),
      body: shadow.querySelector(".body"),
      summary: shadow.querySelector(".summary"),
      chips: Array.from(shadow.querySelectorAll(".chip")),
    };

    api.trigger.addEventListener("click", () => {
      state.expanded = !state.expanded;
      render(api);
      if (state.expanded && state.rows.length === 0 && !state.loading) {
        refreshData(api);
      }
    });

    api.close.addEventListener("click", () => {
      state.expanded = false;
      render(api);
    });

    api.refresh.addEventListener("click", () => refreshData(api));

    for (const chip of api.chips) {
      chip.addEventListener("click", () => {
        state.vipMode = chip.dataset.vip;
        render(api);
      });
    }

    return api;
  }

  function getVisibleRows() {
    if (state.vipMode === "vip") {
      return state.rows.filter((row) => row.isVipOnly);
    }

    if (state.vipMode === "normal") {
      return state.rows.filter((row) => !row.isVipOnly);
    }

    return state.rows;
  }

  function render(api) {
    api.panel.classList.toggle("hidden", !state.expanded);
    api.trigger.textContent = state.expanded ? "×" : "⌘";
    api.refresh.disabled = state.loading;
    api.refresh.textContent = state.loading ? "加载中" : "刷新";

    for (const chip of api.chips) {
      chip.classList.toggle("active", chip.dataset.vip === state.vipMode);
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

    if (state.loading && state.rows.length === 0) {
      api.summary.textContent = "";
      api.body.innerHTML = `<div class="empty">正在加载...</div>`;
      return;
    }

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

  function renderVipBadge(row) {
    return `<span class="badge ${row.isVipOnly ? "yes" : ""}">${
      row.isVipOnly ? "VIP" : "普通"
    }</span>`;
  }

  function renderCropCard(row, index, maxProfit) {
    const percent = maxProfit > 0 ? Math.max(4, (row.revenuePerHour / maxProfit) * 100) : 0;

    return `
      <article class="crop-card ${index < 3 ? "top" : ""}" title="${escapeHtml(row.name)} - ${escapeHtml(row.id)}">
        <div class="rank">${index + 1}</div>
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

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function refreshData(api) {
    state = {
      ...state,
      loading: true,
      error: "",
    };
    render(api);

    try {
      const [seedsPayload, pricesPayload] = await Promise.all([
        requestJson(SEEDS_URL),
        requestJson(PRICES_URL),
      ]);

      state = {
        ...state,
        loading: false,
        rows: buildRanking(seedsPayload, pricesPayload),
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
  }

  const api = createRoot();
  render(api);
})();

