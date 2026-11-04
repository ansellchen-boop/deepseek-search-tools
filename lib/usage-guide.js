/**
 * The one source of truth for the Settings page's "使用说明" panel and the
 * Markdown docs under `docs/USAGE*.md`.
 *
 * Both renderers walk the same section/block array, so the guide is written
 * exactly once. Text values are `{ zh, en }` pairs; `code` blocks are
 * language-neutral strings. A block is one of:
 *
 *   { type: "p",     text }
 *   { type: "h3",    text }
 *   { type: "ul",    items: [text] }
 *   { type: "ol",    items: [text] }
 *   { type: "table", head: [text], rows: [[text]] }
 *   { type: "code",  lang, text }
 *   { type: "faq",   items: [{ q, a }] }
 */

const zh = (zhText, enText) => ({ zh: zhText, en: enText });

export const USAGE_GUIDE = {
  updated: "2026-11-04",
  sections: [
    {
      id: "what",
      title: zh("这个插件做什么", "What this plugin does"),
      blocks: [
        {
          type: "p",
          text: zh(
            "本插件是一个 DSH 插件，向 Harness 注册一个搜索提供者和一个抓取提供者（id 都是 deepseek-tools），用来接管模型可用的两个工具：web_search（搜索网页）和 web_fetch（抓取网页正文）。",
            "This is a DSH plugin that registers one search provider and one fetch provider (both under the id deepseek-tools) to take over the two tools a model can call: web_search (search the web) and web_fetch (read a page's body).",
          ),
        },
        {
          type: "p",
          text: zh(
            "只有在 Harness 的 web 配置把 searchProvider / fetchProvider 指向 deepseek-tools 时，工具调用才会进入本插件；没有接管时，调用仍由原来的提供者处理，本插件完全不参与，也不会计账。",
            "A tool call reaches this plugin only when the Harness web config points searchProvider / fetchProvider at deepseek-tools. When it is not in effect, the previous provider keeps serving and this plugin neither sees the call nor records it.",
          ),
        },
        {
          type: "p",
          text: zh(
            "每次进入本插件的调用都会发给一个「后端」（你配置的某个搜索或抓取服务），再把结果转成工具要求的格式返回，并在本机记录一笔用量。本文写给非开发者：术语第一次出现时都会用中文解释。",
            "Each call that enters the plugin goes to one \"backend\" (a search or fetch service you configured), is normalized to the tool's shape, and is recorded locally as one usage entry. This guide is written for non-developers: every term is explained where it first appears.",
          ),
        },
      ],
    },
    {
      id: "terms",
      title: zh("名词解释", "Terms"),
      blocks: [
        {
          type: "table",
          head: [zh("术语", "Term"), zh("意思", "Meaning")],
          rows: [
            [
              zh("后端（backend）", "backend"),
              zh(
                "一条具体的供应商配置：用哪家服务、走哪个地址、用哪个密钥引用、优先级多少。表格里的每一行就是一个后端。",
                "One concrete vendor entry: which service, which address, which credential reference, and what priority. Each row in the table is one backend.",
              ),
            ],
            [
              zh("类型（type）", "type"),
              zh(
                "决定请求协议和必填字段。例如 zhipu-web-search 走智谱的 web_search 协议，searxng 走 SearXNG 的 JSON 搜索接口。",
                "Decides the request protocol and required fields. For example zhipu-web-search speaks Zhipu's web_search protocol, while searxng speaks a SearXNG JSON search endpoint.",
              ),
            ],
            [
              zh("优先级（priority）", "priority"),
              zh(
                "数字越小越先尝试。自动链按优先级从小到大排队，同优先级按配置顺序。",
                "Smaller numbers are tried first. The automatic chain runs in ascending priority, and ties keep the configured order.",
              ),
            ],
            [
              zh("自动链（automatic chain）", "automatic chain"),
              zh(
                "没有 pin 时的默认模式：按优先级逐个尝试，某个后端失败就静默换下一个，调用方只会看到最终结果。",
                "The default when nothing is pinned: try each backend in priority order and silently move on when one fails; the caller only sees the final outcome.",
              ),
            ],
            [
              zh("pin（固定）", "pin"),
              zh(
                "把 searchBackend 或 fetchBackend 写死成某个后端 id。此时只走那一条，失败直接返回真实错误，不回退。",
                "Hard-wires searchBackend or fetchBackend to one backend id. Only that row runs, and its failure is reported as the real error with no fallback.",
              ),
            ],
            [
              zh("凭据引用（apiKeyEnv）", "credential reference (apiKeyEnv)"),
              zh(
                "密钥在配置里的“名字”，例如 ZHIPU_API_KEY。真正的密钥值存在 DSH 凭据中心，配置里永远不写明文。",
                "The \"name\" of a key in the config, such as ZHIPU_API_KEY. The value itself lives in the DSH credential vault; the config never contains plaintext.",
              ),
            ],
            [
              zh("内置兼容链（legacy）", "built-in compatibility chain (legacy)"),
              zh(
                "searchBackends / fetchBackends 为空时，插件按 0.1.0 规则合成出来的行（搜索：智谱有密钥时智谱→DeepSeek；抓取：DeepSeek→内置 HTTP）。这些行不写进配置，不能开关，只能通过“添加后端”显式添加后再自定义。",
                "Rows synthesized under the 0.1.0 rules when searchBackends / fetchBackends are empty (search: Zhipu when a key resolves, then DeepSeek; fetch: DeepSeek, then the built-in HTTP fetcher). They are not written to the config, cannot be toggled, and become editable only after you add them explicitly with \"Add backend\".",
              ),
            ],
            [
              zh("记账（accounting）", "accounting"),
              zh(
                "每次调用都会在本机 usage.json 里记一笔：查询词或网址、命中哪个后端、耗时、成功与否、结果数。不上传。",
                "Every call is recorded in the local usage.json: the query or URL, which backend answered, latency, success, and result count. Nothing is uploaded.",
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "path",
      title: zh("一次 web_search 的完整路径", "The full path of one web_search"),
      blocks: [
        {
          type: "ol",
          items: [
            zh(
              "模型决定调用 web_search，Harness 执行这个工具。",
              "The model decides to call web_search and the Harness executes the tool.",
            ),
            zh(
              "工具把请求交给当前登记在 ctx.web.searchProvider 的提供者；只有它指向 deepseek-tools 时才进入本插件。",
              "The tool hands the request to whoever is registered as ctx.web.searchProvider; it enters this plugin only when that is deepseek-tools.",
            ),
            zh(
              "本插件执行 runSearch：读取 searchBackends；列表为空时按 0.1.0 规则合成内置兼容链。",
              "The plugin runs runSearch: it reads searchBackends, synthesizing the 0.1.0 compatibility chain when the list is empty.",
            ),
            zh(
              "按优先级从小到大逐个尝试，只考虑启用的行。",
              "It tries rows in ascending priority, considering only enabled rows.",
            ),
            zh(
              "第一个成功的后端立即返回结果，后面的后端不再被调用。",
              "The first backend that succeeds returns immediately; later backends are not called.",
            ),
            zh(
              "某个后端失败就静默回退到下一个；没有可用凭据的行会被直接跳过，不会白试一次。",
              "A failing backend falls through silently to the next one; rows without a usable credential are skipped instead of attempted.",
            ),
            zh(
              "所有后端都失败时，才把最后一个错误抛给模型。",
              "Only when every backend fails does the model receive the last error.",
            ),
            zh(
              "如果 searchBackend 被 pin 到某个 id：只走那一条；失败直接返回真实错误，绝不回退。",
              "If searchBackend is pinned to an id, only that row runs; a failure is returned as the real error and never retried.",
            ),
          ],
        },
        {
          type: "p",
          text: zh(
            "web_fetch 走 fetchProvider / runFetch，规则完全相同。页面上的“测试”按钮会临时 pin 到被测的那一行，所以它显示的是该后端自己的错误，而不是回退后的结果。",
            "web_fetch goes through fetchProvider / runFetch with the same rules. The page's Test button temporarily pins the row under test, so a failure shows that backend's own error rather than a fallback result.",
          ),
        },
      ],
    },
    {
      id: "keys",
      title: zh("密钥存在哪", "Where keys live"),
      blocks: [
        {
          type: "p",
          text: zh(
            "密钥值只存在 DSH 凭据中心：.credentials.yaml 的 refs 段。配置文件（cordis.patch.yml）里只写引用名（apiKeyEnv，例如 ZHIPU_API_KEY），永远不写明文。",
            "Key values live only in the DSH credential vault: the refs section of .credentials.yaml. The config file (cordis.patch.yml) stores just the reference name (apiKeyEnv, e.g. ZHIPU_API_KEY), never plaintext.",
          ),
        },
        {
          type: "p",
          text: zh(
            "查找顺序是：凭据中心 > 环境变量 > .env（启动时载入的环境）。页面和接口只显示“已设置 / 未设置”与固定掩码 ••••••，不会回显任何密钥片段。",
            "Lookup order: credential vault > environment variable > .env (loaded into the environment at launch). The page and its routes only show \"set / not set\" plus the fixed mask ••••••; no key fragment is ever echoed.",
          ),
        },
        {
          type: "ul",
          items: [
            zh(
              "在表格里点某一行的“密钥”格子即可保存或清除该行的密钥；密钥输入框只写不读，保存成功后自动清空。",
              "Click the \"Key\" cell of a row to save or clear that row's key. The input is write-only and is cleared after a successful save.",
            ),
            zh(
              "如果该引用名对应的环境变量已经存在，输入框会提示可以留空使用环境认证。",
              "When the environment variable for that reference already exists, the input hints that leaving it blank uses the environment credential.",
            ),
            zh(
              "行里显示“无需密钥”的类型（例如 http、jina-reader）不能点，也不会有密钥面板。",
              "Rows whose type needs no key (for example http and jina-reader) show \"No key needed\"; the cell is not clickable and has no key panel.",
            ),
          ],
        },
      ],
    },
    {
      id: "examples",
      title: zh("三个上手例子", "Three quick examples"),
      blocks: [
        { type: "h3", text: zh("例 1：智谱 Web Search", "Example 1: Zhipu web search") },
        {
          type: "p",
          text: zh(
            "适合想让智谱先于 DeepSeek 尝试的场景。在“搜索后端”表里点“添加后端”，按下面填写。",
            "Use this when Zhipu should be tried before DeepSeek. Click \"Add backend\" in the search table and fill in:",
          ),
        },
        {
          type: "table",
          head: [zh("字段", "Field"), zh("填法", "Value")],
          rows: [
            [zh("后端类型", "Backend type"), zh("智谱 Web Search（zhipu-web-search）", "Zhipu web search (zhipu-web-search)")],
            [zh("后端名称（id）", "Backend id"), zh("zhipu（自动生成，可保留）", "zhipu (generated; keep it)")],
            [zh("优先级", "Priority"), zh("1", "1")],
            [zh("端点根地址", "Endpoint"), zh("https://open.bigmodel.cn", "https://open.bigmodel.cn")],
            [zh("路径", "Path"), zh("/api/paas/v4/web_search", "/api/paas/v4/web_search")],
            [zh("搜索引擎", "Search engine"), zh("search_std", "search_std")],
            [zh("密钥引用名", "Credential reference"), zh("ZHIPU_API_KEY", "ZHIPU_API_KEY")],
            [zh("密钥", "Key"), zh("点该行“密钥”格子，粘贴智谱 API Key 后保存", "Click that row's Key cell, paste the Zhipu API key and save")],
          ],
        },
        {
          type: "p",
          text: zh(
            "保存后该行徽章变成“已设置”并显示掩码；点“测试”可以直接验证这一行（测试会临时 pin 到它）。",
            "After saving, the row badge turns to \"set\" with the mask; Test probes that row directly (the test pins it temporarily).",
          ),
        },
        { type: "h3", text: zh("例 2：自建 SearXNG", "Example 2: self-hosted SearXNG") },
        {
          type: "table",
          head: [zh("字段", "Field"), zh("填法", "Value")],
          rows: [
            [zh("后端类型", "Backend type"), zh("SearXNG", "SearXNG")],
            [zh("后端名称（id）", "Backend id"), zh("searxng", "searxng")],
            [zh("优先级", "Priority"), zh("1", "1")],
            [zh("端点根地址", "Endpoint"), zh("http://127.0.0.1:8888", "http://127.0.0.1:8888")],
            [zh("路径", "Path"), zh("/search", "/search")],
            [zh("密钥", "Key"), zh("无需密钥，该行显示“无需密钥”", "No key needed; the row says so")],
          ],
        },
        {
          type: "p",
          text: zh(
            "SearXNG 实例必须开启 JSON 输出（settings.yml 的 search.formats 包含 json），否则会返回 403 或一页 HTML。",
            "The SearXNG instance must enable JSON output (search.formats includes json in settings.yml), otherwise it answers 403 or an HTML page.",
          ),
        },
        { type: "h3", text: zh("例 3：OpenAI /responses 兼容中转", "Example 3: an OpenAI /responses compatible relay") },
        {
          type: "table",
          head: [zh("字段", "Field"), zh("填法", "Value")],
          rows: [
            [zh("后端类型", "Backend type"), zh("OpenAI Responses", "OpenAI Responses")],
            [zh("后端名称（id）", "Backend id"), zh("relay", "relay")],
            [zh("优先级", "Priority"), zh("2", "2")],
            [zh("端点根地址", "Endpoint"), zh("https://your-relay.example.com/v1", "https://your-relay.example.com/v1")],
            [zh("路径", "Path"), zh("/responses", "/responses")],
            [zh("模型", "Model"), zh("gpt-4o-mini（按中转支持改）", "gpt-4o-mini (use what the relay supports)")],
            [zh("密钥引用名", "Credential reference"), zh("RELAY_API_KEY", "RELAY_API_KEY")],
            [zh("密钥", "Key"), zh("点该行“密钥”格子，保存中转服务的 key", "Click that row's Key cell and save the relay's key")],
          ],
        },
        {
          type: "p",
          text: zh(
            "中转必须实现 OpenAI Responses 协议的 web_search 工具；插件会从返回的 output 里聚合 output_text 与 url_citation。",
            "The relay must implement the OpenAI Responses protocol's web_search tool; the plugin aggregates output_text and url_citation annotations from the returned output.",
          ),
        },
        {
          type: "p",
          text: zh(
            "以上都可以在设置页用“添加后端”完成，也可以直接在 cordis.patch.yml 的 searchBackends / fetchBackends 里手写同样的字段；写入后热重载生效。",
            "All three can be done on the Settings page with \"Add backend\", or by writing the same fields into searchBackends / fetchBackends in cordis.patch.yml; changes hot-reload.",
          ),
        },
      ],
    },
    {
      id: "faq",
      title: zh("常见问题", "Common questions"),
      blocks: [
        {
          type: "faq",
          items: [
            {
              q: zh("智谱的搜索包为什么不消耗？", "Why is my Zhipu search quota not being used?"),
              a: zh(
                "说明请求没有经过本插件：要么 web 的 searchProvider 没有指向 deepseek-tools，要么 searchBackend 被 pin 到别的后端、智谱行没有启用。先看“API 管理”顶部的生效状态，再去“搜索明细”确认有没有记录；没有记录就说明工具根本没走本插件，自然不会调用智谱。",
                "The request never reached this plugin: either searchProvider does not point at deepseek-tools, or searchBackend pins another row, or the Zhipu row is disabled. Check the effect strip on the API tab first, then look for a record on the Searches tab; no record means the call never went through this plugin, so Zhipu was never billed.",
              ),
            },
            {
              q: zh("测试成功，但实际搜不到怎么办？", "The test succeeds, but real searches return nothing."),
              a: zh(
                "“测试”只用一条固定查询验证连通性（搜索是 DeepSeek，抓取是 https://example.com），不代表查询质量。检查“搜索明细”：有记录但结果数为 0，说明后端本身返回空结果，换查询或换引擎；完全没有记录，说明模型没有调用工具或提供者未接管。智谱还会把查询截断到 70 个字符。",
                "Test uses one fixed query to verify connectivity (\"DeepSeek\" for search, https://example.com for fetch); it does not judge query quality. Check the Searches tab: a record with 0 results means the backend returned nothing (change the query or engine); no record at all means the model never called the tool or the provider is not in effect. Zhipu also truncates queries to 70 characters.",
              ),
            },
            {
              q: zh("429 和 1113 分别是什么意思？", "What do 429 and 1113 mean?"),
              a: zh(
                "429 是请求过多或被限流；智谱返回的 1113 通常表示额度或权益不足。降低调用频率、换密钥或换后端，并确认套餐余额。",
                "429 means too many requests or rate limiting; Zhipu's 1113 usually means the quota or entitlement is insufficient. Slow down, switch keys or backends, and confirm the plan balance.",
              ),
            },
            {
              q: zh("改配置要不要重启？", "Do config changes need a restart?"),
              a: zh(
                "后端列表和密钥是热重载：保存后接口返回最新状态，页面立即刷新，不用重启。只有改动“谁接管 web_search / web_fetch”（web 行的 searchProvider / fetchProvider）或升级插件本身，才需要重启 Harness。",
                "Backend lists and keys hot-reload: saves answer with the fresh state and the page refreshes immediately. Only changing who owns web_search / web_fetch (searchProvider / fetchProvider on the web row) or upgrading the plugin itself needs a Harness restart.",
              ),
            },
            {
              q: zh("卸载插件前要注意什么？", "What should I do before uninstalling?"),
              a: zh(
                "先把 web 行里的 searchProvider / fetchProvider 从 deepseek-tools 改回其他提供者或清空。否则卸载后 Harness 仍指向一个不存在的提供者，web_search / web_fetch 会直接失败。",
                "First point searchProvider / fetchProvider on the web row away from deepseek-tools (or clear them). Otherwise the Harness keeps referencing a provider that no longer exists and web_search / web_fetch fail outright.",
              ),
            },
          ],
        },
      ],
    },
    {
      id: "security",
      title: zh("安全", "Security"),
      blocks: [
        {
          type: "ul",
          items: [
            zh(
              "密钥只写不读：保存接口只接收值，读取接口只返回存在性与固定掩码，日志和错误信息里都不会出现明文。",
              "Keys are write-only: the save route accepts a value, read routes return presence and a fixed mask, and neither logs nor error messages ever contain plaintext.",
            ),
            zh(
              "查询词会离开本机：搜索内容会发给所配置的后端（智谱、Tavily、你自建的中转等），不要把敏感信息放进查询。",
              "Queries leave this machine: search text is sent to the configured backend (Zhipu, Tavily, your own relay, and so on). Do not put sensitive data in a query.",
            ),
            zh(
              "记账只在本机：usage.json 记录查询词或网址、耗时与成败，不上传；可在“用量汇总”里清除。",
              "Accounting stays local: usage.json records the query or URL, latency and outcome, and is never uploaded; it can be cleared on the Usage tab.",
            ),
            zh(
              "凭据文件由 DSH 管理，不要把 .credentials.yaml 提交到代码仓库或分享给别人。",
              ".credentials.yaml is managed by DSH; never commit or share it.",
            ),
            zh(
              "删除后端不会删除它已保存的密钥；需要时在该行的“密钥”面板里点“清除”。",
              "Deleting a backend does not delete its stored key; use Clear in that row's key panel when you want it gone.",
            ),
          ],
        },
      ],
    },
  ],
};
