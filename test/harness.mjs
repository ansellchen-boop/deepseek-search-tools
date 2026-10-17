/**
 * Offline harness for deepseek-search-tools:
 *  - mounts the plugin against a mock `ctx.web` / `ctx.logger`
 *  - checks registry takeover defaults and both provider result shapes
 *  - checks the Settings → Tools bridge (routes, guards, usage accounting)
 *  - (optional) one real probe against api.deepseek.com to confirm the request
 *    format; a 401 means "request accepted, auth missing" — format is correct.
 *
 * Usage:
 *   node test/harness.mjs                  # offline only
 *   node test/harness.mjs --live <apiKey>  # + one real /v1/tools/search call
 */
import { readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The usage store writes under `<DSH_HOME>/plugin-data/…`; keep the harness's
// accounting inside this checkout instead of the real install.
process.env.DSH_HOME = fileURLToPath(new URL("./.tmp-usage", import.meta.url));

const plugin = await import("../lib/index.js");

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

// ---- mock ctx -------------------------------------------------------------

const calls = [];
const makeCtx = ({ searchProviderId = "deepseek-official", fetchProviderId = "http", apiKey = "sk-test", registerPins = true } = {}) => {
  const web = {
    searchProviderId,
    fetchProviderId,
    searchProviders: new Map(),
    fetchProviders: new Map(),
    registerSearchProvider(provider) {
      web.searchProviders.set(provider.id, provider);
      return () => web.searchProviders.delete(provider.id);
    },
    registerFetchProvider(provider) {
      web.fetchProviders.set(provider.id, provider);
      return () => web.fetchProviders.delete(provider.id);
    },
  };
  // A pinned id is only a *choice* when something is actually registered there;
  // otherwise it is a dead pin (disabled or uninstalled bundle) and this plugin
  // treats the seam as broken. Seed the maps to model a live pin.
  if (registerPins) {
    const live = (id) => ({ id, available: () => true, search: async () => ({ sources: [], truncated: false }) });
    if (searchProviderId) web.searchProviders.set(searchProviderId, live(searchProviderId));
    if (fetchProviderId) web.fetchProviders.set(fetchProviderId, live(fetchProviderId));
  }
  const logs = [];
  const routes = [];
  const credentialWrites = [];
  const ctx = {
    web,
    logs,
    routes,
    credentialWrites,
    logger: {
      info: (...args) => logs.push(["info", args.join(" ")]),
      warn: (...args) => logs.push(["warn", args.join(" ")]),
      debug: (...args) => logs.push(["debug", args.join(" ")]),
    },
    // `ctx.inject(deps, callback)` is how a row asks for a service that may
    // mount later; the Settings bridge mounts its routes through it.
    inject(deps, callback) {
      callback({
        effect: (run) => run(),
        webServer: {
          register(route) {
            routes.push(route);
            return () => {
              const index = routes.indexOf(route);
              if (index >= 0) routes.splice(index, 1);
            };
          },
        },
      });
      return () => {};
    },
    get: (name) =>
      name === "credentials"
        ? {
            // Faithful to dsh-credentials-local: `resolve` returns a PROMISE and
            // answers undefined (not an empty value) when nothing is stored.
            // A synchronous mock here once hid a real defect, so it stays async.
            resolve: async (env) => (env && apiKey ? { value: apiKey, source: "file" } : undefined),
            set: async (ref, value) => {
              credentialWrites.push(["set", ref, value]);
            },
            unset: async (ref) => {
              credentialWrites.push(["unset", ref]);
            },
          }
        : undefined,
  };
  return ctx;
};

// ---- 1. registration + takeover -------------------------------------------

{
  const ctx = makeCtx();
  plugin.apply(ctx, {});
  check("registers both providers under id deepseek-tools", ctx.web.searchProviders.has("deepseek-tools") && ctx.web.fetchProviders.has("deepseek-tools"));
  check("takes over the shipped search default", ctx.web.searchProviderId === "deepseek-tools", ctx.web.searchProviderId);
  check("takes over the shipped fetch default", ctx.web.fetchProviderId === "deepseek-tools", ctx.web.fetchProviderId);
}

{
  const ctx = makeCtx({ searchProviderId: "ddg", fetchProviderId: "http" });
  plugin.apply(ctx, {});
  check("respects an explicitly pinned search provider", ctx.web.searchProviderId === "ddg", ctx.web.searchProviderId);
  check("still takes over the default fetch provider", ctx.web.fetchProviderId === "deepseek-tools", ctx.web.fetchProviderId);
  check("warns about the pinned search provider", ctx.logs.some(([level, text]) => level === "warn" && text.includes("ddg")));
}

{
  const ctx = makeCtx({ searchProviderId: "exa", fetchProviderId: "my-fetch" });
  plugin.apply(ctx, {});
  check("leaves both explicit pins alone", ctx.web.searchProviderId === "exa" && ctx.web.fetchProviderId === "my-fetch");
}

// ---- 1b. coexistence switches --------------------------------------------

{
  // dsh-free-search style: it claimed web.searchProvider before we load, and the
  // user turned our search switch off → we must stay out of the way, silently.
  const ctx = makeCtx({ searchProviderId: "web-search-free", fetchProviderId: "http" });
  plugin.apply(ctx, { takeOverSearch: false });
  check("takeOverSearch:false respects a foreign search provider", ctx.web.searchProviderId === "web-search-free", ctx.web.searchProviderId);
  check("takeOverSearch:false does not warn about the foreign provider", ctx.logs.every(([, text]) => !text.includes("web-search-free")), JSON.stringify(ctx.logs));
  check("search provider is still registered for explicit use", ctx.web.searchProviders.has("deepseek-tools"));
  check("fetch still switches over while search stays put", ctx.web.fetchProviderId === "deepseek-tools", ctx.web.fetchProviderId);
}

{
  // dsh-free-search already claimed the field: it only does so because nothing
  // better registered, so the DeepSeek provider supersedes it.
  const ctx = makeCtx({ searchProviderId: "web-search-free", fetchProviderId: "fs-quality-fetch" });
  plugin.apply(ctx, {});
  check("supersedes dsh-free-search's opportunistic claim", ctx.web.searchProviderId === "deepseek-tools" && ctx.web.fetchProviderId === "deepseek-tools", `${ctx.web.searchProviderId}/${ctx.web.fetchProviderId}`);
}

{
  // A provider the user actually chose: warn, don't steal.
  const ctx = makeCtx({ searchProviderId: "my-search", fetchProviderId: "http" });
  plugin.apply(ctx, {});
  check("does not steal an id the user chose", ctx.web.searchProviderId === "my-search", ctx.web.searchProviderId);
  check("points the user at the web.searchProvider pin", ctx.logs.some(([level, text]) => level === "warn" && text.includes("searchProvider: deepseek-tools")), JSON.stringify(ctx.logs));
}

{
  // Unload must give the field back: a stale id pointing at an unregistered
  // provider breaks every web call with "configured web provider ... is not
  // registered".
  const disposers = [];
  const ctx = makeCtx({ searchProviderId: "web-search-free", fetchProviderId: "http" });
  ctx.effect = (fn) => disposers.push(fn());
  plugin.apply(ctx, {});
  check("registers a disposer for each takeover", disposers.length === 2, String(disposers.length));
  disposers.forEach((dispose) => dispose());
  check("dispose restores the previous owners", ctx.web.searchProviderId === "web-search-free" && ctx.web.fetchProviderId === "http", `${ctx.web.searchProviderId}/${ctx.web.fetchProviderId}`);
}

{
  // The switch is toggled off on the same context: hand the default back.
  const ctx = makeCtx({ searchProviderId: "", fetchProviderId: "" });
  plugin.apply(ctx, {});
  check("claims both unset ids", ctx.web.searchProviderId === "deepseek-tools" && ctx.web.fetchProviderId === "deepseek-tools");
  plugin.apply(ctx, { takeOverSearch: false, takeOverFetch: false });
  check("hands both ids back when switched off", ctx.web.searchProviderId === "deepseek-official" && ctx.web.fetchProviderId === "http", `${ctx.web.searchProviderId}/${ctx.web.fetchProviderId}`);
}

{
  // The live desktop failure: @liustack/modsearch's bundle patch pins
  // `searchProvider: modsearch` while its plugin row is disabled, so nothing is
  // registered under that id and every web search dies with
  // `configured web provider "modsearch" is not registered`. A pin nobody can
  // serve is not a choice — take it over and say why.
  const ctx = makeCtx({ searchProviderId: "modsearch", fetchProviderId: "http", registerPins: false });
  plugin.apply(ctx, {});
  check("takes over a pin nothing is registered under", ctx.web.searchProviderId === "deepseek-tools", ctx.web.searchProviderId);
  check("explains the dead pin", ctx.logs.some(([level, text]) => level === "info" && text.includes("modsearch") && text.includes("not registered")), JSON.stringify(ctx.logs));
}

{
  // A pin that is registered but reports itself unavailable is equally broken.
  const ctx = makeCtx({ searchProviderId: "half-dead", fetchProviderId: "http", registerPins: false });
  ctx.web.searchProviders.set("half-dead", { id: "half-dead", available: () => false, search: async () => ({ sources: [], truncated: false }) });
  plugin.apply(ctx, {});
  check("takes over a pin whose provider is unavailable", ctx.web.searchProviderId === "deepseek-tools", ctx.web.searchProviderId);
  check("explains the unavailable pin", ctx.logs.some(([level, text]) => text.includes("registered but unavailable")), JSON.stringify(ctx.logs));
}

{
  // Already pinned by the profile patch: keep it, and do not warn on re-apply.
  const ctx = makeCtx({ searchProviderId: "deepseek-tools", fetchProviderId: "deepseek-tools" });
  plugin.apply(ctx, {});
  plugin.apply(ctx, {});
  check("re-applying over an explicit pin is quiet and idempotent", ctx.web.searchProviderId === "deepseek-tools" && ctx.logs.length === 0, JSON.stringify(ctx.logs));
}

{
  // Switched off but still pinned by the patch → explain instead of silently idling.
  const ctx = makeCtx({ searchProviderId: "deepseek-tools", fetchProviderId: "http" });
  plugin.apply(ctx, { takeOverSearch: false });
  check("explains a leftover explicit pin", ctx.logs.some(([level, text]) => level === "warn" && text.includes("still points here")));
}

// ---- fetch stub shared by the checks below --------------------------------

const realFetch = globalThis.fetch;
const stub = (handler) => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null, headers: init?.headers });
    return handler(String(url), init);
  };
};
const jsonResponse = (status, payload) =>
  new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

// ---- 2. availability (the seam requires a SYNCHRONOUS boolean) ------------

{
  // Shipped-provider semantics: `available()` answers "can this provider be
  // ATTEMPTED", i.e. is a credential source reachable. A mounted credentials
  // service counts even before a key is stored; the missing key then fails the
  // call with WEB_PROVIDER_CREDENTIAL_MISSING (checked further down).
  const ctx = makeCtx({ apiKey: "" });
  plugin.apply(ctx, {});
  const provider = ctx.web.searchProviders.get("deepseek-tools");
  const availability = provider.available();
  check("available() is a synchronous boolean, not a promise", typeof availability === "boolean", `${typeof availability} ${JSON.stringify(availability)}`);
  check("available() when a credential source is reachable", availability === true, String(availability));
  check("fetch provider reports the same", ctx.web.fetchProviders.get("deepseek-tools").available() === true);
}

{
  // No credential source at all: no credentials service, no env, no literal.
  const ctx = makeCtx({ apiKey: "" });
  delete ctx.get;
  delete process.env.DEEPSEEK_API_KEY;
  plugin.apply(ctx, {});
  check("unavailable when no credential source exists", ctx.web.searchProviders.get("deepseek-tools").available() === false);
}

{
  const ctx = makeCtx({ apiKey: "sk-test" });
  plugin.apply(ctx, {});
  const provider = ctx.web.searchProviders.get("deepseek-tools");
  check("available() true with a credential", provider.available() === true);
}

{
  // A literal key needs no service and no environment.
  const ctx = makeCtx({ apiKey: "" });
  delete ctx.get;
  delete process.env.DEEPSEEK_API_KEY;
  plugin.apply(ctx, { apiKey: "sk-literal" });
  check("literal apiKey makes the provider available", ctx.web.searchProviders.get("deepseek-tools").available() === true);
  calls.length = 0;
  stub(() => jsonResponse(200, { results: [] }));
  await ctx.web.searchProviders.get("deepseek-tools").search({ query: "q", maxResults: 1 });
  check("literal apiKey arrives as the bearer key", calls[0].headers.Authorization === "Bearer sk-literal", JSON.stringify(calls[0].headers));
  globalThis.fetch = realFetch;
}

{
  // No credentials service at all: the launch environment is the only source.
  const ctx = makeCtx();
  delete ctx.get;
  process.env.DEEPSEEK_API_KEY = "sk-from-env";
  plugin.apply(ctx, {});
  check("falls back to process.env[DEEPSEEK_API_KEY]", ctx.web.searchProviders.get("deepseek-tools").available() === true);
  delete process.env.DEEPSEEK_API_KEY;
}

{
  // A credentials service that answers SYNCHRONOUSLY (a third-party one may)
  // must work just as well as the shipped asynchronous one.
  const ctx = makeCtx({ apiKey: "sk-sync" });
  ctx.get = (name) => (name === "credentials" ? { resolve: (env) => (env ? { value: "sk-sync" } : undefined) } : undefined);
  plugin.apply(ctx, {});
  calls.length = 0;
  stub(() => jsonResponse(200, { results: [] }));
  await ctx.web.searchProviders.get("deepseek-tools").search({ query: "q", maxResults: 1 });
  check("a synchronous credential resolver still authorizes the request", calls[0].headers.Authorization === "Bearer sk-sync", JSON.stringify(calls[0].headers));
  globalThis.fetch = realFetch;
}

{
  // A custom apiKeyEnv is honoured on both the check and the request.
  const ctx = makeCtx();
  plugin.apply(ctx, { apiKeyEnv: "MY_DS_KEY" });
  check("custom apiKeyEnv reaches the credentials service", ctx.web.searchProviders.get("deepseek-tools").available() === true);
  calls.length = 0;
  stub(() => jsonResponse(200, { results: [] }));
  await ctx.web.searchProviders.get("deepseek-tools").search({ query: "q", maxResults: 1 });
  check("custom apiKeyEnv arrives as the bearer key", calls[0].headers.Authorization === "Bearer sk-test", JSON.stringify(calls[0].headers));
  globalThis.fetch = realFetch;
}

{
  // The web seam throws this code when a configured provider cannot serve.
  const ctx = makeCtx({ apiKey: "" });
  plugin.apply(ctx, {});
  let error = null;
  try {
    await ctx.web.searchProviders.get("deepseek-tools").search({ query: "q", maxResults: 1 });
  } catch (caught) {
    error = caught;
  }
  check("missing credential raises WEB_PROVIDER_CREDENTIAL_MISSING", error?.code === "WEB_PROVIDER_CREDENTIAL_MISSING", `${error?.code} / ${error?.message}`);
}

// ---- 3. result shapes against a stubbed fetch -----------------------------

{
  calls.length = 0;
  const ctx = makeCtx();
  plugin.apply(ctx, {});
  const provider = ctx.web.searchProviders.get("deepseek-tools");
  stub(() =>
    jsonResponse(200, {
      results: [
        { rerank_score: 2.4, title: "DeepSeek V4 模型发布", url: "https://example.com/a", snippet: "短摘要", summary: "长摘要\n含换行", date: "2026-06-01T00:00:00+00:00", content: "" },
        { title: "no summary", url: "https://example.com/b", snippet: "only snippet" },
        { title: "no url" },
      ],
    }),
  );
  const result = await provider.search({ query: "DeepSeek V4", maxResults: 7 });
  check("search posts to /v1/tools/search with bearer auth", calls[0].url === "https://api.deepseek.com/v1/tools/search" && calls[0].headers.Authorization === "Bearer sk-test");
  check("search sends query + clamped count", calls[0].body.query === "DeepSeek V4" && calls[0].body.count === 7, JSON.stringify(calls[0].body));
  check("search omits need_content by default", calls[0].body.need_content === undefined);
  check("search maps summary → snippet and drops the entry without url", result.sources.length === 2 && result.sources[0].snippet === "长摘要 含换行" && result.sources[0].publishedAt === "2026-06-01T00:00:00+00:00", JSON.stringify(result.sources));
  check("count is clamped to the API range", (await (async () => {
    const r = await provider.search({ query: "x", maxResults: 999 });
    return calls[1].body.count === 50 && r.sources.length <= 50;
  })()));
  globalThis.fetch = realFetch;
}

{
  // REGRESSION: the seam rejects a payload whose own properties hold
  // `undefined` ("returned invalid output: value is not lossless JSON"), so a
  // SearchResult must survive a JSON round trip with no keys lost.
  const undefinedKeys = (value, path = "") => {
    if (value === null || typeof value !== "object") return [];
    return Object.entries(value).flatMap(([key, child]) =>
      child === undefined ? [`${path}${key}`] : undefinedKeys(child, `${path}${key}.`),
    );
  };
  const ctx = makeCtx();
  plugin.apply(ctx, {});
  const provider = ctx.web.searchProviders.get("deepseek-tools");
  stub(() => jsonResponse(200, {
    results: [
      { title: "kept", url: "https://example.com/1", summary: "s" },
      { title: "also kept", url: "https://example.com/2", snippet: "s" },
    ],
  }));
  const many = await provider.search({ query: "q", maxResults: 1 });
  const few = await provider.search({ query: "q", maxResults: 5 });
  check("SearchResult carries no undefined-valued property", undefinedKeys(many).length === 0 && undefinedKeys(few).length === 0, JSON.stringify([undefinedKeys(many), undefinedKeys(few)]));
  // `WebRuntime.search` only injects `truncated` when it caps the list, and
  // `dsh-tool-web` copies `value.truncated` into its meta unconditionally — so
  // the provider itself must always answer with an explicit boolean.
  check("SearchResult always states truncated: false", many.truncated === false && few.truncated === false && Object.hasOwn(many, "truncated"), JSON.stringify([many.truncated, Object.hasOwn(many, "truncated")]));
  check("SearchResult round-trips through JSON unchanged", JSON.stringify(JSON.parse(JSON.stringify(many))) === JSON.stringify(many), JSON.stringify(many));
  globalThis.fetch = realFetch;
}

{
  calls.length = 0;
  const ctx = makeCtx();
  plugin.apply(ctx, { maxSourceChars: 20 });
  const provider = ctx.web.searchProviders.get("deepseek-tools");
  stub(() =>
    jsonResponse(200, {
      results: [{ title: "long", url: "https://example.com/long", summary: "一二三四五六七八九十一二三四五六七八九十一二三四五" }],
    }),
  );
  const clipped = await provider.search({ query: "q", maxResults: 1 });
  check(
    "maxSourceChars clips the snippet on a character boundary",
    clipped.sources[0].snippet === "一二三四五六七八九十一二三四五六七八九十…" && [...clipped.sources[0].snippet].length === 21,
    `${clipped.sources[0].snippet} (${[...clipped.sources[0].snippet].length})`,
  );
  globalThis.fetch = realFetch;
}

{
  calls.length = 0;
  const ctx = makeCtx();
  plugin.apply(ctx, { includeContent: true, localization: "1.2.3.4" });
  const provider = ctx.web.searchProviders.get("deepseek-tools");
  stub(() => jsonResponse(200, { results: [] }));
  await provider.search({ query: "q", maxResults: 3 });
  check("includeContent/localization flow into the payload", calls[0].body.need_content === true && calls[0].body.localization === "1.2.3.4", JSON.stringify(calls[0].body));
  globalThis.fetch = realFetch;
}

{
  calls.length = 0;
  const ctx = makeCtx();
  plugin.apply(ctx, {});
  const fetchProvider = ctx.web.fetchProviders.get("deepseek-tools");
  stub(() => jsonResponse(200, { title: "Example article", content: "# Example article\n\nBody." }));
  const page = await fetchProvider.fetch({ url: "https://example.com/article" });
  check("fetch posts to /v1/tools/fetch with the url", calls[0].url === "https://api.deepseek.com/v1/tools/fetch" && calls[0].body.url === "https://example.com/article");
  check(
    "fetch returns a text WebFetchBody with the title fused in",
    page.statusCode === 200 && page.body.kind === "text" && page.body.content.startsWith("Example article\n\n") && page.truncated === false,
    JSON.stringify(page),
  );

  // 404 → plain-HTTP fallback provider when one is registered
  const httpProvider = {
    id: "http",
    async fetch() {
      return { url: "https://example.com/article", statusCode: 200, body: { kind: "html", content: "<html>fallback</html>" }, truncated: false };
    },
  };
  ctx.web.fetchProviders.set("http", httpProvider);
  stub(() => jsonResponse(404, { error: { message: "no content" } }));
  const fallbackPage = await fetchProvider.fetch({ url: "https://example.com/article" });
  check("falls back to the http provider on 404", fallbackPage.body.content === "<html>fallback</html>", JSON.stringify(fallbackPage));

  // no fallback provider → structured error
  ctx.web.fetchProviders.delete("http");
  let error = null;
  try {
    await fetchProvider.fetch({ url: "https://example.com/article" });
  } catch (caught) {
    error = caught;
  }
  check("without a fallback provider a 404 becomes an error", error?.statusCode === 404, String(error?.message));
  check("API failures are not retried into a different error class", /HTTP 404/.test(String(error?.message)) === false && error?.statusCode === 404, String(error?.message));

  // 429 is retried once
  let attempts = 0;
  stub(() => {
    attempts += 1;
    return attempts === 1 ? jsonResponse(429, { error: { message: "rate limited" } }) : jsonResponse(200, { title: "t", content: "ok" });
  });
  const retried = await fetchProvider.fetch({ url: "https://example.com/article" });
  check("retries a 429 once, then succeeds", attempts === 2 && retried.body.content.includes("ok"), `attempts=${attempts}`);
  globalThis.fetch = realFetch;
}

// ---- 5. Settings → Tools bridge ------------------------------------------

/** Drive one registered route with a fake Node request/response pair. */
const httpCall = async (ctx, path, { method = "POST", body = null, remoteAddress = "127.0.0.1", host = "127.0.0.1:19387" } = {}) => {
  const route = ctx.routes.find((entry) => entry.path === `/api/deepseek-search-tools${path}`);
  if (!route) throw new Error(`no route registered for ${path}`);
  const chunks = body === null ? [] : [Buffer.from(JSON.stringify(body))];
  const request = {
    method,
    url: route.path,
    socket: { remoteAddress },
    headers: { host, "content-type": "application/json" },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
  const output = { status: 0, headers: null, body: "" };
  const response = {
    writeHead(status, headers) {
      output.status = status;
      output.headers = headers;
    },
    end(chunk) {
      output.body += chunk ?? "";
    },
  };
  await route.handler(request, response);
  output.json = output.body ? JSON.parse(output.body) : null;
  return output;
};

{
  const ctx = makeCtx();
  plugin.apply(ctx, {});
  const paths = ctx.routes.map((route) => route.path).sort();
  check(
    "the Settings bridge registers five loopback routes",
    paths.length === 5 &&
      paths.every((path) => path.startsWith("/api/deepseek-search-tools/")) &&
      ["overview", "test", "key-set", "key-unset", "usage-clear"].every((name) =>
        paths.includes(`/api/deepseek-search-tools/${name}`),
      ),
    JSON.stringify(paths),
  );

  const overview = await httpCall(ctx, "/overview");
  check(
    "overview reports the credentials reference and the usage totals",
    overview.status === 200 &&
      overview.json?.ok === true &&
      overview.json.api.ref === "DEEPSEEK_API_KEY" &&
      typeof overview.json.api.masked === "string" &&
      typeof overview.json.usage.total.calls === "number" &&
      overview.json.usage.byDay.length === 7,
    JSON.stringify(overview.json?.api),
  );
  check(
    "overview never returns the raw key",
    !overview.body.includes("sk-test") && /^[•*]+$/.test(overview.json.api.masked),
    overview.json.api.masked,
  );

  // The page reads these keys directly; a rename on the host side would render
  // an empty panel without any error, so the contract is asserted here.
  const REQUIRED_API = ["configured", "providerId", "searchProvider", "fetchProvider", "baseUrl", "searchPath", "fetchPath", "source", "ref", "masked", "timeoutMs", "writable"];
  const REQUIRED_USAGE = ["file", "limit", "total", "today", "byDay", "recent"];
  const REQUIRED_TOTAL = ["calls", "search", "fetch", "failed", "results", "avgMs"];
  const REQUIRED_DAY = ["date", ...REQUIRED_TOTAL];
  check(
    "overview carries every field the Settings page reads",
    REQUIRED_API.every((key) => key in overview.json.api) &&
      REQUIRED_USAGE.every((key) => key in overview.json.usage) &&
      REQUIRED_TOTAL.every((key) => key in overview.json.usage.total) &&
      REQUIRED_DAY.every((key) => key in overview.json.usage.byDay[0]),
    `missing: ${[
      ...REQUIRED_API.filter((key) => !(key in overview.json.api)).map((key) => `api.${key}`),
      ...REQUIRED_USAGE.filter((key) => !(key in overview.json.usage)).map((key) => `usage.${key}`),
    ].join(", ") || "none"}`,
  );

  // A search is accounted for, with the query, count, result count and status.
  const target = `bridge-accounting-${Date.now()}`;
  stub(() => jsonResponse(200, { results: [{ title: "t", url: "https://example.com/x", summary: "s" }] }));
  await ctx.web.searchProviders.get("deepseek-tools").search({ query: target, maxResults: 4 });
  globalThis.fetch = realFetch;
  const accounted = await httpCall(ctx, "/overview");
  const record = accounted.json.usage.recent.find((entry) => entry.target === target);
  check(
    "a search is recorded with target, requested count, results, status and latency",
    record !== undefined &&
      record.kind === "search" &&
      record.requested === 4 &&
      record.results === 1 &&
      record.ok === true &&
      Number.isFinite(record.ms),
    JSON.stringify(record),
  );

  // The debounced write must actually reach disk with the record inside it —
  // the harness runs with `DSH_HOME` pointed at this checkout.
  await new Promise((resolve) => setTimeout(resolve, 900));
  const usageFile = join(process.env.DSH_HOME, "plugin-data", "deepseek-search-tools", "usage.json");
  const onDisk = JSON.parse(readFileSync(usageFile, "utf8"));
  check(
    "the usage file persists the recorded calls",
    Array.isArray(onDisk.records) && onDisk.records.some((entry) => entry.target === target),
    `${onDisk.records?.length} record(s) on disk`,
  );

  // Overlapping writers must never share a temporary file: that is how a
  // half-written document reached disk once (the page then showed nothing).
  const { createUsageStore } = await import("../lib/usage.js");
  const raceDir = join(process.env.DSH_HOME, "plugin-data", "race");
  await rm(raceDir, { recursive: true, force: true });
  const store = createUsageStore({ dataDir: raceDir });
  for (let index = 0; index < 8; index += 1) {
    store.record({ kind: "search", target: `race-${index}`, ok: true, ms: 1, results: 1 });
  }
  await Promise.all([store.flush(), store.flush(), store.flush(), store.summarize(7)]);
  const raced = JSON.parse(readFileSync(join(raceDir, "usage.json"), "utf8"));
  check("overlapping writes still produce one valid document", raced.records?.length === 8, `${raced.records?.length} record(s)`);

  // Upgrading from the old package name must not blank the page: with no log in
  // the new directory the store falls back to `plugin-data/dsh-deepseek-tools`.
  const legacyHome = join(process.env.DSH_HOME, "plugin-data", "legacy-home");
  await rm(legacyHome, { recursive: true, force: true });
  await mkdir(join(legacyHome, "plugin-data", "dsh-deepseek-tools"), { recursive: true });
  await writeFile(
    join(legacyHome, "plugin-data", "dsh-deepseek-tools", "usage.json"),
    JSON.stringify({
      version: 1,
      records: [{ at: Date.now(), kind: "search", target: "legacy-call", ok: true, ms: 5, results: 2 }],
    }),
    "utf8",
  );
  const savedHome = process.env.DSH_HOME;
  process.env.DSH_HOME = legacyHome;
  let carried = null;
  try {
    const legacyStore = createUsageStore();
    carried = await legacyStore.summarize(7);
  } finally {
    process.env.DSH_HOME = savedHome;
  }
  check(
    "a log written under the old package name is still read",
    carried?.total?.calls === 1 && carried?.recent?.[0]?.target === "legacy-call",
    JSON.stringify(carried?.total),
  );

  // A failure is recorded too — that is the point of the details tab.
  const failedTarget = `bridge-failure-${Date.now()}`;
  stub(() => jsonResponse(401, { error: { message: "bad key" } }));
  let failure = null;
  try {
    await ctx.web.searchProviders.get("deepseek-tools").search({ query: failedTarget, maxResults: 1 });
  } catch (caught) {
    failure = caught;
  }
  globalThis.fetch = realFetch;
  const afterFailure = await httpCall(ctx, "/overview");
  const failedRecord = afterFailure.json.usage.recent.find((entry) => entry.target === failedTarget);
  check(
    "a failed search is recorded with ok:false and the error text",
    failedRecord !== undefined && failedRecord.ok === false && /HTTP 401/.test(failedRecord.error ?? ""),
    JSON.stringify(failedRecord),
  );

  // The live test route runs one real (stubbed) search and reports its shape.
  stub(() => jsonResponse(200, { results: [{ title: "DeepSeek", url: "https://example.com/deepseek", summary: "s" }] }));
  const tested = await httpCall(ctx, "/test");
  globalThis.fetch = realFetch;
  check(
    "the test route reports ok, latency, count and a sample",
    tested.json?.ok === true &&
      tested.json.count === 1 &&
      tested.json.sample?.url === "https://example.com/deepseek" &&
      Number.isFinite(tested.json.ms),
    JSON.stringify(tested.json),
  );
  const afterTest = await httpCall(ctx, "/overview");
  check(
    "the tested search is tagged origin:test in the history",
    afterTest.json.usage.recent[0]?.origin === "test",
    JSON.stringify(afterTest.json.usage.recent[0]),
  );

  // Guards: a key write must not be reachable from another interface or origin.
  const crossSite = await httpCall(ctx, "/key-set", { body: { value: "sk-x" }, remoteAddress: "10.0.0.7" });
  check("non-loopback peers are rejected", crossSite.status === 403, JSON.stringify(crossSite.json));
  const wrongMethod = await httpCall(ctx, "/overview", { method: "GET" });
  check("routes are POST-only", wrongMethod.status === 405, JSON.stringify(wrongMethod.json));

  const saved = await httpCall(ctx, "/key-set", { body: { value: "  sk-new-key  " } });
  check(
    "key-set writes the trimmed value to the credentials service",
    saved.json?.ok === true &&
      ctx.credentialWrites[0]?.[0] === "set" &&
      ctx.credentialWrites[0]?.[1] === "DEEPSEEK_API_KEY" &&
      ctx.credentialWrites[0]?.[2] === "sk-new-key",
    JSON.stringify(ctx.credentialWrites),
  );
  const cleared = await httpCall(ctx, "/key-unset", { body: {} });
  check(
    "key-unset forgets the stored reference",
    cleared.json?.ok === true && ctx.credentialWrites[1]?.[0] === "unset" && ctx.credentialWrites[1]?.[1] === "DEEPSEEK_API_KEY",
    JSON.stringify(ctx.credentialWrites),
  );

  const wiped = await httpCall(ctx, "/usage-clear", { body: {} });
  check("usage-clear empties the history", wiped.json?.ok === true && wiped.json.usage.total.calls === 0, JSON.stringify(wiped.json?.usage?.total));
}

{
  // `enableSettingsPage: false` must leave the Web server untouched.
  const ctx = makeCtx();
  plugin.apply(ctx, { enableSettingsPage: false });
  check("enableSettingsPage:false registers no routes", ctx.routes.length === 0, JSON.stringify(ctx.routes.map((route) => route.path)));
}

// ---- 6. browser bundle ----------------------------------------------------

{
  // The client half is a classic script: the host installs
  // `window.__ModuleLoader__` and the factory `require`s react. Load it against
  // a small DOM stand-in and assert it exports a client plugin that registers
  // the Tools section — a broken bundle would otherwise only show up after the
  // app is restarted.
  const created = [];
  const loaded = [];
  // A hook-aware stand-in for React: createElement builds a plain tree so the
  // section can be rendered and inspected without a browser, and every
  // component instance gets its own state cells (see renderSection below).
  let hookState = [];
  let hookIndex = 0;
  let pendingEffects = [];
  const React = {
    Fragment: "Fragment",
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat(4) };
    },
    useState(initial) {
      // The cells are captured per hook call: a setState that runs later (from
      // an async effect) must land on the instance that owns the hook, not on
      // whatever instance happens to be rendering at that moment.
      const cells = hookState;
      const index = hookIndex++;
      if (!(index in cells)) cells[index] = typeof initial === "function" ? initial() : initial;
      return [
        cells[index],
        (next) => {
          cells[index] = typeof next === "function" ? next(cells[index]) : next;
        },
      ];
    },
    useEffect(run) {
      pendingEffects.push(run);
    },
    useMemo(factory) {
      return factory();
    },
    useCallback(callback) {
      return callback;
    },
  };
  const clientRequire = (specifier) => {
    if (specifier === "react") return React;
    if (specifier === "react/jsx-runtime") return { jsx: React.createElement, jsxs: React.createElement, Fragment: React.Fragment };
    throw new Error(`unexpected require("${specifier}") from the client bundle`);
  };
  globalThis.document = {
    getElementById: (id) => created.find((element) => element.id === id) ?? null,
    createElement: (tag) => {
      const element = { tag, id: "", textContent: "" };
      created.push(element);
      return element;
    },
    head: { appendChild: () => {} },
  };
  globalThis.window = {
    __ModuleLoader__: {
      load({ id, factory }) {
        loaded.push({ id, exports: factory(clientRequire) });
      },
    },
  };

  await import("../lib/client.js");
  const bundle = loaded[0];
  check("client bundle registers under the package name", bundle?.id === "deepseek-search-tools", String(bundle?.id));
  check(
    "client bundle exports apply + inject",
    typeof bundle?.exports?.apply === "function" &&
      Array.isArray(bundle?.exports?.inject) &&
      bundle.exports.inject.includes("slots"),
    JSON.stringify(bundle?.exports?.inject),
  );

  const slotCalls = [];
  bundle.exports.apply({
    slots: {
      inject: (name, run) => {
        slotCalls.push(["inject", name]);
        run();
      },
      register: (options, Component) => {
        slotCalls.push(["register", options, Component]);
        return () => {};
      },
    },
  });
  const registration = slotCalls.find(([kind]) => kind === "register");
  check(
    "apply registers the Search Tools settings section",
    slotCalls[0]?.[0] === "inject" &&
      slotCalls[0]?.[1] === "settings.section" &&
      registration?.[1]?.name === "settings.section" &&
      registration[1].id === "tools" &&
      registration[1].label() === "Search Tools" &&
      typeof registration[1].order === "number" &&
      typeof registration[2] === "function",
    JSON.stringify(registration?.[1]),
  );
  const styles = created.filter((element) => element.tag === "style");
  check(
    "apply installs the stylesheet exactly once",
    styles.length === 1 && /\.ddt-root/.test(styles[0].textContent) && styles[0].id === "deepseek-search-tools-style",
    `${styles.length} style element(s)`,
  );
  // Re-applying (a fiber restart) must not append a second stylesheet.
  bundle.exports.apply({ slots: { inject: (name, run) => run(), register: () => () => {} } });
  check("re-applying reuses the existing stylesheet", created.filter((element) => element.tag === "style").length === 1);

  // --- render the page itself ----------------------------------------------
  // A blank section is the failure mode this catches: a typo or a missing
  // helper inside a component only throws once something renders it, and the
  // browser would show an empty panel with no error anywhere.
  const overviewPayload = {
    ok: true,
    api: {
      ref: "DEEPSEEK_API_KEY",
      configured: true,
      masked: "••••••",
      source: "file",
      stored: true,
      literal: false,
      writable: true,
      baseUrl: "https://api.deepseek.com",
      searchPath: "/v1/tools/search",
      fetchPath: "/v1/tools/fetch",
      timeoutMs: 60000,
      providerId: "deepseek-tools",
      searchProvider: "deepseek-tools",
      fetchProvider: "deepseek-tools",
      usageDataDir: "C:/tmp/deepseek-search-tools",
    },
    usage: {
      file: "C:/tmp/deepseek-search-tools/usage.json",
      limit: 2000,
      total: { calls: 3, search: 2, fetch: 1, failed: 0, results: 9, avgMs: 1200 },
      today: { calls: 3, search: 2, fetch: 1, failed: 0, results: 9, avgMs: 1200 },
      byDay: [{ date: "2026-10-17", calls: 3, search: 2, fetch: 1, failed: 0, results: 9, avgMs: 1200 }],
      recent: [
        { at: Date.parse("2026-10-17T07:02:00Z"), kind: "search", target: "DeepSeek V4 官方公告", ok: true, ms: 400, results: 8, requested: 8 },
        { at: Date.parse("2026-10-17T07:03:00Z"), kind: "fetch", target: "https://example.com", ok: false, ms: 25, results: 0, error: "HTTP 403" },
      ],
    },
  };

  const rootCells = [];
  const renderSection = (Component, props) => {
    const saved = { state: hookState, index: hookIndex, effects: pendingEffects };
    hookState = rootCells;
    hookIndex = 0;
    pendingEffects = [];
    const tree = Component(props);
    const pending = pendingEffects;
    pendingEffects = [];
    const out = [];
    walk(tree, out, 0);
    // The root's own effects run with the root's cells active, so a setState
    // inside them lands on the instance that will be rendered next pass.
    hookState = rootCells;
    hookIndex = 0;
    for (const run of pending) {
      try {
        run();
      } catch (error) {
        out.push(`<effect error: ${error.message}>`);
      }
    }
    hookState = saved.state;
    hookIndex = saved.index;
    pendingEffects = saved.effects;
    return { tree, text: out.join(" ") };
  };

  function walk(element, out, depth) {
    if (element === null || element === undefined || element === false || element === true) return;
    const kind = typeof element;
    if (kind === "string" || kind === "number") {
      out.push(String(element));
      return;
    }
    if (Array.isArray(element)) {
      for (const child of element) walk(child, out, depth);
      return;
    }
    if (element.type === "style") return;
    if (typeof element.type === "function") {
      if (depth > 12) {
        out.push("<nested too deep>");
        return;
      }
      const saved = { state: hookState, index: hookIndex, effects: pendingEffects };
      hookState = [];
      hookIndex = 0;
      pendingEffects = [];
      let rendered;
      try {
        rendered = element.type({ ...element.props, children: element.children });
      } catch (error) {
        out.push(`<render error: ${error.message}>`);
      }
      const pending = pendingEffects;
      pendingEffects = [];
      if (rendered !== undefined && rendered !== null) walk(rendered, out, depth + 1);
      for (const run of pending) {
        try {
          run();
        } catch (error) {
          out.push(`<effect error: ${error.message}>`);
        }
      }
      hookState = saved.state;
      hookIndex = saved.index;
      pendingEffects = saved.effects;
      return;
    }
    walk(element.children, out, depth);
  }

  const findElement = (element, match, depth = 0) => {
    if (!element || typeof element !== "object" || depth > 16) return undefined;
    if (Array.isArray(element)) {
      for (const child of element) {
        const hit = findElement(child, match, depth);
        if (hit) return hit;
      }
      return undefined;
    }
    if (match(element)) return element;
    for (const child of element.children || []) {
      const hit = findElement(child, match, depth + 1);
      if (hit) return hit;
    }
    return undefined;
  };

  const fetchBefore = globalThis.fetch;
  stub(async () => jsonResponse(200, overviewPayload));

  const first = renderSection(registration[2], { close() {} });
  check(
    "Tools section renders all three tabs",
    ["API 管理", "搜索明细", "用量汇总"].every((label) => first.text.includes(label)),
    first.text.slice(0, 100),
  );
  check("no component threw while rendering", !first.text.includes("render error") && !first.text.includes("effect error"), first.text.slice(0, 200));

  await new Promise((resolve) => setTimeout(resolve, 25));
  const second = renderSection(registration[2], { close() {} });
  check(
    "API panel shows the credential it resolved through the bridge",
    second.text.includes("已设置") &&
      second.text.includes("••••••") &&
      second.text.includes("https://api.deepseek.com") &&
      second.text.includes("DEEPSEEK_API_KEY"),
    second.text.slice(0, 160),
  );

  // The API tab has to answer "is this plugin actually in effect?" — a wrong
  // answer is worse than none, so every state is exercised.
  const renderWithApi = async (patch) => {
    stub(async () => jsonResponse(200, { ...overviewPayload, api: { ...overviewPayload.api, ...patch } }));
    renderSection(registration[2], { close() {} });
    await new Promise((resolve) => setTimeout(resolve, 25));
    return renderSection(registration[2], { close() {} });
  };
  const liveStrip = await renderWithApi({});
  check("API panel says the plugin is in effect", liveStrip.text.includes("生效中"), liveStrip.text.slice(0, 90));
  const halfStrip = await renderWithApi({ searchProvider: "ddg" });
  check(
    "API panel reports a partial takeover",
    halfStrip.text.includes("部分生效") && halfStrip.text.includes("ddg"),
    halfStrip.text.slice(0, 140),
  );
  const deadStrip = await renderWithApi({ searchProvider: "ddg", fetchProvider: "http" });
  check(
    "API panel reports it is not in effect",
    deadStrip.text.includes("未生效") && deadStrip.text.includes("http"),
    deadStrip.text.slice(0, 160),
  );
  const noKeyStrip = await renderWithApi({ configured: false });
  check("API panel warns when it holds no key", noKeyStrip.text.includes("没有密钥"), noKeyStrip.text.slice(0, 160));
  stub(async () => jsonResponse(200, overviewPayload));

  const tabButton = findElement(second.tree, (el) => el.type === "button" && JSON.stringify(el.children).includes("搜索明细"));  check("the search-detail tab is wired to a handler", typeof tabButton?.props?.onClick === "function");
  tabButton.props.onClick();
  const third = renderSection(registration[2], { close() {} });
  check(
    "search detail lists the recorded calls with their status",
    third.text.includes("DeepSeek V4 官方公告") && third.text.includes("成功") && third.text.includes("失败"),
    third.text.slice(0, 200),
  );

  const usageButton = findElement(third.tree, (el) => el.type === "button" && JSON.stringify(el.children).includes("用量汇总"));
  usageButton?.props?.onClick?.();
  const fourth = renderSection(registration[2], { close() {} });
  check(
    "usage summary renders the totals and the record file",
    fourth.text.includes("成功率") && fourth.text.includes("usage.json") && fourth.text.includes("2000"),
    fourth.text.slice(0, 200),
  );
  // The page ships two languages; Simplified Chinese is the default and
  // English must be one click away, with no leftover Traditional strings.
  const enButton = findElement(fourth.tree, (el) => el.type === "button" && JSON.stringify(el.children) === '["English"]');
  check("the header offers a 中文 / English switch", Boolean(enButton), fourth.text.slice(0, 60));
  enButton?.props?.onClick?.();
  const english = renderSection(registration[2], { close() {} });
  check(
    "switching to English relabels the page",
    english.text.includes("Success rate") && english.text.includes("Record file") && english.text.includes("Reset stats"),
    english.text.slice(0, 200),
  );
  const zhButton = findElement(english.tree, (el) => el.type === "button" && JSON.stringify(el.children) === '["中文"]');
  zhButton?.props?.onClick?.();
  const back = renderSection(registration[2], { close() {} });
  check(
    "switching back restores Simplified Chinese",
    back.text.includes("成功率") && back.text.includes("记录文件") && !back.text.includes("檔案"),
    back.text.slice(0, 200),
  );
  globalThis.fetch = fetchBefore;
}

// ---- 7. optional end-to-end run through the real providers ----------------

const liveKeyArg = process.argv.includes("--live") ? process.argv[process.argv.indexOf("--live") + 1] : null;
if (liveKeyArg) {
  const liveCtx = makeCtx({ apiKey: liveKeyArg });
  plugin.apply(liveCtx, {});
  const liveSearch = liveCtx.web.searchProviders.get("deepseek-tools");
  const liveFetch = liveCtx.web.fetchProviders.get("deepseek-tools");

  const liveResult = await liveSearch.search({ query: "DeepSeek V4 上下文长度", maxResults: 3 });
  console.log(`\nLIVE search → ${liveResult.sources.length} source(s)`);
  for (const source of liveResult.sources) {
    console.log(`  - ${source.title}\n    ${source.url}\n    snippet(${source.snippet?.length ?? 0} chars): ${String(source.snippet).slice(0, 90)}…`);
  }
  check("live search returns mapped sources with a model-ready snippet", liveResult.sources.length > 0 && liveResult.sources.every((s) => s.url && s.title && typeof s.snippet === "string"));

  const livePage = await liveFetch.fetch({ url: liveResult.sources[0].url });
  console.log(`\nLIVE fetch → HTTP ${livePage.statusCode}, ${livePage.body.content.length} chars of markdown`);
  console.log(`  head: ${livePage.body.content.slice(0, 160).replace(/\n/g, " ⏎ ")}`);
  check("live fetch returns markdown text", livePage.statusCode === 200 && livePage.body.kind === "text" && livePage.body.content.length > 200);

  let missing = null;
  try {
    await liveFetch.fetch({ url: "https://example.com/" });
  } catch (error) {
    missing = error;
  }
  console.log(`\nLIVE fetch of example.com → ${missing ? `error: ${missing.message}` : "served"}`);
  check("live fetch of a real page does not crash the provider", missing === null || typeof missing.message === "string");
}

const liveKey = process.argv.includes("--probe-raw") ? process.argv[process.argv.indexOf("--probe-raw") + 1] : null;
if (liveKey) {
  const response = await realFetch("https://api.deepseek.com/v1/tools/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${liveKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "DeepSeek V4", count: 2 }),
  });
  const text = await response.text();
  console.log(`\nLIVE probe: HTTP ${response.status} — ${text.slice(0, 300)}`);
  check(
    "request format is accepted (200 = ok, 401 = auth only, 402 = balance)",
    [200, 401, 402].includes(response.status),
    `HTTP ${response.status}`,
  );
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
