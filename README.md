# deepseek-search-tools

DeepSeek Search / Fetch as DSH web providers, plus a configuration-driven
multi-vendor backend list.

The plugin registers one search provider and one fetch provider under the id
`deepseek-tools`, so the shipped `web_search` / `web_fetch` tools answer from a
dedicated search API instead of a full model turn.

* `POST https://api.deepseek.com/v1/tools/search`
* `POST https://api.deepseek.com/v1/tools/fetch`

Since 0.2.0 `searchBackends` and `fetchBackends` each carry their own vendor
list, so search and fetch can use different vendors. Every backend has its own
key source, timeout, priority and switch, and the chain is either automatic
(priority order, silent fallback) or pinned (one backend, real error on failure).

**No new configuration means the 0.1.0 behavior, unchanged**: DeepSeek for
search, DeepSeek then the plain-HTTP fetcher for fetch. All 0.1.0 config keys
and bridge routes are still there.

## Documentation

* [使用说明（中文）](docs/USAGE.zh.md)
* [Usage guide (English)](docs/USAGE.md)

Both files are generated from `lib/usage-guide.js` (`node scripts/build-usage-docs.mjs`);
the Settings page's **Usage guide** panel renders the same structure.

## Requirements

* Node >= 20 (the plugin uses the built-in `fetch`, `AbortSignal.timeout` and
  `AbortSignal.any`; there are no other runtime dependencies)
* The only dependency is `@deepseek-ai/schemastery`

## Configuration

### Selection

| Key | Default | Meaning |
| --- | --- | --- |
| `searchBackends` | `[]` | Search vendor rows. Empty means the 0.1.0 chain. |
| `fetchBackends` | `[]` | Fetch vendor rows. Empty means the 0.1.0 chain. |
| `searchBackend` | `""` | Pin a search backend `id`. Empty = automatic chain. |
| `fetchBackend` | `""` | Pin a fetch backend `id`. Independent from `searchBackend`. |

Automatic chain: enabled rows run in ascending `priority`. A failure falls
through to the next row **only when that row has a usable credential source**;
the attempt is silent to the caller but logged as
`web_search backend=<id>-fallback-<next> reason=<error>`. An aborted request
never spends a second hop.

Pin: only that row runs. Its failure is reported as the real error and is never
silently retried.

### Backend rows

| Field | Default | Meaning |
| --- | --- | --- |
| `id` | required | Unique name, shown in logs, usage and the Settings page. |
| `type` | required | Vendor adapter, see the table below. |
| `enabled` | `true` | Disabled rows are skipped by the automatic chain. |
| `priority` | `100` | Smaller runs first. |
| `apiKey` | `""` | Literal key (`secret` role). Wins over `apiKeyEnv`. |
| `apiKeyEnv` | `""` | Credential reference resolved through the credentials service, then the process environment. |
| `baseUrl` | `""` | Endpoint root; empty uses the type default (`deepseek-official` falls back to the legacy `baseUrl` key). |
| `path` | `""` | Path under `baseUrl`; empty uses the type default. |
| `model` | `""` | `openai-responses` only. |
| `engine` | `""` | `zhipu-web-search` only; defaults to `search_std` (`search_pro`, ...). |
| `extra` | — | Vendor-specific knobs, passed through to the adapter when it reads them. |
| `timeoutMs` | global `timeoutMs` | Per-row timeout override. |

### Vendor support

| `type` | Half | Endpoint | Key |
| --- | --- | --- | --- |
| `deepseek-official` | search + fetch | `{baseUrl}/v1/tools/search`, `/v1/tools/fetch` | required |
| `zhipu-web-search` | search | `{baseUrl}/api/paas/v4/web_search` (query capped at 70 chars) | required |
| `openai-responses` | search | `{baseUrl}/responses` with `tools: [{ type: "web_search" }]` | required, `model` required |
| `tavily` | search | `https://api.tavily.com/search` | required |
| `searxng` | search | `{baseUrl}/search?format=json` (the instance must enable the JSON API) | none |
| `brave` | search | `https://api.search.brave.com/res/v1/web/search` | required |
| `jina-reader` | fetch | `https://r.jina.ai/{encodeURIComponent(url)}` | optional |
| `tavily-extract` | fetch | `https://api.tavily.com/extract` | required |
| `http` | fetch | the shipped plain-HTTP fetcher (`ctx.web.fetchProviders.get("http")`) | none |

Search results are normalized to `{ sources: [{ title, url, snippet? }], truncated }`
with `maxSourceChars` clipping; fetch results to
`{ url, statusCode, body: { kind: "text", content }, truncated }`.

### 0.1.0 keys (unchanged)

| Key | Default |
| --- | --- |
| `apiKey` / `apiKeyEnv` | `""` / `DEEPSEEK_API_KEY` |
| `baseUrl` / `searchPath` / `fetchPath` | `https://api.deepseek.com` / `/v1/tools/search` / `/v1/tools/fetch` |
| `localization` / `includeContent` / `fetchFallback` | `""` / `false` / `true` |
| `takeOverSearch` / `takeOverFetch` | `true` / `true` |
| `timeoutMs` / `maxSourceChars` | `60000` / `4000` |
| `usageDataDir` / `usageLimit` / `usageDays` / `enableSettingsPage` | `""` / `2000` / `7` / `true` |

Every 0.1.0 key still works exactly as before and only feeds the
`deepseek-official` backend (the DeepSeek side of the legacy chain). Vendor
keys for other backend types are never top-level: each backend row carries its
own `apiKey` / `apiKeyEnv` / `baseUrl` / `path` / `engine`.

## Examples

### 1. Automatic chain (fallback)

Zhipu first, DeepSeek as the fallback; search and fetch both use this list.

```yaml
- id: web-search-deepseek-tools
  name: deepseek-search-tools
  config:
    searchBackends:
      - id: zhipu
        type: zhipu-web-search
        priority: 1
        apiKeyEnv: ZHIPU_API_KEY
        engine: search_std
      - id: deepseek
        type: deepseek-official
        priority: 2
        apiKeyEnv: DEEPSEEK_API_KEY
    # searchBackend stays "" -> automatic chain with silent fallback
```

### 2. Pin, with different vendors for search and fetch

Search is pinned to Tavily (a failure is reported, not retried); fetching is
pinned to Jina Reader with no key, and falls back to plain HTTP when Jina is
unreachable only if you leave `fetchBackend` empty.

```yaml
- id: web-search-deepseek-tools
  name: deepseek-search-tools
  config:
    searchBackends:
      - id: tavily
        type: tavily
        priority: 1
        apiKeyEnv: TAVILY_API_KEY
    fetchBackends:
      - id: jina
        type: jina-reader
        priority: 1
      - id: http
        type: http
        priority: 2
    searchBackend: tavily   # pin: real error, no fallback
    fetchBackend: jina      # pin: real error, no fallback
```

To keep the fetch fallback, clear `fetchBackend` and keep both rows; the
automatic chain tries Jina first and HTTP second.

## Settings → Tools page

The bridge (`POST /api/deepseek-search-tools/{overview,test,backend-types,backends/*,usage-guide,key-set,key-unset,usage-clear}`,
loopback only) keeps its 0.1.0 routes. In 0.2.0 and later:

* `overview` lists `searchBackends` / `fetchBackends` (`id`, `type`, `enabled`,
  `priority`, `configured`, `keySource`: `literal` / `env` / `none`) alongside
  every 0.1.0 field, and the active pins.
* `test` accepts `{ kind: "search" | "fetch", backend?, query?, url? }`.
  `backend` pins that row for the probe; defaults keep the 0.1.0 behavior
  (query `"DeepSeek"`, one result, `https://example.com` for fetch).
* `GET /backend-types` returns the backend type catalog the Add form renders.
* `GET /usage-guide` returns the structured usage guide (7 sections, zh + en).
* The page shows one table per half with a per-row **Test** button, an enable
  switch, Edit, Delete and a per-row key panel (see below).
* `usage.json` records now carry `backend`; records written before 0.2.0 have
  no such field and the page shows `—`.

Keys are never logged in full and never returned unmasked.

## Backend management UI

Since 0.3.0 the Settings → Tools page can add, edit, enable/disable and delete
backends without touching `cordis.patch.yml` by hand.

* Each table row carries an **enable switch**, **Edit** and **Delete** (with a
  confirmation). The table header carries **Add backend**: pick a type first,
  then the form renders that type's own field list with instant required-field
  validation.
* Rows synthesized for the 0.1.0 chain show a **built-in** badge instead of a
  switch: they are read-only until you add a real list (writing the list drops
  the synthesized rows).
* Search and fetch are independent: `searchBackends` and `fetchBackends` are
  edited in their own tables, and a type is only offered for its own half.
* **Test** reports the backend that actually answered
  (`{ ok, backend, results, ms, sources }`), so a fallback hop is visible.
* Keys live in the credentials service, never in the patch: the per-row key
  panel is write-only (`POST` / `DELETE /backends/key`), the page only ever
  shows whether a reference is set, and a row whose `apiKeyEnv` is absent from
  the environment says so instead of demanding a key.

Bridge routes used by the UI (loopback only, same registration as 0.1.0):

| Route | Body | Notes |
| --- | --- | --- |
| `GET /backend-types` | — | Type catalog: `{ type, label, kind, fields: [{ key, label, required, secret, placeholder, default, help }] }`. `label` / `help` are i18n keys resolved by the page. |
| `POST /backends/add` | `{ kind, type, fields }` | Appends one row; `id` defaults to the type and gets a suffix when taken. |
| `POST /backends/update` | `{ kind, index, fields }` | Edits one row in place; only supplied fields change. |
| `POST /backends/remove` | `{ kind, index }` | Removes one row. |
| `POST /backends/toggle` | `{ kind, index, enabled }` | `enabled` must be a boolean. |
| `POST /backends/key` | `{ ref, value }` | Forwards to `credentials.set`; the value is never echoed. |
| `DELETE /backends/key` | `{ ref }` | Forwards to `credentials.unset`. |

Every write route answers with the fresh `overview`, so the page never
reconstructs state locally.

**Write path.** Writes go through `ctx.configEditor.edit(entry, (current, inherited) => next)`
for the entry whose `options.id` is `web-search-deepseek-tools`; the change
returns the plugin's whole config with only `searchBackends` / `fetchBackends`
replaced. Nothing is parsed, re-serialized or rewritten wholesale, so YAML
comments and `!!js` expressions elsewhere in the profile patch survive. An
empty list drops the key instead of storing `[]`, which keeps the "not
configured" semantics (the 0.1.0 chain is synthesized again).

If `configEditor` is not mounted, every write route answers `501` with a
message naming `cordis.patch.yml`, and the file is left untouched.

## Compatibility

* Provider id `deepseek-tools`, plugin id `web-search-deepseek-tools` and the
  `exports` map are unchanged.
* Legacy keys, bridge routes and the `usage.json` path are unchanged; old
  records stay readable.
* Zero new runtime dependencies; `engines.node` unchanged.
* With no new keys the 0.1.0 chain, its fallback conditions and its error
  shapes (including the wrapped 404) are preserved.

## License

MIT
