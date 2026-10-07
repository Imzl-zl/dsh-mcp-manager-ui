# Progress

- Shape: durable
- FinalizationStatus: pending-validation（实现 + 审查处置 + 自测均完成；row 8 的浏览器验收环境受阻）
- Truth: .tasks/mcp-project-contract/TODO.csv（row 1-7、9、10 DONE；row 8 IN_PROGRESS/环境受阻）
- Workspace: C:\sudy\github\dsh-mcp-manager-ui\.worktrees\feature\project-mcp-contract（分支 `feature/project-mcp-contract`）
- Commits: a4b3407（主体）、a03be47（审查轮自查修补）、447e5ea（收整）、a2e946c（代次令牌）、7277b01（字段速查）、**078401f（审查处置）**
- SetupChange: 主树的 .gitignore 追加 `.worktrees/`（未提交）
- Latest validation: worktree 内 `node --test` = **250 tests / 250 pass / 0 fail**；真宿主用例连跑 3 遍 6/6（7.5s，耗时稳定）
- Next: ① row 8 的 web 实例验收需用户先停桌面端（命令见下）；② 落地方式（合并/PR）由用户定；③ 发版时补 `lib/whats-new.js` 的更新卡片与 Release notes（发版闸门的一步）

## 独立代码审查（只读、未跑测试）结论与处置

审查范围 `191df7c..a03be47`（+ 我随后的收整），结论 **fixes-required**，10 条发现全部处置完毕（提交 078401f）：

| 发现 | 判定 | 处置 |
|---|---|---|
| **F1** 重要/真实缺陷：终态重建丢掉了 `retireDeadConnection` 的返回值 → `repointConnectionSlots` 不执行 → 同项目**其他存活会话**永久失去项目工具 | **接受**（我漏了） | `dead ?? await retireStaleConnection(...)`；新增回归用例，并**验证过它在退回旧行为时失败** |
| **F2** 重要/架构：「槽位改指新连接」写了两份且记账不同（F1 的根因） | **接受** | 收成单一 `moveSlotToConnection`，repoint 与 commit 两处都走它 |
| **F3** 重要：`idleTimeoutMs` 建连时快照且不参与"配置过期"判定 → 只改它静默无效、面板显示两个值 | **接受** | `isConfigStale` 同时比对插件自己的策略（`idleTimeoutOf` vs `idleTimeoutOfServer`） |
| **F4** 重要/测试：终态启发式零测试；夹具的 `?.` 让"什么都没发生"断言空过 | **接受** | 新增"重建后两个会话都保住工具"用例 + 去掉 `?.`（订阅缺失当场抛错） |
| **F5** 次要：监听器在参数位置解构（解构在 try 之前，null 载荷会否决创建）；忽略取消信号 | **接受** | 签名改为 `async (payload)`、取值在 try 内；`waitForConnectionReady` 接住 signal |
| **F6** 次要：`workspaceConnectionStatus` 内联了同一份指纹比较 | 已在审查前一轮自查修掉（447e5ea） | 改走 `isConfigStale` |
| **F7** 次要：旧代 cleanup 无条件删代次令牌 → 可静默废掉写盘对齐 | 已在审查前一轮自查修掉（a2e946c） | 只删自己那一份 |
| **F8** 次要：硬编码 `state !== 2`；零工具服务器每次挂载都被拆掉重建 | **接受** | 改用 `FIBER_ACTIVE`；加 `hadTools` 证据判据（只有"曾经有工具"才可能是重连耗尽的终态） |
| **F9** 次要/测试：三处时序余量会在负载下抖 | **接受** | 300ms→2500ms、30ms→150ms（等到 400ms）、对齐断言改用夹具机制说明 |
| **F10** 次要：对齐连接在写锁内、且其失败会把已落盘的写报成失败 | **接受** | 移出写锁 + 收成 `alignWorkspaceConnections`（吞错记日志）；exclude 走锁外的 restrict 重算 |

**未加测试的一条（如实记录）**：F10 里"对齐失败只记日志、不把已落盘的写报成失败"这条防御边界没有单独测试——要对模块内部做故障注入才能确定性地触发，代价与收益不成比例；行为写在代码注释与提交信息里。审查另有三条明确的"未发现问题"声明（引用计数漂移 / 空闲计时器竞态 / 僵尸工具），与我的自查结论一致。

## 交付内容（rows 1-7 + 9）

见 TODO.csv 与 `docs/project-mcp-lifecycle.md`。一句话：项目级 MCP 现在**跟着宿主的连接契约走**——配置是唯一真相源（写盘即对齐：新增即挂、删除即撤、改配置就地重载），连接跟配置同生灭（会话结束只进空闲等待），首轮之前就绪（共享预算），耗尽可重建，面板把「连接在不在」与「几个会话在用」分开说，两个项目级旋钮有字段速查表。

## row 8 阻塞（环境，不是代码）

桌面端在跑时**任何 profile** 都起不来第二个 web 实例（`mcpdev` 与对照的既有 `web` profile 都只起进程、不绑端口、无输出；已排除 Electron 单实例锁、lockfile、`--user-data-dir`）。`mcpdev` profile 已建好并 link 到本 worktree，用户关掉桌面端后可直接：

```sh
dsh --profile mcpdev web --port 19399
```

按 TODO.csv row 8 的清单验收；不需要时 `dsh plugin --profile mcpdev remove dsh-mcp-manager-ui` 或删 `~/.dsh/profiles/mcpdev`。

## 设计依据与已否决方案（跨会话恢复时先读）

契约出处逐条见 `docs/project-mcp-lifecycle.md`（mcp-client README:91/93/107、subsystems/mcp.md:24,45、architecture.md:164、agent-loop README:111 + src/index.ts:624、agent src/index.ts:532-559、scope README:73,102）。被否决的三条：**scope 链继承**（父链槽位被 agent preset 注册表占用；`test/scope-chain-inheritance.test.mjs` 固化为证据）、**连接池**（stateful MCP 会串状态）、**默认缓存工具清单**（引入"声明了却不存在"的新失败态）。
