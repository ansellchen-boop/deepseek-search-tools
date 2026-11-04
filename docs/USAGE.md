# Usage

This file is generated from `lib/usage-guide.js`; the Settings page's Usage panel renders the same content.

## What this plugin does

This is a DSH plugin that registers one search provider and one fetch provider (both under the id deepseek-tools) to take over the two tools a model can call: web_search (search the web) and web_fetch (read a page's body).

A tool call reaches this plugin only when the Harness web config points searchProvider / fetchProvider at deepseek-tools. When it is not in effect, the previous provider keeps serving and this plugin neither sees the call nor records it.

Each call that enters the plugin goes to one "backend" (a search or fetch service you configured), is normalized to the tool's shape, and is recorded locally as one usage entry. This guide is written for non-developers: every term is explained where it first appears.

## Terms

| Term | Meaning |
| --- | --- |
| backend | One concrete vendor entry: which service, which address, which credential reference, and what priority. Each row in the table is one backend. |
| type | Decides the request protocol and required fields. For example zhipu-web-search speaks Zhipu's web_search protocol, while searxng speaks a SearXNG JSON search endpoint. |
| priority | Smaller numbers are tried first. The automatic chain runs in ascending priority, and ties keep the configured order. |
| automatic chain | The default when nothing is pinned: try each backend in priority order and silently move on when one fails; the caller only sees the final outcome. |
| pin | Hard-wires searchBackend or fetchBackend to one backend id. Only that row runs, and its failure is reported as the real error with no fallback. |
| credential reference (apiKeyEnv) | The "name" of a key in the config, such as ZHIPU_API_KEY. The value itself lives in the DSH credential vault; the config never contains plaintext. |
| built-in compatibility chain (legacy) | Rows synthesized under the 0.1.0 rules when searchBackends / fetchBackends are empty (search: Zhipu when a key resolves, then DeepSeek; fetch: DeepSeek, then the built-in HTTP fetcher). They are not written to the config, cannot be toggled, and become editable only after you add them explicitly with "Add backend". |
| accounting | Every call is recorded in the local usage.json: the query or URL, which backend answered, latency, success, and result count. Nothing is uploaded. |

## The full path of one web_search

1. The model decides to call web_search and the Harness executes the tool.
2. The tool hands the request to whoever is registered as ctx.web.searchProvider; it enters this plugin only when that is deepseek-tools.
3. The plugin runs runSearch: it reads searchBackends, synthesizing the 0.1.0 compatibility chain when the list is empty.
4. It tries rows in ascending priority, considering only enabled rows.
5. The first backend that succeeds returns immediately; later backends are not called.
6. A failing backend falls through silently to the next one; rows without a usable credential are skipped instead of attempted.
7. Only when every backend fails does the model receive the last error.
8. If searchBackend is pinned to an id, only that row runs; a failure is returned as the real error and never retried.

web_fetch goes through fetchProvider / runFetch with the same rules. The page's Test button temporarily pins the row under test, so a failure shows that backend's own error rather than a fallback result.

## Where keys live

Key values live only in the DSH credential vault: the refs section of .credentials.yaml. The config file (cordis.patch.yml) stores just the reference name (apiKeyEnv, e.g. ZHIPU_API_KEY), never plaintext.

Lookup order: credential vault > environment variable > .env (loaded into the environment at launch). The page and its routes only show "set / not set" plus the fixed mask ••••••; no key fragment is ever echoed.

- Click the "Key" cell of a row to save or clear that row's key. The input is write-only and is cleared after a successful save.
- When the environment variable for that reference already exists, the input hints that leaving it blank uses the environment credential.
- Rows whose type needs no key (for example http and jina-reader) show "No key needed"; the cell is not clickable and has no key panel.

## Three quick examples

### Example 1: Zhipu web search

Use this when Zhipu should be tried before DeepSeek. Click "Add backend" in the search table and fill in:

| Field | Value |
| --- | --- |
| Backend type | Zhipu web search (zhipu-web-search) |
| Backend id | zhipu (generated; keep it) |
| Priority | 1 |
| Endpoint | https://open.bigmodel.cn |
| Path | /api/paas/v4/web_search |
| Search engine | search_std |
| Credential reference | ZHIPU_API_KEY |
| Key | Click that row's Key cell, paste the Zhipu API key and save |

After saving, the row badge turns to "set" with the mask; Test probes that row directly (the test pins it temporarily).

### Example 2: self-hosted SearXNG

| Field | Value |
| --- | --- |
| Backend type | SearXNG |
| Backend id | searxng |
| Priority | 1 |
| Endpoint | http://127.0.0.1:8888 |
| Path | /search |
| Key | No key needed; the row says so |

The SearXNG instance must enable JSON output (search.formats includes json in settings.yml), otherwise it answers 403 or an HTML page.

### Example 3: an OpenAI /responses compatible relay

| Field | Value |
| --- | --- |
| Backend type | OpenAI Responses |
| Backend id | relay |
| Priority | 2 |
| Endpoint | https://your-relay.example.com/v1 |
| Path | /responses |
| Model | gpt-4o-mini (use what the relay supports) |
| Credential reference | RELAY_API_KEY |
| Key | Click that row's Key cell and save the relay's key |

The relay must implement the OpenAI Responses protocol's web_search tool; the plugin aggregates output_text and url_citation annotations from the returned output.

All three can be done on the Settings page with "Add backend", or by writing the same fields into searchBackends / fetchBackends in cordis.patch.yml; changes hot-reload.

## Common questions

**Q: Why is my Zhipu search quota not being used?**

The request never reached this plugin: either searchProvider does not point at deepseek-tools, or searchBackend pins another row, or the Zhipu row is disabled. Check the effect strip on the API tab first, then look for a record on the Searches tab; no record means the call never went through this plugin, so Zhipu was never billed.

**Q: The test succeeds, but real searches return nothing.**

Test uses one fixed query to verify connectivity ("DeepSeek" for search, https://example.com for fetch); it does not judge query quality. Check the Searches tab: a record with 0 results means the backend returned nothing (change the query or engine); no record at all means the model never called the tool or the provider is not in effect. Zhipu also truncates queries to 70 characters.

**Q: What do 429 and 1113 mean?**

429 means too many requests or rate limiting; Zhipu's 1113 usually means the quota or entitlement is insufficient. Slow down, switch keys or backends, and confirm the plan balance.

**Q: Do config changes need a restart?**

Backend lists and keys hot-reload: saves answer with the fresh state and the page refreshes immediately. Only changing who owns web_search / web_fetch (searchProvider / fetchProvider on the web row) or upgrading the plugin itself needs a Harness restart.

**Q: What should I do before uninstalling?**

First point searchProvider / fetchProvider on the web row away from deepseek-tools (or clear them). Otherwise the Harness keeps referencing a provider that no longer exists and web_search / web_fetch fail outright.

## Security

- Keys are write-only: the save route accepts a value, read routes return presence and a fixed mask, and neither logs nor error messages ever contain plaintext.
- Queries leave this machine: search text is sent to the configured backend (Zhipu, Tavily, your own relay, and so on). Do not put sensitive data in a query.
- Accounting stays local: usage.json records the query or URL, latency and outcome, and is never uploaded; it can be cleared on the Usage tab.
- .credentials.yaml is managed by DSH; never commit or share it.
- Deleting a backend does not delete its stored key; use Clear in that row's key panel when you want it gone.
