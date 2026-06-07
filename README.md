# HYB Farm 作物收益排行榜

一个用于黑与白农场页面的 Tampermonkey 用户脚本。脚本会在页面右下角提供一个轻量面板，用于查看作物收益排行、自己农场地块成熟时间，以及好友农场偷菜状态。

## 项目简介

本项目主要包含两部分：

- Tampermonkey 用户脚本：直接在网页内展示收益排行、成熟时间和好友农场状态。
- Node CLI 辅助脚本：在命令行中根据接口数据输出作物收益排行榜。

用户脚本不依赖 React/Vue 等前端框架，不引入远程库。界面使用原生 DOM、Shadow DOM 和内联 CSS 实现。

## 主要功能

- 作物收益排行，按每小时收益从高到低排序
- 全部 / 普通 / VIP 作物筛选
- 当前最划算作物展示
- 作物图标、成熟周期、产量、实时单价、单次收益、每小时收益展示
- 自己农场未收获地块成熟时间展示
- 有成熟作物时右下角悬浮按钮变为金黄色提醒
- 成熟时间页支持一键收菜，并在操作前二次确认
- 好友农场状态展示，按第一块地判断是否可偷菜
- 好友农场访问链接和偷菜按钮
- 偷菜请求冷却与结果提示
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

1. 安装浏览器扩展 Tampermonkey。
2. 在 Tampermonkey 中创建或更新用户脚本。
3. 使用项目中的主脚本内容：

```text
Tampermonkey/farm-profit-ranking.user.js
```

4. 打开：

```text
https://cdk.hybgzs.com/
```

5. 点击页面右下角 `$` 按钮展开面板。

脚本依赖浏览器当前登录态 Cookie，不会读取、保存或硬编码 Cookie。

### 命令行排行脚本

CLI 脚本位于：

```text
script/crop-profit-ranking.js
```

使用前需要在项目根目录创建 `cookie.txt`，内容为当前登录 Cookie。

```bash
npm install
node script/crop-profit-ranking.js
```

注意：`cookie.txt` 包含敏感登录信息，不要提交到仓库。

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
- 一键收菜：收获自己农场中已成熟作物
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
- 收益排行页能展示作物图标、收益数据和进度条
- 成熟时间页能展示地块状态，成熟作物显示可收获样式
- 有成熟作物时悬浮按钮变为金黄色
- 一键收菜按钮在无成熟作物时禁用，有成熟作物时可点击并弹出确认
- 好友农场页能展示好友状态、访问农场按钮和偷菜按钮
- 主题按钮能在 `🌙` / `☀️` 间切换，并在刷新后保留选择

## 文档

- [详细实现文档](doc/implement.md)

## License

MIT License. See [LICENSE](LICENSE).
