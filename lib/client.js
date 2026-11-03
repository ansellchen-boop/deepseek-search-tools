/**
 * deepseek-search-tools — Settings → Tools page (browser half).
 *
 * Registers one settings section named "Tools" with three tabs:
 *
 *   API 管理   the credential the plugin searches with (the Harness's own
 *              DEEPSEEK_API_KEY by default), the backend tables, the
 *              endpoint, and a live test.
 *   搜索明细   every web_search / web_fetch call the plugin served.
 *   用量汇总   totals, today, the trailing-day series, and a reset.
 *
 * All data comes from the host half's loopback bridge (`lib/bridge.js`); the
 * bundle therefore needs no service of its own beyond `slots`.
 */
// The host installs `window.__ModuleLoader__` before any client bundle runs;
// this is the spelling the installed third-party plugins use, so it is the one
// known to work from a profile package (a bare `_ModuleLoader__` binding is only
// provided to bundles the runtime itself wraps).
window.__ModuleLoader__.load({
  id: "deepseek-search-tools",
  factory: (require) => {
    const ReactModule = require("react");
    const React = ReactModule && ReactModule.default ? ReactModule.default : ReactModule;
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useState } = React;

    /** Must match `BRIDGE_PREFIX` in the host half. */
    const BRIDGE = "/api/deepseek-search-tools";
    const STYLE_ID = "deepseek-search-tools-style";

    const CSS = `
.ddt-root{display:flex;flex-direction:column;gap:14px;width:100%;max-width:840px;min-width:0;color:var(--dsw-alias-label-primary,#1f1f1f);font-size:13px;line-height:1.5}
.ddt-head{display:flex;flex-direction:column;gap:4px}
.ddt-title{margin:0;font-size:16px;font-weight:600}
.ddt-sub{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary,#666)}
.ddt-head-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.ddt-lang{display:flex;gap:2px;padding:2px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f2f2f2)}
.ddt-lang-btn{border:0;background:transparent;border-radius:6px;padding:3px 9px;font-size:11px;cursor:pointer;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-family:inherit}
.ddt-lang-btn[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover,#fff);color:var(--dsw-alias-label-primary,#111);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.ddt-tabs{display:flex;gap:4px;padding:4px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,#f2f2f2);width:fit-content}
.ddt-tab{border:0;background:transparent;border-radius:8px;padding:6px 14px;font-size:13px;cursor:pointer;color:var(--dsw-alias-label-secondary,#555);font-family:inherit}
.ddt-tab[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover,#fff);color:var(--dsw-alias-label-primary,#111);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.ddt-card{border:1px solid var(--dsw-alias-border-l2,#e4e4e4);border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:10px;min-width:0;overflow:hidden}
.ddt-card-title{margin:0;font-size:13px;font-weight:600}
.ddt-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.ddt-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.ddt-kv{display:grid;grid-template-columns:104px 1fr;gap:7px 12px;margin:0;font-size:12px}
.ddt-kv dt{color:var(--dsw-alias-label-tertiary,#8a8a8a);margin:0}
.ddt-kv dd{margin:0;word-break:break-all}
.ddt-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px}
.ddt-btn{border:1px solid var(--dsw-alias-border-l2,#dcdcdc);background:transparent;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;color:var(--dsw-alias-label-primary,#111);font-family:inherit}
.ddt-btn:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover,#f4f4f4)}
.ddt-btn[disabled]{opacity:.5;cursor:default}
.ddt-btn-primary{border-color:transparent;background:var(--dsw-alias-state-business-primary,#4d6bfe);color:#fff}
.ddt-btn-primary:hover:not([disabled]){filter:brightness(1.06);background:var(--dsw-alias-state-business-primary,#4d6bfe)}
.ddt-btn-danger{color:var(--dsw-alias-state-error-primary,#c33)}
.ddt-input{border:1px solid var(--dsw-alias-border-l2,#dcdcdc);background:transparent;border-radius:8px;padding:6px 10px;font-size:12px;color:inherit;min-width:240px;font-family:inherit}
.ddt-input:focus{outline:2px solid var(--dsw-focus-ring-color,#4d6bfe);outline-offset:1px}
.ddt-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:10px}
.ddt-stat{border:1px solid var(--dsw-alias-border-l2,#e4e4e4);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:3px}
.ddt-stat-label{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.ddt-stat-value{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}
.ddt-stat-hint{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.ddt-table{width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed}
.ddt-table th{text-align:left;font-weight:500;color:var(--dsw-alias-label-tertiary,#8a8a8a);padding:6px 6px;border-bottom:1px solid var(--dsw-alias-border-l2,#ececec);white-space:nowrap}
.ddt-table td{padding:6px 6px;border-bottom:1px solid var(--dsw-alias-border-l2,#f2f2f2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ddt-table tr:last-child td{border-bottom:0}
.ddt-table th:nth-child(1),.ddt-table td:nth-child(1){width:11%}
.ddt-table th:nth-child(2),.ddt-table td:nth-child(2){width:9%}
.ddt-table th:nth-child(4),.ddt-table td:nth-child(4){width:8%}
.ddt-table th:nth-child(5),.ddt-table td:nth-child(5){width:8%}
.ddt-table th:nth-child(6),.ddt-table td:nth-child(6){width:11%}
.ddt-table th:nth-child(7),.ddt-table td:nth-child(7){width:10%}
.ddt-backends th:nth-child(1),.ddt-backends td:nth-child(1){width:19%}
.ddt-backends th:nth-child(2),.ddt-backends td:nth-child(2){width:20%}
.ddt-backends th:nth-child(3),.ddt-backends td:nth-child(3){width:10%}
.ddt-backends th:nth-child(4),.ddt-backends td:nth-child(4){width:9%}
.ddt-backends th:nth-child(5),.ddt-backends td:nth-child(5){width:28%}
.ddt-backends th:nth-child(6),.ddt-backends td:nth-child(6){width:14%}
.ddt-content{display:flex;align-items:center;gap:6px;min-width:0}
.ddt-target{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ddt-num{font-variant-numeric:tabular-nums;white-space:nowrap}
.ddt-badge{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;white-space:nowrap}
.ddt-ok{background:rgba(45,170,90,.16);color:#1c7a44}
.ddt-fail{background:rgba(220,60,60,.14);color:#b52d2d}
.ddt-info{background:rgba(90,110,220,.14);color:#3d4cc0}
.ddt-notice{margin:0;font-size:12px;padding:8px 10px;border-radius:8px}
.ddt-status{display:flex;align-items:flex-start;gap:8px;padding:10px 12px;border-radius:8px;font-size:12px;line-height:1.5}
.ddt-status-dot{width:8px;height:8px;border-radius:50%;flex:none;margin-top:5px}
.ddt-status-text{flex:1;min-width:0}
.ddt-status-ok{background:rgba(45,170,90,.12);color:#1c7a44}
.ddt-status-ok .ddt-status-dot{background:#2daa5a}
.ddt-status-warn{background:rgba(214,158,38,.16);color:#7d5600}
.ddt-status-warn .ddt-status-dot{background:#d29a24}
.ddt-status-fail{background:rgba(220,60,60,.1);color:#b52d2d}
.ddt-status-fail .ddt-status-dot{background:#d93a3a}
.ddt-notice-ok{background:rgba(45,170,90,.12);color:#1c7a44}
.ddt-notice-error{background:rgba(220,60,60,.1);color:#b52d2d}
.ddt-notice-info{background:rgba(90,110,220,.1);color:#3d4cc0}
.ddt-bars{display:flex;align-items:flex-end;gap:8px;height:104px;padding-top:4px}
.ddt-bar-col{flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;min-width:0}
.ddt-bar-track{width:100%;height:78px;display:flex;align-items:flex-end}
.ddt-bar{width:100%;border-radius:4px 4px 2px 2px;background:var(--dsw-alias-state-business-primary,#4d6bfe);opacity:.85;min-height:2px}
.ddt-bar-label{font-size:10px;color:var(--dsw-alias-label-tertiary,#8a8a8a);white-space:nowrap}
.ddt-empty{padding:20px;text-align:center;font-size:12px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.ddt-legend{display:flex;gap:12px;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.ddt-swatch{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;vertical-align:middle}
/* Settings nav: the shell knows no glyph for this section and paints its gear;
   mark the cell and paint the app's search outline over that slot instead. */
button[data-ddt-nav-icon] > svg{display:none}
button[data-ddt-nav-icon]::before{content:"";display:inline-block;flex:none;width:16px;height:16px;background-color:currentColor;-webkit-mask:var(--ddt-nav-glyph) center / 16px 16px no-repeat;mask:var(--ddt-nav-glyph) center / 16px 16px no-repeat}
button[data-ddt-nav-icon]{--ddt-nav-glyph:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23000' stroke-width='1.3'%3E%3Cpath d='M6.58727 11.8586C9.55061 11.8586 11.9529 9.45637 11.9529 6.49304C11.9529 3.5297 9.55061 1.12744 6.58727 1.12744C3.62394 1.12744 1.22168 3.5297 1.22168 6.49304C1.22168 9.45637 3.62394 11.8586 6.58727 11.8586Z'/%3E%3Cpath d='M10.2991 10.3933L14.7783 14.8725'/%3E%3C/svg%3E")}
`;

    /** Mount the page stylesheet once per document. */
    function ensureStyles() {
      if (typeof document === "undefined") return;
      if (document.getElementById(STYLE_ID)) return;
      const element = document.createElement("style");
      element.id = STYLE_ID;
      element.textContent = CSS;
      document.head.appendChild(element);
    }

    const pad = (value) => String(value).padStart(2, "0");

    /** `HH:mm:ss` today, `MM-DD HH:mm:ss` otherwise. */
    function formatTime(at) {
      const date = new Date(at);
      const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
      if (date.toDateString() === new Date().toDateString()) return clock;
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock}`;
    }

    function formatMs(ms) {
      const value = Number(ms) || 0;
      return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
    }

    function formatDay(date) {
      const [, month, day] = String(date).split("-");
      return `${Number(month)}/${Number(day)}`;
    }

    /* ---------- 文本（简体中文 / English） ---------- */

    const LANG_KEY = "deepseek-search-tools:lang";

    function detectLang() {
      try {
        const saved = globalThis.localStorage && globalThis.localStorage.getItem(LANG_KEY);
        if (saved === "zh" || saved === "en") return saved;
      } catch {
        /* a locked-down storage must never break the page */
      }
      // Only the document's own lang attribute decides the default: the app is
      // Chinese-first, so an English browser UI must not flip this page behind
      // the user's back.
      const hint = String(
        (globalThis.document && globalThis.document.documentElement && globalThis.document.documentElement.lang) || "",
      ).toLowerCase();
      return hint.indexOf("en") === 0 ? "en" : "zh";
    }

    function saveLang(value) {
      try {
        if (globalThis.localStorage) globalThis.localStorage.setItem(LANG_KEY, value);
      } catch {
        /* ignore */
      }
    }

    /** The page language; the section header offers 中文 / English. */
    let LANG = detectLang();

    const STRINGS = {
      zh: {
        subtitle: "DeepSeek 搜索／抓取 API 的连接状态、呼叫明细与用量。web_search 与 web_fetch 由本插件提供。",
        "effect.ok.label": "生效中",
        "effect.ok.detail": "web_search 与 web_fetch 都由本插件提供，调用 {endpoint}。",
        "effect.nokey.label": "已接管，但没有密钥",
        "effect.nokey.detail": "找不到 {ref}，调用时会失败。在下方粘贴密钥，或到 Models 页面设置。",
        "effect.partial.label": "部分生效",
        "effect.partial.detail": "{ours} 走本插件；{other} 由「{otherId}」提供。",
        "effect.off.label": "未生效",
        "effect.off.detail": "目前搜索由「{search}」、抓取由「{fetch}」提供。若刚安装或改过设置，重新整理 Harness 让插件重新接管；或在 cordis.patch.yml 的 web 列把 searchProvider / fetchProvider 设成「{providerId}」。",
        otherProvider: "其他提供者",
        unspecified: "未指定",
        "row.none": "（未指定）",
        "source.credentials": "DSH 凭据中心",
        "source.file": "DSH 凭据文件",
        "source.env": "环境变量",
        "source.config": "插件设置",
        "source.none": "未设置",
        "source.unknown": "未知",
        "badge.set": "已设置",
        "badge.unset": "未设置",
        "api.title": "当前连接",
        "api.refresh": "重新整理",
        "api.refreshing": "重新整理中…",
        "row.provider": "提供者",
        "row.providerValue": "{id}（搜索 / 抓取）",
        "row.searchSource": "搜索来源",
        "row.fetchSource": "抓取来源",
        "row.endpoint": "API 端点",
        "row.searchPath": "搜索路径",
        "row.fetchPath": "抓取路径",
        "row.credential": "凭据来源",
        "row.key": "密钥",
        "row.timeout": "超时",
        "api.testHint": "测试会实际调用一次 /v1/tools/search（计费 1 次）。",
        "api.test": "测试连接",
        "api.testing": "测试中…",
        "api.testOk": "连接成功：{ms}，取得 {count} 条结果{sample}",
        "api.testFail": "连接失败：{message}",
        unknownError: "未知错误",
        "key.title": "API 密钥",
        "key.hint": "默认直接使用 DeepSeek Harness 自己的 API：凭据中心里的 {ref}（设置 → Models 页面写入的同一个引用）。这里留空就不会更动它。",
        "key.placeholder.set": "留空＝维持目前密钥",
        "key.placeholder.unset": "粘贴 sk-… 密钥",
        "key.save": "保存密钥",
        "key.saving": "保存中…",
        "key.clear": "清除密钥",
        "key.clearing": "清除中…",
        "key.readonly": "此部署没有可写入的凭据服务，密钥请由 Models 页面或环境变量提供。",
        "detail.title": "明细（最近 {n} 笔）",
        "filter.all": "全部",
        "filter.search": "搜索",
        "filter.fetch": "抓取",
        "filter.failed": "失败",
        "detail.empty": "还没有任何搜索或抓取记录。",
        "detail.trimmed": "只保留最近 {n} 笔记录，较早的已被汰除。",
        "th.time": "时间",
        "th.kind": "类型",
        "th.content": "内容",
        "th.requested": "要求",
        "th.got": "取得",
        "th.status": "状态",
        "th.ms": "耗时",
        "kind.search": "搜索",
        "kind.fetch": "抓取",
        "badge.test": "测试",
        ok: "成功",
        fail: "失败",
        "usage.todaySearch": "今日搜索",
        "usage.todayFetch": "今日抓取",
        "usage.todayFailed": "今日失败",
        "usage.todayResults": "今日结果数",
        "usage.successRate": "成功率",
        "usage.avg": "平均耗时",
        "usage.cumulative": "累计 {n}",
        "usage.calls": "共 {n} 次呼叫",
        "usage.avgHint": "仅计成功呼叫",
        "usage.chart": "每日呼叫次数",
        "usage.series": "搜索 + 抓取",
        "usage.none": "尚无数据。",
        "usage.barTitle": "{date}：搜索 {search}、抓取 {fetch}、失败 {failed}、结果 {results}",
        "usage.data": "数据",
        "usage.clear": "清除统计",
        "usage.clearing": "清除中…",
        "usage.file": "记录文件",
        "usage.limit": "保留上限",
        "usage.limitValue": "{n} 笔",
        "usage.totalCalls": "总呼叫",
        "usage.totalCallsValue": "{n} 次（成功 {ok}／失败 {failed}）",
        "usage.local": "统计只存在于本机，不会上传；每次呼叫的查询内容与网址都会记录在记录文件中。",
        "row.pin": "后端选择",
        "row.pinValue": "搜索：{search}　抓取：{fetch}",
        "backends.searchTitle": "搜索后端（searchBackends）",
        "backends.fetchTitle": "抓取后端（fetchBackends）",
        "backends.hint": "按优先级从小到大尝试；自动链失败会静默回退，pin 时只走指定后端并直接报错。标「内置」的是未写新配置时生成的 0.1.0 兼容链。",
        "backends.auto": "自动链",
        "backends.none": "未配置新后端，使用 0.1.0 兼容链。",
        "backends.test": "测试",
        "backends.testing": "测试中…",
        "backends.testOk": "{ms} · {count} 条",
        "backends.testFail": "失败：{message}",
        "th.backend": "后端",
        "th.type": "类型",
        "th.priority": "优先级",
        "th.enabled": "启用",
        "th.state": "状态",
        "badge.enabled": "启用",
        "badge.disabled": "停用",
        "badge.configured": "已配置",
        "badge.unconfigured": "缺密钥",
        "badge.legacy": "内置",
        "tab.api": "API 管理",
        "tab.detail": "搜索明细",
        "tab.usage": "用量汇总",
        loading: "读取中…",
        loadFailed: "无法连上插件主进程：{error}",
        noJson: "主进程没有返回 JSON",
        readFailed: "读取失败",
        actionDone: "{action}完成",
        actionFailed: "{action}失败：{message}",
        "confirm.clearKey": "清除后 Harness 就没有 DEEPSEEK_API_KEY 可用（Models 页面也依赖同一个引用）。确定清除？",
        "confirm.clearUsage": "移除全部搜索／抓取记录？此动作无法复原。",
        "lang.zh": "中文",
        "lang.en": "English",
      },
      en: {
        subtitle: "Connection state, call log and usage for the DeepSeek search/fetch API. web_search and web_fetch are served by this plugin.",
        "effect.ok.label": "In effect",
        "effect.ok.detail": "web_search and web_fetch are both served by this plugin via {endpoint}.",
        "effect.nokey.label": "In effect, but no API key",
        "effect.nokey.detail": "No {ref} was found, so calls will fail. Paste a key below, or set it on the Models page.",
        "effect.partial.label": "Partly in effect",
        "effect.partial.detail": "{ours} is served by this plugin; {other} comes from \"{otherId}\".",
        "effect.off.label": "Not in effect",
        "effect.off.detail": "Search is currently served by \"{search}\" and fetch by \"{fetch}\". If you just installed or changed something, reload the Harness so the plugin can take over; or pin searchProvider / fetchProvider to \"{providerId}\" on the web row of cordis.patch.yml.",
        otherProvider: "another provider",
        unspecified: "unspecified",
        "row.none": "(unspecified)",
        "source.credentials": "DSH credential vault",
        "source.file": "DSH credential file",
        "source.env": "environment variable",
        "source.config": "plugin config",
        "source.none": "not set",
        "source.unknown": "unknown",
        "badge.set": "Configured",
        "badge.unset": "Not set",
        "api.title": "Current connection",
        "api.refresh": "Refresh",
        "api.refreshing": "Refreshing…",
        "row.provider": "Provider",
        "row.providerValue": "{id} (search / fetch)",
        "row.searchSource": "Search source",
        "row.fetchSource": "Fetch source",
        "row.endpoint": "API endpoint",
        "row.searchPath": "Search path",
        "row.fetchPath": "Fetch path",
        "row.credential": "Credential source",
        "row.key": "API key",
        "row.timeout": "Timeout",
        "api.testHint": "The test makes one real /v1/tools/search call (billed once).",
        "api.test": "Test connection",
        "api.testing": "Testing…",
        "api.testOk": "Connected: {ms}, {count} result(s){sample}",
        "api.testFail": "Connection failed: {message}",
        unknownError: "unknown error",
        "key.title": "API key",
        "key.hint": "By default this uses the DeepSeek Harness's own API: the {ref} in the credential vault (the same reference the Models page writes). Leave it blank to keep the current value.",
        "key.placeholder.set": "Blank = keep the current key",
        "key.placeholder.unset": "Paste an sk-… key",
        "key.save": "Save key",
        "key.saving": "Saving…",
        "key.clear": "Clear key",
        "key.clearing": "Clearing…",
        "key.readonly": "This deployment has no writable credential service; provide the key on the Models page or through an environment variable.",
        "detail.title": "Activity (latest {n})",
        "filter.all": "All",
        "filter.search": "Search",
        "filter.fetch": "Fetch",
        "filter.failed": "Failed",
        "detail.empty": "No searches or fetches yet.",
        "detail.trimmed": "Only the latest {n} records are kept; older ones were dropped.",
        "th.time": "Time",
        "th.kind": "Type",
        "th.content": "Content",
        "th.requested": "Asked",
        "th.got": "Got",
        "th.status": "Status",
        "th.ms": "Took",
        "kind.search": "Search",
        "kind.fetch": "Fetch",
        "badge.test": "Test",
        ok: "OK",
        fail: "Failed",
        "usage.todaySearch": "Searches today",
        "usage.todayFetch": "Fetches today",
        "usage.todayFailed": "Failures today",
        "usage.todayResults": "Results today",
        "usage.successRate": "Success rate",
        "usage.avg": "Average latency",
        "usage.cumulative": "total {n}",
        "usage.calls": "{n} calls",
        "usage.avgHint": "successful calls only",
        "usage.chart": "Calls per day",
        "usage.series": "search + fetch",
        "usage.none": "No data yet.",
        "usage.barTitle": "{date}: search {search}, fetch {fetch}, failed {failed}, results {results}",
        "usage.data": "Data",
        "usage.clear": "Reset stats",
        "usage.clearing": "Resetting…",
        "usage.file": "Record file",
        "usage.limit": "Retention",
        "usage.limitValue": "{n} records",
        "usage.totalCalls": "Total calls",
        "usage.totalCallsValue": "{n} ({ok} ok / {failed} failed)",
        "usage.local": "Stats stay on this machine and are never uploaded; each call's query or URL is recorded in the record file.",
        "row.pin": "Backend selection",
        "row.pinValue": "search: {search}  fetch: {fetch}",
        "backends.searchTitle": "Search backends (searchBackends)",
        "backends.fetchTitle": "Fetch backends (fetchBackends)",
        "backends.hint": "Tried in ascending priority: the automatic chain falls back silently, while a pin reports the selected backend's real error. \"built-in\" marks the synthesized 0.1.0 chain used when no new keys are written.",
        "backends.auto": "automatic",
        "backends.none": "No new backends configured; the 0.1.0 chain is in use.",
        "backends.test": "Test",
        "backends.testing": "Testing…",
        "backends.testOk": "{ms} · {count} result(s)",
        "backends.testFail": "Failed: {message}",
        "th.backend": "Backend",
        "th.type": "Type",
        "th.priority": "Priority",
        "th.enabled": "Enabled",
        "th.state": "State",
        "badge.enabled": "on",
        "badge.disabled": "off",
        "badge.configured": "key set",
        "badge.unconfigured": "no key",
        "badge.legacy": "built-in",
        "tab.api": "API",
        "tab.detail": "Searches",
        "tab.usage": "Usage",
        loading: "Loading…",
        loadFailed: "Cannot reach the plugin host: {error}",
        noJson: "The host returned no JSON",
        readFailed: "read failed",
        actionDone: "{action} done",
        actionFailed: "{action} failed: {message}",
        "confirm.clearKey": "After clearing, the Harness has no DEEPSEEK_API_KEY (the Models page relies on the same reference). Clear it?",
        "confirm.clearUsage": "Remove all search/fetch records? This cannot be undone.",
        "lang.zh": "中文",
        "lang.en": "English",
      },
    };

    /** Look up a UI string; {name} placeholders are filled from vars. */
    const t = (key, vars) => {
      const table = STRINGS[LANG] || STRINGS.zh;
      const fallback = STRINGS.zh;
      let text = table[key] !== undefined ? table[key] : fallback[key] !== undefined ? fallback[key] : key;
      if (vars) {
        for (const name of Object.keys(vars)) text = text.split("{" + name + "}").join(String(vars[name]));
      }
      return text;
    };
    const SOURCE_LABELS = {
      credentials: "source.credentials",
      file: "source.file",
      env: "source.env",
      config: "source.config",
      none: "source.none",
    };

    const sourceLabel = (source) =>
      SOURCE_LABELS[source] !== undefined ? t(SOURCE_LABELS[source]) : source || t("source.unknown");

    /* ---------- small presentational pieces ---------- */

    function Notice({ notice }) {
      if (!notice) return null;
      return h("p", { className: `ddt-notice ddt-notice-${notice.tone}` }, notice.text);
    }

    function Stat({ label, value, hint }) {
      return h(
        "div",
        { className: "ddt-stat" },
        h("span", { className: "ddt-stat-label" }, label),
        h("span", { className: "ddt-stat-value" }, value),
        hint ? h("span", { className: "ddt-stat-hint" }, hint) : null,
      );
    }

    function KeyValue({ rows }) {
      return h(
        "dl",
        { className: "ddt-kv" },
        rows.map(([key, value, mono]) =>
          h(React.Fragment, { key },
            h("dt", null, key),
            h("dd", { className: mono ? "ddt-mono" : undefined }, value),
          ),
        ),
      );
    }

    /* ---------- API 管理 ---------- */

    /**
     * Whether this plugin is actually the provider the web seam resolved.
     * `ctx.web.searchProviderId` is the live answer, so comparing it with our
     * own id is the honest way to show "is it in effect".
     */
    function effectState(api) {
      const oursSearch = api.searchProvider === api.providerId;
      const oursFetch = api.fetchProvider === api.providerId;
      if (oursSearch && oursFetch) {
        return api.configured
          ? { tone: "ok", label: t("effect.ok.label"), detail: t("effect.ok.detail", { endpoint: `${api.baseUrl}${api.searchPath}` }) }
          : { tone: "warn", label: t("effect.nokey.label"), detail: t("effect.nokey.detail", { ref: api.ref }) };
      }
      if (oursSearch || oursFetch) {
        const ours = oursSearch ? "web_search" : "web_fetch";
        const other = oursSearch ? "web_fetch" : "web_search";
        const otherId = oursSearch ? api.fetchProvider : api.searchProvider;
        return { tone: "warn", label: t("effect.partial.label"), detail: t("effect.partial.detail", { ours, other, otherId: otherId || t("otherProvider") }) };
      }
      return {
        tone: "fail",
        label: t("effect.off.label"),
        detail: t("effect.off.detail", { search: api.searchProvider || t("unspecified"), fetch: api.fetchProvider || t("unspecified"), providerId: api.providerId }),
      };
    }

    function EffectStrip({ state }) {
      return h("div", { className: `ddt-status ddt-status-${state.tone}` },
        h("span", { className: "ddt-status-dot" }),
        h("span", { className: "ddt-status-text" },
          h("strong", null, state.label),
          " — ",
          state.detail));
    }

    /* ---------- 后端列表 ---------- */

    /**
     * One v0.2.0 backend table. Rows come from the bridge overview; a row's
     * test button probes that single backend (pin semantics: the real error is
     * shown, no silent fallback).
     */
    function BackendTable({ kind, backends, busy, results, onTest }) {
      const rows = Array.isArray(backends) ? backends : [];
      return h("div", { className: "ddt-card" },
        h("h3", { className: "ddt-card-title" }, t(kind === "search" ? "backends.searchTitle" : "backends.fetchTitle")),
        h("p", { className: "ddt-sub" }, t("backends.hint")),
        rows.length === 0
          ? h("div", { className: "ddt-empty" }, t("backends.none"))
          : h("table", { className: "ddt-table ddt-backends" },
              h("thead", null,
                h("tr", null,
                  h("th", null, t("th.backend")),
                  h("th", null, t("th.type")),
                  h("th", null, t("th.priority")),
                  h("th", null, t("th.enabled")),
                  h("th", null, t("th.state")),
                  h("th", null, ""),
                ),
              ),
              h("tbody", null,
                rows.map((row) => {
                  const key = `${kind}:${row.id}`;
                  const result = results[key];
                  const testing = busy === `test:${key}`;
                  const state = result === undefined
                    ? h("span", { className: `ddt-badge ${row.configured ? "ddt-ok" : "ddt-fail"}` },
                        row.configured ? t("badge.configured") : t("badge.unconfigured"))
                    : result && result.ok
                      ? h("span", { className: "ddt-badge ddt-ok" },
                          t("backends.testOk", { ms: formatMs(result.ms), count: result.results ?? 0 }))
                      : h("span", { className: "ddt-badge ddt-fail", title: result?.message || "" },
                          t("backends.testFail", { message: result?.message || t("unknownError") }));
                  return h("tr", { key },
                    h("td", null,
                      h("div", { className: "ddt-content" },
                        h("span", { className: "ddt-badge ddt-info" }, row.id),
                        row.legacy ? h("span", { className: "ddt-badge" }, t("badge.legacy")) : null)),
                    h("td", null, row.type),
                    h("td", { className: "ddt-num" }, String(row.priority)),
                    h("td", null, row.enabled ? t("badge.enabled") : t("badge.disabled")),
                    h("td", null, state),
                    h("td", null,
                      h("button", {
                        type: "button",
                        className: "ddt-btn",
                        disabled: busy !== "" || !row.enabled,
                        onClick: () => onTest(kind, row.id),
                      }, testing ? t("backends.testing") : t("backends.test"))),
                  );
                }),
              ),
            ),
      );
    }

    function ApiPanel({ api, busy, keyDraft, onKeyDraft, onTest, onSaveKey, onClearKey, onRefresh, test, backendTests, onTestBackend }) {
      const configuredBadge = h(
        "span",
        { className: `ddt-badge ${api.configured ? "ddt-ok" : "ddt-fail"}` },
            api.configured ? t("badge.set") : t("badge.unset"),
      );
      return h(React.Fragment, null,
        h(EffectStrip, { state: effectState(api) }),
        h("div", { className: "ddt-card" },
          h("div", { className: "ddt-row" },
          h("h3", { className: "ddt-card-title" }, t("api.title")),
            h("div", { className: "ddt-actions" },
              configuredBadge,
              h("button", {
                type: "button",
                className: "ddt-btn",
                disabled: busy !== "",
                onClick: onRefresh,
          }, busy === "refresh" ? t("api.refreshing") : t("api.refresh")),
            ),
          ),
          h(KeyValue, {
            rows: [
          [t("row.provider"), t("row.providerValue", { id: api.providerId })],
          [t("row.searchSource"), api.searchProvider || t("row.none")],
          [t("row.fetchSource"), api.fetchProvider || t("row.none")],
          [t("row.endpoint"), api.baseUrl, true],
          [t("row.searchPath"), api.searchPath, true],
          [t("row.fetchPath"), api.fetchPath, true],
          [t("row.credential"), `${sourceLabel(api.source)} (${api.ref})`],
          [t("row.key"), api.masked || t("badge.unset"), true],
          [t("row.timeout"), `${api.timeoutMs} ms`],
          [t("row.pin"), t("row.pinValue", { search: api.searchBackend || t("backends.auto"), fetch: api.fetchBackend || t("backends.auto") })],
            ],
          }),
          h("div", { className: "ddt-row" },
            h("span", { className: "ddt-sub" }, t("api.testHint")),
            h("button", {
              type: "button",
              className: "ddt-btn ddt-btn-primary",
              disabled: busy !== "",
              onClick: onTest,
          }, busy === "test" ? t("api.testing") : t("api.test")),
          ),
          test
            ? h("p", { className: `ddt-notice ddt-notice-${test.ok ? "ok" : "error"}` },
                test.ok
            ? t("api.testOk", { ms: formatMs(test.ms), count: test.count, sample: test.sample ? ` (${test.sample.title || test.sample.url})` : "" })
            : t("api.testFail", { message: test.message || t("unknownError") }))
            : null,
        ),
        h(BackendTable, { kind: "search", backends: api.searchBackends, busy, results: backendTests, onTest: onTestBackend }),
        h(BackendTable, { kind: "fetch", backends: api.fetchBackends, busy, results: backendTests, onTest: onTestBackend }),
        h("div", { className: "ddt-card" },
          h("h3", { className: "ddt-card-title" }, t("key.title")),
          h("p", { className: "ddt-sub" },
          t("key.hint", { ref: api.ref })),
          h("div", { className: "ddt-actions" },
            h("input", {
              className: "ddt-input",
              type: "password",
              value: keyDraft,
            placeholder: api.configured ? t("key.placeholder.set") : t("key.placeholder.unset"),
              spellCheck: false,
              autoComplete: "off",
              onChange: (event) => onKeyDraft(event.target.value),
            }),
            h("button", {
              type: "button",
              className: "ddt-btn ddt-btn-primary",
              disabled: busy !== "" || !keyDraft.trim() || !api.writable,
              onClick: onSaveKey,
          }, busy === "key-set" ? t("key.saving") : t("key.save")),
            h("button", {
              type: "button",
              className: "ddt-btn ddt-btn-danger",
              disabled: busy !== "" || !api.configured || !api.writable,
              onClick: onClearKey,
          }, busy === "key-unset" ? t("key.clearing") : t("key.clear")),
          ),
        api.writable ? null : h("p", { className: "ddt-sub" }, t("key.readonly")),
        ),
      );
    }

    /* ---------- 搜索明细 ---------- */

    const FILTERS = [
      ["all", t("filter.all")],
      ["search", t("filter.search")],
      ["fetch", t("filter.fetch")],
      ["failed", t("filter.failed")],
    ];

    function DetailPanel({ usage, filter, onFilter }) {
      const rows = useMemo(() => {
        const recent = usage.recent || [];
        if (filter === "all") return recent;
        if (filter === "failed") return recent.filter((row) => !row.ok);
        return recent.filter((row) => row.kind === filter);
      }, [usage.recent, filter]);

      return h("div", { className: "ddt-card" },
        h("div", { className: "ddt-row" },
        h("h3", { className: "ddt-card-title" }, t("detail.title", { n: rows.length })),
          h("div", { className: "ddt-tabs" },
            FILTERS.map(([value, label]) =>
              h("button", {
                key: value,
                type: "button",
                className: "ddt-tab",
                "data-active": filter === value ? "true" : "false",
                onClick: () => onFilter(value),
              }, label),
            ),
          ),
        ),
        rows.length === 0
          ? h("div", { className: "ddt-empty" }, t("detail.empty"))
          : h("table", { className: "ddt-table" },
              h("thead", null,
                h("tr", null,
          h("th", null, t("th.time")),
          h("th", null, t("th.kind")),
          h("th", null, t("th.backend")),
          h("th", null, t("th.content")),
          h("th", null, t("th.requested")),
          h("th", null, t("th.got")),
          h("th", null, t("th.status")),
          h("th", null, t("th.ms")),
                ),
              ),
              h("tbody", null,
                rows.map((row, index) =>
                  h("tr", { key: `${row.at}-${index}` },
                    h("td", { className: "ddt-num" }, formatTime(row.at)),
                    h("td", null,
                      h("span", { className: `ddt-badge ${row.kind === "fetch" ? "ddt-info" : ""}` },
                row.kind === "fetch" ? t("kind.fetch") : t("kind.search"))),
                    h("td", null, row.backend || "—"),
                    h("td", null,
                      h("div", { className: "ddt-content" },
                        h("span", { className: "ddt-target", title: row.target }, row.target),
              row.origin === "test" ? h("span", { className: "ddt-badge ddt-info" }, t("badge.test")) : null)),
                    h("td", { className: "ddt-num" }, row.requested ? String(row.requested) : "—"),
                    h("td", { className: "ddt-num" }, String(row.results ?? 0)),
                    h("td", null,
                      row.ok
              ? h("span", { className: "ddt-badge ddt-ok" }, t("ok"))
              : h("span", { className: "ddt-badge ddt-fail", title: row.error || "" }, t("fail"))),
                    h("td", { className: "ddt-num" }, formatMs(row.ms)),
                  ),
                ),
              ),
            ),
        usage.recent && usage.recent.length >= (usage.limit || 0)
          ? h("p", { className: "ddt-sub" }, t("detail.trimmed", { n: usage.limit }))
          : null,
      );
    }

    /* ---------- 用量汇总 ---------- */

    function UsagePanel({ usage, busy, onClear }) {
      const total = usage.total || { calls: 0, search: 0, fetch: 0, failed: 0, results: 0, avgMs: 0 };
      const today = usage.today || total;
      const series = usage.byDay || [];
      const peak = Math.max(1, ...series.map((day) => day.calls));
      const successRate = total.calls === 0 ? "—" : `${Math.round(((total.calls - total.failed) / total.calls) * 100)}%`;

      return h(React.Fragment, null,
        h("div", { className: "ddt-grid" },
        h(Stat, { label: t("usage.todaySearch"), value: today.search, hint: t("usage.cumulative", { n: total.search }) }),
        h(Stat, { label: t("usage.todayFetch"), value: today.fetch, hint: t("usage.cumulative", { n: total.fetch }) }),
        h(Stat, { label: t("usage.todayFailed"), value: today.failed, hint: t("usage.cumulative", { n: total.failed }) }),
        h(Stat, { label: t("usage.todayResults"), value: today.results, hint: t("usage.cumulative", { n: total.results }) }),
        h(Stat, { label: t("usage.successRate"), value: successRate, hint: t("usage.calls", { n: total.calls }) }),
        h(Stat, { label: t("usage.avg"), value: formatMs(total.avgMs), hint: t("usage.avgHint") }),
        ),
        h("div", { className: "ddt-card" },
          h("div", { className: "ddt-row" },
          h("h3", { className: "ddt-card-title" }, t("usage.chart")),
            h("div", { className: "ddt-legend" },
          h("span", null, h("span", { className: "ddt-swatch", style: { background: "var(--dsw-alias-state-business-primary,#4d6bfe)" } }), t("usage.series")),
            ),
          ),
          series.length === 0
          ? h("div", { className: "ddt-empty" }, t("usage.none"))
            : h("div", { className: "ddt-bars" },
                series.map((day) =>
          h("div", { key: day.date, className: "ddt-bar-col", title: t("usage.barTitle", { date: day.date, search: day.search, fetch: day.fetch, failed: day.failed, results: day.results }) },
                    h("div", { className: "ddt-bar-track" },
                      h("div", {
                        className: "ddt-bar",
                        style: { height: `${Math.round((day.calls / peak) * 100)}%` },
                      }),
                    ),
                    h("span", { className: "ddt-bar-label" }, formatDay(day.date)),
                  ),
                ),
              ),
        ),
        h("div", { className: "ddt-card" },
          h("div", { className: "ddt-row" },
          h("h3", { className: "ddt-card-title" }, t("usage.data")),
            h("button", {
              type: "button",
              className: "ddt-btn ddt-btn-danger",
              disabled: busy !== "" || total.calls === 0,
              onClick: onClear,
        }, busy === "usage-clear" ? t("usage.clearing") : t("usage.clear")),
          ),
          h(KeyValue, {
            rows: [
          [t("usage.file"), usage.file || "—", true],
          [t("usage.limit"), t("usage.limitValue", { n: usage.limit || 0 })],
          [t("usage.totalCalls"), t("usage.totalCallsValue", { n: total.calls, ok: total.calls - total.failed, failed: total.failed })],
            ],
          }),
        h("p", { className: "ddt-sub" }, t("usage.local")),
        ),
      );
    }

    /* ---------- root ---------- */

    const TABS = ["api", "detail", "usage"];

    function ToolsSection() {
      const [tab, setTab] = useState("api");
      const [data, setData] = useState(null);
      const [error, setError] = useState("");
      const [busy, setBusy] = useState("");
      const [notice, setNotice] = useState(null);
      const [test, setTest] = useState(null);
      const [backendTests, setBackendTests] = useState({});
      const [keyDraft, setKeyDraft] = useState("");
      const [filter, setFilter] = useState("all");
      const [lang, setLangState] = useState(LANG);
      const pickLang = (next) => {
        LANG = next;
        saveLang(next);
        setLangState(next);
      };

      const call = useCallback(async (path, body) => {
        const response = await fetch(`${BRIDGE}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body || {}),
        });
        const text = await response.text();
        let payload = null;
        try {
          payload = text ? JSON.parse(text) : null;
        } catch {
          payload = null;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}${payload && payload.message ? `：${payload.message}` : ""}`);
          if (payload === null) throw new Error(t("noJson"));
        return payload;
      }, []);

      const load = useCallback(async () => {
        try {
          const payload = await call("/overview");
            if (payload.ok === false) throw new Error(payload.message || t("readFailed"));
          setData(payload);
          setError("");
        } catch (failure) {
          setError(failure && failure.message ? failure.message : String(failure));
        }
      }, [call]);

      useEffect(() => {
        load();
      }, [load]);

      const runAction = useCallback(async (name, path, body, done) => {
        setBusy(name);
        setNotice(null);
        try {
          const payload = await call(path, body);
          if (payload.ok === false) {
            setNotice({ tone: "error", text: t("actionFailed", { action: done, message: payload.message || t("unknownError") }) });
          } else {
            setNotice({ tone: "ok", text: t("actionDone", { action: done }) });
          }
          await load();
          return payload;
        } catch (failure) {
          setNotice({ tone: "error", text: t("actionFailed", { action: done, message: failure && failure.message ? failure.message : String(failure) }) });
          return null;
        } finally {
          setBusy("");
        }
      }, [call, load]);

      const onTest = useCallback(async () => {
        setBusy("test");
        setNotice(null);
        setTest(null);
        try {
          const payload = await call("/test");
          setTest(payload);
          await load();
        } catch (failure) {
          setTest({ ok: false, message: failure && failure.message ? failure.message : String(failure) });
        } finally {
          setBusy("");
        }
      }, [call, load]);

      /**
       * Probe one backend row. Passing `backend` makes the bridge pin that
       * backend, so a failure shows its real error instead of a silent fallback.
       */
      const onTestBackend = useCallback(async (kind, id) => {
        const key = `${kind}:${id}`;
        setBusy(`test:${key}`);
        setNotice(null);
        try {
          const payload = await call("/test", {
            kind,
            backend: id,
            ...(kind === "fetch" ? { url: "https://example.com" } : { query: "DeepSeek" }),
          });
          setBackendTests((previous) => ({ ...previous, [key]: payload }));
          await load();
        } catch (failure) {
          setBackendTests((previous) => ({
            ...previous,
            [key]: { ok: false, message: failure && failure.message ? failure.message : String(failure) },
          }));
        } finally {
          setBusy("");
        }
      }, [call, load]);

      const onSaveKey = useCallback(async () => {
        const value = keyDraft.trim();
        if (!value) return;
        const payload = await runAction("key-set", "/key-set", { value }, t("key.save"));
        if (payload && payload.ok !== false) setKeyDraft("");
      }, [keyDraft, runAction]);

      const onClearKey = useCallback(async () => {
        if (typeof window !== "undefined" && typeof window.confirm === "function") {
      if (!window.confirm(t("confirm.clearKey"))) return;
        }
      await runAction("key-unset", "/key-unset", {}, t("key.clear"));
      }, [runAction]);

      const onClearUsage = useCallback(async () => {
        if (typeof window !== "undefined" && typeof window.confirm === "function") {
      if (!window.confirm(t("confirm.clearUsage"))) return;
        }
      await runAction("usage-clear", "/usage-clear", {}, t("usage.clear"));
      }, [runAction]);

      const body = () => {
      if (error) return h("div", { className: "ddt-empty" }, t("loadFailed", { error }));
      if (!data) return h("div", { className: "ddt-empty" }, t("loading"));
        if (tab === "api") {
          return h(ApiPanel, {
            api: data.api,
            busy,
            keyDraft,
            onKeyDraft: setKeyDraft,
            onTest,
            onSaveKey,
            onClearKey,
            onRefresh: load,
            test,
            backendTests,
            onTestBackend,
          });
        }
        if (tab === "detail") {
          return h(DetailPanel, { usage: data.usage, filter, onFilter: setFilter });
        }
        return h(UsagePanel, { usage: data.usage, busy, onClear: onClearUsage });
      };

      return h("div", { className: "ddt-root" },
        h("div", { className: "ddt-head" },
          h("div", { className: "ddt-head-top" },
            h("h2", { className: "ddt-title" }, NAV_LABEL),
            h("div", { className: "ddt-lang" },
              ["zh", "en"].map((value) =>
                h("button", {
                  key: value,
                  type: "button",
                  className: "ddt-lang-btn",
                  "data-active": lang === value ? "true" : "false",
                  onClick: () => pickLang(value),
                }, t("lang." + value)),
              ),
            ),
          ),
          h("p", { className: "ddt-sub" }, t("subtitle")),
        ),
        h("div", { className: "ddt-tabs" },
          TABS.map((value) =>
            h("button", {
              key: value,
              type: "button",
              className: "ddt-tab",
              "data-active": tab === value ? "true" : "false",
              onClick: () => setTab(value),
            }, t("tab." + value)),
          ),
        ),
        h(Notice, { notice }),
        body(),
      );
    }

    /* ---------- settings nav glyph ---------- */

    /** Nav label of this section; the shell renders the glyph by section id. */
    const NAV_LABEL = "Search Tools";
    /**
     * Marks this section's settings-nav cell. The stylesheet hides the shell's own
     * glyph and paints the search outline instead — CSS rather than DOM surgery, so
     * the nodes React rendered stay exactly where React put them.
     */
    const NAV_MARK = "data-ddt-nav-icon";

    /**
     * The shell maps section ids to nav glyphs through a fixed table and
     * `settings.section` has no icon option, so this section lands on the settings
     * gear. Mark its nav cell; the stylesheet supplies the search glyph.
     * @returns a disposer that stops watching for the nav cell.
     */
    function installNavGlyph() {
      const view = typeof window !== "undefined" ? window : null;
      const Observer = view && view.MutationObserver;
      if (typeof document === "undefined" || typeof Observer !== "function") return () => {};
      const mark = (button) => {
        if (!button || button.tagName !== "BUTTON" || button.hasAttribute(NAV_MARK)) return;
        const parts = Array.from(button.children);
        if (parts.length !== 2) return;
        const [icon, label] = parts;
        if (!icon || icon.tagName.toLowerCase() !== "svg") return;
        if (!label || label.tagName !== "SPAN") return;
        if ((label.textContent || "").trim() !== NAV_LABEL) return;
        button.setAttribute(NAV_MARK, "1");
      };
      const scan = (root) => {
        if (!root || typeof root.querySelectorAll !== "function") return;
        if (root.tagName === "BUTTON") mark(root);
        for (const button of root.querySelectorAll("button")) mark(button);
      };
      const observer = new Observer((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!node || node.nodeType !== 1) continue;
            if (node.parentElement) mark(node.parentElement);
            scan(node);
          }
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      scan(document);
      return () => observer.disconnect();
    }

    /* ---------- plugin ---------- */

    /** Required services (cordis fiber inject). */
    const inject = ["slots"];

    /**
     * Register the section.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      ensureStyles();
      const stopGlyph = installNavGlyph();
      if (typeof ctx.effect === "function") ctx.effect(() => stopGlyph);
      ctx.slots.inject("settings.section", () =>
        ctx.slots.register({
          name: "settings.section",
          id: "tools",
          order: 20,
          label: () => NAV_LABEL,
        }, ToolsSection),
      );
    }

    return { apply, inject };
  },
});
