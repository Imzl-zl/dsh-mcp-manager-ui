# dsh-mcp-manager-ui

<p align="center">
  <a href="https://linux.do/" title="LINUX DO"><img src="https://cdn.jsdelivr.net/gh/Imzl-zl/dsh-mcp-manager-ui@v1.1.6/docs/images/linux-do-logo.svg" alt="LINUX DO" width="40" height="40"></a>
</p>

DeepSeek Harness Web 的 MCP 管理面板。它在 Web Host 中运行一份，通过右下角悬浮按钮管理全局 MCP（Web profile）与各项目的项目级 MCP（`.dsh/mcp.json`）。

## 界面预览

### 全局管理面板

![MCP 管理面板](https://cdn.jsdelivr.net/gh/Imzl-zl/dsh-mcp-manager-ui@v1.1.6/docs/images/mcp-manager-overview.png)

### 项目作用域（`.dsh/mcp.json`）

![项目 MCP](https://cdn.jsdelivr.net/gh/Imzl-zl/dsh-mcp-manager-ui@v1.1.6/docs/images/mcp-manager-workspace.png)

### 连接详情与操作

![MCP 连接详情](https://cdn.jsdelivr.net/gh/Imzl-zl/dsh-mcp-manager-ui@v1.1.6/docs/images/mcp-manager-detail.png)

### 新增 MCP

![新增 MCP](https://cdn.jsdelivr.net/gh/Imzl-zl/dsh-mcp-manager-ui@v1.1.6/docs/images/mcp-manager-add.png)

## 功能

- 查看 MCP 状态、传输方式、连接参数和工具列表
- 展开每个工具查看完整输入 JSON Schema：必填/可选参数、类型、枚举、默认值与原始 JSON
- 按传输方式（HTTP/stdio）和连接状态筛选，支持按名称/命令/URL 搜索
- 添加时一键套用常用预设模板（Filesystem、Memory、Sequential Thinking 等）
- 从“内置 MCP”目录查看 Exa、Tavily、Firecrawl、Chrome DevTools 和 Playwright，勾选后按需追加；已有配置只识别并跳过，不会覆盖
- **全局 + 项目双作用域**：顶部标签页在「全局」与各项目之间切换；全局 MCP 一次注册所有项目可用，项目级 MCP 写入项目目录 `.dsh/mcp.json` 仅该项目会话可见
- 项目级补充：在项目标签页添加/编辑/移除只写该项目 `.dsh/mcp.json`；项目可用「屏蔽」隐藏某个全局 MCP（写 `exclude`，新会话不再看到）
- 全局注册共用的、项目级补充项目特有的：共用 MCP（Exa、GitHub、Chrome DevTools 等）全局注册一次，所有项目直接可用，无需每个项目重复配置
- serverName 全局唯一（含所有项目），冲突在保存时提示被哪个作用域占用
- 项目 MCP 由**该项目的所有会话共享一份连接**（复用官方 `@deepseek-ai/dsh-mcp-client`，支持惰性连接与自动重连）：同一项目开多少个会话都能用，不会互相占用 `serverName`，也无需手动重连；会话中修改项目配置不会热更新，下一次会话生效（与主流一致，详见[配置生效时机](#配置生效时机重要)）
- 显示并复制已解密的 URL 凭据、args、env、headers 值（会话内临时可见）
- 启用、禁用、重连、添加、编辑和移除 MCP
- 跟随 DSH 深色/浅色主题，并适配窄屏和移动宽度
- 支持 DSH rc.7+ 的完整 MCP 连接字段：`command`、`args`、`env`、`cwd`、`url`、`headers`、调用超时、启动失败策略和重连策略
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
- **为什么必须共享**：`serverName` 同时是进程内唯一的注册名和模型可见工具名 `mcp__<serverName>__*` 的前缀。「每会话各起一份」既会撞名，也不能靠“每会话换个名字”绕过——换名等于换工具名，会话恢复时的历史工具调用和 prompt 缓存都会失效。

### 与 MCP 规范的关系（按版本说清楚）

- 规范 **2026-07-28** 修订版新增了 Statelessness 一节：服务器 **MUST NOT** 依赖同一连接上的先前请求建立上下文，**SHOULD** 准备好处理来自多个任务/线程/会话的请求，客户端 **SHOULD NOT** 把单个任务/会话当作 stdio 进程的生命周期边界。按这一版，共享连接 + 并发多路复用正是被鼓励的形态，而“每会话一个子进程”反倒是被劝阻的。
- 但随 DSH 分发的 `@modelcontextprotocol/sdk` 目前协商的是 **2025-11-25**，那一版**没有** Statelessness 一节，取而代之的是 Lifecycle Management（含 session control）。也就是说：**按 2025-11-25 实现的服务器完全可以合理地维护连接级会话状态**，这不算它的缺陷。
- 传输层的并发安全是有保障的：一个 `Client` 实例的请求 id 单调唯一（SDK 的 `_requestMessageId++`）、响应按 id 路由，stdio 一次 `write` 写整帧，所以多个会话在同一连接上交织调用不会串线。DSH 是单进程多会话，因此不需要生态里那些代理方案的 shim/broker/socket 和请求 id 重映射。

### 不适合共享的服务器（重要，本宿主没有 per-session 逃生舱）

把会话身份隐式绑在连接/进程上的服务器（浏览器自动化、SSH 会话、编辑器缓冲区、按连接建索引等）在多会话共享时会串状态。

生态里的代理方案通常提供 `shared / isolated / session-aware` 三档开关（如 [mcp-mux](https://github.com/thebtf/mcp-mux)、[jasonwarta/mcp-mux](https://github.com/jasonwarta/mcp-mux)、[punt-labs/mcp-proxy](https://github.com/punt-labs/mcp-proxy)）。**本宿主给不了 `isolated` 这一档**，原因就是上面那条：per-session 隔离必须 per-session 换 `serverName`，而那会连带换掉工具名。所以请如实理解：

- 这类服务器**在项目作用域下不被支持**。把它挪到全局作用域也没用（那只是从“本项目所有会话共享”变成“所有项目所有会话共享”，隔离更差）；在项目里另起一个 `serverName` 同样无效（`serverName` 区分的是服务器，不是会话）。
- 可行的做法：让该服务器改用 `streamable-http` 并自己按请求参数分区状态，或者用一个外部代理（上面那几个项目）在 DSH 之外做隔离。
- 规范给出的正解是 `session-aware`：状态跨请求时用请求里显式传的标识符引用（2026-07-28 的 “State that needs to span multiple requests MUST be referenced by an explicit identifier the client passes on each request”，实践上就是 `_meta` 里带会话 id，mcp-mux 的 `_meta.muxSessionId` 就是这么做的）。当前 `dsh-mcp-client` 不注入任何 per-request `_meta`，所以共享连接对服务端是**匿名**的；等上游支持按调用注入会话标识后，这一档才能补上。

生态里的同类问题与同方向实践：Claude Code 每会话各起进程导致的内存压力（[claude-code#28860](https://github.com/anthropics/claude-code/issues/28860)，Anthropic 侧的 shared-daemon 提案，已关为 duplicate）、Serena 在多客户端打开同一项目时的重复实例与并发写问题（[serena#1235](https://github.com/oraios/serena/issues/1235)，Serena 自己给多 agent 场景的建议是改用 HTTP/SSE）。DSH 是单进程多会话，能直接在进程内共享，不需要 daemon 或代理。

## 已知限制（重要，请阅读）

- **首轮就绪时序**：项目 MCP 默认异步建连，新会话的**首轮对话可能还未就绪**，第二轮起可用。若服务器配置了 `failOnStartupError: true`，会等待连接确认后才继续创建会话（与 mcp-client 全局行为一致）。
- **屏蔽不释放命名**：「屏蔽」全局 MCP 只隐藏其工具，该 serverName 的全局实例仍在运行并占用命名，项目内不能通过同名服务器接管；如需接管请先在全局禁用/移除该服务器。
- **全局与项目不能同名**：`serverName` 在整个进程内唯一，项目级不能与全局或其他项目用同一个名字；保存时会提示被哪个作用域占用。
- **共享连接与配置粘性**：见上「配置生效时机」的注意——运行中连接沿用首会话配置，全部会话结束后新连接才用新配置；期间面板标 `配置待生效`。
- **不支持 per-session 隔离**：见上「不适合共享的服务器」。
- **关掉最后一个会话后立刻重开会稍等**：新连接要等旧连接完全销毁才建（避免撞名），这段等待取决于 MCP 服务端退出的快慢（mcp-client 对关闭的等待上限是 5 秒）。
- **插件热重载会清空运行中会话的项目工具**：HMR/卸载时会撤回所有投射并释放连接（否则会留下指向已销毁连接的僵尸工具）。已在运行的会话要重新拿到项目 MCP 工具需新开会话。


## 兼容性

| 项目 | 已验证版本 |
|---|---|
| DeepSeek Harness | `0.1.0-rc.7` 及以上（已验证至 `0.1.0-rc.8`） |
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

DSH 宿主 API 通过 `peerDependencies` 以 `^0.1.0-rc.7` 声明，自动兼容 `0.1.0-rc.7` 到 `0.2.0` 之前的所有版本（含后续 RC 与 `0.1.x` 正式版）。开发与测试环境跟随同一范围，升级 DSH 后用 `pnpm update && npm test` 验证即可，无需改版本号。`0.2.0` 属于新的兼容边界，需要重新验证后再放宽。

## 安装

使用 DSH 插件命令安装。不要把 `mcp-manager-ui` 再手工插入 Web profile 的 `cordis.patch.yml`。

```sh
# 正式使用固定 release tag。
dsh plugin --profile web add github:Imzl-zl/dsh-mcp-manager-ui#v1.1.6
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

DSH rc.7 原生支持两种 MCP transport：

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

`@deepseek-ai/dsh-mcp-client` 不对外暴露连接成功/失败事件，连接状态只出现在它的日志里。因此面板采用两条独立事实拼出状态：

- **已连接（connected）**：只有该 server 的工具已注册（`mcp__<server>__*` 数量 > 0）才判定为已连接。插件 fiber 处于 ACTIVE 只说明 mcp-client 在跑，不能证明握手成功——`failOnStartupError: false`（默认）时连接失败也会让 fiber 保持 ACTIVE。
- **连接失败（failed）**：fiber 活着但没有工具注册，且 mcp-client 最近日志（通过 `ctx.logger.exporter` 订阅并按 `mcp-client(<serverName>)` 过滤）中出现 error/warn。失败原因会展示在详情页，例如 `connection attempt failed: ECONNREFUSED`、`adb forward missing`。
- 工具数为 0 且没有任何失败日志时如实显示**连接中/等待**，不猜测成功。

以上判定同样适用于项目 MCP，**走的是同一套规则、同一条日志通路**（按 `mcp-client(<serverName>)` 过滤）：面板对项目条目显示「已连接（本项目会话共享）/ 连接中… / 连接失败 / 待会话挂载」，配置改过但仍在复用旧连接时标 `配置待生效`。两类失败分开告知，不混为一谈：

- **挂载失败**：本插件在会话 setup 阶段就挂不上（serverName 被占、`failOnStartupError: true` 下启动失败等）。
- **连接失败**：连接已建但零工具，且 mcp-client 最近日志里有 error/warn（例如重连耗尽后“tools unregistered”）。之前这种终态失败会被显成「连接中」，现已修正。

项目 MCP 的工具注册在它自己的共享作用域层里，全局工具视图看不到，所以面板按该作用域枚举（不是走全局 `tools.schemas()`）。

面板在详情页和编辑表单中默认掩码敏感值（URL 凭据、args、env、headers），点击眼睛图标后经 Host 的 `reveal` 接口读取有效运行值并在会话内临时显示；编辑时若未实际修改输入，保存仍保留原配置引用，不会把环境变量密钥写回 profile。该读取只对当前 Web profile 管理的 server 开放。

## 设计约束

`dsh-mcp-manager-ui` 是 Web Host 单实例插件。固定的 Remote namespace 和 UI slot id 是有意设计；重复加载属于配置错误，插件会明确失败，而不是静默忽略。多个 MCP server 则由 `@deepseek-ai/dsh-mcp-client` 的不同 `serverName` 实例管理。

## 相关链接

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [GitHub `dsh-plugin` 主题](https://github.com/topics/dsh-plugin)

## License

MIT
