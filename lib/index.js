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
 * Reference: https://api-docs.deepseek.com/zh-cn/guides/search
 */
import z from "@deepseek-ai/schemastery";
import { BRIDGE_PREFIX, makeBridgeRoutes } from "./bridge.js";
import { createUsageStore } from "./usage.js";

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

/** Config for the plugin row (`web-search-deepseek-tools`). */
const Config = z.object({
  /** Literal key for throwaway testing. Leave empty in real rows: the shipped
   *  credentials service already holds `DEEPSEEK_API_KEY`. */
  apiKey: z.string().role("secret").default(DEFAULTS.apiKey),
  apiKeyEnv: z.string().role("credential-ref").default(DEFAULTS.apiKeyEnv),
  baseUrl: z.string().default(DEFAULTS.baseUrl),
  searchPath: z.string().default(DEFAULTS.searchPath),
  fetchPath: z.string().default(DEFAULTS.fetchPath),
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

/**
 * POST a JSON body and return the parsed response. Retries the DeepSeek
 * documented transient statuses once. `expected` lists the statuses the caller
 * wants to inspect instead of failing (so a fetch miss can fall back).
 */
async function postJson(fetchImpl, url, apiKey, payload, { signal, timeoutMs, expected }) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: combined,
      });
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 600));
        continue;
      }
      throw new Error(`DeepSeek ${url} request failed: ${error?.message ?? error}`);
    }
    const text = await response.text();
    if (response.ok) {
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`DeepSeek returned a non-JSON body (HTTP ${response.status})`);
      }
    }
    const detail = apiErrorText(text);
    const message = `DeepSeek ${url} failed: HTTP ${response.status}${detail ? ` — ${detail}` : ""}`;
    if (expected?.has(response.status)) {
      const error = new Error(message);
      error.status = response.status;
      error.statusCode = response.status;
      throw error;
    }
    if (RETRYABLE_STATUS.has(response.status) && attempt === 0) {
      lastError = new Error(message);
      await new Promise((resolve) => setTimeout(resolve, 800));
      continue;
    }
    throw new Error(message);
  }
  throw lastError ?? new Error(`DeepSeek ${url} failed`);
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

/**
 * `/v1/tools/search` → seam SearchResult.
 * Results carry a query-relevant `summary` (600–800 chars, meant for a model);
 * `snippet` is the short front-end form and is only the fallback.
 */
function toSearchResult(result, count, maxSourceChars) {
  const sources = (Array.isArray(result?.results) ? result.results : [])
    .map((item) => {
      const url = String(item?.url ?? "").trim();
      if (!url) return null;
      const snippet = clip(item?.summary || item?.snippet, maxSourceChars);
      const date = item?.date ? String(item.date) : "";
      return {
        url,
        title: stripNewlines(item?.title) || url,
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

export function apply(ctx, config) {
  const current = () => {
    const base = { ...DEFAULTS, ...(config ?? {}) };
    base.baseUrl = normalizeBaseUrl(base.baseUrl);
    return base;
  };

  const logger = ctx.logger;

  // `credentials` may mount after this plugin; resolve through ctx each time.
  const getCredentials = () => (typeof ctx.get === "function" ? ctx.get("credentials") : undefined);

  /** A literal key from the row config wins over every stored reference. */
  const literalApiKey = () => String(current().apiKey ?? "").trim();

  /**
   * Resolve the key from the credentials service (which layers the inherited
   * environment over the managed `.credentials.yaml`, plus `.env` fallbacks),
   * then this process's environment. Never memoized: a key the user stores
   * while a session runs takes effect on the next search.
   *
   * `credentials.resolve` is asynchronous in the shipped provider
   * (`dsh-credentials-local` returns `Promise<{value} | undefined>`), so the
   * result is awaited; a third-party provider answering synchronously is
   * covered by `Promise.resolve`.
   *
   * @returns the API key, or "" when nothing holds one yet.
   */
  const resolveApiKey = async () => {
    const literal = literalApiKey();
    if (literal) return literal;
    const { apiKeyEnv } = current();
    const credentials = getCredentials();
    if (credentials) {
      try {
        const resolved = await Promise.resolve(credentials.resolve(apiKeyEnv));
        if (typeof resolved === "string" && resolved.trim()) return resolved.trim();
        if (resolved?.value) return String(resolved.value).trim();
      } catch {
        // fall through to the environment
      }
    }
    return String(process.env[apiKeyEnv] ?? "").trim();
  };

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

  const request = async (path, payload, options) => {
    const cfg = current();
    const apiKey = await requireApiKey();
    return postJson(globalThis.fetch, `${cfg.baseUrl}${path}`, apiKey, payload, {
      signal: options?.signal,
      timeoutMs: cfg.timeoutMs,
      expected: options?.expected,
    });
  };

  // ---- usage accounting ----------------------------------------------------

  /**
   * Every call the seam routes here is accounted for, including failures — the
   * Settings → Tools page exists to show what was searched, how many results
   * came back, and whether it worked.
   */
  const usage = createUsageStore({
    dataDir: current().usageDataDir,
    limit: current().usageLimit,
    logger,
  });

  const errorMessage = (error) => (error instanceof Error ? error.message : String(error ?? "unknown error"));

  // ---- search provider -----------------------------------------------------

  /**
   * One `/v1/tools/search` call, accounted for.
   * @param rawQuery - the model's query.
   * @param options - `count`, abort `signal`, and the accounting `origin`.
   * @returns the seam SearchResult.
   */
  const runSearch = async (rawQuery, { count, signal, origin = "tool" } = {}) => {
    const cfg = current();
    const query = String(rawQuery ?? "").trim();
    if (!query) return { sources: [], truncated: false };
    const wanted = clampCount(count, 10);
    const payload = { query, count: wanted };
    if (cfg.includeContent) payload.need_content = true;
    if (cfg.localization) payload.localization = cfg.localization;
    const startedAt = Date.now();
    try {
      const result = await request(cfg.searchPath, payload, { signal, expected: new Set([401, 402]) });
      const mapped = toSearchResult(result, wanted, cfg.maxSourceChars);
      usage.record({
        kind: "search",
        target: query,
        requested: wanted,
        results: mapped.sources.length,
        ok: true,
        ms: Date.now() - startedAt,
        origin,
      });
      return mapped;
    } catch (error) {
      usage.record({
        kind: "search",
        target: query,
        requested: wanted,
        results: 0,
        ok: false,
        ms: Date.now() - startedAt,
        error: errorMessage(error),
        origin,
      });
      throw error;
    }
  };

  const searchProvider = {
    id: PROVIDER_ID,
    // Synchronous by contract (WebRuntime calls it while selecting a
    // provider), so — like the shipped `web-search-deepseek` — it reports
    // whether a credential SOURCE is reachable, not whether a key is stored.
    // A missing key surfaces at call time as WEB_PROVIDER_CREDENTIAL_MISSING.
    available: () => hasCredentialSource(),
    search: (searchRequest, signal) => runSearch(searchRequest?.query, { count: searchRequest?.maxResults, signal }),
  };

  // ---- fetch provider ------------------------------------------------------

  /**
   * The anonymous plain-HTTP fetcher (shipped `@deepseek-ai/dsh-web-fetch-http`).
   * Looked up at call time so registration order does not matter.
   */
  const fallbackFetch = () => {
    const provider = ctx.web?.fetchProviders?.get("http");
    if (!provider || provider === fetchProvider) return null;
    return provider;
  };

  /**
   * One `/v1/tools/fetch` call, accounted for, with the plain-HTTP fallback
   * that keeps `web_fetch` useful when DeepSeek cannot extract a page.
   * @param rawUrl - the requested URL.
   * @param options - abort `signal` and the accounting `origin`.
   * @returns the seam WebFetchResult.
   */
  const runFetch = async (rawUrl, { signal, origin = "tool" } = {}) => {
    const cfg = current();
    const url = String(rawUrl ?? "").trim();
    if (!url) throw new WebError("web_fetch requires a URL", "WEB_PROVIDER_ERROR");
    const startedAt = Date.now();
    const succeed = (result) => {
      usage.record({ kind: "fetch", target: url, results: 1, ok: true, ms: Date.now() - startedAt, origin });
      return result;
    };
    const fail = (error) => {
      usage.record({
        kind: "fetch",
        target: url,
        results: 0,
        ok: false,
        ms: Date.now() - startedAt,
        error: errorMessage(error),
        origin,
      });
      return error;
    };

    let apiFailure = null;
    try {
      const page = await request(cfg.fetchPath, { url }, { signal, expected: new Set([401, 402, 403, 404]) });
      const content = typeof page?.content === "string" ? page.content : "";
      const title = stripNewlines(page?.title);
      if (content.trim()) {
        const body = title ? `${title}\n\n${content}` : content;
        return succeed({ url, statusCode: 200, body: { kind: "text", content: body }, truncated: false });
      }
      apiFailure = new Error(`DeepSeek fetch returned no readable content for ${url}`);
    } catch (error) {
      apiFailure = error;
    }

    const fallback = cfg.fetchFallback ? fallbackFetch() : null;
    if (fallback) {
      logger.debug(
        `${PLUGIN_ID}: DeepSeek fetch could not serve ${url} (${errorMessage(apiFailure)}); falling back to the http provider`,
      );
      let result = null;
      try {
        result = await fallback.fetch({ url }, signal);
      } catch (error) {
        logger.debug(`${PLUGIN_ID}: http fallback failed for ${url} (${errorMessage(error)})`);
      }
      const content = result?.body?.content ?? "";
      if (String(content).trim()) return succeed(result);
      throw fail(apiFailure ?? new Error(`web_fetch could not read ${url}`));
    }
    if (apiFailure?.status === 404 || apiFailure?.statusCode === 404) {
      const error = new Error(`DeepSeek could not extract readable content from ${url}`);
      error.statusCode = 404;
      throw fail(error);
    }
    throw fail(apiFailure ?? new Error(`web_fetch failed for ${url}`));
  };

  const fetchProvider = {
    id: PROVIDER_ID,
    available: () => hasCredentialSource(),
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
    };
  };

  const bridgeHandlers = {
    async overview() {
      return { ok: true, api: await describeApi(), usage: await usage.summarize(current().usageDays) };
    },
    /** One real search — this is a billable request, so it searches for a single result. */
    async test() {
      const startedAt = Date.now();
      try {
        const result = await runSearch("DeepSeek", { count: 1, origin: "test" });
        const first = result.sources[0];
        return {
          ok: true,
          ms: Date.now() - startedAt,
          count: result.sources.length,
          sample: first ? { title: first.title ?? "", url: first.url, snippet: first.snippet ?? "" } : null,
        };
      } catch (error) {
        return { ok: false, ms: Date.now() - startedAt, count: 0, message: errorMessage(error) };
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
