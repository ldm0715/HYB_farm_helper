const fs = require("node:fs/promises");
const path = require("node:path");
const Table = require("cli-table3");

const SEEDS_URL = "https://cdk.hybgzs.com/api/farm/codex/seeds?";
const PRICES_URL =
  "https://cdk.hybgzs.com/api/farm/recycle/prices?includeTrend=1&granularity=day&trendRange=7";
const PRICE_DIVISOR = 500000;

async function readCookie() {
  const cookiePath = path.join(process.cwd(), "cookie.txt");
  const cookie = (await fs.readFile(cookiePath, "utf8")).trim();

  if (!cookie) {
    throw new Error("cookie.txt 为空，请把登录 Cookie 写入该文件。");
  }

  return cookie;
}

async function fetchJson(url, cookie) {
  const response = await fetch(url, {
    headers: {
      cookie,
      accept: "application/json",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36",
    },
  });

  const text = await response.text();
  let json;

  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`接口返回的不是 JSON：${url}\n${text.slice(0, 300)}`);
  }

  if (!response.ok || json.success === false) {
    const message = json.error?.message || response.statusText || "请求失败";
    throw new Error(`${url} 请求失败：${message}`);
  }

  return json;
}

function normalizeSeeds(payload) {
  const seeds = payload?.data?.seeds;

  if (!Array.isArray(seeds)) {
    throw new Error("种子接口数据结构异常：未找到 data.seeds 数组。");
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
    return `${hours}小时${minutes}分钟（${seconds}秒）`;
  }

  return `${minutes}分钟（${seconds}秒）`;
}

function printTable(rows) {
  if (rows.length === 0) {
    console.log("暂无可排行数据");
    return;
  }

  const headers = Object.keys(rows[0]);
  const table = new Table({
    head: headers,
    style: {
      head: [],
      border: [],
    },
    chars: {
      top: "═",
      "top-mid": "╤",
      "top-left": "╔",
      "top-right": "╗",
      bottom: "═",
      "bottom-mid": "╧",
      "bottom-left": "╚",
      "bottom-right": "╝",
      left: "║",
      "left-mid": "╟",
      mid: "─",
      "mid-mid": "┼",
      right: "║",
      "right-mid": "╢",
      middle: "│",
    },
  });

  table.push(...rows.map((row) => headers.map((header) => row[header])));
  console.log(table.toString());
}

async function main() {
  const cookie = await readCookie();
  const [seedsPayload, pricesPayload] = await Promise.all([
    fetchJson(SEEDS_URL, cookie),
    fetchJson(PRICES_URL, cookie),
  ]);

  const seeds = normalizeSeeds(seedsPayload);
  const prices = normalizePrices(pricesPayload);

  const ranking = seeds
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

  console.log("作物收益排行榜");
  printTable(
    ranking.map((item, index) => ({
      排名: index + 1,
      作物: item.name,
      作物ID: item.id,
      成熟时间: formatGrowthTime(item.growthTimeSeconds),
      成熟数量: item.harvestQuantity,
      "实时单价($)": formatUsd(item.unitPrice),
      "单次成熟收益($)": formatUsd(item.harvestRevenue),
      "每小时收益($)": formatUsd(item.revenuePerHour),
      VIP: item.isVipOnly ? "是" : "否",
    })),
  );

  const missingPriceSeeds = seeds.filter((seed) => !prices.has(seed.id));
  if (missingPriceSeeds.length > 0) {
    console.warn(
      `以下作物缺少实时价格，未参与排行：${missingPriceSeeds
        .map((seed) => `${seed.name}(${seed.id})`)
        .join("、")}`,
    );
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
