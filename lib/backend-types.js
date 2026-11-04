/**
 * v0.3.0 backend type catalog.
 *
 * The Settings → Tools page renders its "add backend" form from this list, so
 * every `fields[].key` here is a config key the adapters in `lib/index.js`
 * already read — nothing invented. `label` / `help` are i18n message keys: the
 * browser half resolves them through its own zh/en table, which keeps the host
 * free of hard-coded UI copy.
 *
 * Required is deliberately limited to three facts: an endpoint (`baseUrl`),
 * a protocol/engine choice (`model` / `engine` where the vendor needs one), and
 * the credential reference name (`apiKeyEnv`). A reference with an environment
 * default may stay empty — the adapter falls back to that default, so leaving
 * the form field blank still works.
 *
 * SECRET VALUES NEVER LIVE HERE. `apiKeyEnv` names a credential in the
 * credentials service; the key itself is written through `/backends/key`.
 */

/** One entry per adapter type. `kind` is "search", "fetch", or "both". */
export const BACKEND_TYPES = [
  {
    type: "deepseek-official",
    label: "type.deepseek-official",
    kind: "both",
    help: "help.type.deepseek-official",
    fields: [
      {
        key: "apiKeyEnv",
        label: "field.apiKeyEnv",
        required: false,
        secret: false,
        placeholder: "DEEPSEEK_API_KEY",
        default: "DEEPSEEK_API_KEY",
        help: "help.apiKeyEnvDefault",
      },
      {
        key: "baseUrl",
        label: "field.baseUrl",
        required: false,
        secret: false,
        placeholder: "https://api.deepseek.com",
        default: "https://api.deepseek.com",
        help: "help.baseUrl",
      },
      {
        key: "path",
        label: "field.path",
        required: false,
        secret: false,
        placeholder: "/v1/tools/search",
        default: "",
        help: "help.pathDeepseek",
      },
    ],
  },
  {
    type: "zhipu-web-search",
    label: "type.zhipu-web-search",
    kind: "search",
    help: "help.type.zhipu-web-search",
    fields: [
      {
        key: "apiKeyEnv",
        label: "field.apiKeyEnv",
        required: false,
        secret: false,
        placeholder: "ZHIPU_API_KEY",
        default: "ZHIPU_API_KEY",
        help: "help.apiKeyEnvDefault",
      },
      {
        key: "baseUrl",
        label: "field.baseUrl",
        required: false,
        secret: false,
        placeholder: "https://open.bigmodel.cn",
        default: "https://open.bigmodel.cn",
        help: "help.baseUrl",
      },
      {
        key: "path",
        label: "field.path",
        required: false,
        secret: false,
        placeholder: "/api/paas/v4/web_search",
        default: "/api/paas/v4/web_search",
        help: "help.path",
      },
      {
        key: "engine",
        label: "field.engine",
        required: false,
        secret: false,
        placeholder: "search_std",
        default: "search_std",
        help: "help.engine",
      },
    ],
  },
  {
    type: "openai-responses",
    label: "type.openai-responses",
    kind: "search",
    help: "help.type.openai-responses",
    fields: [
      {
        key: "baseUrl",
        label: "field.baseUrl",
        required: true,
        secret: false,
        placeholder: "https://api.dimleap.cn/v1",
        default: "",
        help: "help.baseUrl",
      },
      {
        key: "apiKeyEnv",
        label: "field.apiKeyEnv",
        required: true,
        secret: false,
        placeholder: "DIMLEAP_API_KEY",
        default: "",
        help: "help.apiKeyEnv",
      },
      {
        key: "path",
        label: "field.path",
        required: false,
        secret: false,
        placeholder: "/responses",
        default: "/responses",
        help: "help.path",
      },
      {
        key: "model",
        label: "field.model",
        required: false,
        secret: false,
        placeholder: "deepseek-v4.1-flash-1017",
        default: "",
        help: "help.model",
      },
    ],
  },
  {
    type: "tavily",
    label: "type.tavily",
    kind: "search",
    help: "help.type.tavily",
    fields: [
      {
        key: "apiKeyEnv",
        label: "field.apiKeyEnv",
        required: true,
        secret: false,
        placeholder: "TAVILY_API_KEY",
        default: "",
        help: "help.apiKeyEnv",
      },
      {
        key: "baseUrl",
        label: "field.baseUrl",
        required: false,
        secret: false,
        placeholder: "https://api.tavily.com",
        default: "https://api.tavily.com",
        help: "help.baseUrl",
      },
      {
        key: "path",
        label: "field.path",
        required: false,
        secret: false,
        placeholder: "/search",
        default: "/search",
        help: "help.path",
      },
    ],
  },
  {
    type: "tavily-extract",
    label: "type.tavily-extract",
    kind: "fetch",
    help: "help.type.tavily-extract",
    fields: [
      {
        key: "apiKeyEnv",
        label: "field.apiKeyEnv",
        required: true,
        secret: false,
        placeholder: "TAVILY_API_KEY",
        default: "",
        help: "help.apiKeyEnv",
      },
      {
        key: "baseUrl",
        label: "field.baseUrl",
        required: false,
        secret: false,
        placeholder: "https://api.tavily.com",
        default: "https://api.tavily.com",
        help: "help.baseUrl",
      },
      {
        key: "path",
        label: "field.path",
        required: false,
        secret: false,
        placeholder: "/extract",
        default: "/extract",
        help: "help.path",
      },
    ],
  },
  {
    type: "searxng",
    label: "type.searxng",
    kind: "search",
    help: "help.type.searxng",
    fields: [
      {
        key: "baseUrl",
        label: "field.baseUrl",
        required: true,
        secret: false,
        placeholder: "http://127.0.0.1:8080",
        default: "",
        help: "help.baseUrl",
      },
      {
        key: "path",
        label: "field.path",
        required: false,
        secret: false,
        placeholder: "/search",
        default: "/search",
        help: "help.path",
      },
    ],
  },
  {
    type: "brave",
    label: "type.brave",
    kind: "search",
    help: "help.type.brave",
    fields: [
      {
        key: "apiKeyEnv",
        label: "field.apiKeyEnv",
        required: true,
        secret: false,
        placeholder: "BRAVE_API_KEY",
        default: "",
        help: "help.apiKeyEnv",
      },
      {
        key: "baseUrl",
        label: "field.baseUrl",
        required: false,
        secret: false,
        placeholder: "https://api.search.brave.com",
        default: "https://api.search.brave.com",
        help: "help.baseUrl",
      },
      {
        key: "path",
        label: "field.path",
        required: false,
        secret: false,
        placeholder: "/res/v1/web/search",
        default: "/res/v1/web/search",
        help: "help.path",
      },
    ],
  },
  {
    type: "jina-reader",
    label: "type.jina-reader",
    kind: "fetch",
    help: "help.type.jina-reader",
    fields: [
      {
        key: "apiKeyEnv",
        label: "field.apiKeyEnv",
        required: false,
        secret: false,
        placeholder: "JINA_API_KEY",
        default: "",
        help: "help.apiKeyEnvOptional",
      },
      {
        key: "baseUrl",
        label: "field.baseUrl",
        required: false,
        secret: false,
        placeholder: "https://r.jina.ai",
        default: "https://r.jina.ai",
        help: "help.baseUrl",
      },
    ],
  },
  {
    type: "http",
    label: "type.http",
    kind: "fetch",
    help: "help.type.http",
    fields: [],
  },
];

const BY_TYPE = new Map(BACKEND_TYPES.map((entry) => [entry.type, entry]));

/** One catalog entry, or undefined for an unknown type. */
export function findBackendType(type) {
  return BY_TYPE.get(String(type ?? "").trim());
}

/** Catalog entries that can serve one half (`both` included). */
export function backendTypesForKind(kind) {
  return BACKEND_TYPES.filter((entry) => entry.kind === "both" || entry.kind === kind);
}

/** The credential reference a type uses when its row leaves `apiKeyEnv` empty. */
export function defaultKeyRef(type) {
  const field = findBackendType(type)?.fields.find((item) => item.key === "apiKeyEnv");
  return String(field?.default ?? "").trim();
}

/**
 * Required fields still missing, applying each field's default. A field with a
 * non-empty default can legitimately stay blank in the row.
 * @returns array of field keys (empty when the row is complete).
 */
export function missingRequiredFields(meta, values) {
  if (!meta) return [];
  const missing = [];
  for (const field of meta.fields) {
    if (!field.required) continue;
    const value = String(values?.[field.key] ?? "").trim() || String(field.default ?? "").trim();
    if (!value) missing.push(field.key);
  }
  return missing;
}
