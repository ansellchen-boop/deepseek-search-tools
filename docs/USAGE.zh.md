# 使用说明

本文件由 `lib/usage-guide.js` 生成，设置页「使用说明」面板渲染的是同一份内容。

## 这个插件做什么

本插件是一个 DSH 插件，向 Harness 注册一个搜索提供者和一个抓取提供者（id 都是 deepseek-tools），用来接管模型可用的两个工具：web_search（搜索网页）和 web_fetch（抓取网页正文）。

只有在 Harness 的 web 配置把 searchProvider / fetchProvider 指向 deepseek-tools 时，工具调用才会进入本插件；没有接管时，调用仍由原来的提供者处理，本插件完全不参与，也不会计账。

每次进入本插件的调用都会发给一个「后端」（你配置的某个搜索或抓取服务），再把结果转成工具要求的格式返回，并在本机记录一笔用量。本文写给非开发者：术语第一次出现时都会用中文解释。

## 名词解释

| 术语 | 意思 |
| --- | --- |
| 后端（backend） | 一条具体的供应商配置：用哪家服务、走哪个地址、用哪个密钥引用、优先级多少。表格里的每一行就是一个后端。 |
| 类型（type） | 决定请求协议和必填字段。例如 zhipu-web-search 走智谱的 web_search 协议，searxng 走 SearXNG 的 JSON 搜索接口。 |
| 优先级（priority） | 数字越小越先尝试。自动链按优先级从小到大排队，同优先级按配置顺序。 |
| 自动链（automatic chain） | 没有 pin 时的默认模式：按优先级逐个尝试，某个后端失败就静默换下一个，调用方只会看到最终结果。 |
| pin（固定） | 把 searchBackend 或 fetchBackend 写死成某个后端 id。此时只走那一条，失败直接返回真实错误，不回退。 |
| 凭据引用（apiKeyEnv） | 密钥在配置里的“名字”，例如 ZHIPU_API_KEY。真正的密钥值存在 DSH 凭据中心，配置里永远不写明文。 |
| 内置兼容链（legacy） | searchBackends / fetchBackends 为空时，插件按 0.1.0 规则合成出来的行（搜索：智谱有密钥时智谱→DeepSeek；抓取：DeepSeek→内置 HTTP）。这些行不写进配置，不能开关，只能通过“添加后端”显式添加后再自定义。 |
| 记账（accounting） | 每次调用都会在本机 usage.json 里记一笔：查询词或网址、命中哪个后端、耗时、成功与否、结果数。不上传。 |

## 一次 web_search 的完整路径

1. 模型决定调用 web_search，Harness 执行这个工具。
2. 工具把请求交给当前登记在 ctx.web.searchProvider 的提供者；只有它指向 deepseek-tools 时才进入本插件。
3. 本插件执行 runSearch：读取 searchBackends；列表为空时按 0.1.0 规则合成内置兼容链。
4. 按优先级从小到大逐个尝试，只考虑启用的行。
5. 第一个成功的后端立即返回结果，后面的后端不再被调用。
6. 某个后端失败就静默回退到下一个；没有可用凭据的行会被直接跳过，不会白试一次。
7. 所有后端都失败时，才把最后一个错误抛给模型。
8. 如果 searchBackend 被 pin 到某个 id：只走那一条；失败直接返回真实错误，绝不回退。

web_fetch 走 fetchProvider / runFetch，规则完全相同。页面上的“测试”按钮会临时 pin 到被测的那一行，所以它显示的是该后端自己的错误，而不是回退后的结果。

## 密钥存在哪

密钥值只存在 DSH 凭据中心：.credentials.yaml 的 refs 段。配置文件（cordis.patch.yml）里只写引用名（apiKeyEnv，例如 ZHIPU_API_KEY），永远不写明文。

查找顺序是：凭据中心 > 环境变量 > .env（启动时载入的环境）。页面和接口只显示“已设置 / 未设置”与固定掩码 ••••••，不会回显任何密钥片段。

- 在表格里点某一行的“密钥”格子即可保存或清除该行的密钥；密钥输入框只写不读，保存成功后自动清空。
- 如果该引用名对应的环境变量已经存在，输入框会提示可以留空使用环境认证。
- 行里显示“无需密钥”的类型（例如 http、jina-reader）不能点，也不会有密钥面板。

## 三个上手例子

### 例 1：智谱 Web Search

适合想让智谱先于 DeepSeek 尝试的场景。在“搜索后端”表里点“添加后端”，按下面填写。

| 字段 | 填法 |
| --- | --- |
| 后端类型 | 智谱 Web Search（zhipu-web-search） |
| 后端名称（id） | zhipu（自动生成，可保留） |
| 优先级 | 1 |
| 端点根地址 | https://open.bigmodel.cn |
| 路径 | /api/paas/v4/web_search |
| 搜索引擎 | search_std |
| 密钥引用名 | ZHIPU_API_KEY |
| 密钥 | 点该行“密钥”格子，粘贴智谱 API Key 后保存 |

保存后该行徽章变成“已设置”并显示掩码；点“测试”可以直接验证这一行（测试会临时 pin 到它）。

### 例 2：自建 SearXNG

| 字段 | 填法 |
| --- | --- |
| 后端类型 | SearXNG |
| 后端名称（id） | searxng |
| 优先级 | 1 |
| 端点根地址 | http://127.0.0.1:8888 |
| 路径 | /search |
| 密钥 | 无需密钥，该行显示“无需密钥” |

SearXNG 实例必须开启 JSON 输出（settings.yml 的 search.formats 包含 json），否则会返回 403 或一页 HTML。

### 例 3：OpenAI /responses 兼容中转

| 字段 | 填法 |
| --- | --- |
| 后端类型 | OpenAI Responses |
| 后端名称（id） | relay |
| 优先级 | 2 |
| 端点根地址 | https://your-relay.example.com/v1 |
| 路径 | /responses |
| 模型 | gpt-4o-mini（按中转支持改） |
| 密钥引用名 | RELAY_API_KEY |
| 密钥 | 点该行“密钥”格子，保存中转服务的 key |

中转必须实现 OpenAI Responses 协议的 web_search 工具；插件会从返回的 output 里聚合 output_text 与 url_citation。

以上都可以在设置页用“添加后端”完成，也可以直接在 cordis.patch.yml 的 searchBackends / fetchBackends 里手写同样的字段；写入后热重载生效。

## 常见问题

**Q: 智谱的搜索包为什么不消耗？**

说明请求没有经过本插件：要么 web 的 searchProvider 没有指向 deepseek-tools，要么 searchBackend 被 pin 到别的后端、智谱行没有启用。先看“API 管理”顶部的生效状态，再去“搜索明细”确认有没有记录；没有记录就说明工具根本没走本插件，自然不会调用智谱。

**Q: 测试成功，但实际搜不到怎么办？**

“测试”只用一条固定查询验证连通性（搜索是 DeepSeek，抓取是 https://example.com），不代表查询质量。检查“搜索明细”：有记录但结果数为 0，说明后端本身返回空结果，换查询或换引擎；完全没有记录，说明模型没有调用工具或提供者未接管。智谱还会把查询截断到 70 个字符。

**Q: 429 和 1113 分别是什么意思？**

429 是请求过多或被限流；智谱返回的 1113 通常表示额度或权益不足。降低调用频率、换密钥或换后端，并确认套餐余额。

**Q: 改配置要不要重启？**

后端列表和密钥是热重载：保存后接口返回最新状态，页面立即刷新，不用重启。只有改动“谁接管 web_search / web_fetch”（web 行的 searchProvider / fetchProvider）或升级插件本身，才需要重启 Harness。

**Q: 卸载插件前要注意什么？**

先把 web 行里的 searchProvider / fetchProvider 从 deepseek-tools 改回其他提供者或清空。否则卸载后 Harness 仍指向一个不存在的提供者，web_search / web_fetch 会直接失败。

## 安全

- 密钥只写不读：保存接口只接收值，读取接口只返回存在性与固定掩码，日志和错误信息里都不会出现明文。
- 查询词会离开本机：搜索内容会发给所配置的后端（智谱、Tavily、你自建的中转等），不要把敏感信息放进查询。
- 记账只在本机：usage.json 记录查询词或网址、耗时与成败，不上传；可在“用量汇总”里清除。
- 凭据文件由 DSH 管理，不要把 .credentials.yaml 提交到代码仓库或分享给别人。
- 删除后端不会删除它已保存的密钥；需要时在该行的“密钥”面板里点“清除”。
