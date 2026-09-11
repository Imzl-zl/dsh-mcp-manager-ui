# dsh-mcp-manager-ui

<p align="center">
  <a href="https://linux.do/" title="LINUX DO"><img src="docs/images/linux-do-logo.svg" alt="LINUX DO" width="40" height="40"></a>
</p>

DeepSeek Harness Web 的 MCP 管理面板。它在 Web Host 中运行一份，通过右下角悬浮按钮（可拖拽）管理全局 MCP（Web profile）与各项目的项目级 MCP（`.dsh/mcp.json`，**本插件私有格式**：DSH 自身没有项目级 MCP 配置契约，见[兼容性](#兼容性)）。

## 界面预览

### 全局管理面板

![MCP 管理面板](docs/images/mcp-manager-overview.png)

### 项目作用域（`.dsh/mcp.json`）

![项目 MCP](docs/images/mcp-manager-workspace.png)

截图是同一项目开两个会话时的真实状态：`memory` 标「已连接（本项目会话共享）」「2 个会话共用」，工具正常枚举——两个会话共用同一份连接，不再出现 `serverName is already in use`。

### 连接详情与操作

![MCP 连接详情](docs/images/mcp-manager-detail.png)

### 新增 MCP

![新增 MCP](docs/images/mcp-manager-add.png)

## 功能

- 查看 MCP 状态、传输方式、连接参数和工具列表
- 展开每个工具查看完整输入 JSON Schema：必填/可选参数、类型、枚举、默认值与原始 JSON
- 按传输方式（HTTP/stdio）和连接状态筛选，支持按名称/命令/URL 搜索
- 添加时一键套用常用预设模板（Filesystem、Memory、Sequential Thinking 等）
- 从“内置 MCP”目录查看 Exa、Tavily、Firecrawl、Chrome DevTools 和 Playwright，勾选后按需追加；已有配置只识别并跳过，不会覆盖
- **全局 + 项目双作用域**：顶部标签页在「全局」与各项目之间切换；全局 MCP 一次注册所有项目可用，项目级 MCP 写入项目目录 `.dsh/mcp.json` 仅该项目会话可见。该项目文件沿用 `mcpServers` 的 schema（与 Claude/Cursor 等一致），但**路径是插件自己的约定**——DSH 不读它，其他客户端也不读 `.dsh/mcp.json`
- 项目级补充：在项目标签页添加/编辑/移除只写该项目 `.dsh/mcp.json`；项目可用「屏蔽」隐藏某个全局 MCP（写 `exclude`，新会话不再看到）
- 全局注册共用的、项目级补充项目特有的：共用 MCP（Exa、GitHub、Chrome DevTools 等）全局注册一次，所有项目直接可用，无需每个项目重复配置
- **两个入口，同一个面板**：右下角悬浮按钮（可拖拽、记忆位置）与 DSH 0.1.5 起的官方侧栏入口（`sidebar.footer.action`，展开态在「设置」上方显示「MCP」，收起成 56px 轨道时只剩图标）共享同一开关状态，都打开同一个浮层面板。面板浮在会话之上而**不切换主面板**，所以查连接状态、临时禁用某个 server 都不打断正在进行的对话。之所以不用主面板：MCP 管理多数发生在会话进行中（模型报某个 server 连不上、想加一个马上用），而主面板会把会话视图换掉，配置完还得再切回来。
- serverName 按**注册作用域**唯一（DSH 0.1.5 起）：项目之间、全局与项目之间可以同名，各自独立连接与注册工具；同一作用域内（同一项目）仍不允许重名
- 项目 MCP 由**该项目的所有会话共享一份连接**（复用官方 `@deepseek-ai/dsh-mcp-client`，支持惰性连接与自动重连）：同一项目开多少个会话都能用，不会互相占用 `serverName`，也无需手动重连；会话中修改项目配置不会热更新，下一次会话生效（与主流一致，详见[配置生效时机](#配置生效时机重要)）
- 需要时经眼睛临时揭示被掩码的值（URL 凭据、args、env/headers），并可一键复制；明文值不配眼睛
- 启用、禁用、重连、添加、编辑和移除 MCP
- 跟随 DSH 深色/浅色主题，并适配窄屏和移动宽度
- 支持 DSH 的完整 MCP 连接字段：`command`、`args`、`env`、`cwd`、`url`、`headers`、调用超时、启动失败策略和重连策略
- 导入 Claude、Cursor、Cline、Roo 等使用的 `mcpServers` JSON，以及 VS Code 的 `servers` JSON
- JSON 导入支持“合并（同名更新）”和“替换”，写入前提供预览
- 结构化修改 Web profile 的 `cordis.patch.yml`，保留其他插件条目、注释和 `!!js` 环境变量表达式
- Host Remote 与 Web 客户端均随插件生命周期加载和卸载
- 非强制更新提示：面板打开时 Host 每天最多向 GitHub Releases 查询一次最新版本，有新版时在面板顶部显示可关闭的提示条；查询失败静默、绝不自动更新，可设环境变量 `DSH_MCP_MANAGER_DISABLE_UPDATE_CHECK` 关闭，除该查询外不发送任何数据

## 配置生效时机（重要）

两类作用域的生效机制不同，这是有意设计，与主流 Agent 客户端一致：

| 作用域 | 存储位置 | 修改后何时生效 |
|---|---|---|
| 全局 | Web profile 的 `cordis.patch.yml` | DSH 热加载，通常立即生效（含运行中的会话） |
| 项目 | 项目目录 `.dsh/mcp.json` | **下一次新建的连接**生效；正在运行的会话不受影响（见下方共享连接的生效边界） |

项目 MCP 在会话创建/恢复时按当时的 `.dsh/mcp.json` 装配到该会话，会话进行中不重读配置——会话里改配置不生效是预期行为，Claude Code、Codex 等客户端的项目级 MCP 同样要求新开会话。「屏蔽」全局 MCP 的可见性变更同理，只对之后的会话生效。

改完配置不需要点「重连」也不需要重启 Host（项目 MCP 的重连由 mcp-client 自己管），新开会话即可。

> **注意（共享连接下的生效边界）**：项目 MCP 是「该项目所有会话共用一份连接」的模型，连接由**最先打开该项目会话时**的配置建立。所以「新开一个会话」并不总等于「用上新配置」：
>
> - 该项目**已经没有会话**在跑 → 新会话会新建连接，立刻用上新配置。
> - 该项目**还有会话**在跑 → 新会话复用现有连接，沿用旧配置。此时面板会在该项目行标出 `配置待生效`，详情页给出说明；等该项目所有会话都结束后，下一个会话才会用新配置建连。
>
> 面板提示只是如实告知，不会静默；本插件不会在运行中替换连接——那会把工具从正在对话的会话脚下抽走。

## 项目 MCP 的共享连接模型

同一项目的多个会话**共用一份**项目 MCP 连接：

- 每个 `(项目目录, serverName)` 在整个 `dsh web` 进程内只启动**一份** `mcp-client` 实例，因此 `serverName` 只登记一次，**并发会话不会撞名**（并发建连与释放/重建均做了串行化：建连 promise 先入表、释放保留占位直到连接完全销毁）。
- 该连接注册出的工具会投射进**每个属于该项目的会话**自己的工具层，所以每个会话都能看到并调用；其他项目的会话看不到（隔离保留，默认不可见、显式投射，不依赖“事后屏蔽”）。
- 引用计数管理生命周期：该项目第一个会话建立连接，最后一个会话结束后释放；会话销毁与插件卸载都会等到连接真正关闭。
- **引用所有权完全交给 cordis**：每一份引用由一个 `agentCtx.effect()` 唯一持有。因此两个边界情形都不需要本插件另建一套存活性判定：会话在建连期间被销毁时（`dsh-agent-loop` 的 `raceAbort` 会抛弃 setup 但不取消它），`effect()` 的 `assertActive()` 当场抛出，引用当场归还；会话正常结束时由 cordis 跑 disposer，并因为它是异步 disposer 而被 `Fiber._unload` 等待。插件 HMR 卸载是另一个纤度的事实（插件代次），由它自己的令牌判定，不与会话存活性共用同一张表。
- **为什么必须共享**：`serverName` 同时是进程内唯一的注册名和模型可见工具名 `mcp__<serverName>__*` 的前缀。「每会话各起一份」既会撞名，也不能靠“每会话换个名字”绕过——换名等于换工具名，会话恢复时的历史工具调用和 prompt 缓存都会失效。

### 与 MCP 规范的关系（按版本说清楚）

- 规范 **2026-07-28** 修订版新增了 Statelessness 一节：服务器 **MUST NOT** 依赖同一连接上的先前请求建立上下文，**SHOULD** 准备好处理来自多个任务/线程/会话的请求，客户端 **SHOULD NOT** 把单个任务/会话当作 stdio 进程的生命周期边界。按这一版，共享连接 + 并发多路复用正是被鼓励的形态，而“每会话一个子进程”反倒是被劝阻的。
- 但随 DSH 分发的 `@modelcontextprotocol/sdk` 目前协商的是 **2025-11-25**，那一版**没有** Statelessness 一节，取而代之的是 Lifecycle Management（含 session control）。也就是说：**按 2025-11-25 实现的服务器完全可以合理地维护连接级会话状态**，这不算它的缺陷。
- 传输层的并发安全是有保障的：一个 `Client` 实例的请求 id 单调唯一（SDK 的 `_requestMessageId++`）、响应按 id 路由，stdio 一次 `write` 写整帧，所以多个会话在同一连接上交织调用不会串线。DSH 是单进程多会话，因此不需要生态里那些代理方案的 shim/broker/socket 和请求 id 重映射。

### 不适合共享的服务器（重要：本插件只提供 shared 一档）

把会话身份隐式绑在连接/进程上的服务器（浏览器自动化、SSH 会话、编辑器缓冲区、按连接建索引等）在多会话共享时会串状态。

生态里的代理方案通常提供 `shared / isolated / session-aware` 三档开关（如 [mcp-mux](https://github.com/thebtf/mcp-mux)、[jasonwarta/mcp-mux](https://github.com/jasonwarta/mcp-mux)、[punt-labs/mcp-proxy](https://github.com/punt-labs/mcp-proxy)）。**本插件目前只提供 `shared` 这一档**（每个 `(项目, serverName)` 一份共享连接）。

关于 `isolated`：在 DSH `0.1.0-rc.7`/`rc.8` 上它确实做不到——那时 `serverName` 全进程唯一，per-session 隔离必须 per-session 换名，而换名会连带换掉模型可见的工具名。但 **DSH 0.1.5 起底层已经支持**：`mcp-client` 按注册作用域判重，同一个 `serverName` 可以在不同会话作用域里各挂一份而互不冲突（本插件的项目级共享作用域吃的就是这个能力）。所以要补 `isolated` 档，缺的只是插件的档位开关与 UI，不再是宿主限制。在那之前，请把这类服务器当作**不支持**，改用下面的做法：

- 这类服务器**在项目作用域下不被支持**。把它挪到全局作用域也没用（那只是从“本项目所有会话共享”变成“所有项目所有会话共享”，隔离更差）；在项目里另起一个 `serverName` 同样无效（`serverName` 区分的是服务器，不是会话）。
- 可行的做法：让该服务器改用 `streamable-http` 并自己按请求参数分区状态，或者用一个外部代理（上面那几个项目）在 DSH 之外做隔离。
- 规范给出的正解是 `session-aware`：状态跨请求时用请求里显式传的标识符引用（2026-07-28 的 “State that needs to span multiple requests MUST be referenced by an explicit identifier the client passes on each request”，实践上就是 `_meta` 里带会话 id，mcp-mux 的 `_meta.muxSessionId` 就是这么做的）。当前 `dsh-mcp-client` 不注入任何 per-request `_meta`，所以共享连接对服务端是**匿名**的；等上游支持按调用注入会话标识后，这一档才能补上。

生态里的同类问题与同方向实践：Claude Code 每会话各起进程导致的内存压力（[claude-code#28860](https://github.com/anthropics/claude-code/issues/28860)，Anthropic 侧的 shared-daemon 提案，已关为 duplicate）、Serena 在多客户端打开同一项目时的重复实例与并发写问题（[serena#1235](https://github.com/oraios/serena/issues/1235)，Serena 自己给多 agent 场景的建议是改用 HTTP/SSE）。DSH 是单进程多会话，能直接在进程内共享，不需要 daemon 或代理。

## 已知限制（重要，请阅读）

- **首轮就绪时序**：项目 MCP 默认异步建连，新会话的**首轮对话可能还未就绪**，第二轮起可用。若服务器配置了 `failOnStartupError: true`，会等待连接确认后才继续创建会话（与 mcp-client 全局行为一致）。
- **屏蔽不释放全局实例**：「屏蔽」全局 MCP 只隐藏它的工具，该 serverName 的全局实例仍在运行（占用它自己那个作用域）。DSH 0.1.5 起项目可以直接用同名服务器独立连接，不需要先把全局那份禁用；更早的宿主按全进程唯一判定，那时同名会启动失败。
- **同名按注册作用域隔离（0.1.5 起）**：`mcp-client` 按**注册作用域**判定 `serverName` 唯一性（`scopeOf(ctx) ?? ctx.root`），而本插件给每个 `(项目, serverName)` 一个独立作用域，所以项目之间、全局与项目之间同名都是合法配置，各自独立连接、各自注册工具（实测：同一作用域内同名仍被拒绝）。**DSH `0.1.0-rc.7`/`rc.8` 按全进程唯一判定**，同名会让其中一份启动失败：面板会在失败的那行标 `serverName 同名冲突`、列出与谁同名，并给出这个版本条件。
- **共享连接与配置粘性**：见上「配置生效时机」的注意——运行中连接沿用首会话配置，全部会话结束后新连接才用新配置；期间面板标 `配置待生效`。
- **不支持 per-session 隔离**：见上「不适合共享的服务器」。
- **关掉最后一个会话后立刻重开会稍等**：新连接要等旧连接完全销毁才建（避免撞名），这段等待取决于 MCP 服务端退出的快慢。**上界约 9 秒**：MCP SDK 的 stdio 关闭本身最多等 2s（stdin 关掉）+ 2s（SIGTERM）再 SIGKILL，mcp-client 对关闭确认又有 5 秒上限。同一会话的多个 server 是并行释放的，不累加。实测正常服务器远低于这个上界（Windows、SDK 1.30.0）：`transport.close()` 对 `@modelcontextprotocol/server-memory` 35ms、`mcp-deepwiki` 43ms、`fast-context-mcp` 34ms、`serena` 167ms；整个 `dsh web` 进程的优雅退出（同时拆 4 个 stdio + 2 个 HTTP 连接）约 0.5s。慢的前提是服务器不理 stdin EOF，见下一条。
- **Windows：忽略 stdin EOF 的 stdio 服务器会漏孙进程**。stdio 服务器在 Windows 上通常是一条进程链（`npx` 解析成 `npx.cmd`，于是 `dsh → cmd.exe → node`），而 MCP SDK 的 `StdioClientTransport.close()` 只对**直接子进程**发 SIGTERM/SIGKILL（`sdk/dist/esm/client/stdio.js` 的 `close()`），没有 job object，孙进程不在射程内。实测常见服务器（memory、deepwiki、fast-context、serena、chrome-devtools）都在 stdin EOF 时自行退出，因此 DSH 正常退出与被强杀都**不残留进程**；但这份干净来自服务器行为，不是 transport 的保证——故意忽略 stdin EOF 的服务器会让 `close()` 吃满 4 秒（2s + 2s）并留下一个孤儿孙进程。遇到这类服务器请让它自己处理退出，或改用 `streamable-http`。
- **DSH 的退出宽限是 5 秒**：官方启动器在 SIGINT/SIGTERM 后只给整棵插件树 5 秒（`dsh/lib/profile-boot-*.js` 的 `PROCESS_SHUTDOWN_TIMEOUT_MS`），超时就 `process.exit()`。正常情形绰绰有余（实测 ~0.5s），但若同时有多个“退得慢”的服务器，退出可能在 teardown 完成前被强行截止。
- **插件热重载会清空运行中会话的项目工具**：HMR/卸载时会撤回所有投射并释放连接（否则会留下指向已销毁连接的僵尸工具）。已在运行的会话要重新拿到项目 MCP 工具需新开会话。


## 兼容性

| 项目 | 已验证版本 |
|---|---|
| DeepSeek Harness | `0.1.5-rc.1` 及以上（已验证至 `0.1.5-rc.2`；`pnpm install && npm test` 含一组真机集成用例） |
| Node.js | DSH 自带/支持的运行时 |
| 平台 | Windows；Linux/macOS 使用同一 DSH Web 契约 |

## 内置 MCP

插件安装和 Web Host 启动都不会自动写入任何 MCP。打开管理面板后，点击顶部工具栏中位于“导入 JSON”和“添加 MCP”之间的“内置 MCP”，可以查看目录、勾选未配置项并一次安装。

| MCP | 默认配置 | 无密钥使用范围 | 本地要求 |
|---|---|---|---|
| [Exa](https://exa.ai/docs/reference/exa-mcp) | `https://mcp.exa.ai/mcp` | 匿名限额；可另配 API Key 提升额度 | 无 |
| [Tavily](https://docs.tavily.com/documentation/keyless) | `https://mcp.tavily.com/mcp/` + `X-Tavily-Access-Mode: keyless` | 限额 Search / Extract；免费账号可提供更高额度 | 无 |
| [Firecrawl](https://docs.firecrawl.dev/mcp-server) | `https://mcp.firecrawl.dev/v2/mcp` | 限额 Search / Scrape / Parse；完整工具需要登录或 API Key | 无 |
| [Chrome DevTools](https://developer.chrome.com/docs/devtools/agents/get-started) | `npx -y chrome-devtools-mcp@latest` | 本地工具，无 API 额度 | Node.js、Chrome |
| [Playwright](https://playwright.dev/docs/getting-started-mcp) | `npx -y @playwright/mcp@latest` | 本地工具，无 API 额度 | Node.js 20+、可用浏览器 |

目录会按 `serverName`、官方 HTTP 主机名和官方 npm 包识别当前有效配置，包括来自其他 bundle、Agent preset 或 `mcp-remote` 桥接的同类项。已存在项会显示其配置名称并禁用勾选；Host 在真正写入前还会在文件锁内再次判重，只追加当时仍缺失的所选项，不更新、不替换用户配置。用户主动移除某项后，只有再次勾选安装才会恢复。

DSH 宿主 API 通过 `peerDependencies` 以 `>=0.1.5-rc.1 <0.2.0` 声明。

**为什么只支持 0.1.5 起**：插件依赖两个 0.1.5 才具备的官方能力——

1. **`mcp-client` 按注册作用域判 `serverName` 唯一性**（`scopeOf(ctx) ?? ctx.root`；更早的版本把注册表挂在 `ctx.root`，全进程唯一）。项目级 MCP 的「跨项目/全局与项目同名」就建立在这条上。
2. **`setup` 把 agent 作为第二个参数交给插件**（`setup?.(prepared.agent.ctx, prepared.agent)`；更早的版本只传 ctx）。项目 MCP 的挂载需要 agent 的 `session.header.cwd`；从 ctx 上读 agent 会被 cordis 服务守卫拒绝（`cannot get property "agent" without inject`），而 setup 抛错会让会话的创建与恢复直接失败。

旧版本不再兼容，也不再为它们保留降级分支。

开发基线（`devDependencies`）跟随已验证的最新 RC，并按官方约定**镜像每一个 peer 依赖**（含 `@deepseek-ai/cordis`）。这条镜像不是冗余：`dsh plugin ... add <本地目录>` 是 `link:` 安装，Node 会从插件自己的路径向上解析，插件若只声明 peer 而没有本地副本，连它自己那份宿主依赖都找不到；反过来本地副本的传递依赖缺一个（例如旧配置遗漏 `@deepseek-ai/cordis`），整个插件树会在启动时直接加载失败。升级 DSH 后用 `pnpm install && npm test` 验证。

两个不在 `@deepseek-ai/dsh-*` 契约面里、但在真实安装中位于宿主模块层的依赖，值得点名：

- `@deepseek-ai/cordis-plugin-loader`（版本线 `1.0.3`）：`reveal` 用它的 `interpolate` 求值 `!!js` 配置节点。它是 vendor 包，靠 profile 的模块回退解析得到（与 `@deepseek-ai/cordis` 同一条路径）。
- `@deepseek-ai/cordis` 的私有字段：`LoggerService.exporter()` 的 disposer 删的是「当时的最大 ID」而不是注册时的 ID（`lib/index.js` 的 `return () => this.exporters.delete(this._snExporter)`），热重载会误删其他插件的 exporter。本插件因此直接读写 `logger.exporters` / `logger._snExporter` 这对私有字段，并把 peer 锁到 `~4.0.2`；字段形状一变就退回 `exporter()` 通道并明确告警。

## 安装

使用 DSH 插件命令安装。不要把 `mcp-manager-ui` 再手工插入 Web profile 的 `cordis.patch.yml`。

```sh
# 正式使用固定 release tag。
dsh plugin --profile web add github:Imzl-zl/dsh-mcp-manager-ui#v1.2.1
```

安装、升级、卸载和本地开发流程见 [安装与升级](docs/installation.md)。

安装后重启 `dsh web`。插件命令会同时完成两件事：

1. 把包加入 Web profile 的 `dependencies`。
2. 把 `dsh-mcp-manager-ui` 加入 `dsh.profile.bundles`。

仓库自己的 `cordis.patch.yml` 已经声明唯一的 Host 条目：

```yaml
- insert:
    - id: mcp-manager-ui
      name: dsh-mcp-manager-ui
```

不要在以下位置重复这段条目：

- `~/.dsh/profiles/web/cordis.patch.yml`
- 任意 Agent preset 的 `agent.cordis.yml`
- 额外的 `--patch` 文件

本插件也不需要全局安装 `@deepseek-ai/dsh-tool-cordis`。需要临时开发 Cordis 插件时，直接新建“创造模式”会话。

卸载：

```sh
dsh plugin --profile web remove dsh-mcp-manager-ui
```

## JSON 兼容范围

DSH 的 MCP 配置原生支持两种 transport：

- `stdio`：`command`、`args`、`env`、`cwd`
- `streamable-http`：`url`、`headers`

导入器会识别 `http`、`streamable-http`、`streamableHttp` 等常见别名，并把 `${TOKEN}`、`${env:TOKEN}` 转成 DSH 的 `!!js process.env.TOKEN` 表达式。DSH 当前不支持的 SSE、WebSocket、OAuth、`headersHelper`、`envFile` 等字段会明确报错或提示，不会静默生成不可用配置。

其他 Agent 的 `directTools` 可以是 `true`、`false` 或缺失。DSH 没有间接工具模式并始终把 MCP 工具注册为 `mcp__<server>__<tool>`，因此导入器采用保守映射：`true` 转成 `disabled: false`，`false` 转成 `disabled: true`，缺失时不干预现有启停状态；同时存在显式 `disabled` 时以后者为准。预览会逐项提示这些转换。

“替换”只替换当前 Web profile 的 `cordis.patch.yml` 中由 `@deepseek-ai/dsh-mcp-client` 声明的条目，不会删除其他 bundle 或 Agent preset 自带的 MCP。

完整格式、两种导入模式、启停映射和密钥处理见 [JSON 导入](docs/json-import.md)。

## 文档

- [安装与升级](docs/installation.md)
- [JSON 导入](docs/json-import.md)
- [DeepSeek Harness 官方插件发布指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)

## 开发流程

1. 在“创造模式”中用 `cordis_inspect`、`cordis_define` 和 `cordis_run` 做临时验证。
2. 将确认后的实现写入本仓库。临时动态插件不会自动生成源码文件，也不会在 DSH 重启后恢复。
3. 停止临时动态版本，避免它与仓库版本同时注册 UI 或 Remote。
4. 使用本地路径执行 `dsh plugin --profile web add ...`，验证正式 bundle。
5. 运行测试并启动 Web 做真实操作验证。

```sh
npm test
dsh --profile web --dump-config
dsh web
```

`npm test` 里除替身用例（`workspace-runtime.test.mjs` 等，验证插件内部自洽）外，还有一组**真机集成用例**（`real-host-integration.test.mjs`）：真 `@deepseek-ai/cordis` + 真 `dsh-tools` + 真 `dsh-scope` + 真 `dsh-mcp-client` + 一个真 stdio MCP 子进程。它证明的是替身测不出来的地基：`tools.schemas(scope)` 按对象同一性查层、`agentCtx` 必须能解析到 `tools`（`dsh-agent-loop` 的 `AgentLoop.inject` 含 `tools`）、`mcp-client` 的 `serverName` 注册表按 `scopeOf(ctx)` 判重，以及「同项目两会话共用一份连接、工具不泄漏到全局、最后一个会话结束后子进程退出」。

## 包结构

- `package.json`：声明 `dsh.bundle` 和 Web `dsh.client`
- `cordis.patch.yml`：插入唯一的 Host 插件实例
- `lib/index.js`：`mcpManager` Host Remote
- `lib/mcp-registry.js`：loader 中 MCP 条目的枚举与工具归属推断
- `lib/workspace-runtime.js`：项目配置读写状态、按 `(项目, serverName)` 引用计数的共享 mcp-client 连接，以及把其工具投射进每个会话作用域
- `lib/workspace-config.js`：项目级 `.dsh/mcp.json` 的读写与转换
- `lib/mcp-config.js`：JSON 规范化与 YAML patch 结构化读写
- `lib/mcp-observability.js`：连接状态判定与 mcp-client 日志格式化
- `lib/client.js`：响应式 Web UI、Remote 客户端和生命周期清理
- `lib/typert.js`：Remote 契约描述

`lib/` 是预构建产物，GitHub、tarball 和 npm 安装均不需要执行构建脚本。

## 连接状态语义

`@deepseek-ai/dsh-mcp-client` 不对外暴露连接成功/失败事件。面板因此用两条官方事实拼出状态：**已注册的工具数** 与 **cordis fiber 的状态代号**。日志只用来填失败原因的文案，不参与判定。

- **已连接（connected）**：只有该 server 的工具已注册（`mcp__<server>__*` 数量 > 0）才判定为已连接。插件 fiber 处于 ACTIVE 只说明 mcp-client 在跑，不能证明握手成功——`failOnStartupError: false`（默认）时连接失败也会让 fiber 保持 ACTIVE。
- **连接失败（failed）**：fiber 已 ACTIVE（mcp-client 的 `apply` 要等首次连接与 `tools/list` 结束才让 fiber ACTIVE）却没有任何工具，或者 fiber 本身处于失败态。具体原因取自 mcp-client 最近的日志（通过 `ctx.logger.exporter` 订阅并按 `mcp-client(<serverName>)` 过滤），例如 `connection attempt failed: ECONNREFUSED`、`giving up after 10 consecutive failed reconnect attempts`；拿不到日志时就如实写“未注册任何工具”。
- **连接中（loading）**：fiber 尚未 ACTIVE（还在跑 apply）。不猜测成功也不猜测失败。
- **已停止（stopped）**：没有 fiber。全局意为条目未加载；项目语境里意为「尚无会话持有这份共享连接」，面板显示为「待会话挂载」。

全局与项目行走的是**同一个判定函数**（`mcp-observability.deriveMcpPhase`）与同一个取值域，只有文案不同（项目行的 connected 写作「已连接（本项目会话共享）」、stopped 写作「待会话挂载」）。面板还会在项目行标出 `配置待生效`（配置改过但仍在复用旧连接）与 `N 个会话共用`。**三类**失败分开告知，不混为一谈：

- **挂载失败**（`mountFailed`）：本插件在会话 setup 阶段就挂不上（配置里的 `${VAR}` 求值为空、`failOnStartupError: true` 下启动失败、工具注册被拒等）。
- **连接失败**（`status === 'failed'`）：mcp-client 那边的事。两者由 Host 分开标记，客户端不再用「lastError 存在」反推挂载失败。
- **作用域故障**（`scopeFailed`）：连接是好的，但工具不在共享作用域层——工具落到了全局层，说明 `@deepseek-ai/dsh-scope` 在宿主与插件之间解析成了两份模块实例（作用域标签是模块内的 Symbol）。这是最隐蔽的故障形态：`tools.schemas(scopeKey)` 认不出标签时会**退回全局层**，面板因此显示「已连接 N 工具」，而工具其实对所有会话、所有项目都可见。所以判定直接对比全局视图（同名前缀的工具出现在全局视图 ⇒ 它们不属于本作用域），并把原因写在 `scopeFailed` 行与 `mcpManager/projectConnections` 的 `scopeError` 上。判定刻意保守：只有「没有同名全局条目、也没有其他项目用同名」时才断言，否则无法与「别人的同名实例的工具」区分；同一连接只判定一次（结论缓存在连接上，不在轮询里重复开销）。

项目 MCP 的工具注册在它自己的共享作用域层里，全局工具视图看不到，所以面板按该作用域枚举（不是走全局 `tools.schemas()`）。

### 只读诊断接口（排障用）

面板每行只回答得了「这个项目的这个 server 怎么了」。进程级的问题（一共有几条共享连接、有没有引用卡住不归零）由一个只读 RPC 回答：

```
mcpManager/projectConnections → { connections: [{ wsPath, serverName, state, refs, sessions, toolCount, fiberState, configStale, configError, duplicateOwners, scopeError }] }
```

- `state`：`ready`（已就绪）/ `connecting`（建连中，还没有连接态可读）/ `disposing`（释放中，占位未清）。卡在后两种状态不走才是最需要排障的形态，所以它们也如实出现在列表里。
- `refs` 与 `sessions` 是**两个独立事实**：前者是引用计数，后者是真实持有它的存活会话数。健康时二者相等；`refs > sessions` 就是漏了引用（会话已销毁但引用没归还），后果是连接永不释放、配置永远刷不新。接口不把两者合成一个“健康”布尔，判读留给使用者。
- `configStale` 为 `null` 表示无从判定（还没建连，或配置里已经没有这个 server），不伪造 `false`；读配置失败时原因在 `configError`。
- `scopeError` 非空表示作用域视图不可用（工具落到了全局层，见「连接状态语义」的作用域故障）：这是「工具对所有会话可见、而面板看着一切正常」的唯一可见证据。
- 全程只读：不改引用计数、不碰 fiber、不触发建连或释放。面板目前不接线，它是给排障留的接口。

面板在详情页和编辑表单中默认掩码敏感值——URL 凭据、args、env/headers 的值都掩码，**明文与 `!!js`/`${VAR}` 引用一视同仁**：引用写法不该改变界面上显示什么，更不该把内部 `!!js` 表达式亮出来（旧实现把 `!!js process.env.X` 当“安全引用”原样保留，结果同一份配置一个掩码、一个泄底）。点击眼睛图标后经 Host 的 `reveal` 接口读取**有效运行值**（全局的 `!!js` 按该 entry 自己的 ctx 求值，项目层的 `${VAR}` 用建连同一个求值器解析）并在会话内临时显示，再点一次回到掩码；编辑时若未实际修改输入，保存仍保留原配置引用，不会把密钥写回配置。该读取只对当前 Web profile 管理的 server 开放。

## 设计约束

`dsh-mcp-manager-ui` 是 Web Host 单实例插件。固定的 Remote namespace 和 UI slot id 是有意设计；重复加载属于配置错误，插件会明确失败，而不是静默忽略。多个 MCP server 则由 `@deepseek-ai/dsh-mcp-client` 的不同 `serverName` 实例管理。

## 相关链接

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [GitHub `dsh-plugin` 主题](https://github.com/topics/dsh-plugin)

## License

MIT
