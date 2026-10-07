# 项目级 MCP 契约对齐 — Execution Spec

**Goal:** 让项目级 MCP 满足它所依赖的 `@deepseek-ai/dsh-mcp-client` 的书面契约（首轮前就绪／掉线期间工具保持可见／耗尽后可恢复／改配置就地重载），并以原生 `agent/created` 串行监听器替代对 `agents.create/resume` 的 monkey-patch。

**Decisions:**

- D1 连接生命周期跟**项目配置**同生灭，不跟会话引用计数；空闲回收默认 30 分钟、可配（`idleTimeoutMs`，0 = 不回收）。依据：MCP 规范 "shutdown when the client no longer needs the session (e.g. the user is leaving the client application)"；Claude Code 空闲超时 30 分钟（stdio）。([transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports))
- D2 项目连接仍按 **scope 一份**持有、同名可在不同 scope 复用。依据：`docs/subsystems/mcp.md:24,45`；`mcp-client/README.md:128`。
- D3 工具仍**逐会话投射**（`agent.ctx.tools.register`）。依据：`docs/architecture.md:164` "Scope a registration to one agent → use that agent's `agent.ctx`"。
- D4 挂载点从"包装 `agents.create/resume` 注入 setup"换成**一个 `agent/created` 串行监听器**。依据：`agent/src/runtime-types.ts:259-261`（`@mode serial`）、`agent/src/index.ts:532-559`（`await ctx.serial(...)`，"a listener failure rejects"）、`agent-loop/src/index.ts:624` + `README.md:111`（创建事务 await 它后才释放排队输入）。插件现有注释把 `agents.announce()` 与同步的 `sessions.announce()` 认混了。
- D5 改配置 = **就地重载连接**（dispose 旧 fiber → 建新 → 重新投射），不等"所有会话结束"。依据：`:107` 工具名是 `(serverName, rawName)` 的纯函数，"Session history and permission rules therefore survive HMR swaps"（这条保证就地重载对会话历史安全）。**注意**：`mcp-client/README.md:93` 的 "Editing the configuration entry reloads the server connection in place" 描述的是 **loader 管理的条目**；本插件的项目连接是程序化挂载（`workspace-runtime.js:153-159`），宿主管不到它，所以这个重载必须由插件自己实现 —— 不能当成继承来的宿主行为。
- D6 **不做** scope 链继承、**不做**连接池、**不默认**缓存工具清单。依据：agent 父链单槽位且被 agent preset 注册表占用（`agent-preset-registry/src/index.ts:241-250`）、`scope/README.md:102` "multi-membership policy sets remain unsupported"；连接池对 stateful MCP 会串状态；工具清单缓存只在"就绪等待不可接受"时才需要。
- D7 UI 只改状态语义与徽标（Text-Only），不引入新视觉/交互/原型。

**Constraints:**

- 宿主基线 `0.2.0-rc.2`（本地源码树 = 安装版本，2026-09-29 对齐）。
- 监听器抛错会**否决会话创建** → 挂载路径必须捕获全部错误并记账（`mountError`），绝不向上抛。
- 插件是 bundle（host 半 + client 半），面板 RPC 走 typert manifest（改动 RPC 需同步 `lib/typert.js` 与 manifest 测试）。
- 不改 `lib/mcp-config.js` 的配置字段语义（已有 `transport/command/args/env/cwd/url/headers/toolCallTimeoutMs/failOnStartupError/reconnect`），只新增可选 `idleTimeoutMs`。

**Non-goals:**

- 不实现 scope 链继承，不提"多父链"上游请求（`scope/README.md` 已列为不受支持）。
- 不实现连接池／per-session 隔离档（`isolated`）。
- 不改全局 MCP 的管理路径与 profile patch 读写。
- 不迁移已有 `<项目>/.dsh/mcp.json` 的格式。

**Architecture:** 连接层由"配置是输入"驱动：`reconcileWorkspaceConnections(ctx, wsPath)` 作为唯一同步点，负责把配置里的 server 集合对齐成项目作用域里的连接集合（新增即建、删除即拆、改动即就地重载），并在连接集合变化后驱动逐会话投射。挂载层只做一件事：`agent/created` 监听器里声明该会话属于哪个项目（读 `agent.session.header.cwd`）并对齐投射；会话结束只撤投射，不动连接。面板把"连接态"与"投射范围"作为两个事实分别呈现。

**Final validation:**

1. `node --test`（全量）通过，包含改造后的 `test/workspace-runtime.test.mjs`、`test/workspace-config.test.mjs`、`test/package-contract.test.mjs` 与新增用例。
2. `node --test test/real-host-integration.test.mjs` 通过：真 mcp-client + 真 stdio 子进程，覆盖"会话建立后写配置 → 活会话立刻拿到工具"、"改配置就地重载且工具名不变"、"杀掉子进程 → 耗尽 → 重载 → 工具回来"、"会话结束不拆连接（同一 fiber 复用）、空闲超时才拆"、"冷启动首轮 header 已含项目工具"。
3. `node --test test/scope-chain-inheritance.test.mjs` 仍通过（记录被否决方案与宿主槽位约束）。
4. 独立 web 实例（非桌面端）实测：面板显示"无会话持有／已连接"两件事实；新建会话首轮即含项目工具；改配置后无需重开会话即生效；杀掉 MCP 服务后失败可辨且可一键重载（由 TODO.csv row 8 拥有）。
5. 就绪等待是**共享总预算**（默认 5000 ms），多服务器下总等待不超过预算。
