# HYB Farm 黑与白农场小助手

<div align="center">
<img alt="index" src="https://github.com/ldm0715/HYB_farm_helper/blob/main/static/logo.png" width="10%">
</div>

<div align="center">
  <a href="https://greasyfork.org/zh-CN/scripts/581559-hyb-farm-helper">
    <img alt="Tampermonkey" src="https://img.shields.io/badge/Tampermonkey-v5.5.0-orange?logo=tampermonkey&logoColor=white">
  </a>

  <a href="https://greasyfork.org/zh-CN/scripts/581559-hyb-farm-helper">
    <img alt="Greasy Fork Version" src="https://img.shields.io/greasyfork/v/581559?label=version&color=green&logo=greasyfork&logoColor=white">
  </a>

  <a href="https://greasyfork.org/zh-CN/scripts/581559-hyb-farm-helper">
    <img alt="License" src="https://img.shields.io/greasyfork/l/581559?label=license&color=blue&logo=opensourceinitiative&logoColor=white">
  </a>
</div>


一个用于黑与白农场页面的 Tampermonkey 用户脚本。脚本会在页面右下角提供一个轻量面板，用于查看作物收益排行、自己的农场情况、仓库库存和好友农场偷菜状态。

## 项目简介

本项目主要包含两部分：

- Tampermonkey 用户脚本：直接在网页内展示收益排行、我的农场、我的仓库和好友农场状态。
- Node CLI 辅助脚本：在命令行中根据接口数据输出作物收益排行榜。

用户脚本不依赖 React/Vue 等前端框架，不引入远程库。界面使用原生 DOM、Shadow DOM 和内联 CSS 实现。

## 主要功能

- 作物图标、成熟周期、产量、实时单价、单次收益、每小时收益展示
- 我的农场页展示农场情况，按接口返回的田地数量补齐空地
- 我的仓库展示库存、回收价格，并支持多选数量
- 有成熟作物时右下角悬浮按钮变为金黄色提醒
- 我的农场页支持一键收菜，并在操作前二次确认
- 我的仓库多选后支持一键卖出，卖出前会先获取最新回收报价
- 我的仓库多选后支持一键种植，种植前会校验空闲土地数量
- 好友农场访问链接和偷菜按钮
- 浅色 / 暗色主题切换，主题选择会持久化


## 技术栈

| 部分 | 技术 |
| --- | --- |
| 用户脚本 | Tampermonkey + 原生 JavaScript |
| 界面隔离 | Shadow DOM |
| 样式 | 内联 CSS + CSS variables |
| 接口请求 | `GM_xmlhttpRequest` |
| CLI 辅助脚本 | Node.js |
| CLI 表格输出 | `cli-table3` |

## 安装使用

### Tampermonkey 脚本

1. 安装浏览器扩展 [Tampermonkey](https://www.tampermonkey.net/)。
2. 安装脚本：
   1. 新建脚本后，粘贴`Tampermonkey/farm-profit-ranking.user.js`
   2. 从[greasyfork-hyb-farm-helper](https://greasyfork.org/zh-CN/scripts/581559-hyb-farm-helper)下载脚本

4. 打开黑与白官网

5. 点击页面右下角 `$` 按钮展开面板。

脚本依赖浏览器当前登录态 Cookie，不会读取、保存或硬编码 Cookie。

### 命令行排行脚本

CLI 脚本位于：`script/crop-profit-ranking.js`

使用前需要在项目根目录创建 `cookie.txt`，内容为当前登录 Cookie。

使用如下命令，即可在控制台打印出结果
```bash
npm install
node script/crop-profit-ranking.js
```
<div align="center">
<img alt="index" src="https://github.com/ldm0715/HYB_farm_helper/blob/main/static/console.png" width="65%">
</div>


## 界面展示

作物实时价格面板（亮色）：

<div align="center">
<img alt="index" src="https://github.com/ldm0715/HYB_farm_helper/blob/main/static/crops.png" width="65%">
</div>

作物实时价格面板（暗色）：

<div align="center">
<img alt="index" src="https://github.com/ldm0715/HYB_farm_helper/blob/main/static/crops_dark.png" width="65%">
</div>

好友农场面板（亮色）：

<div align="center">
<img alt="index" src="https://github.com/ldm0715/HYB_farm_helper/blob/main/static/friends_farm.png" width="65%">
</div>

好友农场面板（暗色）：

<div align="center">
<img alt="index" src="https://github.com/ldm0715/HYB_farm_helper/blob/main/static/friends_farm.png" width="65%">
</div>

我的农场面板：

<div align="center">
<img alt="index" src="https://github.com/ldm0715/HYB_farm_helper/blob/main/static/farm.png" width="65%">
</div>

我的仓库面板

<div align="center">
<img alt="index" src="https://github.com/ldm0715/HYB_farm_helper/blob/main/static/warehouse.png" width="65%">
</div>

## 目录结构

```text
hyubai_farm/
├── Tampermonkey/
│   ├── farm-profit-ranking.user.js      # 当前主用户脚本
│   └── farm-profit-ranking.user-v*.js   # 历史版本备份
├── script/
│   └── crop-profit-ranking.js           # Node CLI 收益排行脚本
├── doc/
│   └── implement.md                     # 详细实现文档
├── static/                              # 静态资源目录
├── package.json
├── package-lock.json
├── LICENSE
└── README.md
```

## 接口范围

用户脚本会请求 HYB Farm 的农场接口，主要包括：

- 种子图鉴：获取作物静态配置
- 回收价格：获取实时回收价格和趋势信息
- 当前地块：获取自己农场未收获作物成熟状态
- 农场地块容量：获取当前总土地数量，用于一键种植前校验空地
- 我的仓库：获取库存作物、数量和回收价格
- 一键收菜：收获自己农场中已成熟作物
- 回收报价：卖出前获取最新市场单价
- 作物回收：按仓库多选数量卖出作物
- 批量种植：按仓库多选数量种植作物
- 好友列表：获取可查看偷菜状态的好友
- 好友农场详情：查看好友第一块地成熟状态
- 好友偷菜：对指定好友执行偷菜

详细接口结构和处理逻辑见 [doc/implement.md](doc/implement.md)。

## 验证

用户脚本语法检查：

```bash
node --check Tampermonkey/farm-profit-ranking.user.js
```

浏览器验证重点：

- 面板能通过右下角 `$` 按钮展开和收起
- 面板顶部标题显示“黑与白农场小助手”
- 收益排行页能展示作物图标、收益数据和进度条
- 我的农场页能展示农场情况，空地不会缺失，成熟作物显示可收获样式
- 有成熟作物时悬浮按钮变为金黄色
- 一键收菜按钮在无成熟作物时禁用，有成熟作物时可点击并弹出确认
- 我的仓库能展示库存，进入多选后可调整数量
- 一键卖出会展示按行拼接的卖出结果，并刷新仓库
- 一键种植会校验空闲土地数量，成功后刷新农场情况和仓库
- 好友农场页能展示好友状态、访问农场按钮和偷菜按钮
- 主题按钮能在 `🌙` / `☀️` 间切换，并在刷新后保留选择

## 文档

- [详细实现文档](doc/implement.md)

## License

MIT License. See [LICENSE](LICENSE).
