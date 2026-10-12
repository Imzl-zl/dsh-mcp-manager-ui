# 技能面架构审查交接（2026-10-12）

> 这份是**给下一个会话的交接材料**，不是发布说明。目标：修掉技能面的架构缺陷，并在动手前先把「我们是否遵守 DSH 契约」审清楚。

## 一、当前状态（务必先读）

| 项 | 值 |
|---|---|
| 仓库 | `D:\sudy\github\dsh-toolbox-ui`（本仓库） |
| 宿主源码 | `D:\sudy\github\deepseek-harness`（**权威契约在这里，不要凭想象**） |
| 宿主运行包 | `C:\Users\zhanglu\.dsh\profiles\node_modules\@deepseek-ai\*`（version `0.2.0-rc.2`，真机用这份） |
| 已发布 | npm `dsh-toolbox-ui@1.6.5`（`dist-tags.latest` = 1.6.5） |
| 工作树 | 干净、**544 pass / 0 fail**，与 v1.6.5 tag 一致 |
| 未完成的 WIP | `git stash` → `审查中：判据过宽待重做（扁平 .md 判据 + 名字不一致用例）`，**应用前先读第三节，那份判据是错的** |

**先做**：`git stash list` 看那条，`git stash show -p stash@{0}` 读内容。它把 `locateSkill` 的扁平判据从「`文件名 === <name>.md`」改成「`以 .md 结尾`」——**方向对但太宽**（详见第三节），需要重做成「根下的直接条目」，而不是直接 apply。

## 二、架构发现（核心，决定怎么修）

### 发现 1：面板把「技能名 → 磁盘路径」重新推导了一遍，丢掉了宿主给的 `path`

`lib/skills-file-ops.js` 的 `resolveSkillTarget`：

```js
const bundlePath = join(root, name, 'SKILL.md')   // 按名字拼
const flatPath   = join(root, `${name}.md`)       // 按名字拼
```

**而宿主允许磁盘文件名与 frontmatter 里的 `name` 不一致。** 已用真宿主实测（`~/.dsh/profiles` 那份 0.2.0-rc.2）：

- `file-name.md` 里写 `name: flat-alias` → 宿主照收，`ctx.skills.list()` 报 `flat-alias`，`ctx.skills.get('flat-alias')` 正常返回正文
- 目录同理：`dir-name/SKILL.md` 里写 `name: dir-alias` → 同样照收

**后果**：这类技能宿主可用、模型能用，但**面板所有操作都失败**（读正文／启停／删除全报「找不到技能 <name>」）。实测 4 条技能里 2 条完全不可操作。

**这是既有缺陷，不是 1.6.4/1.6.5 引入的**（拿 1.6.4 原始产物实测同样失败）。它的性质是**第二真值来源**：宿主已经给了 `summary.path`（真实文件路径，连链接都解析好了），面板却丢掉它、拿名字重算。

### 发现 2：宿主**没有**「启停技能」这个概念

`dsh-skill` / `dsh-skill-filesystem` 里没有 disabled/enabled 字段（只有 watcher 的 `enabled`，与技能无关）。宿主只认 frontmatter 的两个策略字段：

- `disable-model-invocation` → `modelInvocable`
- `user-invocable` → `userInvocable`

**所以「停用技能」是我们在文件系统层面自创的机制**（把 `SKILL.md` 改名成 `SKILL.md.disabled`，让宿主读不到而跳过）。这不是违反契约（纯文件系统操作，宿主确实因此不再发现它），但必须清楚：

- 它是**我们约定的语义**，不是 DSH 的能力；文档与 UI 文案要如实这么说
- 它的正确性完全依赖「宿主按固定路径读 `<name>/SKILL.md` 或 `<root>/<name>.md`」这个实现细节——**而发现 1 说明这个假设对「名字不一致」的技能不成立**
- 改名的**方向**与**目标路径**都必须来自宿主给的真实路径，不能按名字推

**要审的问题**：把「改名」作为启停手段，在发现 1 修好之后是否仍然成立？如果没有磁盘名与技能名一致的保证，改名目标该怎么算？（应当：从 `summary.path` 出发，把末段 `SKILL.md`/`<x>.md` 加 `.disabled`，而不是从名字拼。）

### 发现 3：官方有 `ui-skill`，用 path 而不是名字

`deepseek-harness/packages/client/ui-skill`（`@deepseek-ai/dsh-client-ui-skill`）。它的 README 明确写：点击已知技能时「opens its **provider-supplied `SKILL.md` path** in the right Sidebar」。**官方按路径定位，不按名字重算**——与发现 1 的结论一致，可以作为改法的依据。

另外官方有 `ctx.sessionSkillCatalog`（`packages/api/session-controller/src/skill-catalog.ts`），README 说它「without activating a cold Agent」——**这可能让我们的 `presetScope` 租借变多余**。值得审：我们绕的那一圈（`agentPresets.acquireScope()` → `skills.list({scope})`）是否可以用官方这个服务替代，那样更符合契约。⚠️ 注意它的 `list` 只返回 **user-invocable** 的条目且**不含正文**，未必够用——审清楚再决定。

## 三、要修的清单（含已验证的证据）

### A.【架构】目标定位改用宿主给的 `path`，不要按名字重算
- 症状：磁盘名 ≠ frontmatter name 的技能，面板全部操作失败（真机实测 0/2 可操作）
- 证据：`node` 脚本已验（见第四节「验证手法」）。既有缺陷。
- 方向：`resolveSkillTarget` 接受并优先使用宿主给的**真实路径**（`summary.path`），形态由该路径的末段判定（`SKILL.md` → bundle，否则 → flat）；名字只在「必须在根内校验」时用。注意保持既有的**安全不变量**：写入仍必须限定在宿主报告过的根内（wire 只送引用、服务端核对自己算出的目标，这条纪律不能破坏）。

### B.【判据过宽】`locateSkill` 的扁平判据必须收紧到「根下的直接条目」
- 现状（已发布 1.6.5）：`if (file === `${summary.name}.md`)` → 名字不一致的技能定位不到根
- WIP 的改法：`if (file.endsWith('.md'))` → **太宽**：`some/deep/nested.md` 这种宿主**永远不会产出**的路径也被接受，破坏了「认不出就不猜」的纪律（既有用例 `omits the root when the path shape matches neither known host locator` 因此变红）
- 正确判据：宿主只扫**一层**（`dsh-skill-filesystem` README：「Discovery is one level deep」）。所以 flat 应当是「**直接位于 `base` 之下**且以 `.md` 结尾」；bundle 是「`base` 之下的 `<某目录>/SKILL.md`」。**不要**用「文件名等于技能名」——宿主不保证这一点。

### C.【测试网】`@deepseek-ai/dsh-skill-filesystem` 已加入 devDeps，但只有一条用例用它
- 教训（已写进 `.tasks/toolbox-ui/PROGRESS.md` 跨行教训 13-16）：此前它在**不在** devDependencies，而它正是产生「两个路径字段口径不同」的根因包 → 所有技能用例都喂手搓 summary → 整类缺陷测不到，由用户在真机上报出来
- 现状：`test/skills-host.test.mjs` 的 `the user-reported shape: ...` 用真宿主 + 真 junction；其余仍是替身
- 要做：把「名字不一致」也做进真宿主用例（**不要**只手搓 summary，那正是教训 13 说的坑），并覆盖：读正文／停用→可见→启用／删除不伤外部库

### D.【待审的问题】其余逻辑是否遵守 DSH

逐条对着宿主源码审（**不要凭 README 转述，读 `packages/skill/**` 与 `docs/subsystems/skills.zh.md`**）：

1. **识别（discovery）**：我们的 `locateSkill` / `skillTargetsView` 复刻了宿主 `roots()` 的规则（六级 rank、`findProjectRoot` 找 `.git`、`skipSystem`）。这些复刻点每一项都可能在宿主升级时漂移——审：能不复刻的都改成问宿主吗？剩下必须复刻的，有没有用例钉住语义（`test/skill-targets.test.mjs` 是这类用例）。
2. **禁用/启用**：见发现 2。审「改名」这个自创机制是否优雅；至少要保证改名目标来自真实路径。
3. **自动发现**：宿主用 Chokidar 监听并让 `skills/change` 事件失效缓存。面板现在是**手动刷新/轮询**。审：能不能订阅主人的 `skills/change`（`ctx.on('skills/change', ...)`）做到真·自动发现？那比轮询符合契约。注意 SPEC 约束 14（面板的读取不得依赖存在活动会话）。
4. **调用权限**：行上的权限一律来自**技能文件本身**（`invocationOf` → `readSkillDocument`），不取宿主 summary 的发现缓存——这条是刻意的（summary 会滞后），审它是否仍然正确、以及和发现 1 的关系（都该从 `path` 读）。
5. **作用域租借**：`presetScope` 借 `agentPresets.acquireScope()`。审能否用官方的 `ctx.sessionSkillCatalog` 替代（见发现 3），以及归还（`Symbol.asyncDispose`）是否稳妥。

## 四、验证手法（务必照做，这是前几轮翻车的地方）

1. **真宿主 + 真文件系统**，不要只手搓 summary：
   ```js
   const PROFILE = 'C:/Users/zhanglu/.dsh/profiles/node_modules/@deepseek-ai'
   const { Context } = await import(pathToFileURL(`${PROFILE}/cordis/lib/index.js`).href)
   const { SkillRegistry } = await import(pathToFileURL(`${PROFILE}/dsh-skill/lib/index.js`).href)
   const fsProvider = await import(pathToFileURL(`${PROFILE}/dsh-skill-filesystem/lib/index.js`).href)
   // provider 必须带自己的 inject，否则报 "cannot get property skills without inject"
   const FSPlugin = { apply: fsProvider.apply, inject: fsProvider.inject, name: fsProvider.name, Config: fsProvider.Config }
   const ctx = new Context(); await ctx.plugin(SkillRegistry)
   const fiber = ctx.plugin(FSPlugin, { dshHome, agentsHome, watch: false }); await fiber
   ```
2. **断言落在「操作真的改了盘」**，不要只断言「列出了几行 / 显示什么字」。同一批缺陷里显示全对、操作全废。
3. **发布前用「已发布产物本身」验收**，不要拿工作树冒充：
   ```pwsh
   npm pack dsh-toolbox-ui@<版本>; tar -xzf ... ; # 把解出来的放到生产布局（peer 为兄弟目录）
   ```
   然后对同一套「用户完整形状」跑两份产物做前后对照。
4. **变异验证**：每条新用例都要临时把实现改回旧行为，确认它**真的变红**，再还原。（前几轮多次出现「用例绿但没测到东西」。）
5. **符号链接**：本机建不了 file symlink（EPERM），只能用**目录 junction**（`fs.symlink(target, path, 'junction')`）。要测「扁平技能的文件本身是链接」时，用**宿主会给出的字段值**构造输入（照抄 `deepseek-harness/packages/skill/skill-filesystem/tests/skill-filesystem.spec.ts` 的 linked-flat 用例），并在注释里说明为什么这样构造。

## 五、用户的「完整形状」（真机复现用这个）

```
DSH_HOME = <工作区>/.dsh            ← DSH_HOME 就在工作区里（工作区自己是 git 根）
技能根    = <DSH_HOME>/skills        ← 项目级根 == 全局根（同一个物理目录）
技能      = 全部是指向外部同步库的 junction（用户 11 条技能都这样）
工作区    = 两个（如 D:\DSH 与 D:\DSH\temp）
```
这个形状会同时触发：同一物理目录被两档指到、链接技能、重复行、遮蔽判定。**任何技能面的改动都要在这个形状下过一遍。**

## 六、纪律

- 改前先读宿主源码确认契约（`D:\sudy\github\deepseek-harness`），**不要从 README 或测试助手反推契约**——宿主的测试助手（`writeFlatSkill`）总是让文件名等于 name，于是它的用例里没有「名字不一致」这种形状，拿它当契约就会漏。
- 结构性问题做结构修复，不要加特例补丁。这一轮已经出现过「改一处、露一处」：修好链接目录 → 暴露扁平链接 → 改判据 → 暴露名字不一致。**先找共同的不变量**（目前看是「身份与定位一律以宿主给的真实路径为准」）。
- 一次改干净再发版，不要改一次发一次。
- 发布流程：`npm test` 绿 → 提交 → 推 main → `git tag -a vX.Y.Z && git push origin vX.Y.Z`（CI 会自动跑测试、发 npm、建 **pre-release** Release；`--prerelease` 是硬要求，见 `.github/workflows/release.yml` 的说明）。版本号 synchronized 的地方：`package.json`、`test/package-contract.test.mjs`、`test/package-artifact.test.mjs`、`README.md`、`README.en.md`、`docs/installation.md`、`lib/whats-new.js`、`.github/release-notes/vX.Y.Z.md`。
- 发布后回 issue #5 回复用户（提反馈的是 `QianNianwen`）。⚠️ 1.6.1 及更早的面板**不会主动提示**新版本，要提醒手动 `dsh plugin --profile web update dsh-toolbox-ui`。
