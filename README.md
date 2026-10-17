<div align="center">

# Deepseek-Search-Tools

**把 DeepSeek 专用搜索 / 抓取 API 接进 DeepSeek Harness，让 `web_search` 与 `web_fetch` 不再消耗模型轮次。**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)
[![Topic](https://img.shields.io/badge/topic-deepseek--harness--plugins-8a2be2.svg)](#)
[![DSH](https://img.shields.io/badge/dsh-%3E%3D0.2.0--rc.1-black.svg)](package.json)

[简体中文](README.md) · [English](#english)

</div>

---

## 这是什么

DSH 自带的搜索要么走 `dsh-free-search` 的公开引擎，要么走官方 `deepseek-official` provider——后者把搜索塞进一次完整的 Anthropic Messages 调用（`web_search_20250305` server tool），**每次搜索都要跑一整个模型轮次并产生 token**。

本插件直接调用 DeepSeek 专用工具 API，搜索与抓取都是一次普通的 HTTPS 请求：

| 工具 | 端点 | 返回 |
| --- | --- | --- |
| `web_search` | `POST https://api.deepseek.com/v1/tools/search` | `results[]`（title / url / snippet / summary / content / date / authority …） |
| `web_fetch` | `POST https://api.deepseek.com/v1/tools/fetch` | `{ title, content }`，`content` 为 Markdown |

API 文档：<https://api-docs.deepseek.com/zh-cn/guides/search>　计费：搜索与抓取各 **每 1,000 次成功请求 5 元**，`count` 不影响价格，QPS 各 5。

插件在 `ctx.web` 的**两个注册表**各注册一个 provider（id 均为 `deepseek-tools`），所以整条链路只需切换一次 provider，不需要改动任何官方包。

## 特性

- **不花模型 token**：返回的是 API 已整理好的 `summary`（600–800 字），并附带 `date` 与 `authority`。
- **无需钉死配置**：`apply` 时自动接管「未设置 / 仍是出厂默认 / 被 `dsh-free-search` 抢先注册」的 provider；已被别人钉住时只留一行警告，绝不抢。
- **优雅降级**：插件没加载，原本的 provider 继续工作；`web_fetch` 遇到 403/404/超时/空正文可退回匿名 HTTP 抓取。
- **设置页 Search Tools**：生效状态条、密钥管理、真实连通性测试、逐条搜索明细、用量汇总（简中 / English 双语）。
- **一处记录**：明细与用量写在 `<DSH_HOME>/plugin-data/deepseek-search-tools/usage.json`，原子写入，写失败也绝不影响搜索本身。

## 安装

> 前置：`dsh plugin` 只是把参数转发给 **pnpm**，所以 `pnpm` 必须在 `PATH` 里（`npm i -g pnpm`）。
> DSH 桌面版自带一份 pnpm（`resources/runtime/pnpm`），但不会注入终端 `PATH`，命令行安装需要自己装。
>
> 名称说明：npm 上 `searchtools` 已被占用，本包发布名是 **`deepseek-search-tools`**；
> 安装命令里的标识就是这个包名。

### 从 npm（推荐）

```bash
dsh plugin --profile web add deepseek-search-tools
```

### 从 GitHub

```bash
dsh plugin --profile web add github:<owner>/deepseek-search-tools
```

### 启用 bundle

`dsh plugin add` 只做包安装（转发给 pnpm），**还需要让 profile 加载它**。编辑 `~/.dsh/profiles/web/package.json`：

```jsonc
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        // …
        "deepseek-search-tools"
      ]
    }
  }
}
```

或者从 DSH 设置页的 **Plugins** 页签启用它（该页会在安装成功后自动把声明了 `dsh.bundle` 的依赖写进 `bundles`）。

从旧包名 `dsh-deepseek-tools` 升级时，旧的明细日志会被自动接续读取，不需要手动搬移。

然后重启 `dsh web`（桌面端则重启应用）。重新打开会话问一个需要联网的问题，`web_search` 就会走 `/v1/tools/search`。

### 本地开发

```powershell
dsh plugin --profile web add link:C:\path\to\deepseek-search-tools
```

`link:` 安装的包在 `pnpm install` 之后依然有效，改完 `lib/client.js` 只需在 GUI 里按 <kbd>Ctrl</kbd>+<kbd>R</kbd>（浏览器端 bundle 每次请求都从磁盘读），改 `lib/index.js` 才需要重启。

## 配置

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml（可选：想固定 provider 时再加）
- insert:
    - id: web-search-deepseek-tools
      name: deepseek-search-tools
      config:
        # apiKeyEnv: DEEPSEEK_API_KEY
        # baseUrl: https://api.deepseek.com
        # searchPath: /v1/tools/search
        # fetchPath: /v1/tools/fetch
```

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | 要解析的凭据名称 |
| `baseUrl` | `https://api.deepseek.com` | API 根地址（结尾斜杠自动去除） |
| `searchPath` | `/v1/tools/search` | 搜索路径 |
| `fetchPath` | `/v1/tools/fetch` | 抓取路径 |
| `localization` | `""` | 非空时发送 `localization`（IP 提示，让结果更贴近当地） |
| `includeContent` | `false` | 发送 `need_content: true`，结果直接带正文（token 更多） |
| `fetchFallback` | `true` | `web_fetch` 遇到 403/404/超时/空正文时退回 `http` provider |
| `takeOverSearch` | `true` | `web.searchProviderId` 未设置或仍为出厂默认时接管 |
| `takeOverFetch` | `true` | 同上，对象是 `web.fetchProviderId` |
| `timeoutMs` | `60000` | 单次请求超时 |
| `maxSourceChars` | `4000` | 单条来源交给模型的上限 |
| `apiKey` | `""` | 直接写死的密钥，优先于凭据服务 |
| `enableSettingsPage` | `true` | 是否挂上设置页的「Search Tools」栏目 |
| `usageDataDir` | `""` | 用量记录目录，空串表示 `<DSH_HOME>/plugin-data/deepseek-search-tools` |
| `usageLimit` | `2000` | 明细保留条数 |
| `usageDays` | `7` | 用量汇总的每日序列天数 |

不钉 `web.searchProvider` 是刻意的：`- id: web` 写进的是「配置」，配置活得比插件久；插件加载失败时 `web_search` 会变成每次都报 `configured web provider "deepseek-tools" is not registered`。运行期接管则是优雅的。真要「插件不见就大声失败」：

```yaml
- id: web
  config:
    searchProvider: deepseek-tools
    fetchProvider: deepseek-tools   # 想保留匿名 HTTP 抓取就写 http
```

注意 patch 是整行覆盖（不 merge）。

## 凭据

依次尝试，第一个有值者胜出：

1. `ctx.get("credentials").resolve(apiKeyEnv)` —— 凭据服务（已存的 ref、启动环境、dotenv 兜底）；
2. `process.env[apiKeyEnv]`。

`DEEPSEEK_API_KEY` 通常已经在 `~/.dsh/.credentials.yaml` 里，**不需要额外配置**。缺失时报 `WEB_PROVIDER_CREDENTIAL_MISSING` 并直接写出变量名。也可以直接在设置页保存 / 清除密钥，写入的是 Harness 自己的凭据服务。

## 设置页：Search Tools

`settings.section`（`id: "tools"`）下有三个月签：

| 页签 | 内容 |
| --- | --- |
| **API 管理** | 顶部生效状态条（生效中 / 已接管但没有密钥 / 部分生效 / 未生效，并指出实际 provider），当前凭据（ref、来源 `file`/`env`/`literal`、掩码值）、端点、超时；「测试连接」会真打一次 `/v1/tools/search`；可直接保存或清除密钥。 |
| **搜索明细** | 每条 `web_search` / `web_fetch`：时间、类型、内容、请求条数、返回条数、成功/失败、耗时；失败附 API 错误串；可按 全部 / 搜索 / 抓取 / 失败 筛选。 |
| **用量汇总** | 总调用、今日调用、成功率、平均延迟、累计返回条数、近 7 日柱状图、清除统计。 |

- 记录文件：`<DSH_HOME>/plugin-data/deepseek-search-tools/usage.json`（原子写入，默认保留 2000 条）。
- 主机端由 `lib/bridge.js` 挂出五条 loopback 路由：`/api/deepseek-search-tools/{overview,test,key-set,key-unset,usage-clear}`，只接受 `POST`，只允许本机来源（`socket.remoteAddress` + `Host` + `Origin`），body 上限 64 KB。
- **语言**：右上角 `中文 / English` 切换，文案全部走 `lib/client.js` 里的同一张 `STRINGS` 表，中文一律简体；默认中文，除非 `document.documentElement.lang` 是 `en*`；选择存在 `localStorage["deepseek-search-tools:lang"]`。
- **导航图标**：外壳按 section id 查固定表决定图标，`settings.section` 没有 icon 选项。插件给自己的导航格加 `data-ddt-nav-icon`，再用 mask 画出放大镜（隐藏齿轮），不动 React 节点，所以换语言或重绘都不会坏。
- 只想用 provider、不要记录时设 `enableSettingsPage: false`。

## 离线自检

不需要 API key，也不需要 DSH：

```bash
node --import ./test/register-loader.mjs test/harness.mjs
```

87 项检查覆盖：provider 注册与 id 冲突、接管/不抢/交还的各种组合、`available()` 必须同步返回布尔值、请求格式（bearer、`count` 夹取、`need_content`、`localization`）、响应映射、`fetch` 标题融合与 `http` 退回、429 重试、缺凭据错误码、`SearchResult.truncated` 必须为 `false`（否则 `web_search` 会回 `value is not lossless JSON`）、五条桥接路由与防护（非 loopback 403、非 POST 405）、用量记录（成功失败都记且确实落盘）、浏览器 bundle 的加载与栏目注册，最后用 React hook 替身把整个 Search Tools 页真正渲染一遍（载入数据后、切换每个页签后、四种生效状态各一次、切到 English 再切回简体）。

加 `--live <apiKey>` 会多跑三项真端到端检查：

```bash
node --import ./test/register-loader.mjs test/harness.mjs --live sk-xxxx
```

## 文件

```
lib/index.js        插件本体（provider、凭据解析、请求/重试、接管逻辑、设置桥挂载）
lib/client.js       设置页浏览器端 bundle（Search Tools 栏目）
lib/bridge.js       设置页 loopback 路由
lib/usage.js        用量记录与汇总
cordis.patch.yml    可贴进 profile 的 patch 片段
test/harness.mjs    离线 + live 自我检查
test/loader.mjs     @deepseek-ai/* 模块解析垫片（仅测试用）
```

## 常见问题

**`dsh plugin --profile web add deepseek-search-tools` 装完没反应？** 还需要把包名加进 profile 的 `dsh.profile.bundles`（见上文），重启 `dsh web`。

**桌面版 profile 改不动？** `desktop` profile 由 Electron 应用独占管理（`dsh --profile desktop --dump-config` 会直接拒绝），必须在应用内重启或按 <kbd>Ctrl</kbd>+<kbd>R</kbd>。

**和 `dsh-free-search` 冲突吗？** 不冲突。本插件只接管被它趁默认值抢下的 `web-search-free` / `fs-quality-fetch`，它其它工具（`advanced_search`、`multi_search`、`research`、`weather` …）照常。

**402 / 401？** 余额不足与鉴权失败原样上报，不重试。

---

<a id="english"></a>

## English

Deepseek-Search-Tools wires DeepSeek's dedicated Tools API into DeepSeek Harness (DSH) so the built-in `web_search` / `web_fetch` hit `POST /v1/tools/search` and `POST /v1/tools/fetch` directly — one HTTPS call instead of a full model turn, with `date` and `authority` metadata and no generated tokens.

```bash
dsh plugin --profile web add deepseek-search-tools
# then add "deepseek-search-tools" to dsh.profile.bundles in ~/.dsh/profiles/web/package.json
# and restart `dsh web`
```

It registers a provider in both `ctx.web` registries (id `deepseek-tools`), takes over only unclaimed/default providers, falls back to plain HTTP fetch on 403/404/timeouts, and adds a bilingual **Search Tools** settings page (status strip, key management, live connection test, per-call log, usage summary).

Run the offline check with `node --import ./test/register-loader.mjs test/harness.mjs` (87 checks, no API key needed).

## 许可

[MIT](LICENSE) © deepseek-search-tools contributors

插件清单收录主题：[`deepseek-harness-plugins`](https://github.com/topics/deepseek-harness-plugins) · [`dsh-plugin`](https://github.com/topics/dsh-plugin)
