# Progress

- Shape: durable
- FinalizationStatus: **complete**（16/16 行全部 DONE）
- Truth: .tasks/skills-manager/TODO.csv
- Current: 全部完成。包名已改为 `dsh-toolbox-ui`，版本 1.6.0
- Latest validation: `node --test` → **448 pass / 0 fail**；`npm pack --dry-run` → `dsh-toolbox-ui@1.6.0`（2026-10-08）
- Next: 无（计划内 16 行已全部完成）。后续可选：真机在 desktop profile 挂载后按 SPEC「Final validation 5/6」做人工验收；以及把本分支合回 main 的合并决策

## 执行进度

| row | 目标 | 状态 |
|---|---|---|
| 1 | 宿主侧 skills 读取层（`lib/skills-registry.js`） | ✅ DONE |
| 2 | skills 文件动作（`lib/skills-file-ops.js` + `lib/skills-archive.js`） | ✅ DONE |
| 3 | frontmatter 校验与诊断（`lib/skills-frontmatter.js`） | ✅ DONE |
| 4 | 市场目录数据（`.tasks/skills-verified.yaml`，110 条） | ✅ DONE |
| 5 | 目录生成器（`scripts/build-skills-catalog.mjs` → `lib/skills-catalog.js`） | ✅ DONE |
| 6 | 许可门禁与风险扫描（`lib/skills-admission.js`） | ✅ DONE |
| 7 | 宿主服务 `skillsManager`（独立 TypertRemoteService） | ✅ DONE |
| 8 | typert 契约（`TYPERT` 补 skillsManager 调用，共 40 条） | ✅ DONE |
| 9 | 客户端契约副本（并进同一个 `MCP_CONTRIBUTION`，仍单次 `$mount`） | ✅ DONE |
| 10 | `SKILLS_CSS`（与 `MCP_CSS` 合并为一次注入） | ✅ DONE |
| 11 | 客户端技能组件（`SkillsPanel` / `SkillCard` / `SkillInstallModal`） | ✅ DONE |
| 12 | 能力层切换（MCP/技能，复用现有入口，不新增 slot） | ✅ DONE |
| 13 | 让位检测（D15，须排除自身，失败 fail-open） | ✅ DONE |
| 14 | 市场远端搜索（skills.sh，白名单 + 超时/缓存/静默降级） | ✅ DONE |
| 15 | 文档与元数据 + 版本 bump（→ 1.6.0） | ✅ DONE |
| 16 | 改名（D16）：包名 → `dsh-toolbox-ui` | ✅ DONE |

**row 1 关键发现**：传 `cwd` 时宿主返回的是「项目+用户+bundled」**完整合并视图**（`provider.roots(cwd)` 把项目根 push 进 `cwd` 分支，而用户根与 bundled 根的 push 在该分支之外**无条件**执行）。因此项目查询结果**已包含**全局技能——直接 concat 会让每个全局技能在每个项目里各重复一份（实测 11 → 22 行）。修正为「项目查询只取 `source` 归属为 `project-*` 的行」；**不可**按名称做差集，因为同名跨作用域是合法配置（DSH 按 rank 裁决谁生效）。已由 `test/skills-registry.test.mjs` 专门用例守住。

**row 2 已完成部分**：
- `lib/skills-file-ops.js`：启停（`SKILL.md` ↔ `SKILL.md.disabled` rename）、删除、扫描已禁用、读正文、**导入**。安全行为已独立验证：12 种路径穿越/非法名全部被拒；找不到技能**报错不回退**（同名跨作用域是合法配置，静默回退会误停用另一个作用域的副本）；bundled 根拒写。
- `lib/skills-archive.js`：压缩包安全解包，支持 zip（stored/deflate）、tar、tar.gz，按**魔数**识别（下载 URL 可不带扩展名）。防 zip slip、拒符号链接与硬链接、按**实际解出字节**卡总量（不用头部声明值——那是攻击者可控的）。限额照抄主流 CLI（`vercel-labs/skills`）：10 MiB/文件、25 MiB 总量、1000 条目。
- **流程说明（诚实记录）**：压缩包模块的实现写于测试之前，违反 TDD 铁律；全绿本身证明力弱，故补做**变异测试**——植入 4 个安全缺陷（去 zip slip 防护 / 去符号链接拒绝 / 去条目数上限 / 去总量上限），确认各被对应用例抓到，恢复后 12/12 绿。测试被证明能抓错。

**row 2 导入接线（本轮完成）**：
- `importSkill({ root, scope, source: { type: 'file'|'directory'|'archive', path } })`，三种来源分别落成扁平 `<name>.md` 与目录捆绑 `<name>/`（连同 resources）。
- **关键事实（照 DSH 源码核实）**：宿主技能身份取自 **frontmatter 的 `name`**，不是文件/目录名（`dsh-skill-filesystem/lib/index.js:696-704` 的 `parsed.name`，外层名字被完全忽略）。故导入按 frontmatter 名落盘——否则本层自己的 `resolveSkillTarget(name)` 找不到刚导入的技能，用户导入完就点不动它。
- 导入前跑**完整 frontmatter 诊断**（复用 row 3 的模块）：宿主对非法技能只 warn + 跳过，放进来等于装一条「看不见的技能」，用户会以为导入成功。
- 压缩包**先解到系统 tmp** 再挑技能根：暂存放技能根内会被宿主扫成一条技能（宿主只跳过 `.system`），且 `mkdtemp` 先于建根会让「作用域根尚不存在」的首次导入直接失败。
- 技能根取**最浅**的 `SKILL.md`（自然剥掉压缩包外层包装目录）；同层出现多个则**拒绝**——多技能包静默挑一个等于猜。
- **先全量校验再落盘**，任何失败都不在用户技能根里留残骸；同名已存在（含 `.md`/`.md.disabled` 各种形态）**拒绝而不覆盖**。
- **变异测试（本轮）**：植入 8 个缺陷（按外层名落盘 / 跳过 frontmatter 校验 / 多技能包静默取一个 / 允许写只读根 / 暂存进技能根 / 去 zip slip / 静默覆盖同名 / 去链接守卫）。首轮有 **2 个存活**——「跳过 frontmatter 校验」被名字守卫掩盖、「暂存进技能根」在既有用例下几乎等价。据此补了 2 组用例（非名字类 frontmatter 损坏 5 例：缺 description / 无 frontmatter / YAML 非法 / 驼峰 invocation 键 / 布尔非法；作用域根尚不存在的首次导入），复测两个变异体**均被杀死**。
- 目录导入**同样拒绝符号链接/junction**：`fs.cp` 默认保留链接（`dereference: false`），克隆来的技能仓库带链接时，`references/...` 会指向技能根之外——技能正文会把读者引向不该读的内容。与压缩包路径同一纪律。
- **流程失误（诚实记录，与 row 2 压缩包那次同类）**：该链接守卫的用例首版用 file symlink 造链接，而本机缺 `SeCreateSymbolicLinkPrivilege`（实测 file symlink 与 dir symlink 均 EPERM，只有目录 **junction** 可建）——那次「红」是**夹具在 setup 阶段报错**，断言根本没执行，等于没测。改用 junction 后先确认 `readdir(withFileTypes)` 对 junction 报 `isSymbolicLink = true`（守卫正是看 Dirent），再补做变异（去掉守卫 → 该用例红，恢复 → 绿）才真正证明它有效。**教训**：「看到红」不等于「测到了」——必须确认红来自对断言的评估，而不是夹具/环境失败。
- 对齐：导出名由 `listDisabledSkills` 改为 TODO.csv 声明的 `scanDisabledSkills`（CSV 是状态真值，名字不一致就无法诚实收口）。
- 夹具去重：zip/tar 构造器移到 `scripts/archive-fixtures.mjs` 供两组测试共用（`node --test` 会把 `test/` 下**每个**文件当成用例文件加载，实测放 helper 进去会让 tests 计数 +1 并以「没有用例」失败；`scripts/` 已是非发布区且有 `theme-spec.mjs` 先行者）。

**row 3 已完成（frontmatter 校验与诊断）**：`lib/skills-frontmatter.js` 的 `parseSkillFrontmatter` + `diagnoseSkill`，判定逐字照抄宿主（`parseFrontmatter:780-806`、`stringField:841-844`、`isSkillName`（`dsh-skill:17`）、`frontmatterBoolean:863-878`、`optionalMetadata:879-883`），**issue 顺序照抄宿主校验顺序**，使 `issues[0]` 恒等于宿主跳过的那个原因。error = 宿主整条跳过（无 frontmatter / 无结束行 / YAML 非法 / 非映射 / name·description 缺失 / 名字非法 / 驼峰 invocation 键 / 布尔非法）；warning = 字段被丢弃但技能仍在（`when_to_use` 蛇形——那是 Claude Code 的字段、`whenToUse` 非字符串、`metadata` 非对象）。D3 无前置依赖，但 row 2 的导入依赖它按 frontmatter 名定位，故本轮先做 row 3 再补 row 2 的导入。

**row 4/5/6 已完成（市场目录数据 → 生成器 → 许可门禁）**：

- **数据（row 4）**：`.tasks/skills-verified.yaml`，**110 条 / 4 个白名单来源**（anthropics/skills 19、github/awesome-copilot 28、obra/superpowers 15、wshobson/agents 48），许可分布 MIT 86 / Apache-2.0 19 / Proprietary 4 / Unverified 1，85 条能追到具体许可证据文件。核验方法：对每个仓库 git 浅克隆后**读仓库内实际文件**（不是网页摘要）。
- **生成器（row 5）**：`scripts/build-skills-catalog.mjs` → `lib/skills-catalog.js`，8 分类，照 MCP 生成器的四件事。**唯一本质差异**：技能的 installable **不写进 YAML**，由生成器调用 `classifyLicense()` 算出——写进数据会形成第二真相源，改了规则却漏改数据，门禁就静默失效（有专门用例 + 变异测试守住）。
- **门禁（row 6）**：`lib/skills-admission.js`，三条纯函数（`classifyLicense` / `resolveGoverningLicense` / `scanSkillRisks`），**不联网**。白名单之外一律拒绝，未声明/认不出 → 不可安装；GPL/AGPL **故意不在**白名单（传染性义务该由用户自己判断）。

**核实中的三个关键发现（都改进了实现）**：

1. **`anthropics/skills` 没有顶层 LICENSE**（GitHub API 的 `license` 字段为 `null`），许可完全按技能目录分发，全仓只有 3 种许可文本。docx/pdf/pptx/xlsx 四者的 `LICENSE.txt` **逐字节相同**（1467 B，SHA-256 前缀 `79F6D8F5B4`），`ADDITIONAL RESTRICTIONS` 明确禁止「retain copies of these materials outside the Services」「reproduce or copy」与「distribute … to any third party」→ 四者**硬阻断**（目录里保留、只展示不可装，用户搜 pdf 时能知道为什么没有）。同仓库另有 14 个 Apache-2.0 技能可正常安装——**逐技能判定**由此得到实证。
2. **`anti-ui-slop` 存在声明与实际冲突**：frontmatter 写 `license: MIT`，同目录却带完整 Apache-2.0 `LICENSE` 与第三方 `NOTICE`。**以实际存在的许可文件为准**（Apache-2.0 管辖，另有 §4 的 NOTICE 保留义务）。这条直接催生了 `resolveGoverningLicense()`：许可文件 > frontmatter > 未核实，且**冲突要标记出来给用户看**（产物里 `licenseConflict: true`，实测只有这一条）。
3. **`obra/superpowers-skills` 与 `obra/superpowers` 名字极像但前者已归档**（2025-10-14，31 个被取代的技能，frontmatter 还用 Title Case，README 里**没有**任何废弃横幅——归档状态只在 GitHub API/UI 可见）。收录它 = 让用户装一年前的旧版技能，故不收录，并已由测试钉住。

其它事实：`doc-coauthoring` 既无 LICENSE 文件也无 `license` 字段（**无授权即不可装**，记 Unverified）；`wshobson/agents` 的许可是**插件级**的（仓库根 MIT，逐插件以 `license` 字段声明，实测 90×MIT / 4×Apache-2.0），conductor 插件是 Apache-2.0（3 条候选来自它），故逐条按插件记录而非按仓库聚合；`evaluation-methodology` 的许可是**单来源**（`marketplace.json` 声明 MIT，但该插件自己的 `plugin.json` 完全没有 `license` 字段）。

**⚠️ 流程失误与修正（诚实记录，与 row 2 压缩包那次同类）**：`classifyLicense` 的拒绝正则**首版按我自己改写的「简化版」条款写**，于是那条用例是绿的、**真实原文却漏过**——我写的是 `may not retain copies outside`，而原文是 `Extract these materials from the Services or retain copies of these materials outside the Services`（否定词在上一行的列表引导语里，并不紧邻动作）。改用克隆到的**逐字原文**做用例后当场变红，据此重写全部模式（不要求否定词紧邻，按真实句法匹配）。**教训**：拿自己改写的「代表性文本」当夹具，测的是我的想象而不是真实世界。反向风险也一并守住：用 BSD-2 / MIT / Apache-2.0 的逐字原文测「不得误杀」，因此**刻意不把 `All rights reserved` 当拒绝特征**（它在 BSD 里是标准开头）。

**变异测试（本轮，全部双向）**：许可拒绝侧 5 个 + 误杀侧 1 个 + 证据优先级 3 个 + 目录不变量 8 个，共 **17 个缺陷逐个植入**。其中 2 个目录变异首轮因**锚点写错**而报「未找到锚点」——那等于没测，已按产物实际文本校准锚点后重跑，最终全部被抓。

**主流技能分发方式（已核实，用于定功能范围）**：依据 `vercel-labs/skills`（事实标准 CLI，支持 80+ agent）——Git 仓库引用（`owner/repo`、任意 git URL、私库）、本地路径、单个 `SKILL.md`、**压缩包（.zip/.tar/.tar.gz/.tgz）**、Claude 插件清单 `.claude-plugin/marketplace.json`。压缩包只在「直接下载 URL」这条回退路径上，但确属主流支持范围，故已一并实现。

**row 7 已完成（宿主服务 `skillsManager`）**：`SkillsManagerGateway` 是独立的 `TypertRemoteService`（serviceKey `skillsManager`），暴露 list/detail/setEnabled/remove/importSkill/market/scanSources，作为**子插件**由现有 gateway 的构造函数 `ctx.plugin()` 挂载（`cordis.patch.yml` 仍只有一条条目）。

**必须实测才敢写的一条**：`ctx.skills` **不暴露 `roots()`**（真 cordis Context + 真宿主包实测：公开面只有 registerProvider/register/snapshot/get/collect/…，`roots()` 在 filesystem provider 内部）。而 SPEC 约束 2 要求「根目录由宿主决定，本插件只读不猜」。可行解是从 summary 的 `resourceBase` 推——**判别式必须是「path 恰为 `<base>/SKILL.md`」**：首版用「`dirname(path)===base`」，而该条件在**两种形态下都成立**（捆绑时 path 的父目录正是 base），不是判别式，实测会把扁平技能的根算成上一层（`~/.agents/skills` 算成 `~/.agents`）。推不出时**不填 root**，因为猜错会让启停/删除作用在错的目录上——本层最危险的失败模式。

**SPEC 约束 16 做了行为级验收**（比断言 inject 数组强得多）：用真 cordis Context 在不提供 `skills` 服务的环境里装载两个 gateway，确认 `mcpManager` 照常激活、`skillsManager` 静默等待。之所以必须这样验：inject 写错的真实形态是**静默失效**（服务缺失时 fiber 只等待、不报错），静态断言挡不住语义错误。

**peer 同步 4 处**（照 SPEC 陷阱表）：`package.json` 的 peer+dev、两个测试的 `dshHostPackages`、`pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`。`dsh-skill` 此前**不在 lockfile**，故本轮真正安装 `@deepseek-ai/dsh-skill@0.2.0-rc.2` 并对齐 lockfile（`pnpm add` 会写死精确版本，改成 `^0.2.0-rc.2` 后重装才同步）。

**顺带修掉一个真实缺陷**：`list()` 原本查**两遍**宿主（一次取行、一次算 revision）——两倍工作，且两次之间技能若被改动会产生撕裂视图（指纹与实际渲染的行对不上 → 面板漏刷新）。改为 revision 由已查好的行纯函数算出。

**⚠️ 变异测试暴露了三处「断言看着写了、其实没测到」**（首轮 3/6 存活）：① inject 用**子串**匹配，`["loader","tools","skills"]` 仍匹配 → 改为数组精确比较；② 「推不出根就不填」的兜底**不可达**（用例命中了更早的早退分支）→ 补「有 resourceBase 但形态不匹配」的用例；③ patch 只数了**特定 id**，新增一条别的 id 照样通过 → 改为数条目总数。修正后 6/6 全部被杀死。

**row 8/9 已完成（typert 契约 + 客户端契约副本）**：

- **row 8**：`TYPERT` 新增 7 条 `skillsManager` 调用（list/detail/setEnabled/remove/importSkill/market/scanSources），MCP 的 31 条一条未动，manifest 现在恰好含两个 namespace。另写 `mvs()` 工厂而非复用 `mv()`——后者把 id/service/namespace 三处写死成 `mcpManager`，硬套会得到「id 说 skillsManager、endpoint 在 mcpManager」的条目：结构完全合法、只在调用时静默打到错的服务上。
- **row 9**：skills 的 7 条 descriptor 追加进**同一个** `MCP_CONTRIBUTION`，`apply` 内保持**一次** `$mount`（SPEC 已核实的 Critical 陷阱：`register()` 按 `contribution.package` 去重，第二次 `$mount` 会让插件在 mount 阶段激活失败、面板整体消失）。实测确认 client.js 里只有 1 个 contribution、1 次 `$mount`、1 次 `__injectCss`。
- **契约完整性改由机器推导**：新用例用宿主自己的 `remoteMethods(实例)` 读类原型上的 `@Remote` 标记，与 `TYPERT` 自动比对，不靠人工清单（手抄清单在「加了 `@Remote` 却忘补 `TYPERT`」时会保持绿色）。

**⚠️ 本轮踩到并钉住的两个真实假绿**（都由变异测试发现）：

1. **`remoteMethods()` 要活实例，不是 prototype**——标记由类的静态初始化块装在实例路径上，传 prototype 会返回空数组，于是「契约 vs 实现」的 `deepEqual([], [])` 通过：看起来在守契约，其实什么都没守。已补用例把这个行为记录在案，并断言 `declared.length > 0`。
2. **客户端的 codec 没被任何用例验过**——契约用例只比较 `mode`/`typeSymbol`，而「双渠道」用例只读 `lib/typert.js`。于是「**客户端**的 codec 丢了 `create()`」能全绿通过，而它在 0.1.6-alpha.2 起的宿主上会**加载即拒**。两侧是两份独立产物，必须各自验：已新增遍历客户端全部 codec 的用例，并加反向下限（skills descriptor 必须恰为 7 条，否则循环空转也会「通过」）。

**row 10 已完成（`SKILLS_CSS`）**：管理双栏 + 市场卡片网格 + 风险披露块 + 移动端降级，类名统一 `dsh-skills-*`（与 `dsh-mcp-*` 分开，两者各自的「渲染出来的类都要有样式」扫描器才不会互相误判）。两个 SPEC 陷阱都避开并各有专门用例：① **注入合并成一次** `__injectCss(MCP_CSS + '\n' + SKILLS_CSS)`（那个函数的 id 写死，二次调用会覆写同一 `<style>`，skills 样式会静默冲掉 MCP 面板样式）；② **不声明第二处 body 别名层**（自定义属性在声明处完成替换，第二处会整体覆盖第一处，一半界面取到空值）。

**⚠️ 本轮踩到并钉住的第三个真实假绿**：`SKILLS_CSS` 首版以**裸反引号**结尾（`…}` 换行后直接 `` ` ``）——JS 里完全合法（ASI），但 `extractPanelCss` 的正则要求结尾是 `` `; ``，于是提取器**静默漏掉整份** `SKILLS_CSS`，11 个扫描器一个都没查过新样式，而 12 条主题测试**全绿**。这正是 SPEC 警告的「绿而无效」。发现方式是**事先**写了「真实产物里必须有两份常量且都被扫到」的用例（红→改→绿），而不是靠事后 review。

**⚠️ 编辑事故（诚实记录）**：一次 edit 误删了模块级的 `const h = React2.createElement;`（用 `SKILLS_CSS` 替换了那一行），整个 client.js 会全盘失效。靠「编辑后立刻检查关键词是否还在」发现并恢复。教训：**替换锚点要包含被保留的部分**，只用目标行做锚点会连它一起吃掉。

**row 11/12 已完成（客户端技能组件 + 能力层切换）**：`SkillsPanel`（管理双栏 + 市场卡片网格 + 安装披露弹窗）、`SkillRow`/`SkillDetail`/`SkillCard`/`SkillInstallModal`，复用既有原子。能力层枚举放在 `McpTab` 里，切到「技能」复用**同一个**悬浮窗外壳与侧栏入口，**未新增任何 slot 注册**（`slots` 顺序断言仍恰为 `['shell.overlay','sidebar.footer.action']`）。

**把纯逻辑单独抽出来测**：组件在 jsdom 里渲染得出来 ≠ 对，所以 8 条用例全部对准推导函数——`skillScopeOptions`（作用域候选项由**实际发现的 source 集合**派生，带真实根路径；本机 `~/.dsh/skills` 不存在，写死清单会让用户看到空作用域）、`skillRows`（key 用 `scope:source:name`，按名字当 key 会让 React 把两份不同技能认成一行）、`shadowedSkills`（指出**生效者是哪个来源**）、`skillDiagnostics`、`skillRiskLevel`、`skillFilter`、`skillSourceLabel`。**技能侧独立 `callSkills`** 走 `remote.skillsManager`，取不到时降级为「技能服务未连接」——约束 16 的客户端一侧，不连累 MCP 面。

**⚠️ theme-contract 抓到一个真实缺陷（不是测试噪音）**：`SkillInstallModal` 首版用了 `dsh-mcp-modal-h/-b/-f` 三个类，而**本仓库根本没有这三个类**——既有三个弹窗都用 `h3` + `dsh-mcp-modal-actions`。也就是说那三个类只是被**引用**过、从未有样式定义，我的组件把「无样式的类」渲染出来了。theme-contract 的「渲染出来的类都要有样式」当场判红（正是它存在的理由：拼错类名表现为「这块没排版」，不像报错那样显眼）。已改用既有约定。

**⚠️ 编辑事故（诚实记录）**：中途误把 `readWorkspaces()` 当成既有函数调用——它不存在，是我凭空写的。改为走真实 RPC `listWorkspaces`（既有 MCP 面板同款）。教训：**引用一个「应该是既有」的东西前先确认它真的存在**。

**row 13 已完成（让位检测 D15）**：宿主侧 `conflictingManager()` + 客户端让位分支。**自身排除用 `options.id` 而不是 `name`**——本插件自己的 loader `name` 就是 `package.json.name`，而改名（row 16）在最后，按 name 判定会**命中自身** → 误判为「旧包已装」→ 静默让位 → **面板完全打不开**（约束 10 警告的失败）。**fail-open 是刻意的**：loader 缺失、`entries()` 抛错、返回非数组一律视为无冲突——代价不对称（漏检最坏两个入口并存，误判则用户完全打不开）。名字判据保守（须同时含 mcp 与 manager 两段）。**「让位」的准确含义**（照 SPEC 措辞「不注册**入口**并渲染提示」）：不注册的是会互相遮挡、且都写同一份配置的入口按钮；让位提示仍要渲染，否则用户只看到「装了但什么都没有」。

**⚠️ 本行的变异测试暴露了 3 处「假绿」，全部修正后才 6/6 全杀** —— 这是本轮最有价值的部分：

1. **同一件事有两处判据**：`isMcpManagerPluginName` 里另硬写了一次包名，于是 `options.id === SELF_ENTRY_ID` 变成**冗余**——变异删掉它用例照样绿（自我排除由另一处悄悄完成）。这不只是覆盖问题：两处判据会在改名后**分叉**，届时硬写的那处静默失效，而它正是防「面板打不开」的闸。已收敛到一处。**教训：同一件事只能有一处判据。**
2. **用例里的包装少了一层**：loader 条目是 `{ options: { id, name } }`，首版测试写成 `[..., entry]`，被测代码读 `entry.options` 得 `undefined` 就 `continue` → 该用例**恒真**。
3. **「无关条目」用例选错了样本**：原来那批名字两段都不含，所以「放宽成只查 manager」测不出来。**要测「必须同时满足」，只能用只满足一半的输入。**

**row 14 已完成（市场远端搜索 skills.sh）**：`lib/skills-remote.js` + 宿主 `searchRemote` + 契约两侧。

**API 契约全部来自真实请求实测**（不是文档）：`GET https://skills.sh/api/search?q=<≥2字符>&limit=1..200` → `{skills:[{id,source,skillId,name,installs}],count}`。实测边界：`limit=0` 夹到 1、`limit=500` 夹到 200、不传得 100（上限 **200**）；**q 少于 2 字符直接 400**，所以短查询在发请求之前就返回（搜索框随打随搜，否则每敲一个字符白挨一个 400）。**约束 9 得到实证**：实测 `q=superpowers` 返回 **9 个不同 source** 的同名技能（`obra/superpowers` 与 `101-skills/superpowers`、`qu-skills/superpowers` 等），另出现非 owner/repo 形态的 `open.feishu.cn`。故**白名单与形态校验是两道独立的闸**；且形态校验不能只看「两段」——`smithery.ai/x` 恰好两段但是域名，所以 owner 段必须符合 GitHub 命名法（不含点）——这条是写完首版后被用例逼出来的修正。**约束 11 的落地**：任何失败都退化成 `{skills:[], degraded}`、**永不抛错**。远端条目一律 `installable:false`（远端搜索**不做**许可核实，不让未核条目看起来像内置目录里已核实的那些）。白名单与目录同集合**由测试用行为取样反推比对**，不靠注释承诺。

**⚠️ 本行踩到一个测试隔离缺陷**：宿主那两条用例共用同一查询串，而库层有 5 分钟缓存——第二条「离线降级」拿到的是第一条的缓存值，**根本没走到网络路径**（等于没测）。已在每条用例前后 `resetSkillsSearchCache()`。**教训：有缓存的被测对象，用例之间必须显式清缓存，否则「测第二条」实际上在测第一条。**

**row 15 已完成（文档与元数据 + 版本 bump → 1.6.0）**：新增 `docs/skills-manager.md`（作用域优先级、启停为何是改名、安装三种来源、许可门禁、搜索行为）、`.github/release-notes/v1.6.0.md`、whats-new 1.6.0 条目；README / README.en / docs/design.md 补技能面说明与包结构。

**意外发现的第三个真源**：README / README.en / installation.md **三份**文档的安装命令都写着具体版本号（`add dsh-mcp-manager-ui@^1.5.0` 与 `add github:…#v1.5.0`），而 `package-contract` 的 documentation 用例逐份断言它们等于 `packageJson.version`——所以 **bump 版本会连带要求改三份文档共 11 处**。这不是事先知道的，是跑测试时红的。

**⚠️ 变异测试的教训（值得记）**：首轮 6 个变异有 3 个「存活」，但查下来是**变异本身太弱**，不是守着的东西有缺口——① 我删掉的是**断言自己**（用断言抓「断言被删」是同义反复，本就不可能红）；② release notes 里还有另一行 `add` 命令，而正则写作 `(?:add|update)`，换掉 update 那行仍匹配；③ 我只把标题换成占位，正文还在（仍 >500 字符且含关键词）。改成真正的控制点后（收窄 `files` 字段 / 整段删掉升级说明 / 整份换成真占位），3/3 全部被杀死。**教训：变异存活时先怀疑变异，再怀疑测试**——一个「不可能失败」的变异和一条「永远通过」的用例是同一类错误。

**row 16 已完成（改名 → `dsh-toolbox-ui`）**：共 65 处身份耦合（codec typeSymbol 2 / 样式去重键 5 / 契约 invocation id 40 / 独立字符串 16 / JSON 字符串 2）+ 文档与元数据。**`dsh-mcp-*` 样式前缀 558 处一处未动**（实测改名前后都是 558，且 0 处 `dsh-toolbox-` 样式前缀渗入）；仓库三字段仍指向 `Imzl-zl/dsh-mcp-manager-ui`（D13 双包同仓，仓库不跟着改）。

**⚠️ 本行三个教训（都是「测试看着在守、其实没守」的变体）**：

1. **一个「防漏网」用例首版是恒真的**：旧名残留检查里有一条 catch-all 白名单 `/dsh-mcp-manager-ui/`（本意是「指代旧包的说明文字」），它匹配**任何**含旧包名的行——**138 行全部被放行**，改名前后同样通过。改为逐出现判定上下文 + 取样下界后，它立刻抓出真漏改（`sourceLocation.file`、`upgrade.test.mjs` 的 `UPGRADE_PACKAGE` 期望值、`typert.js` 文件头）。**再次印证：变异/改名这类「应当改变行为」的操作，是检验用例是否恒真的最好手段。**
2. **`<旧名>#` 这条替换规则越过了语义边界**：它在契约 id 里是「包名#方法」，在 URL 里是「仓库名#tag」——同一字面形态两种含义。于是产出了指向**不存在仓库**的命令（`github:Imzl-zl/dsh-toolbox-ui`）。已全面还原并加扫描确认。**基于子串的改名规则必须逐条说明它改的是哪一类身份。**
3. **定义基准的测试不能参与被测的改动**：改名脚本把它自己那份测试里的旧名字面量也改了，于是它拿**新**名去查「旧名残留」（把新包名每一行都报成漏网，真正的旧名一处未查）。已把旧名抽成显式 `OLD_NAME` 常量并写明理由。

**顺带修掉一个真源问题**：仓库名与包名改名后**已不相等**，而三条断言把它们混为一谈（都拿 `packageJson.name` 去比 github URL）。已改为各自从真正的来源推导——patch 的 `name` 用 `package.json.name`，github 安装命令用从 `repository.url` 解析出的仓库 slug。将来仓库改名也不会再波及包名断言。

## Planning 阶段完成事项

- **工件**：`SPEC.md`（设计真值，含 D0–D18 决策表、改名触及面、已核实陷阱表、环境基线）+ `TODO.csv`（16 行，依赖闭环已校验）+ `PROGRESS.md`。
- **Cutover 已完成**：`DESIGN.md` 已删除（其关键资料全部迁入 SPEC 附录 A/B/C，无悬空引用）。
- **计划审查已执行并处置**：审查子代理报 3 条，逐条核实后**全部接受并修正**（均为真实问题）：
  1. **[Critical] 第二次 `$mount` 必抛错** —— `typert.remotes.register()` 按 `contribution.package` 去重（`dsh-typert-registry/lib/index.js:143`），两侧 package 同名 → 插件在 mount 阶段激活失败、面板消失。**修正**：任务 9 改为把 skills descriptor 合并进同一个 `MCP_CONTRIBUTION`，保持一次 `$mount`（descriptor 只按 endpoint `namespace/method` 与 id 去重，天然支持多 namespace）。
  2. **[Important] 任务 15 漏版本 bump 且边界自相矛盾** —— release-notes 文件名由 `packageJson.version` 推导（`package-contract.test.mjs:132`）；`package-contract.test.mjs:41` 与 `package-artifact.test.mjs:84` 硬编码 `'1.5.0'`，而原 validation 未含 `package-artifact`。**修正**：任务 15 边界与 related_files 纳入 `package.json` 版本 bump 与两个测试文件，validation 补 `package-artifact`。
  3. **[Important] 任务 13 让位检测会命中自身** —— 本插件自己的 loader `name` 就是 `package.json.name`，而改名（任务 16）在最后 → 必然误判为「旧包已装」→ 静默让位、**面板完全打不开**（正是 SPEC 约束 10 警告的失败）。**修正**：检测须排除自身，按 `entry.options.id !== 'mcp-manager-ui'` 过滤。
  - 另采纳 2 条 advisory：任务 11 补 SPEC 约束 12/13 的断言；任务 16 提示 `package-contract.test.mjs:58` 的 `repository.url` 断言。
- **机械核对**：25 个引用文件全部存在、17 个新建文件均尚不存在；16 行依赖闭环；16 条 SPEC 约束均有任务落点；无占位符。

## 跨会话恢复须知

- **恢复入口**：本文件 → `TODO.csv` 的 `status` 与 `Current` 字段。
- **双包关系**：本分支产出 `dsh-toolbox-ui`；`main` 上的 `dsh-mcp-manager-ui` 继续 MCP-only 维护。MCP 修复先落 main，再 **git merge** 进本分支（不是 cherry-pick）。
- **改名是最后一步**（D16 / row 16）：在此之前所有契约 id 仍用 `dsh-mcp-manager-ui`，属**预期中间态**，不要提前改。
