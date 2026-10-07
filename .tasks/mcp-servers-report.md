# MCP 服务器清单与核实报告

面向 DSH 插件「MCP 市场」。交付物：`mcp-servers-verified.yaml`（47 条，可解析、字段自洽）。

> 条数与分类构成会随收录变动，**以目录文件为准**；下表是核实当时的快照。
> 分类的展示顺序由 `scripts/build-catalog.mjs` 的 CATEGORY_ORDER 定义（下表按它排列）。

## 核实方法（三层证据）

1. **可机读一手源**：`registry.npmjs.org`、`pypi.org/pypi/<pkg>/json`、`registry.modelcontextprotocol.io/v0/servers`。
   用于确认包是否真实存在、最新版本、发布时间、**发布方归属**（判断「官方」还是「社区」）。
2. **厂商官方文档**：端点 URL、必需 header、环境变量名、启动参数均逐条抄自官方页面。
3. **真实握手**：对 HTTP 型 endpoint 直接发 JSON-RPC `initialize`（`Accept: application/json, text/event-stream`）。
   能返回 `serverInfo` 的记为免密可用；返回 `401 + WWW-Authenticate: Bearer resource_metadata=...` 的记为「端点存在、需 OAuth」。

第 3 层是这份清单相对纯文档摘抄的关键差异——它把「文档里写了」升级为「现在真的连得上」。

## 结果概览

| 分类 | 条数 | 免密可直接用 |
|---|---|---|
| search | 7 | exa, tavily, firecrawl, google-maps |
| dev | 7 | git, serena, everything |
| security | 3 | — |
| data | 8 | postgres, sqlite, redis, clickhouse, mongodb |
| ai | 7 | memory, sequential-thinking, context7, deepwiki, huggingface, arxiv |
| browser | 2 | chrome-devtools, playwright |
| cloud | 6 | cloudflare-docs, aws, kubernetes, docker |
| productivity | 5 | microsoft-learn |
| files | 1 | filesystem |
| comms | 1 | — |
| **合计** | **47** | |

## 核实表

| id | 来源 URL | 确认了什么 |
|---|---|---|
| exa | https://docs.exa.ai/reference/exa-mcp | 端点 `https://mcp.exa.ai/mcp`；免费档；提升额度用 `x-api-key` 头；stdio 备选 `npx -y exa-mcp-server` + `EXA_API_KEY` |
| tavily | https://docs.tavily.com/documentation/keyless | keyless 必须带 `X-Tavily-Access-Mode: keyless`，文档明写「header 是必需的」；免费 Key 1000 credits/月无需信用卡；实测带此头握手成功（`tavily-mcp@4.0.4`） |
| firecrawl | https://docs.firecrawl.dev/mcp-server | `https://mcp.firecrawl.dev/v2/mcp`（keyless 或 Bearer）；OAuth 走 `/v2/mcp-oauth`；实测 keyless 握手成功（`firecrawl-fastmcp@3.28.2`） |
| brave-search | https://www.npmjs.com/package/@brave/brave-search-mcp-server | 包名 `@brave/brave-search-mcp-server`；2.x 默认 stdio，参数 `--transport stdio`；`BRAVE_API_KEY` 必填 |
| perplexity | https://docs.perplexity.ai/docs/getting-started/integrations/mcp-server | 远端 `https://api.perplexity.ai/mcp`（Bearer）；本地 `npx -y @perplexity-ai/mcp-server` + `PERPLEXITY_API_KEY` |
| google-maps | https://developers.google.com/maps/ai/code-assist | 端点 `https://mapscodeassist.googleapis.com/mcp`；文档明写 `tools/list` 无需认证；实验阶段免费 |
| fetch | https://github.com/modelcontextprotocol/servers + https://pypi.org/pypi/mcp-server-fetch/json | README 给 `uvx mcp-server-fetch`；PyPI v2026.8.18，作者 Anthropic |
| github | https://docs.github.com/en/copilot/how-tos/copilot-in-your-ide/copilot-for-common-tasks/use-the-github-mcp-server | 远端 `https://api.githubcopilot.com/mcp/`；stdio 备选 `ghcr.io/github/github-mcp-server` + `GITHUB_PERSONAL_ACCESS_TOKEN`；所有套餐可用，功能权限随套餐 |
| gitlab | https://docs.gitlab.com/user/model_context_protocol/mcp_server/ | 官方 MCP server，Free/Premium/Ultimate，HTTP 传输；实测 `gitlab.com/api/v4/mcp` 返回 `resource_metadata=gitlab.com/.well-known/oauth-protected-resource/api/v4/mcp` |
| sentry | https://docs.sentry.io/product/sentry-mcp/ | base `https://mcp.sentry.dev/mcp`，可加 `/{org}/{project}`；全部连接走 OAuth |
| git | https://pypi.org/pypi/mcp-server-git/json + servers README | `uvx mcp-server-git --repository <path>`；PyPI v2026.8.18，作者 Anthropic |
| serena | https://oraios.github.io/serena/02-usage/030_clients.html | 通用 context 为 `ide`；启动 `serena start-mcp-server --context ide --project-from-cwd`；PyPI `serena-agent` v1.7.0，作者 Oraios AI |
| everything | https://registry.npmjs.org/@modelcontextprotocol/server-everything | 包存在，v2026.8.31；README 给 `npx -y @modelcontextprotocol/server-everything` |
| postgres | https://github.com/crystaldba/postgres-mcp | `uvx postgres-mcp --access-mode=unrestricted` + `DATABASE_URI`；PyPI `postgres-mcp` v0.3.0，作者 jssmith@crystal.cloud |
| sqlite | https://github.com/modelcontextprotocol/servers-archived/tree/main/src/sqlite | `uvx mcp-server-sqlite --db-path <path>`（归档仓库 README 的 VS Code 安装块给出该形式）；**仓库已于 2025-05-29 归档** |
| redis | https://redis.io/docs/latest/integrate/redis-mcp/ + https://raw.githubusercontent.com/redis/mcp-redis/main/README.md | `uvx --from redis-mcp-server@latest redis-mcp-server --url redis://...`；PyPI `redis-mcp-server` v0.5.1，作者 **Redis** |
| clickhouse | https://github.com/ClickHouse/mcp-clickhouse | `uv run --with mcp-clickhouse --python 3.12 mcp-clickhouse`；`CLICKHOUSE_HOST/PORT/USER/PASSWORD`；PyPI home 指向 ClickHouse 官方仓库 |
| mongodb | https://www.mongodb.com/docs/mcp-server/get-started/ | `npx -y mongodb-mcp-server@latest --readOnly` + `MDB_MCP_CONNECTION_STRING`；npm v3.0.5，registry 归属 mongodb-js |
| supabase | https://supabase.com/docs/guides/getting-started/mcp | 托管端点 `https://mcp.supabase.com/mcp`；支持 `?read_only=true`、`?project_ref=` |
| neon | https://neon.com/docs/ai/neon-mcp-server | 端点 `https://mcp.neon.tech/mcp`；OAuth 或 API Key；可选只读 |
| chrome-devtools | https://github.com/ChromeDevTools/chrome-devtools-mcp | `npx -y chrome-devtools-mcp@latest`；npm v1.10.1；需 Chrome |
| playwright | https://github.com/microsoft/playwright-mcp | `npx @playwright/mcp@latest`；npm v0.0.83；需 Node 18+ |
| cloudflare-api | https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/ | `https://mcp.cloudflare.com/mcp`；OAuth 或 API Token 作 Bearer |
| cloudflare-docs | 同上 | `https://docs.mcp.cloudflare.com/mcp`；实测免密握手成功（`docs-ai-search@0.4.13`） |
| aws | https://awslabs.github.io/mcp/servers/core-mcp-server/ | `uvx awslabs.core-mcp-server@latest`；PyPI v1.0.27，作者 **Amazon Web Services**；需 Bedrock 凭证 |
| kubernetes | https://github.com/containers/kubernetes-mcp-server | `npx -y kubernetes-mcp-server@latest`（官方 README 的 Claude Desktop 段落）；npm v0.0.67；原生 Go 实现，不依赖 kubectl |
| docker | https://github.com/docker/mcp-gateway | 入口是 `docker mcp gateway run`（CLI 插件，非 npm 包）；可 `--profile` / `--port` |
| vercel | https://vercel.com/docs/mcp/vercel-mcp | 端点 `https://mcp.vercel.com`；OAuth；公开工具免认证 |
| netlify | https://docs.netlify.com/build/build-with-ai/netlify-mcp-server/ | 远端 `https://netlify-mcp.netlify.app/mcp`；本地备选 `npx -y @netlify/mcp`（npm v1.17.0） |
| notion | https://developers.notion.com/guides/mcp/get-started-with-mcp | JSON 配置块明确 `"url": "https://mcp.notion.com/mcp"`；FAQ 原文「Notion MCP (`https://mcp.notion.com/mcp`) is our hosted, actively maintained server」；OAuth 授权；实测该端点返回 MCP OAuth protected-resource 元数据 |
| linear | https://linear.app/docs/mcp | 文档明确给出 `https://mcp.linear.app/mcp` 与只读 `https://mcp.linear.app/mcp/readonly` |
| atlassian | https://support.atlassian.com/atlassian-ai-gateway/docs/get-started-with-the-atlassian-remote-mcp-server/ + https://github.com/atlassian/atlassian-mcp-server | 正确端点是 `https://mcp.atlassian.com/v2/mcp`（我最初按 v1 探测为 401，后据官方仓库更正）；有免费档 |
| airtable | https://support.airtable.com/articles/9897799762-using-the-airtable-mcp-server | 官方自建自维护；托管端点 `https://mcp.airtable.com/mcp`；全部套餐含免费档 |
| microsoft-learn | https://learn.microsoft.com/en-us/training/support/mcp | `https://learn.microsoft.com/api/mcp`；文档明写「无需认证」「不收费」；实测免密握手成功 |
| memory | https://registry.npmjs.org/@modelcontextprotocol/server-memory | v2026.8.31；README 给 `npx -y @modelcontextprotocol/server-memory` |
| sequential-thinking | https://registry.npmjs.org/@modelcontextprotocol/server-sequential-thinking | v2026.8.31；README 给 `npx -y ...` |
| context7 | https://github.com/upstash/context7 | 端点 `https://mcp.context7.com/mcp`；npm `@upstash/context7-mcp` v4.1.3；实测免密握手成功（`Context7@4.1.3`） |
| deepwiki | https://docs.devin.ai/work-with-devin/deepwiki-mcp | 端点 `https://mcp.deepwiki.com/mcp`；文档明写「free, remote, no-authentication-required」；实测免密握手成功 |
| huggingface | https://huggingface.co/mcp | 端点 `https://huggingface.co/mcp`；实测免密握手成功（`huggingface.co/mcp@0.4.28`） |
| arxiv | https://github.com/blazickjp/arxiv-mcp-server | `uvx arxiv-mcp-server`；PyPI v0.8.1，作者 Joseph Blazick（**社区项目，非 arXiv 官方**） |
| filesystem | https://registry.npmjs.org/@modelcontextprotocol/server-filesystem + servers README | v2026.8.31；`npx -y @modelcontextprotocol/server-filesystem <dir>`，目录为显式授权范围 |
| time | https://pypi.org/pypi/mcp-server-time/json + servers README | `uvx mcp-server-time`；PyPI v2026.8.18 |
| slack | https://docs.slack.dev/ai/slack-mcp-server | 端点 `https://mcp.slack.com/mcp`，JSON-RPC over Streamable HTTP；**不支持 SSE 与动态客户端注册**，须用自有 Slack App 的 client_id/secret 且应用需已发布或为内部应用 |
| frida-mcp | https://github.com/dnakov/frida-mcp | PyPI `frida-mcp` v0.1.1（2025-03），MIT，仓库 435★；`uvx --with mcp<2 --with frida-mcp frida-mcp`；实测完成 `initialize`/`tools/list` 握手，`enumerate_processes` 返回本机进程。**注意与 npm 上的同名包不是同一个东西**（见排除第 11 条） |

## 因无法核实而排除

**没进清单的，以及原因。**

1. **Discord** — `https://mcp.discord.com/mcp` 实测返回 401 + `resource_metadata=https://mcp.discord.com/.well-known/oauth-protected-resource/mcp`，端点很可能真实存在；但我**找不到 Discord 官方文档页**确认（`docs.discord.com/developers/mcp` 不存在，只在第三方博客见到提及）。仅凭一次 401 不足以写进配置，故排除。
2. **Elasticsearch** — npm `@elastic/mcp-server-elasticsearch` 存在（v0.3.1，2025-07 后未更新），但官方 README 顶部明确标注 **deprecated**，已被「Elastic Agent Builder MCP endpoint（Elastic 9.2+）」取代；后者的稳定 URL 我没能核实，故整体排除。
3. **Snowflake** — PyPI `snowflake-labs-mcp` 存在（v1.4.2），但仓库 README 标注 **DEPRECATED**，要求迁移到「official Snowflake MCP Server」，而该官方 server 的调用方式我未取得一手来源，故排除。
4. **Google Drive / Gmail** — 官方 registry 搜 `gdrive` 返回 0 条，未找到任何官方维护的替代实现（参考实现已归档），排除。
5. **Obsidian** — registry 中只有第三方/Smithery 托管条目（如 `@oleksandrkucherenko/mcp-obsidian`、`@dalecb/obsidian-semantic-mcp`），**没有公认的官方或事实标准包**，「最成熟的那个」无法客观判定，排除。
6. **Puppeteer** — `@modelcontextprotocol/server-puppeteer` 虽仍在 npm（v2025.5.12），但属已归档的参考实现且一年未更新；其能力已被 chrome-devtools 与 playwright 完整覆盖，收录会造成重复与误导，排除。
7. **Browserbase / Stagehand** — npm `@browserbasehq/mcp-server-browserbase` 存在（v2.4.3），但 GitHub 仓库已 **ARCHIVED**，官方明写不应视为其当前生产能力，排除。
8. **归档参考服务器**（均排除，改用官方或活跃替代）：`@modelcontextprotocol/server-github`（2025-04 停更 → 改用 GitHub 远端）、`server-postgres`（2024-12 → 改用 postgres-mcp）、`server-redis`（→ 改用 Redis 官方 `redis-mcp-server`）、`server-slack`（→ 改用 Slack 官方远端）、`server-brave-search`（→ 改用 `@brave/brave-search-mcp-server`）。
9. **同类竞品中的非官方实现**（避免冒充官方）：`mcp-server-kubernetes`（PyPI 第三方，→ 改用 containers/kubernetes-mcp-server）、`@executeautomation/playwright-mcp-server`（第三方，→ 改用 Microsoft `@playwright/mcp`）、`mcp-server-docker`（PyPI 第三方，→ 改用 Docker 官方 gateway）、`docker-mcp`（npm v1.0.0，非 Docker 官方）、`mcp-atlassian`（PyPI 第三方，→ 改用 Atlassian 官方远端）。
10. **Tavily 的 stdio 形式** — 官方文档徽章写的是 npm `@tavily/mcp`，但该包在 npm 上 **404 不存在**；实际发布的是 `tavily-mcp`（v0.2.22）。为免把用户引向错误包名，Tavily 只收远端 HTTP 形式。
11. **npm 上的 `frida-mcp`** — 与 PyPI 的 `frida-mcp`（dnakov，已收录）**同名但不是同一个项目**：npm 包 v1.0.0（2026-05，维护者 `europa6`）在 registry 里**没有 `repository` 字段**，README 只把它指向配套的 skills 仓库 `yfe404/frida-mcp-skills`（4★），追不到一手来源；且它是纯 Node 包，与 Python 系的 mcp 2.x 无关。按「拿不到一手来源的宁可不收」排除，改收 PyPI 版本。

## 两个写进配置前必须知道的坑

1. **`mcp-server-git` / `mcp-server-fetch` / `mcp-server-time` 在 npm 上是 `0.0.1-security` 占位包，不是实现。**
   照记忆写 `npx -y mcp-server-git` 会装到一个空壳。这三个 Python 参考服务器**只有 PyPI 发布**，必须用 `uvx`。
2. **Serena 官方明确警告不要用 MCP 市场里的安装命令**，README 原文：*"Do not install Serena via an MCP or plugin marketplace! They contain outdated and suboptimal installation commands."*
   本清单已按官方 Quick Start 校正（先 `uv tool install -p 3.13 serena-agent`，再用 `serena start-mcp-server`）。市场详情页建议保留这句警告。
