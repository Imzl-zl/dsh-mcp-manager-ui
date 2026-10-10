# Progress

- Shape: durable
- FinalizationStatus: **delivered**（v1.5.1 已发布：npm + GitHub Release）
- Truth: .tasks/mcp-project-contract/TODO.csv（row 1-7、9、10 DONE；row 8 的验收已由本轮真机复核替代完成，见下）
- Workspace: 已并入 `main`（`fbcf22d`）；worktree 保留在 D:\sudy\github\dsh-mcp-manager-ui\.worktrees\feature\project-mcp-contract
- Commits: 主体链见 `git log`；最近三轮为 **737ad85（折进未发布的 v1.5.0：更新卡片 + Release notes）**、**fbcf22d（第二轮审查 5 条处置）**、**190a1ad（第三轮审查处置：三条规则各收敛到一个表达点）** 与 **b5cdfc0（v1.5.1 发布）**
- Latest validation: `main` 上 `node --test` = **301 tests / 301 pass / 0 fail**；CI（ci run 38056945305）success；release run 38056957009 success
- Next: 无。后续如需改动请从 `main` 开新分支

## 第三轮独立审查（只读）与 v1.5.1 发布（2026-10-10）

审查范围 `f21196e..17c9f5d`（跨工作区复制 + 项目配置导出），结论 **fixes-required**：无 Critical，3 条 Important 是同一个病——**同一条规则在两处各写了一遍**，再用注释/断言保证它们一致。处置方式是把「一致」改成由结构保证（提交 `190a1ad`），不给局部补丁。

| 发现 | 判定 | 处置 |
|---|---|---|
| **I1** 重要/架构：合并结果有两份实现（一个出 servers、一个出名字清单），导入路径报告的 `updated` 与真正落盘的 servers **不同源、连顺序都不同**（实测 `['gamma','alpha']` vs `['alpha','gamma']`） | **接受** | `classifyMerge`（唯一名字规则）+ `planMerge(existing, incoming, { replaceAll, onExisting })`（唯一落盘形态），三条写盘路径全走它 |
| **I2** 重要/测试：新增的 `dialogRef` 护栏是**自指**的——只统计已经写了 `dialogRef` 的对话框，所以它声称要拦的「新对话框漏了焦点」照样能过（内存探针实测四个断言全绿） | **接受** | 抽出 `Dialog` 构造器（焦点契约只有一份实现），断言改成从渲染站点出发 + 数遮罩层数；两种破坏形态都验证过变红 |
| **I3** 重要/架构：写边界只钉在 7 条写路径中的 1 条上（另 6 条按客户端给的路径直接写），而文档把这道门描述成安全边界 | **接受** | `withRegisteredWorkspaceWrite` 成为唯一入口（7/7），`withWorkspaceWrite` 不再对外导出；注册表访问同收一处；文档改成「不是复制专有的」 |
| **M1** 次要：`setOwn` 的注释声称「所有按用户可控名字建映射的地方都必须用它」，但工具计数与日志脱敏仍是普通赋值（名叫 `__proto__` 的 serverName 会让面板永远报「未连接」、脱敏静默丢键） | **接受** | 抽出 `lib/own-property.js`（收掉宿主侧 4 份定义）并补齐这两处——让声明成真，而不是削弱声明；两条回归用例 |
| **M2** 次要：空选择与「源里本来没有」报同一句话 | **接受** | 两种事实分开报，两条都进测试 |
| **M3-M6** 次要：无 await 的 `async`、冗余的 `planSeq`、`overwrite` 下同内容也重写（文档未说明）、导出的「只在项目作用域」是入口性质而非 Host 强制 | **接受** | 删前两个；后两个写进 `docs/design.md` 让文档成真（不改语义） |
| **M7** 次要/测试：复制与注册表查找只在夹具 ctx 下测过 | 部分接受 | 共享的写盘/对齐路径已有真宿主集成用例；本轮补的是真机交互复核（见下），未另加真宿主用例 |

**真机复核（按 `docs/installation.md` 的要求，在打 tag 之前做）**：`uitest` profile（`link:` 到本工作树）起真 Web 实例 19687，先从页面 fetch 实际下发的 plugin bundle 确认拿到的是本次构建（`const Dialog =` 在、`role:'dialog'` 3 处、遮罩 6 处、`h(Dialog` 5 处）。逐项结果：面板入口在位；`添加 MCP` / `导入 MCP` / `导出项目 MCP` / `复制项目 MCP` 四个弹框的 `document.activeElement` **都真的是弹框本体**、单层遮罩、`role=dialog` + `tabIndex=-1`；**真实 CDP 按键** Esc 只关弹框、面板仍在（这正是上一轮修的故障形态）；点遮罩同样只关弹框；导入弹框真扫到本机 5 份客户端配置；导出弹框跑到真 RPC，textarea 拿到 `{"mcpServers":{}}` 且只读、字面凭据警告在场；复制弹框列出 7 个目标、**当前工作区不在目标列表里**、选目标后真调 `previewWorkspaceCopy`；连采 15 次 / 9 秒（跨两个轮询周期）弹框与选择没被重置；控制台无插件错误。**未被真机覆盖**：导出的「下载文件」与复制的实际写入——那需要往真实工作区写 `.dsh/mcp.json`，按约束没做，由夹具宿主用例覆盖。环境已还原：19687 释放、`workspace.json` 未改、四个真实项目下都没有新建 `.dsh/mcp.json`。

**发布（v1.5.1）**：`main` 上三个未发布提交（复制/导出 + 这轮重构）折进 **1.5.1**，1.6.0 留给 skills 那边的统一版。发布闸门（`whats-new` 最后一条 == `package.json`、`.github/release-notes/v1.5.1.md`、README/README.en/docs 的版本与 tag 引用、`package-contract` 与 `package-artifact` 两处版本断言）同步后 `npm test` = **301 pass**。CI：ci run `38056945305` success；release run `38056957009` success（Publish 带 provenance 并已发到 sigstore；Release 页面用手写稿）；npm 上 `+ dsh-mcp-manager-ui@1.5.1`（`npm view` 初查还是 1.5.0，是 registry 复制延迟，约 1 分钟后可见）。

## 发布与真机复核（2026-10-08）

- **v1.5.0 是一次「补发」**：本地 main 原有 4 个未推送提交（MCP 市场 + 一键升级）本就是完整的 1.5.0 发布态，但 `origin/main` 停在 v1.4.2、无 v1.5.0 tag、npm 最新也是 1.4.2 —— 即 1.5.0 从未发出去。因此项目级 MCP 直接**折进这个尚未发布的 1.5.0**，用户只更新一次，未另开版本号。
- 落地方式：`feature/project-mcp-contract` 先 rebase 到 main（保持本仓库的线性历史：55 个提交、0 个 merge commit），再 `--ff-only` 并入；合并前后 tree hash 一致（`ae8175e8`）证明 rebase 未改内容。
- **row 8 的环境受阻已查明并解决**，不是代码问题：
  1. `~/.dsh/profiles/mcpdev` 的 link 指向仓库搬家前的 `C:\sudy\...`（该路径已不存在）；
  2. 该 profile 的 `dsh.profile.bundles` 缺 `@deepseek-ai/dsh-web-app`，没有 web 服务器可绑端口；
  3. 启动命令应为 `dsh --profile mcpdev --port 19399`（`--profile` 选的是 profile 本身，`dsh --profile mcpdev web` 会把 `web` 当成 app 参数而报 `too many expected 0 arguments`）。
- 真机复核（独立 web 实例 19399，真 stdio 子进程）逐项通过：面板渲染正常（无白屏）、项目行文案为新的两事实写法（`已连接 · 当前无会话使用（连接保留，下次直接用） · 1 工具` / `尚未建立连接（新会话自动挂载）`）、编辑表单能原样带回 `args`、点「重连」确实拆旧建新（子进程 PID 变化）、空闲保留期间子进程存活。
- **复核同时抓出一条真机缺陷（fbcf22d 的 F1）**：空闲保留态点「重连」会拆掉连接却什么都不建（reconcile 只遍历存活会话），RPC 却回「已重连」。已修 + 回归用例（验证过退回旧行为即失败）+ 真机复验。

## 第二轮独立审查（只读）结论与处置

审查范围 `191df7c..078401f`，结论 **fixes-required**（无 Critical，2 Important），全部处置完毕（提交 fbcf22d）：

| 发现 | 判定 | 处置 |
|---|---|---|
| **F1** 重要/真实缺陷：空闲保留态点「重连」拆完连接什么都不建，RPC 却报成功 | **接受**（真机复核独立复现） | 空闲态自建连接并当场归还引用；跳过 disabled 条目；两条回归用例（都验证过退回旧行为即失败） |
| **F2** 重要/架构：HMR 重叠时旧代 cleanup 撕掉存活代的投射与会话记录（三件销毁动作只有令牌那件有归属判定） | **接受** | 三件共用一条归属判定：令牌已易主且新代活着 ⇒ 旧代只收订阅；回归用例验证过退回即失败 |
| **F3** 次要：注释仍在描述已删的「配置粘性」行为 | **接受** | 改写为就地重载的现状 |
| **F4** 次要：`alignWorkspaceConnections` 声称「下次挂载会重试」，但删除的 server 不在任何后续挂载里 | **接受** | 注释与日志如实说清后果（删除时留到空闲超时或卸载） |
| **F5** 次要/测试：空闲保留态的卸载无覆盖 | **接受** | 新增真机用例（真 mcp-client + 真 stdio 子进程） |

**本轮另外自查出一条同类缺陷**（真机用例逼出来的，不在审查清单里）：`disposeAllProjectSlots` 只经 slot 回收连接，而空闲保留态没有 slot ⇒ 卸载后 bucket 留着一条 fiber 已随插件 fiber 销毁、`released` 仍为 false 的 entry；HMR 重装后 acquire 会命中 `if (cell.entry)` 把这条**已死**连接发给新会话，且它永不再被回收。已按 bucket 兜底。

**审查另有一处结论被我用实验推翻（如实记录）**：refs 计数专项审查提了一条 low「卸载后 refs 冻结导致面板报假泄漏」。我写探针实测：HMR 清理后诊断视图是空集（`[]`），不是 `refs=2, sessions=0` —— 该 entry 已 `released=true` 且 `cell.entry` 被清空，视图读不到它，用户不可见，故未按该建议改动（避免为不可观测的内部记账引入改动）。

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
