/**
 * deepseek-search-tools — DeepSeek Search / Fetch REST API as DSH web providers.
 *
 *   POST https://api.deepseek.com/v1/tools/search
 *   POST https://api.deepseek.com/v1/tools/fetch
 *
 * Registers one provider in each `ctx.web` registry under the id
 * `deepseek-tools`, so the shipped `web_search` / `web_fetch` tools serve from
 * the DeepSeek Search/Fetch API instead of the Anthropic Messages route.
 *
 * v0.2.0: the hard-wired DeepSeek backends became a configuration-driven
 * backend list. `searchBackends` / `fetchBackends` each name their own
 * vendors, and `searchBackend` / `fetchBackend` optionally pin one of them
 * (a pin failure is reported, never silently retried). With no new keys
 * written, the plugin serves the exact 0.1.0 behavior: DeepSeek for search,
 * and DeepSeek then plain HTTP for fetch.
 *
 * Reference: https://api-docs.deepseek.com/zh-cn/guides/search
 *            https://docs.bigmodel.cn/cn/guide/tools/web-search
 */
import z from "@deepseek-ai/schemastery";
import { BRIDGE_PREFIX, BridgeError, makeBridgeRoutes } from "./bridge.js";
import { BACKEND_TYPES, defaultKeyRef, findBackendType, missingRequiredFields } from "./backend-types.js";
import { createUsageStore } from "./usage.js";
import { USAGE_GUIDE } from "./usage-guide.js";

/**
 * `WebError` from `@deepseek-ai/dsh-web`, reproduced locally.
 *
 * The web seam only ever inspects `code`, and importing the runtime package
 * from a profile plugin imposes a resolution requirement that shipped plugins
 * (`dsh-free-search`) do not take on. A local class keeps the plugin loadable
 * from any layout that can resolve `@deepseek-ai/schemastery`.
 */
class WebError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "WebError";
    this.code = code;
  }
}

const PLUGIN_ID = "web-search-deepseek-tools";
const PROVIDER_ID = "deepseek-tools";

const NAME = "deepseek-tools";
const inject = ["web"];
const reusable = true;

/** Defaults, also applied by `apply` itself so a direct call (tests, or a loader
 *  that hands over the raw config) behaves exactly like a schema-validated one. */
const DEFAULTS = {
  apiKey: "",
  apiKeyEnv: "DEEPSEEK_API_KEY",
  baseUrl: "https://api.deepseek.com",
  searchPath: "/v1/tools/search",
  fetchPath: "/v1/tools/fetch",
  /** v0.2.0 backend lists. Empty means the exact 0.1.0 behavior: DeepSeek for
   *  search, and DeepSeek plus the plain-HTTP fetcher for fetch. */
  searchBackends: [],
  fetchBackends: [],
  /** Pinned backend id; "" = automatic chain with silent fallback. */
  searchBackend: "",
  fetchBackend: "",
  localization: "",
  includeContent: false,
  fetchFallback: true,
  takeOverSearch: true,
  takeOverFetch: true,
  timeoutMs: 60_000,
  maxSourceChars: 4_000,
  /** Settings → Tools page: where the call history lives, how much of it is
   *  kept, how many days the chart covers, and whether the page's loopback API
   *  is served at all. */
  usageDataDir: "",
  usageLimit: 2_000,
  usageDays: 7,
  enableSettingsPage: true,
};

/**
 * One backend entry, shared by `searchBackends` and `fetchBackends`. Which
 * fields matter depends on `type`; the adapter table in `apply` documents it.
 * `apiKey` (literal) wins over `apiKeyEnv` (credential reference), exactly like
 * the DeepSeek keys above.
 */
const BackendSchema = z.object({
  /** Unique within the list; also the name shown in logs and usage.json. */
  id: z.string(),
  /** `deepseek-official` / `zhipu-web-search` / `openai-responses` / `tavily` /
   *  `searxng` / `brave` for search, `deepseek-official` / `tavily-extract` /
   *  `jina-reader` / `http` for fetch. */
  type: z.string(),
  enabled: z.boolean().default(true),
  /** Smaller runs first in the automatic chain. */
  priority: z.number().default(100),
  apiKey: z.string().role("secret").default(""),
  apiKeyEnv: z.string().role("credential-ref").default(""),
  /** Type-specific endpoint root; empty uses the type's (or legacy) default. */
  baseUrl: z.string().default(""),
  /** Type-specific path under `baseUrl`; empty uses the type's default. */
  path: z.string().default(""),
  /** `openai-responses` only. */
  model: z.string().default(""),
  /** `zhipu-web-search` only: `search_std` / `search_pro` / ... */
  engine: z.string().default(""),
  /** Vendor-specific knobs; passed through to the adapter when it uses them. */
  extra: z.any(),
  /** Per-backend override of the global `timeoutMs`. */
  timeoutMs: z.number(),
});

/** Config for the plugin row (`web-search-deepseek-tools`). */
const Config = z.object({
  /** Literal key for throwaway testing. Leave empty in real rows: the shipped
   *  credentials service already holds `DEEPSEEK_API_KEY`. */
  apiKey: z.string().role("secret").default(DEFAULTS.apiKey),
  apiKeyEnv: z.string().role("credential-ref").default(DEFAULTS.apiKeyEnv),
  baseUrl: z.string().default(DEFAULTS.baseUrl),
  searchPath: z.string().default(DEFAULTS.searchPath),
  fetchPath: z.string().default(DEFAULTS.fetchPath),
  /** v0.2.0 search backends. An empty list serves the exact 0.1.0 behavior. */
  searchBackends: z.array(BackendSchema).default([]),
  /** v0.2.0 fetch backends. An empty list synthesizes the 0.1.0 chain. */
  fetchBackends: z.array(BackendSchema).default([]),
  /** Pin one search backend id; "" keeps the automatic chain with fallback. */
  searchBackend: z.string().default(""),
  /** Pin one fetch backend id; "" keeps the automatic chain with fallback. */
  fetchBackend: z.string().default(""),
  /** IP address hint used by DeepSeek to prefer localized results. */
  localization: z.string().default(DEFAULTS.localization),
  /** Pass `need_content: true` on search (returns page bodies: more tokens). */
  includeContent: z.boolean().default(DEFAULTS.includeContent),
  /** web_fetch: fall back to the anonymous plain-HTTP fetcher when the API
   *  cannot serve the page (403/404/timeout/no markdown). */
  fetchFallback: z.boolean().default(DEFAULTS.fetchFallback),
  /** Point `web.searchProvider` here when it is unset or still the shipped
   *  `deepseek-official`. Turn off to let another search plugin (e.g.
   *  dsh-free-search) keep serving web_search while this one stays available. */
  takeOverSearch: z.boolean().default(DEFAULTS.takeOverSearch),
  /** Same for `web.fetchProvider` (shipped default: `http`). */
  takeOverFetch: z.boolean().default(DEFAULTS.takeOverFetch),
  timeoutMs: z.number().default(DEFAULTS.timeoutMs),
  /** Per-source snippet ceiling handed to the model. */
  maxSourceChars: z.number().default(DEFAULTS.maxSourceChars),
  /** Directory holding `usage.json`. Empty keeps it under `<DSH_HOME>/plugin-data`. */
  usageDataDir: z.string().default(DEFAULTS.usageDataDir),
  /** How many individual calls the Settings page keeps on disk. */
  usageLimit: z.number().step(1).min(100).max(50_000).default(DEFAULTS.usageLimit),
  /** How many trailing days the usage chart covers. */
  usageDays: z.number().step(1).min(1).max(31).default(DEFAULTS.usageDays),
  /** Serve the Settings → Tools page's loopback API (overview/test/key/usage). */
  enableSettingsPage: z.boolean().default(DEFAULTS.enableSettingsPage),
});

export { Config, inject, NAME as name, reusable, PROVIDER_ID, PLUGIN_ID };

function normalizeBaseUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

/** OpenAI-style error body → short message. */
function apiErrorText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed);
    const message = parsed?.error?.message ?? parsed?.message;
    if (typeof message === "string" && message) return message;
  } catch {
    // not JSON
  }
  return trimmed;
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One HTTP request with the shared retry policy: retry the documented transient
 * statuses once, and expose `expected` statuses to the caller’s error handling.
 * Returns the raw text so a JSON or plain-text adapter can share it.
 * `label` names the service in error messages.
 */
async function requestText(fetchImpl, url, { method = "GET", headers = {}, body, signal, timeoutMs, expected, label } = {}) {
  const who = label || "HTTP";
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try {
      response = await fetchImpl(url, { method, headers, body, signal: combined });
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
      if (attempt === 0) {
        await sleep(600);
        continue;
      }
      throw new Error(`${who} ${url} request failed: ${error?.message ?? error}`);
    }
    const text = await response.text();
    if (response.ok) return { status: response.status, text, response };
    const detail = apiErrorText(text);
    const message = `${who} ${url} failed: HTTP ${response.status}${detail ? ` — ${detail}` : ""}`;
    if (expected?.has(response.status)) {
      const error = new Error(message);
      error.status = response.status;
      error.statusCode = response.status;
      throw error;
    }
    if (RETRYABLE_STATUS.has(response.status) && attempt === 0) {
      lastError = new Error(message);
      await sleep(800);
      continue;
    }
    throw new Error(message);
  }
  throw lastError ?? new Error(`${who} ${url} failed`);
}

/** POST a JSON body and return the parsed response. */
async function postJson(fetchImpl, url, apiKey, payload, options) {
  const { status, text } = await requestText(fetchImpl, url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
    ...options,
  });
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${options?.label || "HTTP"} returned a non-JSON body (HTTP ${status})`);
  }
}

/** GET a JSON document. */
async function getJson(fetchImpl, url, options = {}) {
  const { status, text } = await requestText(fetchImpl, url, {
    method: "GET",
    headers: { Accept: "application/json", ...(options.headers ?? {}) },
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    expected: options.expected,
    label: options.label,
  });
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${options.label || "HTTP"} returned a non-JSON body (HTTP ${status})`);
  }
}

function clampCount(value, fallback = 10) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(50, Math.max(1, Math.trunc(n)));
}

const stripNewlines = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

/** Trim to a whole-character boundary so a multi-byte snippet never ends mid-codepoint. */
const clip = (value, max) => {
  const text = stripNewlines(value);
  if (!Number.isFinite(max) || max <= 0 || text.length <= max) return text;
  return `${[...text].slice(0, Math.trunc(max)).join("").trimEnd()}…`;
};

/** First `max` whole characters of a query, for the one-line backend logs. */
const logQuery = (query, max = 60) => [...String(query ?? "")].slice(0, max).join("");

/**
 * Shared source normalizer: every search adapter maps its vendor payload onto
 * `{ url, title, snippet?, publishedAt? }` and this applies the seam shape
 * (`{ sources, truncated }` + `maxSourceChars` clipping).
 */
function normalizeSources(items, pick, count, maxSourceChars) {
  const sources = (Array.isArray(items) ? items : [])
    .map((item) => {
      const picked = pick(item) ?? {};
      const url = String(picked.url ?? "").trim();
      if (!url) return null;
      const snippet = clip(picked.snippet, maxSourceChars);
      const date = picked.publishedAt ? String(picked.publishedAt) : "";
      return {
        url,
        title: stripNewlines(picked.title) || url,
        ...(snippet ? { snippet } : {}),
        ...(date ? { publishedAt: date } : {}),
      };
    })
    .filter(Boolean)
    .slice(0, count);
  // `truncated` MUST be an explicit boolean. `WebRuntime.search` only adds the
  // key when it caps the list (`capSources` returns the provider result
  // untouched when `sources.length <= maxResults`), and `dsh-tool-web` copies
  // `value.truncated` into its presentation meta unconditionally, so a missing
  // key becomes an own `undefined` property — which is not lossless JSON:
  // tool "web_search" returned invalid output: value is not lossless JSON.
  return { sources, truncated: false };
}

/**
 * `/v1/tools/search` → seam SearchResult.
 * Results carry a query-relevant `summary` (600–800 chars, meant for a model);
 * `snippet` is the short front-end form and is only the fallback.
 */
function toSearchResult(result, count, maxSourceChars) {
  return normalizeSources(
    result?.results,
    (item) => ({ url: item?.url, title: item?.title, snippet: item?.summary || item?.snippet, publishedAt: item?.date }),
    count,
    maxSourceChars,
  );
}

/**
 * Zhipu `POST /api/paas/v4/web_search` → seam SearchResult, shaped exactly like
 * `toSearchResult` above. Zhipu answers `search_result[]` whose items carry the
 * link as `link` (some engines answer `url`) and the summary as `content`.
 * Reference: https://docs.bigmodel.cn/cn/guide/tools/web-search
 */
function toZhipuSearchResult(result, count, maxSourceChars) {
  return normalizeSources(
    result?.search_result,
    (item) => ({ url: item?.link || item?.url, title: item?.title, snippet: item?.content, publishedAt: item?.publish_date }),
    count,
    maxSourceChars,
  );
}

/**
 * OpenAI Responses payload → `{ text, citations }`.
 *
 * Text is every `output[].content[].output_text`; citations are the
 * `url_citation` annotations on those parts. When a provider returns prose
 * without annotations, the URLs found in that prose are the sources (title =
 * URL), which is the documented fallback.
 */
function collectResponsesOutput(result) {
  const texts = [];
  const citations = [];
  for (const item of Array.isArray(result?.output) ? result.output : []) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part?.type !== "output_text") continue;
      if (typeof part.text === "string" && part.text.trim()) texts.push(part.text);
      for (const annotation of Array.isArray(part.annotations) ? part.annotations : []) {
        const url = String(annotation?.url ?? "").trim();
        if (annotation?.type === "url_citation" && url) citations.push({ url, title: annotation?.title });
      }
    }
  }
  const text = texts.join("\n");
  if (citations.length === 0 && text) {
    for (const match of text.match(/https?:\/\/[^\s"'<>()\[\]，。；、]+/g) ?? []) {
      citations.push({ url: match.replace(/[.,;:!?。]+$/, ""), title: "" });
    }
  }
  return { text, citations };
}

/** Deduplicate `{ url, title }` citations, keeping the first title seen. */
function toResponsesSearchResult(result, count, maxSourceChars) {
  const { citations } = collectResponsesOutput(result);
  const seen = new Set();
  const unique = [];
  for (const citation of citations) {
    const url = String(citation.url ?? "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    unique.push({ url, title: citation.title });
  }
  return normalizeSources(unique, (item) => item, count, maxSourceChars);
}

const KEYLESS_TYPES = new Set(["jina-reader", "http"]);
const KNOWN_SEARCH_TYPES = new Set(["deepseek-official", "zhipu-web-search", "openai-responses", "tavily", "searxng", "brave"]);
const KNOWN_FETCH_TYPES = new Set(["deepseek-official", "tavily-extract", "jina-reader", "http"]);

/** Vendor defaults used when the backend row leaves `baseUrl` empty. */
const TYPE_DEFAULTS = {
  "deepseek-official": { baseUrl: DEFAULTS.baseUrl, path: DEFAULTS.searchPath },
  "zhipu-web-search": { baseUrl: "https://open.bigmodel.cn", path: "/api/paas/v4/web_search" },
  "openai-responses": { baseUrl: "", path: "/responses" },
  tavily: { baseUrl: "https://api.tavily.com", path: "/search" },
  "tavily-extract": { baseUrl: "https://api.tavily.com", path: "/extract" },
  "jina-reader": { baseUrl: "https://r.jina.ai", path: "" },
  searxng: { baseUrl: "", path: "/search" },
  brave: { baseUrl: "https://api.search.brave.com", path: "/res/v1/web/search" },
  http: { baseUrl: "", path: "" },
};

export function apply(ctx, config) {
  /**
   * The config snapshot every helper reads. `configEditor.edit` re-applies this
   * plugin with a fresh config object, but the route handlers currently running
   * belong to the previous apply — so after a write the handlers swap this
   * reference to the reloaded entry's config before building the overview they
   * return. Everything else reads it through `current()`.
   */
  let activeConfig = config;
  const current = () => {
    const base = { ...DEFAULTS, ...(activeConfig ?? {}) };
    base.baseUrl = normalizeBaseUrl(base.baseUrl);
    if (!Array.isArray(base.searchBackends)) base.searchBackends = [];
    if (!Array.isArray(base.fetchBackends)) base.fetchBackends = [];
    return base;
  };

  const logger = ctx.logger;

  // `credentials` may mount after this plugin; resolve through ctx each time.
  const getCredentials = () => (typeof ctx.get === "function" ? ctx.get("credentials") : undefined);

  /** A literal key from the row config wins over every stored reference. */
  const literalApiKey = () => String(current().apiKey ?? "").trim();

  /**
   * The credential reference one backend row means. An explicit `apiKeyEnv`
   * wins; otherwise the type's documented default (`DEEPSEEK_API_KEY` for the
   * official API, `ZHIPU_API_KEY` for Zhipu) applies, which is what lets the
   * add form leave a reference blank when an environment default exists.
   */
  const backendKeyRef = (backend) => String(backend?.apiKeyEnv ?? "").trim() || defaultKeyRef(backend?.type);

  /**
   * Resolve a key for one backend: literal `apiKey` first, then the credentials
   * service under `apiKeyEnv`, then this process's environment. Never memoized:
   * a key the user stores while a session runs takes effect on the next call.
   *
   * `credentials.resolve` is asynchronous in the shipped provider
   * (`dsh-credentials-local` returns `Promise<{value} | undefined>`), so the
   * result is awaited; a third-party provider answering synchronously is
   * covered by `Promise.resolve`.
   *
   * @returns the API key, or "" when nothing holds one yet.
   */
  const resolveBackendKey = async (backend) => {
    const literal = String(backend?.apiKey ?? "").trim();
    if (literal) return literal;
    const ref = backendKeyRef(backend);
    if (!ref) return "";
    const credentials = getCredentials();
    if (credentials) {
      try {
        const resolved = await Promise.resolve(credentials.resolve(ref));
        if (typeof resolved === "string" && resolved.trim()) return resolved.trim();
        if (resolved?.value) return String(resolved.value).trim();
      } catch {
        // fall through to the environment
      }
    }
    return String(process.env[ref] ?? "").trim();
  };

  /** The legacy DeepSeek key, resolved exactly as 0.1.0 did. */
  const resolveApiKey = () => resolveBackendKey({ apiKey: current().apiKey, apiKeyEnv: current().apiKeyEnv });

  /**
   * The seam asks SYNCHRONOUSLY whether this provider can serve, and there is
   * no asynchronous answer available to it. Following the shipped
   * `web-search-deepseek` provider, this reports whether a credential *source*
   * is reachable (a literal key, the credentials service, or the launched
   * environment) rather than whether a key is currently stored. A key that is
   * missing surfaces at call time as `WEB_PROVIDER_CREDENTIAL_MISSING`, which
   * names the exact reference the user has to fill in.
   */
  const hasCredentialSource = () => {
    if (literalApiKey()) return true;
    if (getCredentials() !== undefined) return true;
    return String(process.env[current().apiKeyEnv] ?? "").trim().length > 0;
  };

  /** Whether one backend row has a usable key source right now. */
  const backendAvailable = (backend) => {
    if (!backend) return false;
    if (String(backend.apiKey ?? "").trim()) return true;
    const ref = backendKeyRef(backend);
    if (ref && getCredentials() !== undefined) return true;
    if (ref && String(process.env[ref] ?? "").trim()) return true;
    if (KEYLESS_TYPES.has(backend.type)) return true;
    if (backend.type === "searxng") return Boolean(normalizeBaseUrl(backend.baseUrl));
    return false;
  };

  const credentialError = () =>
    new WebError(
      `DeepSeek Search/Fetch has no API key for "${current().apiKeyEnv}"; store it through the credentials service (the web Models page writes it), export it in the launching environment, or set a literal "apiKey" in the deepseek-search-tools config`,
      "WEB_PROVIDER_CREDENTIAL_MISSING",
    );

  const requireApiKey = async () => {
    const apiKey = await resolveApiKey();
    if (!apiKey) throw credentialError();
    return apiKey;
  };

  /** Naming the backend makes a multi-vendor row's failure actionable. A row
   *  synthesized for the 0.1.0 chain reports the exact 0.1.0 credential error. */
  const backendCredentialError = (backend) => {
    if (backend?.legacy) return credentialError();
    const ref = backendKeyRef(backend);
    return new WebError(
      `backend "${backend?.id}" (${backend?.type}) has no API key${ref ? ` for "${ref}"` : ""}; store it through the credentials service, export it in the launching environment, or set a literal "apiKey" on that backend row`,
      "WEB_PROVIDER_CREDENTIAL_MISSING",
    );
  };

  const requireBackendKey = async (backend) => {
    const apiKey = await resolveBackendKey(backend);
    // 0.1.0 parity: the synthesized legacy DeepSeek row must fail with the exact
    // 0.1.0 credential error, byte for byte (same text, same code).
    if (!apiKey) {
      throw backend?.legacy && backend?.type === "deepseek-official" ? credentialError() : backendCredentialError(backend);
    }
    return apiKey;
  };

  // ---- usage accounting ----------------------------------------------------

  /**
   * Every call the seam routes here is accounted for, including failures — the
   * Settings → Tools page exists to show what was searched, how many results
   * came back, and whether it worked. Each record also names the backend.
   */
  const usage = createUsageStore({
    dataDir: current().usageDataDir,
    limit: current().usageLimit,
    logger,
  });

  const errorMessage = (error) => (error instanceof Error ? error.message : String(error ?? "unknown error"));

  // ---- backend rows, legacy synthesis, chain selection ----------------------

  /** The backend rows the user wrote for one half, or []. */
  const configuredBackends = (kind) => {
    const cfg = current();
    const list = kind === "search" ? cfg.searchBackends : cfg.fetchBackends;
    return Array.isArray(list) ? list.filter((item) => item && String(item.id ?? "").trim() && String(item.type ?? "").trim()) : [];
  };

  /** 0.1.0's DeepSeek search backend, rebuilt from the legacy keys. */
  const legacyDeepseekSearchBackend = () => {
    const cfg = current();
    return {
      id: "deepseek",
      type: "deepseek-official",
      enabled: true,
      priority: 2,
      apiKey: cfg.apiKey,
      apiKeyEnv: cfg.apiKeyEnv,
      baseUrl: cfg.baseUrl,
      path: cfg.searchPath,
      model: "",
      engine: "",
      legacy: true,
    };
  };

  const legacyDeepseekFetchBackend = () => {
    const cfg = current();
    return {
      id: "deepseek",
      type: "deepseek-official",
      enabled: true,
      priority: 1,
      apiKey: cfg.apiKey,
      apiKeyEnv: cfg.apiKeyEnv,
      baseUrl: cfg.baseUrl,
      path: cfg.fetchPath,
      model: "",
      engine: "",
      legacy: true,
    };
  };

  const legacyHttpFetchBackend = () => ({
    id: "http",
    type: "http",
    enabled: true,
    priority: 2,
    apiKey: "",
    apiKeyEnv: "",
    baseUrl: "",
    path: "",
    model: "",
    engine: "",
    legacy: true,
  });

  /** The 0.1.0 search behavior: DeepSeek, always. */
  const legacySearchChain = () => [legacyDeepseekSearchBackend()];

  /** The 0.1.0 fetch chain: DeepSeek, plus the plain-HTTP fetcher when enabled. */
  const legacyFetchChain = () => {
    const cfg = current();
    const chain = [legacyDeepseekFetchBackend()];
    if (cfg.fetchFallback && hasHttpProvider()) chain.push(legacyHttpFetchBackend());
    return chain;
  };

  /** Enabled rows, smallest `priority` first (stable for equal priorities). */
  const orderBackends = (list) =>
    list
      .map((item, index) => ({ item, index }))
      .sort((a, b) => (Number(a.item.priority) || 0) - (Number(b.item.priority) || 0) || a.index - b.index)
      .map((entry) => entry.item);

  /**
   * Resolve the chain that serves one half.
   * @param kind - "search" or "fetch".
   * @param pinnedId - an explicit override (the Settings test button), else the
   *   configured pin (`searchBackend` / `fetchBackend`).
   * @returns `{ chain, pinned, legacy }`.
   */
  const buildChain = (kind, pinnedId) => {
    const cfg = current();
    const list = configuredBackends(kind);
    const pin = String(pinnedId ?? (kind === "search" ? cfg.searchBackend : cfg.fetchBackend) ?? "").trim();
    const synthesize = () => (kind === "search" ? legacySearchChain() : legacyFetchChain());
    if (pin) {
      const source = list.length > 0 ? list : synthesize();
      const found = source.find((item) => String(item.id) === pin);
      if (!found) {
        throw new WebError(
          `configured ${kind} backend "${pin}" is not defined; add it to ${kind}Backends or clear ${kind}Backend`,
          "WEB_PROVIDER_ERROR",
        );
      }
      return { chain: [found], pinned: true, legacy: !list.length };
    }
    if (list.length === 0) return { chain: synthesize(), pinned: false, legacy: true };
    return { chain: orderBackends(list.filter((item) => item.enabled !== false)), pinned: false, legacy: false };
  };

  // ---- adapters -------------------------------------------------------------

  /** Endpoint for one row: the row wins, then the type (and half) default. */
  const endpoint = (backend, kind = "search") => {
    const cfg = current();
    const defaults =
      backend.type === "deepseek-official"
        ? { baseUrl: cfg.baseUrl, path: kind === "fetch" ? cfg.fetchPath : cfg.searchPath }
        : TYPE_DEFAULTS[backend.type] ?? { baseUrl: "", path: "" };
    const base = normalizeBaseUrl(backend.baseUrl) || normalizeBaseUrl(defaults.baseUrl);
    const path = String(backend.path ?? "").trim() || defaults.path;
    return { base, path, url: `${base}${path}` };
  };

  const backendTimeout = (backend) => {
    const value = Number(backend?.timeoutMs);
    return Number.isFinite(value) && value > 0 ? value : current().timeoutMs;
  };

  /**
   * One search call on one backend, normalized. Errors bubble up so the chain
   * runner can decide between a silent fallback (auto) and a real failure (pin).
   */
  const searchWithBackend = async (backend, query, wanted, signal) => {
    const cfg = current();
    const timeoutMs = backendTimeout(backend);
    switch (backend.type) {
      case "deepseek-official": {
        const apiKey = await requireBackendKey(backend);
        const { url } = endpoint(backend, "search");
        const payload = { query, count: wanted };
        if (cfg.includeContent) payload.need_content = true;
        if (cfg.localization) payload.localization = cfg.localization;
        const result = await postJson(globalThis.fetch, url, apiKey, payload, {
          signal,
          timeoutMs,
          expected: new Set([401, 402]),
          label: "DeepSeek",
        });
        return toSearchResult(result, wanted, cfg.maxSourceChars);
      }
      case "zhipu-web-search": {
        // Every parameter comes from the backend row (apiKey/apiKeyEnv/
        // baseUrl/path/engine); the type defaults fill what the row omits.
        const apiKey = await requireBackendKey(backend);
        const { url } = endpoint(backend, "search");
        const payload = {
          // The API rejects queries longer than 70 characters.
          search_query: [...query].slice(0, 70).join(""),
          search_engine: String(backend.engine ?? "").trim() || "search_std",
          count: wanted,
          search_intent: false,
        };
        const result = await postJson(globalThis.fetch, url, apiKey, payload, { signal, timeoutMs, label: "Zhipu" });
        return toZhipuSearchResult(result, wanted, cfg.maxSourceChars);
      }
      case "openai-responses": {
        const { base, url } = endpoint(backend, "search");
        if (!base) throw new WebError(`search backend "${backend.id}" (openai-responses) requires a baseUrl`, "WEB_PROVIDER_ERROR");
        const apiKey = await requireBackendKey(backend);
        const payload = {
          model: String(backend.model ?? "").trim(),
          input: query,
          tools: [{ type: "web_search" }],
        };
        const result = await postJson(globalThis.fetch, url, apiKey, payload, { signal, timeoutMs, label: backend.id });
        const calls = result?.tool_usage?.web_search;
        logger.info(
          `[deepseek-search-tools] ${backend.id} tool_usage.web_search=${typeof calls === "number" ? calls : "n/a"}`,
        );
        return toResponsesSearchResult(result, wanted, cfg.maxSourceChars);
      }
      case "tavily": {
        const apiKey = await requireBackendKey(backend);
        const { url } = endpoint(backend, "search");
        const result = await postJson(
          globalThis.fetch,
          url,
          apiKey,
          { query, max_results: wanted, search_depth: "basic" },
          { signal, timeoutMs, label: "Tavily" },
        );
        return normalizeSources(
          result?.results,
          (item) => ({ url: item?.url, title: item?.title, snippet: item?.content }),
          wanted,
          cfg.maxSourceChars,
        );
      }
      case "searxng": {
        const { base, path } = endpoint(backend, "search");
        if (!base) throw new WebError(`search backend "${backend.id}" (searxng) requires a baseUrl`, "WEB_PROVIDER_ERROR");
        const url = `${base}${path}?q=${encodeURIComponent(query)}&format=json`;
        const result = await getJson(globalThis.fetch, url, { signal, timeoutMs, label: "SearXNG" });
        return normalizeSources(
          result?.results,
          (item) => ({ url: item?.url, title: item?.title, snippet: item?.content }),
          wanted,
          cfg.maxSourceChars,
        );
      }
      case "brave": {
        const apiKey = await requireBackendKey(backend);
        const { url } = endpoint(backend, "search");
        const target = `${url}?q=${encodeURIComponent(query)}&count=${wanted}`;
        const result = await getJson(globalThis.fetch, target, {
          signal,
          timeoutMs,
          label: "Brave",
          headers: { "X-Subscription-Token": apiKey },
        });
        return normalizeSources(
          result?.web?.results,
          (item) => ({ url: item?.url, title: item?.title, snippet: item?.description }),
          wanted,
          cfg.maxSourceChars,
        );
      }
      default:
        throw new WebError(
          `search backend "${backend.id}" has unknown type "${backend.type}"; supported: ${[...KNOWN_SEARCH_TYPES].join(", ")}`,
          "WEB_PROVIDER_ERROR",
        );
    }
  };

  /** The anonymous plain-HTTP fetcher (shipped `@deepseek-ai/dsh-web-fetch-http`). */
  const httpProvider = () => ctx.web?.fetchProviders?.get("http");
  const hasHttpProvider = () => {
    const provider = httpProvider();
    return Boolean(provider && provider !== fetchProvider);
  };

  /**
   * One fetch call on one backend, normalized to
   * `{ url, statusCode, body: { kind: "text", content }, truncated }`.
   */
  const fetchWithBackend = async (backend, url, signal) => {
    const cfg = current();
    const timeoutMs = backendTimeout(backend);
    switch (backend.type) {
      case "deepseek-official": {
        const apiKey = await requireBackendKey(backend);
        const { url: target } = endpoint(backend, "fetch");
        const page = await postJson(globalThis.fetch, target, apiKey, { url }, {
          signal,
          timeoutMs,
          expected: new Set([401, 402, 403, 404]),
          label: "DeepSeek",
        });
        const content = typeof page?.content === "string" ? page.content : "";
        const title = stripNewlines(page?.title);
        if (!content.trim()) throw new Error(`DeepSeek fetch returned no readable content for ${url}`);
        const body = title ? `${title}\n\n${content}` : content;
        return { url, statusCode: 200, body: { kind: "text", content: body }, truncated: false };
      }
      case "jina-reader": {
        const key = await resolveBackendKey(backend);
        const { base } = endpoint(backend, "fetch");
        if (!base) throw new WebError(`fetch backend "${backend.id}" (jina-reader) requires a baseUrl`, "WEB_PROVIDER_ERROR");
        const target = `${base}/${encodeURIComponent(url)}`;
        const { status, text } = await requestText(globalThis.fetch, target, {
          headers: { Accept: "text/plain", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
          signal,
          timeoutMs,
          label: "Jina Reader",
        });
        if (!text.trim()) throw new Error(`Jina Reader returned no text for ${url}`);
        return { url, statusCode: status, body: { kind: "text", content: text }, truncated: false };
      }
      case "tavily-extract": {
        const apiKey = await requireBackendKey(backend);
        const { url: target } = endpoint(backend, "fetch");
        const result = await postJson(globalThis.fetch, target, apiKey, { urls: [url] }, {
          signal,
          timeoutMs,
          label: "Tavily",
        });
        const content = String(result?.results?.[0]?.raw_content ?? "");
        if (!content.trim()) throw new Error(`Tavily extract returned no content for ${url}`);
        return { url, statusCode: 200, body: { kind: "text", content }, truncated: false };
      }
      case "http": {
        const provider = httpProvider();
        if (!provider || provider === fetchProvider) {
          throw new Error(`fetch backend "${backend.id}" needs the shipped http fetch provider, which is not registered`);
        }
        const result = await provider.fetch({ url }, signal);
        const content = result?.body?.content ?? "";
        if (!String(content).trim()) throw new Error(`http provider returned no content for ${url}`);
        return {
          url,
          statusCode: result?.statusCode ?? 200,
          body: { kind: "text", content: String(content) },
          truncated: Boolean(result?.truncated),
        };
      }
      default:
        throw new WebError(
          `fetch backend "${backend.id}" has unknown type "${backend.type}"; supported: ${[...KNOWN_FETCH_TYPES].join(", ")}`,
          "WEB_PROVIDER_ERROR",
        );
    }
  };

  // ---- chain runner ---------------------------------------------------------

  /**
   * Walk the chain. Records every attempt with its backend id. A fallback
   * happens only when the next hop has a usable credential source; aborting the
   * call never spends a second request; a pinned chain throws on the first
   * failure (the point of a pin is to surface the real error).
   * @returns `{ result, backend, failures }`.
   */
  const runChain = async ({ kind, chain, pinned, signal, origin, target, requested, targetLog, count, run }) => {
    if (!chain.length) {
      throw new WebError(`no enabled ${kind} backend is configured`, "WEB_PROVIDER_ERROR");
    }
    const failures = [];
    const stamp = (id, results, ms) => `[deepseek-search-tools] web_${kind} backend=${id} ${targetLog} results=${results} ms=${ms}`;
    const attach = (error, backend) => {
      try {
        error.failures = failures;
        if (!error.backend) error.backend = String(backend?.id ?? "");
      } catch {
        // a frozen error object can still be thrown
      }
      return error;
    };

    for (let index = 0; index < chain.length; index += 1) {
      const backend = chain[index];
      const startedAt = Date.now();
      try {
        const result = await run(backend);
        const results = count(result);
        logger.info(stamp(String(backend.id), results, Date.now() - startedAt));
        usage.record({
          kind,
          backend: String(backend.id),
          target,
          requested,
          results,
          ok: true,
          ms: Date.now() - startedAt,
          origin,
        });
        return { result, backend: String(backend.id), failures };
      } catch (error) {
        const ms = Date.now() - startedAt;
        logger.info(stamp(String(backend.id), 0, ms));
        usage.record({
          kind,
          backend: String(backend.id),
          target,
          requested,
          results: 0,
          ok: false,
          ms,
          error: errorMessage(error),
          origin,
        });
        failures.push({ backend, error });
        if (signal?.aborted || pinned) throw attach(error, backend);
        const next = chain[index + 1];
        if (!next) throw attach(error, backend);
        if (!backendAvailable(next)) throw attach(error, backend);
        logger.info(
          `[deepseek-search-tools] web_${kind} backend=${backend.id}-fallback-${next.id} reason=${errorMessage(error)}`,
        );
      }
    }
    throw attach(failures.length > 0 ? failures[failures.length - 1].error : new Error(`${kind} failed`), failures[failures.length - 1]?.backend);
  };

  /** One search, accounted for, with the chain's fallback semantics. */
  const runSearchInternal = async (rawQuery, { count: wanted, signal, origin = "tool", backend } = {}) => {
    const query = String(rawQuery ?? "").trim();
    if (!query) return { result: { sources: [], truncated: false }, backend: null, failures: [] };
    const wantedCount = clampCount(wanted, 10);
    const { chain, pinned } = buildChain("search", backend);
    return runChain({
      kind: "search",
      chain,
      pinned,
      signal,
      origin,
      target: query,
      requested: wantedCount,
      targetLog: `query="${logQuery(query)}"`,
      count: (result) => result.sources.length,
      run: (item) => searchWithBackend(item, query, wantedCount, signal),
    });
  };

  const runSearch = async (query, options) => (await runSearchInternal(query, options)).result;

  /** One fetch, accounted for, preserving 0.1.0's 404/fallback error shapes. */
  const runFetchInternal = async (rawUrl, { signal, origin = "tool", backend } = {}) => {
    const url = String(rawUrl ?? "").trim();
    if (!url) throw new WebError("web_fetch requires a URL", "WEB_PROVIDER_ERROR");
    const { chain, pinned, legacy } = buildChain("fetch", backend);
    try {
      return await runChain({
        kind: "fetch",
        chain,
        pinned,
        signal,
        origin,
        target: url,
        requested: undefined,
        targetLog: `url=${url}`,
        count: () => 1,
        run: (item) => fetchWithBackend(item, url, signal),
      });
    } catch (error) {
      // 0.1.0 reported the DeepSeek failure when its http fallback also failed,
      // and wrapped a lone 404 in a readable message. Keep both shapes.
      const failures = Array.isArray(error?.failures) ? error.failures : [];
      let chosen = error;
      if (legacy && failures.length > 1) chosen = failures[0].error ?? error;
      if (failures.length === 1) {
        const status = chosen?.status ?? chosen?.statusCode;
        if (status === 404) {
          const wrapped = new Error(`DeepSeek could not extract readable content from ${url}`);
          wrapped.statusCode = 404;
          chosen = wrapped;
        }
      }
      throw chosen;
    }
  };

  const runFetch = async (url, options) => (await runFetchInternal(url, options)).result;

  // ---- the two seam providers ----------------------------------------------

  const searchProvider = {
    id: PROVIDER_ID,
    // Synchronous by contract (WebRuntime calls it while selecting a
    // provider), so — like the shipped `web-search-deepseek` — it reports
    // whether a credential SOURCE is reachable, not whether a key is stored.
    // A missing key surfaces at call time as WEB_PROVIDER_CREDENTIAL_MISSING.
    available: () => {
      const list = configuredBackends("search");
      if (list.length === 0) return hasCredentialSource();
      return list.some((item) => item.enabled !== false && backendAvailable(item));
    },
    search: (searchRequest, signal) => runSearch(searchRequest?.query, { count: searchRequest?.maxResults, signal }),
  };

  const fetchProvider = {
    id: PROVIDER_ID,
    available: () => {
      const list = configuredBackends("fetch");
      if (list.length === 0) return hasCredentialSource();
      return list.some((item) => item.enabled !== false && backendAvailable(item));
    },
    fetch: (fetchRequest, signal) => runFetch(fetchRequest?.url, { signal }),
  };

  ctx.web.registerSearchProvider(searchProvider);
  ctx.web.registerFetchProvider(fetchProvider);

  /**
   * Provider ids this apply-able plugin claimed, so it can hand them back when
   * the switch is turned off. Kept on the web service itself (not module state)
   * so the memory survives a re-apply, a reload, and even a duplicated module
   * instance.
   */
  const CLAIMS = Symbol.for("dsh.web.deepseek-tools.claims");
  const claims = (ctx.web[CLAIMS] ??= new Map());

  /**
   * Point `web.<kind>Provider` at this plugin unless the user pinned something
   * that actually works. `supersedable` lists third-party providers that only
   * ever claim the field because nothing better was registered
   * (`dsh-free-search` claims `web-search-free`/`fs-quality-fetch` when the
   * field still holds the shipped default).
   *
   * A pin is also taken over when it is DEAD — no provider is registered under
   * that id, or the one registered reports `available() === false`. That is not
   * a user choice, it is a broken seam: the config outlives the plugin, so a
   * `- id: web  config: searchProvider: <uninstalled-or-disabled>` row leaves
   * every web call failing with `configured web provider "<id>" is not
   * registered`, including the fallback that used to work.
   *
   * The assignment is undone on dispose, for the same reason: a plain field
   * write outlives the plugin.
   */
  const applyTakeover = (kind, provider, wanted, shipped, supersedable = []) => {
    const key = `${kind}ProviderId`; // web.searchProviderId
    const option = `${kind}Provider`; // web.searchProvider (the cordis config key)
    const claimKey = `claimed${kind[0].toUpperCase()}${kind.slice(1)}ProviderId`;
    const configured = ctx.web[key];
    const alreadyMine = claims.get(claimKey) === provider.id;
    const deadPin = (id) => {
      const store = kind === "search" ? ctx.web.searchProviders : ctx.web.fetchProviders;
      const owner = store?.get?.(id);
      if (owner === undefined) return "not registered";
      try {
        if (owner.available() === false) return "registered but unavailable";
      } catch {
        return "its available() threw";
      }
      return undefined;
    };

    if (wanted) {
      if (configured === provider.id) {
        claims.set(claimKey, provider.id);
        return;
      }
      const broken = configured && !supersedable.includes(configured) && configured !== shipped ? deadPin(configured) : undefined;
      if (!configured || configured === shipped || supersedable.includes(configured) || broken) {
        const previous = configured;
        ctx.web[key] = provider.id;
        claims.set(claimKey, provider.id);
        if (typeof ctx.effect === "function") {
          ctx.effect(() => () => {
            if (ctx.web[key] === provider.id) ctx.web[key] = previous;
          });
        }
        logger.info(
          !configured
            ? `${PLUGIN_ID}: web.${key} was unset, taking over as "${provider.id}"`
            : broken
              ? `${PLUGIN_ID}: web.${key} is "${configured}" (${broken}), taking over as "${provider.id}" — that pin was breaking every ${kind} call`
              : `${PLUGIN_ID}: taking over web.${key} from "${configured}" as "${provider.id}"`,
        );
        return;
      }
      logger.warn(
        `${PLUGIN_ID}: web.${key} is "${configured}", not "${provider.id}", so ${kind} stays with "${configured}".\n` +
          `${PLUGIN_ID}: to serve ${kind} with the DeepSeek tools API:\n- id: web\n  config:\n    ${option}: ${provider.id}`,
      );
      return;
    }

    // Wanted off, but this plugin is what put the id there: give the default back.
    if (alreadyMine && configured === provider.id) {
      ctx.web[key] = shipped;
      claims.delete(claimKey);
      logger.info(`${PLUGIN_ID}: released web.${key} back to "${shipped}"`);
    } else if (configured === provider.id) {
      logger.warn(
        `${PLUGIN_ID}: takeOver${kind[0].toUpperCase()}${kind.slice(1)} is off but web.${key} still points here via the profile patch.`,
      );
    }
  };

  applyTakeover("search", searchProvider, current().takeOverSearch, "deepseek-official", ["web-search-free"]);
  applyTakeover("fetch", fetchProvider, current().takeOverFetch, "http", ["fs-quality-fetch"]);

  // ---- Settings → Tools page (host half) -----------------------------------

  /** Never hand the key back to the browser: show a recognisable prefix only. */
  const maskKey = (value) => {
    const text = String(value ?? "");
    if (text.length <= 8) return "••••••";
    return `${text.slice(0, 5)}…${text.slice(-4)}`;
  };

  /**
   * Where one credential reference stands right now, masked only — the display
   * half of the resolution chain `resolveBackendKey` runs.
   * @param ref - the credential reference name.
   * @param literal - a literal key from the row config, or "".
   * @returns `{ configured, masked, source }` for the Settings page.
   */
  const describeCredential = async (ref, literal) => {
    const credentials = getCredentials();
    let source = "none";
    let masked = null;
    let configured = false;
    if (literal) {
      source = "config";
      configured = true;
      masked = maskKey(literal);
    } else if (credentials) {
      try {
        const resolved = await Promise.resolve(credentials.resolve(ref));
        const value = typeof resolved === "string" ? resolved : resolved?.value;
        if (value) {
          configured = true;
          masked = maskKey(value);
          source = (typeof resolved === "object" && resolved?.source) || "credentials";
        }
      } catch (error) {
        logger.debug(`${PLUGIN_ID}: credentials.resolve("${ref}") failed (${errorMessage(error)})`);
      }
    }
    if (!configured) {
      const ambient = String(process.env[ref] ?? "").trim();
      if (ambient) {
        configured = true;
        masked = maskKey(ambient);
        source = "env";
      }
    }
    return { configured, masked, source };
  };

  /**
   * Presence-only credential state for one reference. `credentials.describe`
   * answers `{ configured, source, writable }` and never a value, which is what
   * the backend table may display; a value the user stored is masked with a
   * fixed placeholder instead of echoing a key fragment.
   */
  const describeReference = async (ref) => {
    if (!ref) return { configured: false, source: "none", writable: false };
    const credentials = getCredentials();
    if (credentials && typeof credentials.describe === "function") {
      try {
        const info = await Promise.resolve(credentials.describe(ref));
        if (info?.configured) {
          return { configured: true, source: String(info.source ?? "credentials"), writable: Boolean(info.writable) };
        }
      } catch (error) {
        logger.debug(`${PLUGIN_ID}: credentials.describe("${ref}") failed (${errorMessage(error)})`);
      }
    }
    if (String(process.env[ref] ?? "").trim()) return { configured: true, source: "env", writable: false };
    return { configured: false, source: "none", writable: false };
  };

  /**
   * One backend row for the Settings page. No key value crosses this boundary:
   * `keyConfigured` is presence, `keyMasked` is a fixed placeholder, and the
   * non-secret config keys are copied so the edit form can prefill them.
   * `index` is the row's position in the *stored* array (the write routes'
   * address); synthesized 0.1.0 rows carry no index and are not editable.
   */
  const describeBackendRow = async (backend, index) => {
    const literal = String(backend.apiKey ?? "").trim();
    const ref = backendKeyRef(backend);
    const info = literal ? { configured: true, source: "literal", writable: false } : await describeReference(ref);
    const keyless = KEYLESS_TYPES.has(backend.type) || (backend.type === "searxng" && backendAvailable(backend));
    const row = {
      id: String(backend.id),
      type: String(backend.type),
      enabled: backend.enabled !== false,
      priority: Number.isFinite(Number(backend.priority)) ? Number(backend.priority) : 100,
      configured: info.configured || keyless,
      keySource: literal ? "literal" : ref ? info.source : "none",
      legacy: Boolean(backend.legacy),
      /** The reference this row stores its key under (the type default when blank). */
      keyRef: ref,
      keyConfigured: info.configured,
      keyMasked: info.configured ? "••••••" : null,
      keyWritable: info.writable,
      /** True when that reference also exists in the launched environment. */
      envPresent: Boolean(ref && String(process.env[ref] ?? "").trim()),
      /** Non-secret stored values, for the edit form's initial state. */
      fields: {
        baseUrl: String(backend.baseUrl ?? ""),
        path: String(backend.path ?? ""),
        apiKeyEnv: String(backend.apiKeyEnv ?? ""),
        model: String(backend.model ?? ""),
        engine: String(backend.engine ?? ""),
      },
    };
    if (Number.isInteger(index)) row.index = index;
    return row;
  };

  /** Rows for one half; an empty list shows the synthesized 0.1.0 chain. */
  const describeBackends = async (kind) => {
    const cfg = current();
    const list = kind === "search" ? cfg.searchBackends : cfg.fetchBackends;
    const pairs = (Array.isArray(list) ? list : [])
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item && String(item.id ?? "").trim() && String(item.type ?? "").trim());
    if (pairs.length === 0) {
      const legacy = kind === "search" ? legacySearchChain() : legacyFetchChain();
      return Promise.all(legacy.map((backend) => describeBackendRow(backend)));
    }
    pairs.sort(
      (a, b) => (Number(a.item.priority) || 0) - (Number(b.item.priority) || 0) || a.index - b.index,
    );
    return Promise.all(pairs.map(({ item, index }) => describeBackendRow(item, index)));
  };

  /**
   * Where the key comes from right now, without revealing it. The default is
   * the key the Harness itself stores (`DEEPSEEK_API_KEY` in the credentials
   * service, the same reference the Models page writes), so "use the Harness's
   * own API" needs no configuration here at all.
   */
  const describeApi = async () => {
    const cfg = current();
    const ref = cfg.apiKeyEnv;
    const literal = literalApiKey();
    const credentials = getCredentials();
    let source = "none";
    let masked = null;
    let configured = false;
    let stored = false;
    if (literal) {
      source = "config";
      configured = true;
      masked = maskKey(literal);
    } else if (credentials) {
      try {
        const resolved = await Promise.resolve(credentials.resolve(ref));
        const value = typeof resolved === "string" ? resolved : resolved?.value;
        if (value) {
          configured = true;
          stored = true;
          masked = maskKey(value);
          source = (typeof resolved === "object" && resolved?.source) || "credentials";
        }
      } catch (error) {
        logger.debug(`${PLUGIN_ID}: credentials.resolve("${ref}") failed (${errorMessage(error)})`);
      }
    }
    if (!configured) {
      const ambient = String(process.env[ref] ?? "").trim();
      if (ambient) {
        configured = true;
        masked = maskKey(ambient);
        source = "env";
      }
    }
    return {
      ref,
      configured,
      masked,
      source,
      stored,
      literal: Boolean(literal),
      writable: typeof credentials?.set === "function",
      baseUrl: cfg.baseUrl,
      searchPath: cfg.searchPath,
      fetchPath: cfg.fetchPath,
      timeoutMs: cfg.timeoutMs,
      providerId: PROVIDER_ID,
      pluginId: PLUGIN_ID,
      searchProvider: ctx.web?.searchProviderId ?? null,
      fetchProvider: ctx.web?.fetchProviderId ?? null,
      usageDataDir: usage.dataDir,
      /** v0.2.0: which backend serves each half ("" = automatic chain). */
      searchBackend: String(cfg.searchBackend ?? "").trim(),
      fetchBackend: String(cfg.fetchBackend ?? "").trim(),
      /** v0.2.0 backend tables; an empty list is the synthesized 0.1.0 chain. */
      searchBackends: await describeBackends("search"),
      fetchBackends: await describeBackends("fetch"),
    };
  };

  // ---- backend management (v0.3.0) -----------------------------------------

  /** Exact copy the ticket requires when no config editor is loaded. */
  const CONFIG_EDITOR_MISSING = "DSH 未加载配置编辑器，请手动编辑 cordis.patch.yml";

  const backendListKey = (kind) => (kind === "search" ? "searchBackends" : "fetchBackends");

  const requireBackendKind = (kind) => {
    const value = String(kind ?? "").trim();
    if (value !== "search" && value !== "fetch") throw new BridgeError(400, `unknown backend kind: "${value}"`);
    return value;
  };

  const configEditor = () => (typeof ctx.get === "function" ? ctx.get("configEditor") : undefined);

  /** The loader entry this plugin owns, as `configEditor.edit` expects it. */
  const findConfigEntry = () => {
    const editor = configEditor();
    if (!editor || typeof editor.entries !== "function") return undefined;
    const entries = [...(editor.entries() ?? [])];
    return entries.find((entry) => entry?.options?.id === PLUGIN_ID) ?? entries.find((entry) => String(entry?.id ?? "") === PLUGIN_ID);
  };

  /**
   * Rewrite exactly one `searchBackends` / `fetchBackends` array through the
   * config editor. `mutate` gets a detached copy of the stored list and returns
   * its replacement; throwing inside it aborts before anything is written. An
   * empty replacement deletes the key, which is what keeps "no new backends
   * configured" = the synthesized 0.1.0 chain.
   */
  const editBackendList = async (kind, mutate) => {
    const editor = configEditor();
    const entry = findConfigEntry();
    if (!editor || typeof editor.edit !== "function" || !entry) throw new BridgeError(501, CONFIG_EDITOR_MISSING);
    const listKey = backendListKey(kind);
    let written;
    await editor.edit(entry, (currentConfig) => {
      const base = currentConfig && typeof currentConfig === "object" ? currentConfig : {};
      const stored = Array.isArray(base[listKey])
        ? base[listKey].map((row) => (row && typeof row === "object" ? { ...row } : row))
        : [];
      const nextList = mutate(stored);
      const next = { ...base };
      if (nextList.length === 0) delete next[listKey];
      else next[listKey] = nextList;
      written = next;
      return next;
    });
    // The write is authoritative for the response. The editor's reload is
    // asynchronous, so reading the entry back here can still show the previous
    // list; the config we just returned from `change` is the fresh state.
    if (written && typeof written === "object") activeConfig = written;
  };

  const requireBackendIndex = (list, value) => {
    const index = Number(value);
    if (!Number.isInteger(index) || index < 0 || index >= list.length) {
      throw new BridgeError(400, `backend index out of range: ${value}`);
    }
    return index;
  };

  const requireBackendMeta = (type, kind) => {
    const meta = findBackendType(type);
    if (!meta) throw new BridgeError(400, `unknown backend type: "${type}"`);
    if (meta.kind !== "both" && meta.kind !== kind) throw new BridgeError(400, `backend type "${type}" does not serve ${kind}`);
    return meta;
  };

  const REFERENCE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

  /** One declared field from the request, trimmed; blank becomes undefined. */
  const readBackendField = (field, value) => {
    const text = String(value ?? "").trim();
    if (field.key === "apiKeyEnv" && text && !REFERENCE_PATTERN.test(text)) {
      throw new BridgeError(400, `invalid credential reference "${text}" (expected an environment-variable name)`);
    }
    return text;
  };

  const pickBackendFields = (meta, input) => {
    const out = {};
    const source = input && typeof input === "object" ? input : {};
    for (const field of meta.fields) {
      if (!Object.hasOwn(source, field.key)) continue;
      const value = readBackendField(field, source[field.key]);
      if (value) out[field.key] = value;
    }
    return out;
  };

  /** Merge a partial edit into a row; an emptied field reverts to its default. */
  const applyBackendFields = (meta, row, input) => {
    const source = input && typeof input === "object" ? input : {};
    for (const field of meta.fields) {
      if (!Object.hasOwn(source, field.key)) continue;
      const value = readBackendField(field, source[field.key]);
      if (value) row[field.key] = value;
      else delete row[field.key];
    }
    return row;
  };

  const assertBackendComplete = (meta, row) => {
    const missing = missingRequiredFields(meta, row);
    if (missing.length) throw new BridgeError(400, `missing required field(s): ${missing.join(", ")}`);
  };

  /** A stable id derived from the type, with a numeric suffix when taken. */
  const uniqueBackendId = (list, type) => {
    const base = String(type).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "backend";
    let id = base;
    let suffix = 2;
    while (list.some((row) => String(row?.id ?? "") === id)) id = `${base}-${suffix++}`;
    return id;
  };

  /** The overview payload every write route answers with. */
  const overviewPayload = async () => ({ ok: true, api: await describeApi(), usage: await usage.summarize(current().usageDays) });

  const bridgeHandlers = {
    /** v0.3.0: the type catalog, with env-default availability annotated. */
    async backendTypes() {
      const types = BACKEND_TYPES.map((entry) => ({
        ...entry,
        fields: entry.fields.map((field) => ({
          ...field,
          envPresent: Boolean(
            field.key === "apiKeyEnv" && field.default && String(process.env[field.default] ?? "").trim(),
          ),
        })),
      }));
      return { ok: true, types };
    },
    async backendsAdd(body) {
      const kind = requireBackendKind(body?.kind);
      const type = String(body?.type ?? "").trim();
      const meta = requireBackendMeta(type, kind);
      const fields = pickBackendFields(meta, body?.fields);
      const row = { id: "", type, enabled: true, priority: 100, ...fields };
      assertBackendComplete(meta, row);
      await editBackendList(kind, (list) => {
        row.id = uniqueBackendId(list, type);
        return [...list, row];
      });
      return overviewPayload();
    },
    async backendsUpdate(body) {
      const kind = requireBackendKind(body?.kind);
      await editBackendList(kind, (list) => {
        const index = requireBackendIndex(list, body?.index);
        const row = { ...(list[index] ?? {}) };
        const meta = requireBackendMeta(String(row.type ?? ""), kind);
        applyBackendFields(meta, row, body?.fields);
        assertBackendComplete(meta, row);
        const next = [...list];
        next[index] = row;
        return next;
      });
      return overviewPayload();
    },
    async backendsRemove(body) {
      const kind = requireBackendKind(body?.kind);
      await editBackendList(kind, (list) => {
        const index = requireBackendIndex(list, body?.index);
        return list.filter((_, position) => position !== index);
      });
      return overviewPayload();
    },
    async backendsToggle(body) {
      const kind = requireBackendKind(body?.kind);
      if (typeof body?.enabled !== "boolean") throw new BridgeError(400, "enabled must be a boolean");
      await editBackendList(kind, (list) => {
        const index = requireBackendIndex(list, body?.index);
        const next = [...list];
        next[index] = { ...(list[index] ?? {}), enabled: body.enabled };
        return next;
      });
      return overviewPayload();
    },
    /** Key values cross this route only, into the credentials service. */
    async backendsKeySet(body) {
      const ref = String(body?.ref ?? "").trim();
      const value = String(body?.value ?? "").trim();
      if (!ref) throw new BridgeError(400, "empty credential reference");
      if (!REFERENCE_PATTERN.test(ref)) throw new BridgeError(400, `invalid credential reference "${ref}"`);
      if (!value) throw new BridgeError(400, "empty key");
      const credentials = getCredentials();
      if (typeof credentials?.set !== "function") throw new BridgeError(501, "the credentials service is not available in this deployment");
      await credentials.set(ref, value);
      return overviewPayload();
    },
    async backendsKeyUnset(body) {
      const ref = String(body?.ref ?? "").trim();
      if (!ref) throw new BridgeError(400, "empty credential reference");
      if (!REFERENCE_PATTERN.test(ref)) throw new BridgeError(400, `invalid credential reference "${ref}"`);
      const credentials = getCredentials();
      if (typeof credentials?.unset !== "function") throw new BridgeError(501, "the credentials service is not available in this deployment");
      await credentials.unset(ref);
      return overviewPayload();
    },
    async overview() {
      return overviewPayload();
    },
    /** v0.3.1: the structured guide the page's help panel and the docs share. */
    async usageGuide() {
      return { ok: true, guide: USAGE_GUIDE };
    },
    /**
     * One real request — this is billable, so a search asks for a single result.
     * `{ kind, backend?, query?, url? }`: `backend` pins that backend for the
     * probe; `count` (search only, optional) asks for more sources; omitting
     * everything keeps the 0.1.0 behavior ("DeepSeek", 1 result).
     */
    async test(body) {
      const kind = body?.kind === "fetch" ? "fetch" : "search";
      const backend = String(body?.backend ?? "").trim() || undefined;
      const startedAt = Date.now();
      try {
        if (kind === "fetch") {
          const url = String(body?.url ?? "").trim() || "https://example.com";
          const outcome = await runFetchInternal(url, { origin: "test", backend });
          const content = String(outcome.result?.body?.content ?? "");
          return {
            ok: true,
            kind,
            backend: outcome.backend,
            ms: Date.now() - startedAt,
            results: 1,
            sample: { title: url, url, snippet: clip(content, 200) },
          };
        }
        const query = String(body?.query ?? "").trim() || "DeepSeek";
        // 0.1.0's probe asked for one result; `count` is an opt-in extension so
        // an acceptance run can inspect several sources without a tool turn.
        const wanted = body?.count === undefined ? 1 : clampCount(body.count, 1);
        const outcome = await runSearchInternal(query, { count: wanted, origin: "test", backend });
        const first = outcome.result.sources[0];
        return {
          ok: true,
          kind,
          backend: outcome.backend,
          ms: Date.now() - startedAt,
          results: outcome.result.sources.length,
          count: outcome.result.sources.length,
          sample: first ? { title: first.title ?? "", url: first.url, snippet: first.snippet ?? "" } : null,
          sources: outcome.result.sources,
        };
      } catch (error) {
        return { ok: false, kind, backend: error?.backend || backend || null, ms: Date.now() - startedAt, results: 0, count: 0, message: errorMessage(error) };
      }
    },
    async setKey(body) {
      const value = String(body?.value ?? "").trim();
      if (!value) return { ok: false, message: "empty key" };
      const credentials = getCredentials();
      if (typeof credentials?.set !== "function") {
        return { ok: false, message: "the credentials service is not available in this deployment" };
      }
      await credentials.set(current().apiKeyEnv, value);
      return { ok: true, api: await describeApi() };
    },
    async unsetKey() {
      const credentials = getCredentials();
      if (typeof credentials?.unset !== "function") {
        return { ok: false, message: "the credentials service is not available in this deployment" };
      }
      await credentials.unset(current().apiKeyEnv);
      return { ok: true, api: await describeApi() };
    },
    async clearUsage() {
      await usage.clear();
      return { ok: true, usage: await usage.summarize(current().usageDays) };
    },
  };

  if (current().enableSettingsPage && typeof ctx.inject === "function") {
    ctx.inject(["webServer"], (sctx) => {
      sctx.effect(() => {
        const disposers = makeBridgeRoutes(bridgeHandlers).map((route) => sctx.webServer.register(route));
        return () => {
          for (const dispose of disposers) dispose();
        };
      }, "deepseek-search-tools: settings bridge");
    });
  }
}
