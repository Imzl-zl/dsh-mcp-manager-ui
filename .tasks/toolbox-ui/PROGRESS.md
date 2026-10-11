# Progress

- Shape: durable
- FinalizationStatus: active
- Truth: .tasks/toolbox-ui/TODO.csv
- Current: 源码整改第 4 批已完成（解包上界 / 输入大小闸 / PAX 头 / withFileLock / 原子提交 / 树根链接检查）；剩余见 Next
- Latest validation: `node --test` → **503 pass / 0 fail**（2026-10-11 实测，本分支首次全绿）。R1 记的 537 是「删除内置精选目录 / skills.sh」**之前**的数，那一轮（`1876605`）连应用例一起删了，所以基线据实重置为 503 而不是把它当覆盖率下降；四批整改累计 13 项变异验证（启用判据、让位判据、内置安装、载荷 root/writable、acknowledged、删除接线、诊断恒空、扫描根、detail 读错根、解压上界、PAX 头、输入大小闸、并发锁、树根链接），2026-10-11 另加 4 项（同名 MCP 判重键、只读根守卫、只读根被写入、命名闸塞回旧安装命令）；`node .tasks/toolbox-ui/prototype/check-prototype.mjs` → 全部通过
- Next: ① 整改第 5 批（TODO row 22）：`scanSources` 删、`searchRemote` 接线或删、`revision` 消费或删、剩余假绿、端到端用例 ② TODO row 21 非法条目诊断 ③ row 18 真机检查单 ④ row 17 外部源真机验收

## 恢复须知

- **恢复入口**：本文件 → `TODO.csv` 的 `status` / `notes`。设计真值＝`SPEC.md`；界面设计真值＝`prototype/unified-design.html`。
- **双包关系**：本分支产出 `dsh-toolbox-ui`（1.6.0）；`main` 上的 `dsh-mcp-manager-ui` 继续 MCP-only 维护。MCP 修复先落 main，再 **git merge** 进本分支（不是 cherry-pick）。
- **改名（row 16 / D16）已完成**，不再是「最后一步」；此后契约 id 与文档一律用新包名。
- **改名 2026-10-11（一次改到位）**：分支 / 工作树 / git admin 目录 `.worktrees/feature/toolbox-ui` @ `feature/toolbox-ui`（原 `…/skills-manager`）；技能面文档 `docs/skills.md`（原 `docs/skills-manager.md`）；任务记录目录 `.tasks/toolbox-ui/`（原 `.tasks/skills-manager/`，它装的是**整条线**的记录，早就有 MCP 内容）。`web` 与 `skillsuitest` 两个 profile 的 `link:` 与 `node_modules` junction 已同步；旧路径留了一个 junction 桥，等跑过 `web` 的宿主重启一次之后即可删。
- **改名顺带修掉两处「身份写错」**（此前一直没人看见，因为命名闸只扫一层目录）：`.github/release-notes/v1.6.0.md` 把旧包名当**主安装路径**（npm 上根本装不到这条线）→ 改成新包名并补上「包名变了、`update` 不跨包名」的迁移说明；`.github/workflows/release.yml` 把 Release 标题**写死**成旧包名 → 改成从 `package.json` 的 `name` 推导（同仓库两条产品线，写死必错一条）。
- **发布前验收（2026-10-11，隔离 DSH_HOME，用户自己的 profile / 实例一个字节没动；验完隔离目录连凭据一起删）**：
  1. **迁移路径**（用户的原话：装了 MCP 的要卸载再装）走官方命令跑通：`dsh plugin add` 旧包（`link:` 仓库根 = main）→ 旧面板只有 MCP 面、没有技能页签；`dsh plugin remove dsh-mcp-manager-ui` → `dependencies` 与 `dsh.profile.bundles` **双清**；`dsh plugin add <toolbox-ui 工作树>` → 重启后面板 MCP + 技能两个页签都在，无 `already registered` / 无未激活条目。**一处无害残留**：`remove` 之后 pnpm 会把 `node_modules/<旧包名>` 那个 junction 留在原地，`pnpm install` 与 `pnpm install --frozen-lockfile` 都不会清（lockfile 本身是干净的——里面出现的旧包名只是新包 link 路径里的**仓库名**）。它不影响加载（bundles / dependencies 都不引用它，loader 也不扫 node_modules），只是看着像旧包还装着；v1.6.0 的迁移说明可以考虑加一句「想干净就删掉它」。
  2. **真会话 + 真模型**：两个工作区各 `create` 一个会话 → 两侧都 `已连接 · 1 个会话在用 · 1 工具`、无失败横幅，详情页工具列分别是各自那份连接的 `mcp__fixture__a_echo` / `mcp__fixture__b_echo`；用阶跃 `step-5-preview` 发真实指令，模型**真的调用**了项目 MCP 工具并原样贴回 `b_echo: 阶跃验收`（1 轮 2 步 / 3 秒）。
  3. **缺陷本身在最终构建上复跑**（临时把 `loadScopeModule` 指向第二份 dsh-scope，验完已还原、grep `probe-leak` = 0）：两个项目**都没有**「未能挂载到会话」（issue #4 那个形状确实被结构挡掉了），同一根因的另一面如实报出——横幅 = 后果 + 原因 + 修法 + 首个原因全文。
  4. **自建 profile 会踩的坑**（不是本插件的问题，但用户加 provider 时会遇到）：patch 层必须**覆盖 bundle 里同 id 的** `llm-pi-ai`；新起一个 id（如 `llm-stepfun`）会挂出**第二份**实例，运行期报 `no adapter registered for provider "xxx"`（`NO_ADAPTER`）。
- **本轮（R1）改动全部未提交**：13 个已跟踪文件改动 + `lib/skillhub.js` + 7 个新测试文件 + `prototype/unified-design.html`。**R1 的 row 17/18 是按这些未提交工作反推补上的行**（原计划只有 16 行，且 PROGRESS 曾写着「16/16 全部 DONE」——那与实际状态不符，已改回 `active`）。
- **版本不用动**：`dsh-toolbox-ui` 在 npm 上仍是 404（2026-10-10 实测未发布），所以 R1（skillhub 源 + 面板对齐）直接并进尚未发布的 1.6.0，SPEC 约束 24 的连带面没有被触发。
- **旧的过程日记去哪了**：SPEC/TODO/PROGRESS 在 commit `6d5a76b` 的版本里有逐行过程记录（含每次变异测试的细节）。本次按协议把它们压回「行级事实 + 跨行教训」，原文可用 `git show 6d5a76b:.tasks/toolbox-ui/TODO.csv` 取回。

## 跨行教训（只记不变量级的；单行细节在 TODO.csv 的 notes）

1. **「看到红」不等于「测到了」**：夹具在 setup 阶段报错也会红，断言根本没执行（本机缺符号链接权限，只有目录 junction 能建）。**第二个实例（2026-10-11）**：`test/skills-host.test.mjs` 那条「导入落点」用例自 `8367f62` 起一直红在两个缺失导入（`existsSync`、`readdir`）上，补完导入才露出夹具漏建只读根 `bundled`——三条断言里最后那条（「内置根不得被写入」）从来没执行过。同一个 `ReferenceError` 被当作「既有失败」带过了好几轮；看到红的第一件事是确认断言到底跑没跑到，而不是先记成环境问题。
2. **变异存活时先怀疑变异，再怀疑测试**：一个「不可能失败」的变异和一条「永远通过」的用例是同一类错误（删掉断言自己就是同义反复）。
3. **别用自己改写的「代表性文本」当夹具**：那测的是想象而不是真实世界。许可判定必须用逐字原文，并同时用 MIT/BSD/Apache 原文测「不得误杀」。
4. **同一件事只能有一处判据**：两处判据会在改名/重构后分叉，而静默失效的那一处往往正是闸门（让位检测的自身排除）。
5. **定义基准的测试不能参与被测的那次改动**：旧名常量必须显式写死，否则改名脚本会顺手改掉判据。
6. **要测「必须同时满足」，只能用只满足一半的输入**。
7. **有缓存的被测对象，用例之间必须显式清缓存**，否则「测第二条」其实在测第一条（远端搜索的 5 分钟缓存）。
8. **手抄的清单会漂**：契约完整性要由 `@Remote` 标记机器推导；`remoteMethods()` 要**活实例**、不是 prototype（传 prototype 得到空数组，`deepEqual([], [])` 照样通过）。
9. **「无悬空引用」这类承诺必须是闸，不是散文**：现由 `test/tasks-spec-integrity.test.mjs` 守着。
10. **替换锚点要包含被保留的部分**，只用目标行做锚点会把它一起吃掉（曾误删 `const h = React2.createElement`）。
11. **引用一个「应该是既有」的东西前先确认它真的存在**：凭想象写 `readWorkspaces()` 会静默走错路径。
12. **常驻的计数类断言用下界**（样式前缀 `> 500`），钉死数字会让每次加样式都要改测试。
13. **闸的覆盖面本身也要被断言**：`package-rename` 的目录扫描首版只 `readdir` 一层，`.github/` 的子目录（release notes 与 workflows）整类无人看管——于是「v1.6.0 发布稿把旧包名当主安装路径」和「release.yml 把 Release 标题写死成旧包名」两处真错留了好几轮。改成递归之后又发现第二层问题：白名单按**行的形状**放行「`dsh plugin … add <旧包>`」= 把「叫用户装旧包」和「教用户从旧包迁过来」判成同一件事，前者正是缺陷形态。修法是让迁移说明靠**同行的措辞**（旧包 / 此前叫 / 迁移）放行，安装命令本身不再有豁免，并做变异验证（塞回旧命令 → 闸红且精确点名）。
