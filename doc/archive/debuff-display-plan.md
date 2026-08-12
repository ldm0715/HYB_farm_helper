# Debuff 显示修复执行计划

## 背景

HYB Farm 后续更新为作物增加了 debuff 机制（缺水/杂草/虫害）。API `conditions` 字段由字符串数组变更为对象数组 `{ kind: "thirsty" | "weed" | "pest" }[]`，但脚本代码仍按字符串数组拼接，导致"农场情况"网格卡片显示 `状态 [object Object]`。

## 图标显示规则

| 条件 | 图标 |
|---|---|
| 已成熟 | 真实作物图标 `crop.iconUrl` |
| 未成熟 + 有 debuff | debuff emoji：💧 缺水 / 🌿 杂草 / 🐛 虫害 |
| 未成熟 + 无 debuff | 占位图 `https://cdk.hybgzs.com/farm/crops/starfruit_s2.png` |

优先级：成熟 → 真实图标；未成熟时 debuff emoji 优先于占位图。

## 状态文字规则

- 无 debuff → "状态正常"（现状，不变）
- 有 debuff → "状态 缺水"（保留「状态 」前缀，多个用 `、` 连接），文字红色 `var(--warn)`

## 修改范围

| 文件 | 改动 |
|---|---|
| `Tampermonkey/farm-profit-ranking.user.js` | 新增常量、归一化 conditions、renderPlotCard 图标/状态逻辑、新增 CSS |
| `doc/api.md` | conditions 类型与说明 |
| `doc/implement.md` | conditions 类型、说明、归一化示例 |

仅改"我的农场 → 农场情况"网格卡片（`renderPlotCard`），hero 区与好友页不动。

## 代码改动详情

### 1. 常量区新增（API 常量附近）

```js
const DEBUFF_META = {
  thirsty: { name: "缺水", icon: "💧" },
  weed: { name: "杂草", icon: "🌿" },
  pest: { name: "虫害", icon: "🐛" },
};
const CROP_PLACEHOLDER_URL = "https://cdk.hybgzs.com/farm/crops/starfruit_s2.png";
```

### 2. `normalizeCrops` — conditions 归一化

将原始 `[{ kind: "thirsty" }]` 映射为 `[{ kind, name, icon }]`，兼容字符串/对象、过滤未知 kind：

```js
conditions: Array.isArray(crop.conditions)
  ? crop.conditions
      .map((c) => {
        const kind = typeof c === "string" ? c : c?.kind;
        const meta = DEBUFF_META[kind];
        return meta ? { kind, name: meta.name, icon: meta.icon } : null;
      })
      .filter(Boolean)
  : [],
```

### 3. `renderPlotCard` — 图标与状态文字

**图标**：`isMature` → 真实图标；否则有 debuff → emoji span；否则占位图。

**状态文字**：有 debuff → 红色 "状态 缺水"；无 debuff → "状态正常"。

### 4. CSS 新增

```css
.plot-sub.debuff { color: var(--warn); font-weight: 600; }
.crop-icon.debuff-icon {
  display: grid;
  place-items: center;
  font-size: 14px;
  line-height: 1;
}
```

## 验证

- `node --check Tampermonkey/farm-profit-ranking.user.js`
- 浏览器实测：未成熟+缺水显示 💧 + 红色「状态 缺水」；正常未成熟显示杨桃占位图 + 「状态正常」；成熟显示真实图标
