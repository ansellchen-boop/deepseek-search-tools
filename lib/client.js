/**
 * deepseek-search-tools — Settings → Tools page (browser half).
 *
 * Registers one settings section named "Tools" with three tabs:
 *
 *   API 管理   the backends the plugin searches with, each row's key entry
 *              (stored in the DSH credential service, never in the config), the
 *              endpoint, and a live test.
 *   搜索明细   every web_search / web_fetch call the plugin served.
 *   用量汇总   totals, today, the trailing-day series, and a reset.
 *
 * v0.3.1: the API tab also carries a "使用说明" panel whose content comes from
 * the same structured guide (`lib/usage-guide.js`) that generates docs/USAGE*.
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
.ddt-root{--ddt-surface:#fff;--ddt-surface-alt:#f6f7f8;--ddt-border:#e2e3e5;--ddt-ok-fg:#1c7a44;--ddt-ok-bg:#e8f5ee;--ddt-fail-fg:#b52d2d;--ddt-fail-bg:#fdeaea;--ddt-info-fg:#3d4cc0;--ddt-info-bg:#eceefb;--ddt-warn-fg:#7d5600;--ddt-warn-bg:#fdf3dc;display:flex;flex-direction:column;gap:14px;width:100%;max-width:840px;min-width:0;color:var(--dsw-alias-label-primary,#1f1f1f);font-size:13px;line-height:1.5;background:var(--ddt-surface-alt);border-radius:12px;padding:14px}
body[data-ds-dark-theme] .ddt-root{--ddt-surface:#232324;--ddt-surface-alt:#2c2c2e;--ddt-border:#3a3b3d;--ddt-ok-fg:#86dcaa;--ddt-ok-bg:#1e3a2a;--ddt-fail-fg:#ffa1a1;--ddt-fail-bg:#3d2022;--ddt-info-fg:#aeb8ff;--ddt-info-bg:#232740;--ddt-warn-fg:#e7c46a;--ddt-warn-bg:#3a3320}
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
.ddt-card{background:var(--ddt-surface);border:1px solid var(--ddt-border);border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:10px;min-width:0;overflow:hidden}
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
.ddt-stat{background:var(--ddt-surface);border:1px solid var(--ddt-border);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:3px}
.ddt-stat-label{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.ddt-stat-value{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}
.ddt-stat-hint{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.ddt-table{width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed}
.ddt-table th{text-align:left;font-weight:500;color:var(--dsw-alias-label-tertiary,#8a8a8a);background:var(--ddt-surface-alt);padding:6px 6px;border-bottom:1px solid var(--ddt-border);white-space:nowrap}
.ddt-table td{padding:6px 6px;border-bottom:1px solid var(--dsw-alias-border-l2,#f2f2f2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ddt-table tr:last-child td{border-bottom:0}
.ddt-table th:nth-child(1),.ddt-table td:nth-child(1){width:11%}
.ddt-table th:nth-child(2),.ddt-table td:nth-child(2){width:9%}
.ddt-table th:nth-child(4),.ddt-table td:nth-child(4){width:8%}
.ddt-table th:nth-child(5),.ddt-table td:nth-child(5){width:8%}
.ddt-table th:nth-child(6),.ddt-table td:nth-child(6){width:11%}
.ddt-table th:nth-child(7),.ddt-table td:nth-child(7){width:10%}
.ddt-backends th:nth-child(1),.ddt-backends td:nth-child(1){width:18%}
.ddt-backends th:nth-child(2),.ddt-backends td:nth-child(2){width:16%}
.ddt-backends th:nth-child(3),.ddt-backends td:nth-child(3){width:8%}
.ddt-backends th:nth-child(4),.ddt-backends td:nth-child(4){width:9%}
.ddt-backends th:nth-child(5),.ddt-backends td:nth-child(5){width:12%}
.ddt-backends th:nth-child(6),.ddt-backends td:nth-child(6){width:19%}
.ddt-backends th:nth-child(7),.ddt-backends td:nth-child(7){width:18%}
.ddt-mini{padding:3px 8px;font-size:11px}
.ddt-cell-actions{display:flex;gap:5px;flex-wrap:wrap;align-items:center}
.ddt-switch{position:relative;width:34px;height:18px;border:0;border-radius:9px;padding:0;cursor:pointer;background:var(--dsw-alias-border-l2,#c9c9c9)}
.ddt-switch[data-on="true"]{background:var(--dsw-alias-state-business-primary,#4d6bfe)}
.ddt-switch[disabled]{opacity:.5;cursor:default}
.ddt-switch::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .15s}
.ddt-switch[data-on="true"]::after{left:18px}
.ddt-modal{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.38)}
.ddt-dialog{width:100%;max-width:520px;max-height:86vh;overflow:auto;display:flex;flex-direction:column;gap:12px;padding:16px 18px;border-radius:12px;background:var(--ddt-surface);box-shadow:0 14px 44px rgba(0,0,0,.26)}
.ddt-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.ddt-dialog-title{margin:0;font-size:14px;font-weight:600}
.ddt-dialog-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}
.ddt-field{display:flex;flex-direction:column;gap:4px}
.ddt-field-label{font-size:12px;font-weight:500}
.ddt-field-required{font-size:11px;font-weight:400;color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.ddt-field-help{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.ddt-field-error{font-size:11px;color:var(--ddt-fail-fg)}
.ddt-field-ok{font-size:11px;color:var(--ddt-ok-fg)}
.ddt-select{border:1px solid var(--dsw-alias-border-l2,#dcdcdc);background:transparent;border-radius:8px;padding:6px 10px;font-size:12px;color:inherit;font-family:inherit}
.ddt-select:focus{outline:2px solid var(--dsw-focus-ring-color,#4d6bfe);outline-offset:1px}
.ddt-key-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.ddt-dialog .ddt-input{min-width:0;width:100%}
.ddt-content{display:flex;align-items:center;gap:6px;min-width:0}
.ddt-target{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ddt-num{font-variant-numeric:tabular-nums;white-space:nowrap}
.ddt-badge{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;white-space:nowrap}
.ddt-ok{background:var(--ddt-ok-bg);color:var(--ddt-ok-fg)}
.ddt-fail{background:var(--ddt-fail-bg);color:var(--ddt-fail-fg)}
.ddt-info{background:var(--ddt-info-bg);color:var(--ddt-info-fg)}
.ddt-neutral{background:var(--ddt-surface-alt);color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.ddt-notice{margin:0;font-size:12px;padding:8px 10px;border-radius:8px}
.ddt-status{display:flex;align-items:flex-start;gap:8px;padding:10px 12px;border-radius:8px;font-size:12px;line-height:1.5}
.ddt-status-dot{width:8px;height:8px;border-radius:50%;flex:none;margin-top:5px}
.ddt-status-text{flex:1;min-width:0}
.ddt-status-ok{background:var(--ddt-ok-bg);color:var(--ddt-ok-fg)}
.ddt-status-ok .ddt-status-dot{background:#2daa5a}
.ddt-status-warn{background:var(--ddt-warn-bg);color:var(--ddt-warn-fg)}
.ddt-status-warn .ddt-status-dot{background:#d29a24}
.ddt-status-fail{background:var(--ddt-fail-bg);color:var(--ddt-fail-fg)}
.ddt-status-fail .ddt-status-dot{background:#d93a3a}
.ddt-notice-ok{background:var(--ddt-ok-bg);color:var(--ddt-ok-fg)}
.ddt-notice-error{background:var(--ddt-fail-bg);color:var(--ddt-fail-fg)}
.ddt-notice-info{background:var(--ddt-info-bg);color:var(--ddt-info-fg)}
.ddt-bars{display:flex;align-items:flex-end;gap:8px;height:104px;padding-top:4px}
.ddt-bar-col{flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;min-width:0}
.ddt-bar-track{width:100%;height:78px;display:flex;align-items:flex-end}
.ddt-bar{width:100%;border-radius:4px 4px 2px 2px;background:var(--dsw-alias-state-business-primary,#4d6bfe);opacity:.85;min-height:2px}
.ddt-bar-label{font-size:10px;color:var(--dsw-alias-label-tertiary,#8a8a8a);white-space:nowrap}
.ddt-empty{padding:20px;text-align:center;font-size:12px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.ddt-legend{display:flex;gap:12px;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}
.ddt-swatch{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;vertical-align:middle}
.ddt-key-btn{display:inline-flex;align-items:center;gap:6px;max-width:100%;border:1px dashed var(--ddt-border);background:var(--ddt-surface-alt);border-radius:6px;padding:1px 6px;font:inherit;font-size:11px;color:inherit;cursor:pointer}
.ddt-key-btn:hover:not([disabled]){border-style:solid;background:var(--ddt-surface)}
.ddt-key-btn[disabled]{opacity:.5;cursor:default}
.ddt-key-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ddt-guide-dialog{max-width:760px}
.ddt-guide-section{display:flex;flex-direction:column;gap:8px}
.ddt-guide-title{margin:6px 0 0;font-size:14px;font-weight:600}
.ddt-guide-sub{margin:4px 0 0;font-size:12.5px;font-weight:600}
.ddt-guide-p{margin:0;font-size:12px;line-height:1.65}
.ddt-guide-list{margin:0;padding-left:18px;font-size:12px;line-height:1.65}
.ddt-guide-table{table-layout:auto;font-size:12px}
.ddt-guide-table th,.ddt-guide-table td{width:auto!important;white-space:normal;word-break:break-word;vertical-align:top}
.ddt-guide-code{margin:0;padding:10px 12px;border-radius:8px;background:var(--ddt-surface-alt);border:1px solid var(--ddt-border);overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;white-space:pre-wrap}
.ddt-guide-qa{margin:0}
.ddt-guide-q{margin:0 0 2px;font-size:12px;font-weight:600}
.ddt-guide-a{margin:0;font-size:12px;line-height:1.65;color:var(--dsw-alias-label-secondary,#666)}
a.ddt-btn{display:inline-flex;align-items:center;text-decoration:none}
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
        "backends.testOk": "{ms} · {count} 条 · {backend}",
        "backends.testFail": "失败：{message}",
        "backends.add": "添加后端",
        "backends.addTitle": "添加{kind}后端",
        "backends.editTitle": "编辑后端 {id}",
        "backends.edit": "编辑",
        "backends.delete": "删除",
        "backends.save": "保存",
        "backends.saving": "保存中…",
        "backends.cancel": "取消",
        "backends.typeLabel": "后端类型",
        "backends.keyTitle": "密钥",
        "backends.keyOptional": "（可选）",
        "backends.keyHint": "密钥只会写入 DSH 凭据中心，配置文件、日志与接口响应里都不会出现明文。",
        "backends.keyHintEnv": "环境变量 {ref} 已存在：密钥输入框留空即使用环境认证。",
        "backends.keyPlaceholder": "留空＝沿用现有密钥",
        "backends.keyPlaceholderEnv": "留空＝使用环境变量 {ref}",
        "backends.keyMasked": "已设置的密钥不会回显，修改时重新输入即可。",
        "backends.required": "必填",
        "backends.requiredHint": "缺少必填项：{fields}",
        "backends.defaultRef": "留空＝{ref}",
        "backends.envPresent": "环境变量 {ref} 已存在",
        "backends.noKey": "无需密钥",
        "backends.stale": "该行已被改动，请刷新后重试",
        "backends.legacyTitle": "未写入配置，由插件按 0.1.0 规则合成",
        "backends.legacyHint": "内置行由空配置合成，不能开关；要自定义请点「添加后端」显式添加。",
        "backends.keySet": "设置密钥 · {id}",
        "backends.keyChange": "更改密钥",
        "backends.keySave": "保存",
        "backends.keyClear": "清除",
        "backends.keySaved": "密钥已保存",
        "backends.keyCleared": "密钥已清除",
        "backends.keyError": "密钥操作失败：{message}",
        "backends.keyRef": "凭据引用：{ref}",
        "th.key": "密钥",
        "th.actions": "操作",
        "kind.searchWord": "搜索",
        "kind.fetchWord": "抓取",
        "type.deepseek-official": "DeepSeek 官方 API",
        "type.zhipu-web-search": "智谱 Web Search",
        "type.openai-responses": "OpenAI Responses",
        "type.tavily": "Tavily 搜索",
        "type.tavily-extract": "Tavily 抓取",
        "type.searxng": "SearXNG",
        "type.brave": "Brave 搜索",
        "type.jina-reader": "Jina Reader",
        "type.http": "内置 HTTP 抓取",
        "field.baseUrl": "端点根地址",
        "field.path": "路径",
        "field.apiKeyEnv": "密钥引用名",
        "field.model": "模型",
        "field.engine": "搜索引擎",
        "help.baseUrl": "例如 https://api.example.com；留空使用厂商默认值。",
        "help.path": "留空使用厂商默认路径。",
        "help.pathDeepseek": "搜索用 /v1/tools/search，抓取用 /v1/tools/fetch；留空即按类型自动选择。",
        "help.apiKeyEnv": "凭据中心里的引用名（环境变量式命名），密钥值在下方单独输入，不会写进配置。",
        "help.apiKeyEnvDefault": "留空＝{default}，可从环境变量或凭据中心读取。",
        "help.apiKeyEnvOptional": "可选：留空则匿名访问。",
        "help.model": "openai-responses 使用的模型名。",
        "help.engine": "智谱搜索引警，例如 search_std、search_pro。",
        "help.type.deepseek-official": "官方 /v1/tools/search 与 /v1/tools/fetch，搜索与抓取都可用。",
        "help.type.zhipu-web-search": "智谱 web_search：query 截断 70 字符，失败时可回退。",
        "help.type.openai-responses": "POST {baseUrl}/responses，从 output 聚合 output_text 与 url_citation。",
        "help.type.tavily": "POST /search，Bearer 认证，返回 results[]。",
        "help.type.tavily-extract": "POST /extract，取 results[0].raw_content。",
        "help.type.searxng": "GET {baseUrl}/search?q=&format=json，需要可访问的 SearXNG 实例。",
        "help.type.brave": "GET /res/v1/web/search，X-Subscription-Token 认证。",
        "help.type.jina-reader": "GET {baseUrl}/{url}，免 key 可用，返回纯文本。",
        "help.type.http": "委托内核内置的匿名 HTTP 抓取提供者。",
        "confirm.removeBackend": "删除后端「{id}」？它在凭据中心里的密钥不会被一并清除。",
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
        "guide.title": "使用说明",
        "guide.open": "使用说明",
        "guide.close": "关闭",
        "guide.loading": "读取说明中…",
        "guide.failed": "无法读取使用说明：{message}",
        "guide.docs": "查看 Markdown 版",
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
        "backends.testOk": "{ms} · {count} result(s) · {backend}",
        "backends.testFail": "Failed: {message}",
        "backends.add": "Add backend",
        "backends.addTitle": "Add a {kind} backend",
        "backends.editTitle": "Edit backend {id}",
        "backends.edit": "Edit",
        "backends.delete": "Delete",
        "backends.save": "Save",
        "backends.saving": "Saving…",
        "backends.cancel": "Cancel",
        "backends.typeLabel": "Backend type",
        "backends.keyTitle": "API key",
        "backends.keyOptional": "(optional)",
        "backends.keyHint": "The key is written to the DSH credentials service only; it never appears in the config file, logs or API responses.",
        "backends.keyHintEnv": "Environment variable {ref} exists: leave the key field empty to use that credential.",
        "backends.keyPlaceholder": "Leave empty to keep the current key",
        "backends.keyPlaceholderEnv": "Leave empty to use {ref}",
        "backends.keyMasked": "A stored key is never echoed; type a new one to replace it.",
        "backends.required": "required",
        "backends.requiredHint": "Missing required field(s): {fields}",
        "backends.defaultRef": "empty = {ref}",
        "backends.envPresent": "Environment variable {ref} exists",
        "backends.noKey": "No key needed",
        "backends.stale": "That row changed; refresh and try again",
        "backends.legacyTitle": "Not stored in config; synthesized by the plugin using the 0.1.0 rules",
        "backends.legacyHint": "Built-in rows are synthesized from an empty config and cannot be toggled; click \"Add backend\" to add one explicitly and customize it.",
        "backends.keySet": "Set key · {id}",
        "backends.keyChange": "Change key",
        "backends.keySave": "Save",
        "backends.keyClear": "Clear",
        "backends.keySaved": "Key saved",
        "backends.keyCleared": "Key cleared",
        "backends.keyError": "Key operation failed: {message}",
        "backends.keyRef": "Credential reference: {ref}",
        "th.key": "Key",
        "th.actions": "Actions",
        "kind.searchWord": "search",
        "kind.fetchWord": "fetch",
        "type.deepseek-official": "DeepSeek official API",
        "type.zhipu-web-search": "Zhipu web search",
        "type.openai-responses": "OpenAI Responses",
        "type.tavily": "Tavily search",
        "type.tavily-extract": "Tavily extract",
        "type.searxng": "SearXNG",
        "type.brave": "Brave search",
        "type.jina-reader": "Jina Reader",
        "type.http": "Built-in HTTP fetch",
        "field.baseUrl": "Endpoint",
        "field.path": "Path",
        "field.apiKeyEnv": "Credential reference",
        "field.model": "Model",
        "field.engine": "Search engine",
        "help.baseUrl": "For example https://api.example.com; leave empty for the vendor default.",
        "help.path": "Leave empty for the vendor default path.",
        "help.pathDeepseek": "Search uses /v1/tools/search, fetch uses /v1/tools/fetch; empty picks per kind.",
        "help.apiKeyEnv": "A reference name (environment-variable form) in the credentials service. The key value is entered separately and never stored in the config.",
        "help.apiKeyEnvDefault": "Empty = {default}, read from the environment or the credentials service.",
        "help.apiKeyEnvOptional": "Optional: empty means anonymous access.",
        "help.model": "The model name used by openai-responses.",
        "help.engine": "Zhipu search engine, e.g. search_std or search_pro.",
        "help.type.deepseek-official": "The official /v1/tools/search and /v1/tools/fetch; serves both halves.",
        "help.type.zhipu-web-search": "Zhipu web_search: the query is truncated to 70 characters and can fall back on failure.",
        "help.type.openai-responses": "POST {baseUrl}/responses; output_text and url_citation annotations are aggregated.",
        "help.type.tavily": "POST /search with Bearer auth; returns results[].",
        "help.type.tavily-extract": "POST /extract; returns results[0].raw_content.",
        "help.type.searxng": "GET {baseUrl}/search?q=&format=json; needs a reachable SearXNG instance.",
        "help.type.brave": "GET /res/v1/web/search with X-Subscription-Token auth.",
        "help.type.jina-reader": "GET {baseUrl}/{url}; keyless, returns plain text.",
        "help.type.http": "Delegates to the kernel's built-in anonymous HTTP fetch provider.",
        "confirm.removeBackend": "Delete backend \"{id}\"? Its stored credential is not removed.",
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
        "guide.title": "Usage guide",
        "guide.open": "Usage guide",
        "guide.close": "Close",
        "guide.loading": "Loading the guide…",
        "guide.failed": "Could not load the guide: {message}",
        "guide.docs": "Markdown version",
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

    /** The usage guide's text values are `{ zh, en }`; plain strings pass through. */
    const pickText = (value) =>
      value && typeof value === "object" ? String(value[LANG] ?? value.zh ?? "") : String(value ?? "");

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
    function BackendTable({ kind, backends, busy, results, types, onTest, onAdd, onToggle, onEdit, onRemove, onKey }) {
      const rows = Array.isArray(backends) ? backends : [];
      const typeLabel = (type) => {
        const meta = types.find((entry) => entry.type === type);
        return t(meta ? meta.label : type);
      };
      return h("div", { className: "ddt-card" },
        h("div", { className: "ddt-row" },
          h("h3", { className: "ddt-card-title" }, t(kind === "search" ? "backends.searchTitle" : "backends.fetchTitle")),
          h("button", {
            type: "button",
            className: "ddt-btn ddt-btn-primary",
            disabled: busy !== "" || types.length === 0,
            onClick: () => onAdd(kind),
          }, t("backends.add"))),
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
                  h("th", null, t("th.key")),
                  h("th", null, t("th.state")),
                  h("th", null, t("th.actions")),
                ),
              ),
              h("tbody", null,
                rows.map((row) => {
                  const key = `${kind}:${row.id}`;
                  const result = results[key];
                  const testing = busy === `test:${key}`;
                  const editable = Number.isInteger(row.index);
                  const state = result === undefined
                    ? h("span", { className: `ddt-badge ${row.configured ? "ddt-ok" : "ddt-fail"}` },
                        row.configured ? t("badge.configured") : t("badge.unconfigured"))
                    : result && result.ok
                      ? h("span", { className: "ddt-badge ddt-ok" },
                          t("backends.testOk", {
                            ms: formatMs(result.ms),
                            count: result.results ?? 0,
                            backend: result.backend || row.id,
                          }))
                      : h("span", { className: "ddt-badge ddt-fail", title: result?.message || "" },
                          t("backends.testFail", { message: result?.message || t("unknownError") }));
                  return h("tr", { key },
                    h("td", null,
                      h("div", { className: "ddt-content" },
                        h("span", { className: "ddt-badge ddt-info" }, row.id))),
                    h("td", null, typeLabel(row.type)),
                    h("td", { className: "ddt-num" }, String(row.priority)),
                    h("td", null,
                      editable
                        ? h("button", {
                            type: "button",
                            className: "ddt-switch",
                            role: "switch",
                            "aria-checked": row.enabled ? "true" : "false",
                            "aria-label": t("th.enabled"),
                            "data-on": row.enabled ? "true" : "false",
                            disabled: busy !== "",
                            onClick: () => onToggle(kind, row.index, !row.enabled),
                          })
                        : h("span", { className: "ddt-badge ddt-neutral", title: t("backends.legacyTitle") }, t("badge.legacy"))),
                    h("td", null,
                      row.keyRef
                        ? h("button", {
                            type: "button",
                            className: "ddt-key-btn",
                            title: row.keyConfigured ? t("backends.keyChange") : t("backends.keySet", { id: row.id }),
                            "aria-label": row.keyConfigured ? t("backends.keyChange") : t("backends.keySet", { id: row.id }),
                            disabled: busy !== "",
                            onClick: () => onKey(kind, row),
                          },
                          h("span", { className: `ddt-badge ${row.keyConfigured ? "ddt-ok" : "ddt-fail"}` },
                            row.keyConfigured ? t("badge.set") : t("badge.unset")),
                          row.keyMasked ? h("span", { className: "ddt-sub ddt-num" }, row.keyMasked) : null)
                        : h("span", { className: "ddt-sub" }, t("backends.noKey"))),
                    h("td", null, state),
                    h("td", null,
                      h("div", { className: "ddt-cell-actions" },
                        h("button", {
                          type: "button",
                          className: "ddt-btn ddt-mini",
                          disabled: busy !== "" || !row.enabled,
                          onClick: () => onTest(kind, row.id),
                        }, testing ? t("backends.testing") : t("backends.test")),
                        editable
                          ? h("button", {
                              type: "button",
                              className: "ddt-btn ddt-mini",
                              disabled: busy !== "",
                              onClick: () => onEdit(kind, row),
                            }, t("backends.edit"))
                          : null,
                        editable
                          ? h("button", {
                              type: "button",
                              className: "ddt-btn ddt-mini ddt-btn-danger",
                              disabled: busy !== "",
                              onClick: () => onRemove(kind, row),
                            }, t("backends.delete"))
                          : null)),
                  );
                }),
              ),
            ),
        rows.some((row) => row.legacy)
          ? h("p", { className: "ddt-sub" }, t("backends.legacyHint"))
          : null,
      );
    }

    /**
     * The add/edit sheet. Type comes first; the field list below is rendered
     * from the host catalog, so a new adapter type shows up here without any
     * client change. The key box is write-only: it starts empty every time, and
     * a save posts it to `/backends/key` instead of embedding it in the row.
     */
    function BackendDialog({ dialog, types, busy, error, onClose, onSubmit }) {
      const kind = dialog.kind;
      const editing = dialog.mode === "edit";
      const options = types.filter((entry) => entry.kind === "both" || entry.kind === kind);
      const [type, setType] = useState(dialog.row?.type || (options[0] ? options[0].type : ""));
      const [values, setValues] = useState(() => {
        const source = (dialog.row && dialog.row.fields) || {};
        return {
          baseUrl: source.baseUrl || "",
          path: source.path || "",
          apiKeyEnv: source.apiKeyEnv || "",
          model: source.model || "",
          engine: source.engine || "",
        };
      });
      const [keyDraft, setKeyDraft] = useState("");
      const meta = options.find((entry) => entry.type === type);
      const fields = meta ? meta.fields : [];
      const keyField = fields.find((field) => field.key === "apiKeyEnv");
      const effectiveRef = String(values.apiKeyEnv || "").trim() || String((keyField && keyField.default) || "");
      const missing = fields
        .filter((field) => field.required && !(String(values[field.key] || "").trim() || String(field.default || "").trim()))
        .map((field) => field.key);
      const invalidRef = Boolean(String(values.apiKeyEnv || "").trim()) && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(values.apiKeyEnv || "").trim());
      const envPresent = Boolean(
        keyField && effectiveRef && (
          (dialog.row && dialog.row.envPresent && effectiveRef === dialog.row.keyRef)
          || (keyField.envPresent && effectiveRef === String(keyField.default || ""))
        ),
      );
      const canSave = Boolean(meta) && missing.length === 0 && !invalidRef && busy === "";
      const setField = (key, value) => setValues((previous) => ({ ...previous, [key]: value }));
      const submit = () => onSubmit({
        kind,
        mode: dialog.mode,
        index: dialog.row ? dialog.row.index : undefined,
        type,
        fields: values,
        keyRef: effectiveRef,
        keyValue: String(keyDraft || "").trim(),
      });
      return h("div", {
        className: "ddt-modal",
        role: "dialog",
        "aria-modal": "true",
        onClick: (event) => {
          if (event.target === event.currentTarget && busy === "") onClose();
        },
      },
        h("div", { className: "ddt-dialog" },
          h("div", { className: "ddt-dialog-head" },
            h("h3", { className: "ddt-dialog-title" },
              editing
                ? t("backends.editTitle", { id: dialog.row?.id || "" })
                : t("backends.addTitle", { kind: t(kind === "search" ? "kind.searchWord" : "kind.fetchWord") })),
            h("button", { type: "button", className: "ddt-btn ddt-mini", disabled: busy !== "", onClick: onClose }, t("backends.cancel"))),
          h("label", { className: "ddt-field" },
            h("span", { className: "ddt-field-label" }, t("backends.typeLabel")),
            h("select", {
              className: "ddt-select",
              value: type,
              disabled: editing || busy !== "",
              onChange: (event) => {
                setType(event.target.value);
                setValues({ baseUrl: "", path: "", apiKeyEnv: "", model: "", engine: "" });
              },
            },
              options.map((entry) => h("option", { key: entry.type, value: entry.type }, t(entry.label)))),
            meta ? h("span", { className: "ddt-field-help" }, t(meta.help)) : null),
          fields.map((field) => h("label", { key: field.key, className: "ddt-field" },
            h("span", { className: "ddt-field-label" },
              t(field.label),
              field.required ? h("span", { className: "ddt-field-required" }, ` · ${t("backends.required")}`) : null,
              field.key === "apiKeyEnv" && field.default
                ? h("span", { className: "ddt-field-required" }, ` · ${t("backends.defaultRef", { ref: field.default })}`)
                : null),
            h("input", {
              className: "ddt-input",
              type: "text",
              value: values[field.key] || "",
              placeholder: field.placeholder || String(field.default || ""),
              disabled: busy !== "",
              autoComplete: "off",
              spellCheck: false,
              onChange: (event) => setField(field.key, event.target.value),
            }),
            field.help ? h("span", { className: "ddt-field-help" }, t(field.help, { default: field.default || "" })) : null,
            field.key === "apiKeyEnv" && field.envPresent
              ? h("span", { className: "ddt-field-help" }, t("backends.envPresent", { ref: field.default }))
              : null,
            missing.includes(field.key)
              ? h("span", { className: "ddt-field-error" }, t("backends.requiredHint", { fields: t(field.label) }))
              : null)),
          keyField
            ? h("div", { className: "ddt-field" },
                h("span", { className: "ddt-field-label" }, t("backends.keyTitle"), " ", h("span", { className: "ddt-field-required" }, t("backends.keyOptional"))),
                h("div", { className: "ddt-key-line" },
                  h("span", { className: `ddt-badge ${dialog.row && dialog.row.keyConfigured ? "ddt-ok" : "ddt-fail"}` },
                    dialog.row && dialog.row.keyConfigured ? t("badge.set") : t("badge.unset")),
                  dialog.row && dialog.row.keyMasked ? h("span", { className: "ddt-num" }, dialog.row.keyMasked) : null,
                  h("span", null, effectiveRef || "-")),
                h("input", {
                  className: "ddt-input",
                  type: "password",
                  value: keyDraft,
                  disabled: busy !== "",
                  autoComplete: "off",
                  spellCheck: false,
                  placeholder: envPresent
                    ? t("backends.keyPlaceholderEnv", { ref: effectiveRef })
                    : t("backends.keyPlaceholder"),
                  onChange: (event) => setKeyDraft(event.target.value),
                }),
                h("span", { className: "ddt-field-help" },
                  envPresent ? t("backends.keyHintEnv", { ref: effectiveRef }) : t("backends.keyHint")),
                dialog.row && dialog.row.keyConfigured
                  ? h("span", { className: "ddt-field-help" }, t("backends.keyMasked"))
                  : null)
            : null,
          error ? h("span", { className: "ddt-field-error" }, error) : null,
          h("div", { className: "ddt-dialog-actions" },
            h("button", { type: "button", className: "ddt-btn", disabled: busy !== "", onClick: onClose }, t("backends.cancel")),
            h("button", {
              type: "button",
              className: "ddt-btn ddt-btn-primary",
              disabled: !canSave,
              onClick: submit,
            }, busy === "backend-save" ? t("backends.saving") : t("backends.save"))),
        ),
      );
    }

    /**
     * The per-row key panel. It only receives the reference and direct actions;
     * the value is write-only (the field starts empty and is cleared by the
     * caller after a successful save), and the badge comes from the refreshed
     * overview rather than from anything this panel remembers.
     */
    function KeyDialog({ row, busy, error, notice, draft, onDraft, onClose, onSave, onClear }) {
      const configured = Boolean(row && row.keyConfigured);
      return h("div", {
        className: "ddt-modal",
        role: "dialog",
        "aria-modal": "true",
        onClick: (event) => {
          if (event.target === event.currentTarget && busy === "") onClose();
        },
      },
        h("div", { className: "ddt-dialog" },
          h("div", { className: "ddt-dialog-head" },
            h("h3", { className: "ddt-dialog-title" }, t("backends.keySet", { id: row?.id || "" })),
            h("button", { type: "button", className: "ddt-btn ddt-mini", disabled: busy !== "", onClick: onClose }, t("backends.cancel"))),
          h("div", { className: "ddt-key-line" },
            h("span", { className: `ddt-badge ${configured ? "ddt-ok" : "ddt-fail"}` },
              configured ? t("badge.set") : t("badge.unset")),
            configured && row?.keyMasked ? h("span", { className: "ddt-num" }, row.keyMasked) : null,
            h("span", { className: "ddt-mono" }, t("backends.keyRef", { ref: row?.keyRef || "-" }))),
          h("input", {
            className: "ddt-input",
            type: "password",
            value: draft,
            disabled: busy !== "",
            autoComplete: "off",
            spellCheck: false,
            placeholder: row && row.envPresent
              ? t("backends.keyPlaceholderEnv", { ref: row.keyRef })
              : t("backends.keyPlaceholder"),
            onChange: (event) => onDraft(event.target.value),
          }),
          h("span", { className: "ddt-field-help" },
            row && row.envPresent ? t("backends.keyHintEnv", { ref: row.keyRef }) : t("backends.keyHint")),
          error ? h("span", { className: "ddt-field-error" }, error) : null,
          notice ? h("span", { className: "ddt-field-ok" }, notice) : null,
          h("div", { className: "ddt-dialog-actions" },
            h("button", {
              type: "button",
              className: "ddt-btn ddt-btn-danger",
              disabled: busy !== "" || !configured,
              onClick: onClear,
            }, t("backends.keyClear")),
            h("button", {
              type: "button",
              className: "ddt-btn ddt-btn-primary",
              disabled: busy !== "" || !String(draft || "").trim(),
              onClick: onSave,
            }, t("backends.keySave"))),
        ),
      );
    }

    /* ---------- 使用说明（与 docs/USAGE*.md 同一份结构化数据） ---------- */

    function GuideBlock({ block }) {
      if (!block) return null;
      if (block.type === "h3") return h("h5", { className: "ddt-guide-sub" }, pickText(block.text));
      if (block.type === "ul") {
        return h("ul", { className: "ddt-guide-list" },
          block.items.map((item, index) => h("li", { key: index }, pickText(item))));
      }
      if (block.type === "ol") {
        return h("ol", { className: "ddt-guide-list" },
          block.items.map((item, index) => h("li", { key: index }, pickText(item))));
      }
      if (block.type === "table") {
        return h("div", { className: "ddt-guide-table-wrap" },
          h("table", { className: "ddt-table ddt-guide-table" },
            h("thead", null,
              h("tr", null, block.head.map((cell, index) => h("th", { key: index }, pickText(cell))),
              ),
            ),
            h("tbody", null,
              block.rows.map((row, rowIndex) =>
                h("tr", { key: rowIndex },
                  row.map((cell, cellIndex) => h("td", { key: cellIndex }, pickText(cell))),
                ),
              ),
            ),
          ),
        );
      }
      if (block.type === "code") return h("pre", { className: "ddt-guide-code" }, h("code", null, block.text));
      if (block.type === "faq") {
        return h("div", null,
          block.items.map((item, index) =>
            h("div", { key: index, className: "ddt-guide-qa" },
              h("p", { className: "ddt-guide-q" }, pickText(item.q)),
              h("p", { className: "ddt-guide-a" }, pickText(item.a)))),
        );
      }
      return h("p", { className: "ddt-guide-p" }, pickText(block.text));
    }

    function UsageGuideDialog({ guide, loading, error, docsHref, onClose }) {
      const sections = guide && Array.isArray(guide.sections) ? guide.sections : [];
      return h("div", {
        className: "ddt-modal",
        role: "dialog",
        "aria-modal": "true",
        onClick: (event) => {
          if (event.target === event.currentTarget) onClose();
        },
      },
        h("div", { className: "ddt-dialog ddt-guide-dialog" },
          h("div", { className: "ddt-dialog-head" },
            h("h3", { className: "ddt-dialog-title" }, t("guide.title")),
            h("div", { className: "ddt-actions" },
              h("a", { className: "ddt-btn ddt-mini", href: docsHref, target: "_blank", rel: "noreferrer" }, t("guide.docs")),
              h("button", { type: "button", className: "ddt-btn ddt-mini", onClick: onClose }, t("guide.close"))),
          ),
          loading ? h("div", { className: "ddt-empty" }, t("guide.loading")) : null,
          error ? h("div", { className: "ddt-empty" }, t("guide.failed", { message: error })) : null,
          sections.map((section) =>
            h("section", { key: section.id, className: "ddt-guide-section" },
              h("h4", { className: "ddt-guide-title" }, pickText(section.title)),
              section.blocks.map((block, index) => h(GuideBlock, { key: index, block })))),
        ),
      );
    }

    function ApiPanel({ api, busy, keyDraft, onKeyDraft, onTest, onSaveKey, onClearKey, onRefresh, test, backendTests, onTestBackend, backendTypes, onAddBackend, onToggleBackend, onEditBackend, onRemoveBackend, onRowKey }) {
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
        h(BackendTable, {
          kind: "search",
          backends: api.searchBackends,
          busy,
          results: backendTests,
          types: backendTypes,
          onTest: onTestBackend,
          onAdd: onAddBackend,
          onToggle: onToggleBackend,
          onEdit: onEditBackend,
          onRemove: onRemoveBackend,
          onKey: onRowKey,
        }),
        h(BackendTable, {
          kind: "fetch",
          backends: api.fetchBackends,
          busy,
          results: backendTests,
          types: backendTypes,
          onTest: onTestBackend,
          onAdd: onAddBackend,
          onToggle: onToggleBackend,
          onEdit: onEditBackend,
          onRemove: onRemoveBackend,
          onKey: onRowKey,
        }),
        api.writable ? null : h("div", { className: "ddt-card" },
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
              disabled: busy !== "" || !keyDraft.trim(),
              onClick: onSaveKey,
          }, busy === "key-set" ? t("key.saving") : t("key.save")),
            h("button", {
              type: "button",
              className: "ddt-btn ddt-btn-danger",
              disabled: busy !== "" || !api.configured,
              onClick: onClearKey,
          }, busy === "key-unset" ? t("key.clearing") : t("key.clear")),
          ),
        h("p", { className: "ddt-sub" }, t("key.readonly")),
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
      const [backendTypes, setBackendTypes] = useState([]);
      const [dialog, setDialog] = useState(null);
      const [dialogError, setDialogError] = useState("");
      const [keyTarget, setKeyTarget] = useState(null);
      const [rowKeyDraft, setRowKeyDraft] = useState("");
      const [rowKeyBusy, setRowKeyBusy] = useState("");
      const [rowKeyError, setRowKeyError] = useState("");
      const [rowKeyNotice, setRowKeyNotice] = useState("");
      const [guideOpen, setGuideOpen] = useState(false);
      const [guide, setGuide] = useState(null);
      const [guideLoading, setGuideLoading] = useState(false);
      const [guideError, setGuideError] = useState("");
      const [lang, setLangState] = useState(LANG);
      const pickLang = (next) => {
        LANG = next;
        saveLang(next);
        setLangState(next);
      };

      const call = useCallback(async (path, body, method) => {
        const verb = method || "POST";
        const options = { method: verb };
        if (body !== undefined) {
          options.headers = { "content-type": "application/json" };
          options.body = JSON.stringify(body);
        }
        const response = await fetch(`${BRIDGE}${path}`, options);
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

      /** The add/edit form's type catalog. Static, so it is fetched once. */
      useEffect(() => {
        let cancelled = false;
        call("/backend-types", undefined, "GET")
          .then((payload) => {
            if (!cancelled && payload && Array.isArray(payload.types)) setBackendTypes(payload.types);
          })
          .catch(() => {});
        return () => {
          cancelled = true;
        };
      }, [call]);

      /** Every write route answers with the fresh overview; use it as-is. */
      const applyOverview = useCallback((payload) => {
        if (payload && payload.api) setData({ ok: true, api: payload.api, usage: payload.usage });
      }, []);

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

      /* ---- backend management ---- */

      const openBackendDialog = useCallback((kind, row) => {
        setDialogError("");
        setDialog({ kind, mode: row ? "edit" : "add", row: row || null });
      }, []);

      const closeBackendDialog = useCallback(() => {
        setDialog(null);
        setDialogError("");
      }, []);

      const onToggleBackend = useCallback(async (kind, index, enabled) => {
        if (!Number.isInteger(index)) return;
        setBusy("backend-toggle");
        setNotice(null);
        try {
          const payload = await call("/backends/toggle", { kind, index, enabled });
          if (payload && payload.ok === false) throw new Error(payload.message || t("readFailed"));
          applyOverview(payload);
          if (!payload || !payload.api) await load();
        } catch (failure) {
          setNotice({ tone: "error", text: t("actionFailed", { action: t("backends.edit"), message: failure && failure.message ? failure.message : String(failure) }) });
        } finally {
          setBusy("");
        }
      }, [call, load, applyOverview]);

      const onRemoveBackend = useCallback(async (kind, row) => {
        if (!Number.isInteger(row?.index)) return;
        if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(t("confirm.removeBackend", { id: row.id }))) return;
        setBusy("backend-remove");
        setNotice(null);
        try {
          const payload = await call("/backends/remove", { kind, index: row.index });
          if (payload && payload.ok === false) throw new Error(payload.message || t("readFailed"));
          applyOverview(payload);
          setNotice({ tone: "ok", text: t("actionDone", { action: t("backends.delete") }) });
          if (!payload || !payload.api) await load();
        } catch (failure) {
          setNotice({ tone: "error", text: t("actionFailed", { action: t("backends.delete"), message: failure && failure.message ? failure.message : String(failure) }) });
        } finally {
          setBusy("");
        }
      }, [call, load, applyOverview]);

      /**
       * Add or edit one backend, then (when the sheet carried a key) store it
       * through `/backends/key`. The key never travels as part of the config
       * write, and the input is cleared by the dialog unmounting.
       */
      const onSaveBackend = useCallback(async (request) => {
        setBusy("backend-save");
        setNotice(null);
        setDialogError("");
        try {
          const path = request.mode === "add" ? "/backends/add" : "/backends/update";
          const body = request.mode === "add"
            ? { kind: request.kind, type: request.type, fields: request.fields }
            : { kind: request.kind, index: request.index, fields: request.fields };
          const payload = await call(path, body);
          if (payload && payload.ok === false) throw new Error(payload.message || t("readFailed"));
          let latest = payload;
          if (request.keyRef && request.keyValue) {
            latest = await call("/backends/key", { ref: request.keyRef, value: request.keyValue });
            if (latest && latest.ok === false) throw new Error(latest.message || t("readFailed"));
          }
          applyOverview(latest);
          if (!latest || !latest.api) await load();
          setDialog(null);
          setDialogError("");
          setNotice({
            tone: "ok",
            text: t("actionDone", { action: request.mode === "add" ? t("backends.add") : t("backends.edit") }),
          });
        } catch (failure) {
          setDialogError(failure && failure.message ? failure.message : String(failure));
        } finally {
          setBusy("");
        }
      }, [call, load, applyOverview]);

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

      /** The row under the key panel, refreshed from the latest overview. */
      const keyRow = useMemo(() => {
        if (!keyTarget) return null;
        const api = data && data.api;
        const list = api ? (keyTarget.kind === "search" ? api.searchBackends : api.fetchBackends) : null;
        const found = Array.isArray(list)
          ? list.find((row) => row.id === keyTarget.id && row.keyRef === keyTarget.ref)
          : null;
        return found || keyTarget;
      }, [keyTarget, data]);

      const onRowKey = useCallback((kind, row) => {
        setKeyTarget({
          kind,
          id: row.id,
          ref: row.keyRef,
          keyConfigured: row.keyConfigured,
          keyMasked: row.keyMasked,
          envPresent: row.envPresent,
        });
        setRowKeyDraft("");
        setRowKeyError("");
        setRowKeyNotice("");
      }, []);

      const closeRowKey = useCallback(() => {
        setKeyTarget(null);
        setRowKeyDraft("");
        setRowKeyError("");
        setRowKeyNotice("");
      }, []);

      const onRowKeySave = useCallback(async () => {
        const value = rowKeyDraft.trim();
        if (!value || !keyTarget) return;
        setRowKeyBusy("key-save");
        setRowKeyError("");
        setRowKeyNotice("");
        try {
          const payload = await call("/backends/key", { ref: keyTarget.ref, value });
          if (payload && payload.ok === false) throw new Error(payload.message || t("readFailed"));
          applyOverview(payload);
          if (!payload || !payload.api) await load();
          setRowKeyDraft("");
          setRowKeyNotice(t("backends.keySaved"));
        } catch (failure) {
          setRowKeyError(t("backends.keyError", { message: failure && failure.message ? failure.message : String(failure) }));
        } finally {
          setRowKeyBusy("");
        }
      }, [rowKeyDraft, keyTarget, call, applyOverview, load]);

      const onRowKeyClear = useCallback(async () => {
        if (!keyTarget) return;
        setRowKeyBusy("key-clear");
        setRowKeyError("");
        setRowKeyNotice("");
        try {
          const payload = await call("/backends/key", { ref: keyTarget.ref }, "DELETE");
          if (payload && payload.ok === false) throw new Error(payload.message || t("readFailed"));
          applyOverview(payload);
          if (!payload || !payload.api) await load();
          setRowKeyNotice(t("backends.keyCleared"));
        } catch (failure) {
          setRowKeyError(t("backends.keyError", { message: failure && failure.message ? failure.message : String(failure) }));
        } finally {
          setRowKeyBusy("");
        }
      }, [keyTarget, call, applyOverview, load]);

      /** The help panel reads the same structured guide the docs are built from. */
      const openGuide = useCallback(async () => {
        setGuideOpen(true);
        setGuideError("");
        if (guide) return;
        setGuideLoading(true);
        try {
          const payload = await call("/usage-guide", undefined, "GET");
          if (payload && payload.ok === false) throw new Error(payload.message || t("readFailed"));
          setGuide(payload.guide || null);
        } catch (failure) {
          setGuideError(failure && failure.message ? failure.message : String(failure));
        } finally {
          setGuideLoading(false);
        }
      }, [call, guide]);

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
            backendTypes,
            onAddBackend: (kind) => openBackendDialog(kind, null),
            onToggleBackend,
            onEditBackend: (kind, row) => openBackendDialog(kind, row),
            onRemoveBackend,
            onRowKey,
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
            h("div", { className: "ddt-actions" },
              h("button", { type: "button", className: "ddt-btn ddt-mini", onClick: openGuide }, t("guide.open")),
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
        dialog ? h(BackendDialog, {
          dialog,
          types: backendTypes,
          busy,
          error: dialogError,
          onClose: closeBackendDialog,
          onSubmit: onSaveBackend,
        }) : null,
        keyRow ? h(KeyDialog, {
          row: keyRow,
          busy: rowKeyBusy,
          error: rowKeyError,
          notice: rowKeyNotice,
          draft: rowKeyDraft,
          onDraft: setRowKeyDraft,
          onClose: closeRowKey,
          onSave: onRowKeySave,
          onClear: onRowKeyClear,
        }) : null,
        guideOpen ? h(UsageGuideDialog, {
          guide,
          loading: guideLoading,
          error: guideError,
          docsHref: lang === "zh"
            ? "https://github.com/ansellchen-boop/deepseek-search-tools/blob/main/docs/USAGE.zh.md"
            : "https://github.com/ansellchen-boop/deepseek-search-tools/blob/main/docs/USAGE.md",
          onClose: () => setGuideOpen(false),
        }) : null,
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
