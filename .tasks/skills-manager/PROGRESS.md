# Progress

- Shape: durable
- FinalizationStatus: active
- Truth: .tasks/skills-manager/TODO.csv
- Current: 源码整改第 4 批已完成（解包上界 / 输入大小闸 / PAX 头 / withFileLock / 原子提交 / 树根链接检查）；剩余见 Next
- Latest validation: `node --test` → **537 pass / 0 fail**（2026-10-10 实测；含规范闸 8 条）；四批整改共 **13 项变异验证**（启用判据、让位判据、内置安装、载荷 root/writable、acknowledged、删除接线、诊断恒空、扫描根、detail 读错根、解压上界、PAX 头、输入大小闸、并发锁、树根链接 → 退回旧写法即红）；`node .tasks/skills-manager/prototype/check-prototype.mjs` → 全部通过
- Next: ① 整改第 5 批（TODO row 22）：`scanSources` 删、`searchRemote` 接线或删、`revision` 消费或删、剩余假绿、端到端用例 ② TODO row 21 非法条目诊断 ③ row 18 真机检查单 ④ row 17 外部源真机验收

## 恢复须知

- **恢复入口**：本文件 → `TODO.csv` 的 `status` / `notes`。设计真值＝`SPEC.md`；界面设计真值＝`prototype/unified-design.html`。
- **双包关系**：本分支产出 `dsh-toolbox-ui`（1.6.0）；`main` 上的 `dsh-mcp-manager-ui` 继续 MCP-only 维护。MCP 修复先落 main，再 **git merge** 进本分支（不是 cherry-pick）。
- **改名（row 16 / D16）已完成**，不再是「最后一步」；此后契约 id 与文档一律用新包名。
- **本轮（R1）改动全部未提交**：13 个已跟踪文件改动 + `lib/skillhub.js` + 7 个新测试文件 + `prototype/unified-design.html`。**R1 的 row 17/18 是按这些未提交工作反推补上的行**（原计划只有 16 行，且 PROGRESS 曾写着「16/16 全部 DONE」——那与实际状态不符，已改回 `active`）。
- **版本不用动**：`dsh-toolbox-ui` 在 npm 上仍是 404（2026-10-10 实测未发布），所以 R1（skillhub 源 + 面板对齐）直接并进尚未发布的 1.6.0，SPEC 约束 24 的连带面没有被触发。
- **旧的过程日记去哪了**：SPEC/TODO/PROGRESS 在 commit `6d5a76b` 的版本里有逐行过程记录（含每次变异测试的细节）。本次按协议把它们压回「行级事实 + 跨行教训」，原文可用 `git show 6d5a76b:.tasks/skills-manager/TODO.csv` 取回。

## 跨行教训（只记不变量级的；单行细节在 TODO.csv 的 notes）

1. **「看到红」不等于「测到了」**：夹具在 setup 阶段报错也会红，断言根本没执行（本机缺符号链接权限，只有目录 junction 能建）。
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
