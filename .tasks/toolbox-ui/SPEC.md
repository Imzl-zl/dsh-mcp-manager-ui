# Skills 管理 + 市场（同一代码库双包）— Execution Spec

**本文件是本 effort 的唯一设计真值**（`DESIGN.md` 已在 planning cutover 删除）。三条维护纪律：

1. **每条规则只在这里声明一次。** 约束自带「要求 / 证据 / 做法」三段，不另设陷阱表；附录只放清单（改名触及面、环境、原型），不复述规则。随包发布的 `docs/*.md` 是**用户/集成文档**，可以复述结论，但不得引入本 SPEC 没有的要求；两者冲突时以本 SPEC 为准。
2. **id 与编号一旦分配，不复用、不重排。** 决策 `D*` 与约束编号在 `lib/index.js`、`lib/client.js`、`scripts/`、`test/skills-*.test.mjs` 里有 30+ 处引用，重排会让**漏改的引用指向另一个仍然存在的编号**（静默错，不报错，`test/tasks-spec-integrity.test.mjs` 也抓不到——它只能判「可解析」，判不了「指对了」）。所以新增只能**追加到末尾**：R1 的新决策是 D19，不是任何被腾出来的号。`D2/D9` 是历史合并行（两个号指同一条决策），保留原样。

3. **不写易变数字。** 测试条数、样式前缀处数这类量每次都变，只在 `PROGRESS.md` 的 `Latest validation` 记当次实测值，或用下界断言（`test/package-rename.test.mjs` 用 `> 500`）。写进本文件的数字必须是恒定的（结构条数、限额、rank、限额字节数）。

Retired-ids: D3, D4
（这两个号来自已删除的 `DESIGN.md`，内容随该文件消失、未进入本 SPEC。任何引用它们的文字都是**过期引用**：按名字重新定位，不要去找 D3/D4。`test/tasks-spec-integrity.test.mjs` 读这一行，所以格式不能改。）

## 撤回记录

**2026-10-10 撤回：内置精选目录与 skills.sh 补充搜索整条线下线，市场只留 skillhub.cn。**
两条原因：① skillhub.cn 上游已有的技能足够多，自维护一份精选清单不再值得；② 内置精选目录的数据里**没有可固定的 commit/tag**，只能抓默认分支、不可复现，所以它本来就做不成可复现的安装来源（Non-goals 里那条待办随之取消）。
随之删除：目录数据与生成器、目录产物、许可门禁模块、skills.sh 远端搜索模块，以及契约三边对应的 `market` / `searchRemote` 两条端点（各剩 11 条）；宿主侧的 skills.sh 白名单（`REMOTE_SKILL_ALLOWLIST`）一并删除。
被撤回的条目（原编号与大意**保留**，就地标「已撤回」，不重写历史）：**D6**、**D12**、**约束 8**（含其三条子项）、**约束 9**、**约束 18** 里「来源默认内置精选」那一句、Non-goals 里「内置精选的一键安装」一条、Final validation 第 2 条里的「许可门禁拒绝」与「市场远端过滤」。
**撤销的是闸门，不是披露纪律**：许可门禁随目录一起下线；外部源本来就不做许可判定（约束 17）——安装前仍要摆出发布方认证、安全扫描结论与是否需 API Key，并要一次**显式确认**。

**Goal:** 在 `dsh-toolbox-ui` 这条产品线里新增 Skills 能力面（管理 + 市场），与既有 MCP 能力并列；`main` 上的 `dsh-mcp-manager-ui` 保持 MCP-only 并继续维护。

**Decisions:** 设计阶段确认；R1 追加 D19。「决定者」＝该决定由谁拍板：`user` 表示用户拍板、改动须重新经用户确认；`model` 表示模型在授权范围内确定、用户可推翻；`待确认` 表示尚未取得该确认。这 18 行**不是**「都经用户确认」——原表头那么写是错的。

| id | 决策 | 决定者 |
|---|---|---|
| D0 | 管理与市场**一起做**，不做「只有市场」的半成品 | user |
| D1 | 复用宿主 `ctx.skills`（list/get/snapshot），不自建技能扫描 | model |
| D2/D9 | 改名为新包；**旧包不 deprecate**，`main` 保持 MCP-only 并继续维护（两条线并行） | user |
| D2b | 市场安装**跟随当前选中的作用域**，不每次询问 | user |
| D5 | `extractPanelCss` 改为支持多 `*_CSS` 常量（已实施） | model |
| D6 | ~~市场以**内置精选目录**为主，skills.sh 作搜索补充~~ **已撤回（2026-10-10，见顶部「撤回记录」）**：整条线删除，市场只留 skillhub.cn | user |
| D7 | IA = 双层分段控件（标题栏：能力层 MCP/技能 → 第二行：模式层 **已安装/发现市场**）；**作用域药丸只在「已安装」出现**；两层都只由外壳渲染一次 | model |
| D8 | 管理行按（名称 + 作用域）精确操作；新增「被遮蔽 / 非法条目」提示 | model |
| D10 | 入口维持现状（`shell.overlay` + `sidebar.footer.action`），不用 `sidebar.panellist` | user |
| D11 | 管理页 = 左列表 + 右详情；市场页 = 卡片网格 | user |
| D12 | ~~市场源分档，许可门禁为硬闸门~~ **已撤回（2026-10-10，见顶部「撤回记录」）**：市场只剩 skillhub.cn 一个来源，许可门禁随内置精选目录一起下线（外部源本就不做许可判定，见约束 17） | model |
| D13 | **同一代码库双包发布**；MCP 修复走 `git merge` 而非 cherry-pick | user |
| D14 | 新包名 `dsh-toolbox-ui` | user |
| D15 | 新包检测到旧包时**主动让位**（须排除自身，见约束 10） | user |
| D16 | **先做功能，最后改名** | user |
| D17 | skills 服务作独立子插件（自带 `inject = ["skills"]`），现有 gateway 的 inject 不变 | model |
| D18 | `SKILLS_CSS` 与 `MCP_CSS` **合并为一次** `__injectCss` 调用 | model |
| D19 | 市场引入**第二个外部源 skillhub.cn**（宿主侧直连上游、不复用第三方同源路由、不做许可判定）；R1 轮次，见约束 17–19。**2026-10-10 起它是市场唯一的来源**（内置精选与 skills.sh 已撤回，见顶部「撤回记录」），决策本身不变 | user |
| D20 | UI 作用域模型＝**「全局 + 各工作区」**（候选项来自实际发现的 source）——**不采用**原型的 `当前项目 / 系统内置` 分段：多个工作区并存时「当前项目」本身有歧义；原型那一行**只对齐外观，不逐字照抄** | user |

**Constraints:**

1. **宿主基线 `0.2.0-rc.2`**，peer 下限维持 `>=0.1.5-rc.1 <0.2.0`（D10 不用 panellist 槽位，故无需抬高下限）。
2. **skills 侧根目录由宿主决定，本插件只读不猜**：`<projectRoot>/.dsh/skills`(100) · `<projectRoot>/.agents/skills`(200) · custom(300) · `<dshHome>/skills`(400，跳过 `.system`) · `<agentsHome>/skills`(500) · bundled(600，只读)。
3. **禁用 = `SKILL.md` ↔ `SKILL.md.disabled` 重命名。**
   - *证据*：DSH 无 `disabled` 字段（MCP 有、skills 没有）；`isRelevantWatchEvent` 对目录捆绑只看 `segments[1] === "SKILL.md"`（`dsh-skill-filesystem/lib/index.js`），改名触发 unlink → provider 失效 → 下次查询刷新；扁平文件规则要求 `name.endsWith(".md")`，`x.md.disabled` 不匹配、不会被误扫。
   - *缺口与做法*：**禁用后技能从宿主目录消失**，所以面板无法从 `ctx.skills.list()` 得知「存在但被禁用」——必须**自行扫描各 root 下的 `SKILL.md.disabled` / `<name>.md.disabled`**，再与宿主目录做差集。这是「管理」相对「模型目录」的第二个独有价值（第一个是非法条目诊断）。`dsh-atomic-write` 只导出 `writeFileAtomic` 与 `withFileLock`、**没有 rename**，启停直接用 `node:fs/promises` 的 `rename`。
   - *待扫的根来自能力，不来自观察*：根集合必须从 `skillTargetsView` 取（宿主支持的全部位置），**不得从可见行反推**——某个根里的技能全被停用时可见行里没有那个根，于是它永远不被扫，面板零显示也无法恢复（与「启用判据写反」叠加就是永久失联）。禁用行还必须带上 `source` 与项目路径：客户端的分组、作用域标签与药丸全靠它们，缺了就并成一个无名组。
4. **frontmatter 按 DSH 源码逐字校验**：`name` 必须匹配 `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`；必需 `name`+`description`；可选 **`whenToUse`（驼峰）**、`metadata`、`disable-model-invocation`、`user-invocable`。**不是**外部规范的 `when_to_use`（那是 Claude Code 的字段）；DSH 明确拒绝驼峰式 `disableModelInvocation`。**issue 顺序照抄宿主校验顺序**，使 `issues[0]` 恒等于宿主跳过的那个原因。
5. **契约两侧必须同步**：`lib/typert.js` 的 `TYPERT` 与 `lib/client.js` 的 `*_CONTRIBUTION` 由 `test/client-lifecycle.test.mjs` 逐字段 deepEqual 绑定；codec 必须**同时**写 `schema` 与 `create()`（宿主 0.1.5-rc.x 查 `schema`、0.1.6-alpha.2 起查 `create()`，少写任一即在那一侧加载被拒）。
6. **样式闸门**：新增样式必须并入 `*_CSS` 常量（`extractPanelCss` 已支持多常量）；禁字面色值、禁自造圆角刻度；别名层唯一宿主为 `body`；全圆角同规则补 `corner-shape:round`；等宽只用 `--ds-font-family-code`；抬升面（`--dsw-elevation-*` / `--dsw-shadow-lv*`）**不得再叠中性边框**（elevation 自带 0.5px stroke）；品牌色是单色（`--dsw-alias-brand-primary` 浅 `#0f1115` / 深 `#f9fafb`），蓝色是 `--dsw-alias-state-business-primary`，别混；**每个被渲染出来的类都必须有样式**（有扫描器，拼错类名的表现是「这块没排版」，不像报错那样显眼）。
   - 已有 `@media (prefers-reduced-motion:reduce)` 动效降级并有用例守着，**保留**；`.dsh-mcp-dot.loading` 的呼吸是刻意不关的例外。
7. **`dsh-mcp-*` 样式前缀保留不改**：它是内部类名，与包名无关；改了会与 `main` 大面积冲突，且 `theme-contract` 的 class 扫描正则写死该前缀。数量只做下界断言（`> 500`），不钉精确值。
8. **已撤回（2026-10-10，见顶部「撤回记录」）：许可门禁是硬闸门，仅适用于内置精选目录**——原规则：逐技能判定、**不得按仓库聚合**；白名单（MIT/Apache-2.0/BSD-2/BSD-3/ISC/MPL-2.0/CC0-1.0/Unlicense/0BSD）之外一律 unknown → 不可安装（未声明 = 无授权）；GPL/AGPL **故意不在**白名单（传染性义务由用户自己判断）。内置精选目录与 skills.sh 删除后这道闸已无适用对象（外部源不做许可判定，约束 17）；以下三条子项一并**已撤回**，原文只作历史与证据保留。
   - *证据（历史，规则已撤回）*：`anthropics/skills` 没有顶层 LICENSE（GitHub API 的 `license` 为 `null`），docx/pdf/pptx/xlsx 四者的 `LICENSE.txt` 逐字节相同（1467 B），其 `ADDITIONAL RESTRICTIONS` 禁止「retain copies of these materials outside the Services」，故四者硬阻断；同仓库另有 Apache-2.0 技能可正常安装——逐技能判定由此得到实证。反向风险同样要守：用 BSD-2 / MIT / Apache-2.0 的逐字原文测「不得误杀」，因此**刻意不把 `All rights reserved` 当拒绝特征**（它是 BSD 的标准开头）。
   - *做法（已随本轮删除作废，原文保留）*：`installable` 由生成器调用 `classifyLicense()` 算出，**不写进 YAML**（写进数据会形成第二真相源：改了规则却漏改数据，门禁静默失效）。许可证据优先级＝目录内许可文件 > frontmatter > 未核实，**没有逐技能声明时不得回落到仓库级许可**。
   - *没有旁路（已撤回）*：内置精选**不提供一键安装**（唯一可安装来源是外部源，见约束 17–19），所以当时门禁是**构造上**成立的——不存在「许可受限也能勾选装进去」的入口；现在这份目录本身已删除。
9. **已撤回（2026-10-10，见顶部「撤回记录」）：市场来源必须白名单 owner，且形态合法**——这条只针对 skills.sh：它的 `source` 实测含仿冒同名（`obra/superpowers` vs `obra/superpowers-skills`）与非 GitHub 值（`smithery.ai/…`、`open.feishu.cn`）。白名单与形态校验是**两道独立的闸**；形态校验不能只看「两段」——`smithery.ai/x` 恰好两段但是域名，故 owner 段必须符合 GitHub 命名法（不含点）。skills.sh 整条线已删除，本约束随之作废（skillhub.cn 走上游自己的搜索接口，没有 owner 白名单）。
10. **让位检测（D15）失败时 fail-open，且必须排除自身。**
    - *证据与做法*：fail-open 是刻意的——漏检最坏是两个按钮并存（可自愈），误判则用户**完全打不开面板**（代价不对称），所以 loader 缺失、`entries()` 抛错、返回非数组一律视为无冲突、catch 里不抛。**自身判据只能有一处，用 loader entry 的 `options.id`，不能用 `name`**：本插件自己的 loader `name` 就是 `package.json.name`，按 name 判定必然自伤 → 静默让位 → 面板打不开。名字判据保持保守（须同时含 `mcp` 与 `manager` 两段）。
    - 「让位」的准确含义：不注册会互相遮挡、且都写同一份 profile 配置的**入口**，但**让位提示仍要渲染**，否则用户只看到「装了但什么都没有」。
11. **面板本身不开新网络依赖；联网只发生在宿主侧**：本插件历史上唯一 HTTP 是 `checkForUpdate()`；市场首屏原为**离线可用**（内置目录随包发布）——**该前提已于 2026-10-10 随目录撤回失效**（见顶部「撤回记录」）：市场只剩 skillhub.cn，技能面一挂载就会发出宿主侧请求，因此**失败必须静默降级**、面板照旧可用。外部源的两条补充规则见约束 18、19。
12. **UI 不得写死 skill 根路径**：按宿主返回的 `source`（`user-dsh` / `user-agents` / `project-dsh` / `project-agents` / `custom` / `bundled`）显示其真实路径，不得假设某一级存在；作用域选择器的候选项来自**实际发现的 source 集合**，而非硬编码列表。
    - *证据*：同一台机器两次实测——2026-10-08 `~/.dsh/skills`（rank 400）**不存在**、11 个技能全在 `~/.agents/skills`（rank 500）；2026-10-10 复查 rank 400 目录**已存在但为空**。两次观测正好证明规则本身：**不能假设某一级存在或不存在**，判定只能按宿主实际返回的 `source`。
    - *作用域分段的语义按 D20*：用「全局 + 每个工作区」，**不设**「当前项目」「系统内置」两个语义段（`bundled` 以来源标签呈现）。与原型一致的只有外观——**不要**为了逐字对齐原型而改语义。
13. **每个作用域要各调一次 `list()`**：`ctx.skills.list(options = {})` 的 `cwd` 可选，provider 的 `roots(cwd)` 只在 `cwd !== undefined` 时才加入项目根（`includeDefaultRoots && cwd !== void 0` 分支）。
    - 传 `cwd` 时返回的是「项目 + 用户 + bundled」**完整合并视图**，所以项目查询结果**已包含**全局技能——直接 concat 会让每个全局技能在每个项目里各重复一份。项目查询只取 `source` 归属为 `project-*` 的行；**不可**按名称做差集（同名跨作用域合法）。
14. **管理动作不依赖会话**：面板的读取与文件操作都不得要求存在活动会话。官方 `ctx.remote.skills.list` 需要真实 `sessionId` 且会激活冷 Agent，故本插件必须走自己的 RPC。
15. **第二个服务必须在同一条 patch 条目内挂载**：`cordis.patch.yml` 只有一条 `- id: mcp-manager-ui / name: <包名>`，且 `test/package-contract.test.mjs` 断言该 id 与 name 各出现恰好 1 次、条目总数恰好 1。Cordis 支持子插件挂载（`ctx.plugin(plugin, config)`，`cordis/lib/index.js:1619`），故 `SkillsManagerGateway` 由现有 gateway 的构造函数 `ctx.plugin()` 挂载。`TypertRemoteService` 的构造签名是 `(ctx, serviceKey, options?)`，`serviceKey` 同时是 Cordis 服务键与默认 wire namespace：MCP 用 `mcpManager`，skills 用 `skillsManager`。
16. **`skills` 不得进入现有插件的 `static inject`**：Cordis 的 `inject` 是**依赖声明**——服务缺失时该 fiber 只保持不激活并等待，**不报错也不激活**（`cordis/lib/index.js` 的 `notify()` → `fiber._refresh()`）。若把 `skills` 加进现有 gateway 的 inject，任何未挂载 `@deepseek-ai/dsh-skill` 的 profile（用户可禁用该内置插件）都会让**整个 MCP 面板一起失效**。现有 gateway 的 `inject` 保持 `["loader","tools"]` 不变，skills 服务作独立子插件自带 `inject = ["skills"]`；客户端取不到 `remote.skillsManager` 时按「技能服务未连接」降级，MCP 面板照常可用。
17. **外部源（skillhub.cn）不做许可判定**（R1）：上游条目**没有 license 字段**，只有发布方企业认证 `publisher.certifiedName` 与腾讯安全扫描结论 `securityReports.keen/sanbu`——假装能判就是编。外部源安装前必须把发布方认证、安全扫描结论、是否需 API Key 摆出来，明确写出「本插件未核验」，并要求一次**显式确认**（勾选后才可点安装）。内置目录那套闸门（约束 8）**已随 2026-10-10 撤回一起下线**（见顶部「撤回记录」）；市场只剩这一个来源，安装弹窗也只服务它。
18. **外部源直连上游，且由宿主侧发起**（R1）：`api.skillhub.cn` 公开无鉴权，请求由宿主侧发出，面板仍不联网（因此也不存在浏览器 CORS 问题）。~~首屏依旧离线：来源默认「内置精选」，切到 skillhub.cn 才发请求~~ **已撤回（2026-10-10，见顶部「撤回记录」）**：内置精选已删除，skillhub.cn 是唯一来源，技能面一挂载就会发一次搜索与一次分类请求，此后的搜索按「切分类 / 回车」触发；⚠️ **本条曾经不成立，2026-10-10 已修**（同一轮里真机抓到两个缺陷，都记在这里）：
（a）**逐击键打上游**——本地搜索框与市场搜索框当时共用同一个 `query` 状态，而挂载副作用的依赖链是 `useEffect([call, searchHub]) ← searchHub = useCallback([call, hubCategory, query])`，所以**任一搜索框里击键都会逐次触发一次上游搜索**（回车与切分类只是再触发一次），与「不随击键打网络」相反。修法：拆开**草稿**（`marketDraft`）与**已提交关键字**（`hubKeyword`），输入框只改草稿、回车才提交，`searchHub` 只依赖后者；两个搜索框也各用各的草稿。真机 wire：修前敲 3 个字 = **3 次** `skillHubSearch`，修后 = **0 次**、回车 = 1 次。
（b）**无限重发**——删掉内置精选（`skillsManager/market` 端点随之消失）时漏了一个调用点：外壳那处「技能服务可用性探针」仍在调 `callSkills('market')`。它必然拿到 `{ok:false}`，于是面板先把技能面标成「服务未连接」，并触发一串连锁重渲染：真机 wire 上 `skillsManager/list` + `skillTargets` + `mcpManager/list` + `listWorkspaces` 在**任何 state 变化之后**（例如在搜索框里敲一个字）以约每秒一轮无限重发——修前实测敲 3 个字后 4 秒 +3 轮、修后 delta 0。修法：探针改探 `list`（同样只读本机技能根、不发网络请求，而且是权威答案）；并加一道**源码扫描闸**（客户端源码里每一处 `callSkills(…)` 都必须指向真实存在的方法），它正好能抓住「删了端点却漏了调用点」这类漏网。任何失败（网络断/超时/5xx/JSON 坏/字段缺失）只在结果区显示一条告警 + 重试，**永不抛错、永不拖垮面板**。
19. **不复用第三方插件的同源路由**（R1）：如 `@cocofhu/skillhub` 的 `/skillhub` 是它的私有协议而非宿主契约（它卸载/改版即失效），且那个插件同时握有装/重启 DSH 插件的权限。直连上游另有一条实质好处：**落点由面板选**（复用同一套「安装到」＝全局/项目 × `.dsh`/`.agents`），而不是由上游替用户决定。
20. **文件动作按 `(name, scope, root)` 精确定位，找不到即报错不回退**（同名跨作用域是合法配置，静默回退会作用到错的目录上——本层最危险的失败模式）；bundled 根拒写。
    - 读-改-写类动作在 `withFileLock` 内做。导入按 **frontmatter 的 `name`** 落盘（宿主身份取自 frontmatter，不是文件/目录名，`dsh-skill-filesystem/lib/index.js:696-704`），否则本层自己的 `resolveSkillTarget(name)` 找不到刚导入的技能；导入前跑完整 frontmatter 诊断（宿主对非法技能只 warn + 跳过，放进来等于装了一条「看不见的技能」）；**先全量校验再落盘**，任何失败都不在用户技能根里留残骸；同名已存在（含 `.md` / `.md.disabled` 各种形态）**拒绝而不覆盖**。
    - 压缩包按**魔数**识别（下载 URL 可以不带扩展名），支持 zip(stored/deflate)/tar/tar.gz；防 zip slip、拒符号链接与硬链接、按**实际解出字节**卡总量（头部声明值是攻击者可控的），限额 10 MiB/文件、25 MiB 总量、1000 条目；**先解到系统 tmp** 再挑技能根（暂存放技能根内会被宿主扫成一条技能）。技能根取**最浅**的 `SKILL.md`，同层多个则**拒绝**（多技能包静默挑一个等于猜）。目录导入同样拒绝符号链接/junction（`fs.cp` 默认保留链接），**树根自身也要查**（只从内部走会漏掉「调用方给的路径就是 junction」那种情形）。
    - **限额必须发生在解压过程内**：`inflateRawSync` / `gunzipSync` 都带 `maxOutputLength`。限额检查原本在解压**之后**，于是 0.2 MiB 的 deflate 包能先分配 256 MiB 再被拒（实测 RSS +520 MiB）——压缩比是现成的 DoS 通道。镜像地，压缩包**输入**大小必须在 `readFile` 之前用 `stat` 卡住（32 MiB）。
    - **tar 必须认 PAX / GNU 扩展头**：`git archive`、GitHub codeload tarball、部分 `npm pack` 产物的第一个块就是 `pax_global_header`（typeFlag `g`）。`x`/`g` 当元数据消费（`path=` 记录可给出超长条目名）、`L` 应用到下一条目、`K` 跳过；只对真正的链接/设备/FIFO 保持拒绝。夹具必须能造出这种包，否则「支持 tar」是假绿。
    - **所有写入都在锁内 + 原子提交**：`setSkillEnabled` / `removeSkill` / `importSkill` 一律 `withFileLock(join(root, name))`（同一把键，同名操作彼此串行）——并发同名导入曾双双通过「目标空闲」检查，随后一条的失败清理删掉另一条正在写的目录。落盘用「根内**对宿主不可见**的暂存名 → rename」：扁平用不带 `.md` 后缀的临时名（宿主只认 `*.md`），目录捆绑用 `<root>/.dsh-import-<随机>/skill` 两层结构（宿主判定技能看 `<dir>/SKILL.md`，外层没有）。
21. **样式注入只发生一次，且拼接顺序有意义**：`MCP_CSS` 与 `SKILLS_CSS` 合并为**一次** `__injectCss` 调用——那个函数的 id 与 `data-plugin-css` 写死，同 id 二次调用会复用同一个 `<style>` 并覆写 `textContent`，skills 样式会静默冲掉 MCP 面板样式。
    - 两张表按 MCP → SKILLS 顺序拼接，**同特异性下 `SKILLS_CSS` 天然压过 `MCP_CSS`**：任何「覆盖块」必须放在 `SKILLS_CSS` 的最末尾，并且这个位置约束要写在注释里。两次真机事故都出自这里（`.dsh-mcp-pane-off` 被后面的 `.dsh-mcp-card{display:flex}` 压掉、外壳对齐块接在 `MCP_CSS` 末尾导致圆角与选中背景不生效）。
    - 改完必须到真机上看 `getComputedStyle` 的实际值，不能只看源码顺序合理。
    - **CSS 注释里不得出现反引号**：整张样式表是模板字符串，一个反引号就提前闭合它。
    - **不声明第二处 body 别名层**：自定义属性在**声明处**完成替换，第二处 `body` 声明会整体覆盖第一处，一半界面取到空值。
22. **客户端只注册一个 contribution、只 `$mount` 一次**：`$mount` → `mountContribution` → `typert.remotes.register()`，register 按 `contribution.package` 去重（`dsh-typert-registry/lib/index.js:143` 抛 `Remote package "…" is already registered`）——第二次 `$mount` 会让插件在 mount 阶段激活失败、**面板整体消失**。skills 的 descriptor 追加进**同一个** contribution（descriptor 只按 endpoint `namespace/method` 与 id 去重，天然支持多 namespace）。
23. **详情组件必须是纯函数**：`ServerDetail` / `SkillDetail` 被测试以普通函数调用（校验渲染文本），函数体里放 `useState` 会抛 `Invalid hook call`——页签状态因此放在薄包装 `ServerDetailPane` / `SkillDetailPane` 里。页签的**非当前页只隐藏不卸载**（`dsh-mcp-pane-off`），否则「详情必须画出正文/根路径」的断言失效。
24. **新增宿主 peer 依赖要同步 4 处**：`package.json` 的 peer + dev、`test/package-contract.test.mjs` 与 `test/package-artifact.test.mjs` 的 `dshHostPackages`、`pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`。注意 `dsh-skill` 可能不在 lockfile，加 devDependency 会动 lockfile（`--frozen-lockfile` 下会红）。
25. **版本 bump 的连带面**：`test/package-contract.test.mjs` 与 `test/package-artifact.test.mjs` 里有硬编码版本断言，release-notes 文件名由 `packageJson.version` 推导（不 bump 则新 notes **永不被读取**），三份文档（`README.md` / `README.en.md` / `docs/installation.md`）里的安装命令共 11 处写着具体版本号且被逐份断言——bump 必须一并同步，且 validation 必须包含 `package-artifact`。
26. **wire 只送引用，落点由服务端解析**：`setEnabled` / `removeSkill` / `importSkill` / `skillHubInstall` 的载荷只带一个引用 `{source, root, projectPath}`；服务端拿**自己算出来的**目标集合（`resolveTargetReference` → `skillTargetsView`）核对，命不中就拒，`writable` 一律以服务端那份为准（载荷里那个不再读）。外部源安装还必须在 wire 上带 `acknowledged: true`。
    - *为什么*：`root`/`writable` 直接取自载荷时，「写入限定在技能根内」「bundled 只读」「勾选后才可装」这三条**只由客户端保证**——一个 `removeSkill {name:'<任意 kebab-case 名>', root:'<任意目录>'}` 就能递归删掉 `<任意目录>/<名>`（例如整个仓库），`importSkill {root:'<bundled 路径>', writable:true}` 能写进只读根，而确认勾选框只是 UI 上的一个 `disabled` 表达式。判据必须在**持有真值的那一侧**。
    - *纪律*：新增变更类 RPC 一律照此办理——载荷里出现绝对路径或 `writable` 就是回归。
    - *读也按引用*：`detail` 同样按引用定位到**那个根**再读文件（`resolveTargetReference` → `resolveSkillTarget` → `readSkillFile`），不走 `ctx.skills.get(name)`——那个按 rank 返回生效者，点「被遮蔽」那一行会读到别人的正文（与 D8 的精确模型冲突）。顺带：停用时定位结果是 `.disabled` 路径，所以已停用技能的正文也读得出来。
27. **同一件事只能有一个身份函数**：技能行的身份＝`source + cwd + name`（客户端的 `skillIdentity`），安装目标的身份＝`source + root`（`installTargetId`）。React key、分组键、诊断判据、detail 引用、落点查找全部从这两处派生，**不允许出现第三种写法**。
    - *为什么*：曾经有四种（行 key `scope:source:name`、分组 `rank\0source\0cwd`、诊断去重 `scope:name`、安装目标 `source`），每一种都要重新记得「同名跨作用域是合法配置」这条事实，漏掉一个就是静默错——诊断列表因为 `scope:name` 撞车而恒为空（调用方只好把输入清空），行的 key 少了 cwd 会让两个工作区的同名技能撞成一行，安装目标只用 source 会把两个工作区合成一项并装进第一个。

**Non-goals:**

- 不实现宿主 skills 运行时（registry/provider/工具/斜杠命令由 DSH 提供）
- 不做 skills 分组、跨工作区批量迁移（`dsh-skill-mcp-panel` 已有；与本次目标无关）
- 不做技能正文编辑（只读展示 + 打开外部预览）
- 不改 MCP 侧既有行为与配置语义
- 不在本轮引入 `sidebar.panellist` 全页面板
- ~~内置精选的**一键安装**：目录数据里只有 `source` + `path`，**没有可固定的 commit/tag**，抓默认分支不可复现 —— 要做必须先给 110 条补 commit 并实现宿主侧抓取（TODO row 19）~~ **已撤回（2026-10-10，见顶部「撤回记录」）**：不做，改为整体删除内置精选目录，市场只留 skillhub.cn；TODO row 19 已改写成只剩「本地导入入口」那一半
- 面板的本地导入入口（`.md` / 目录 / 压缩包三种形态；宿主 RPC 已支持，同一行 TODO 一起做）
- 需要新 Host RPC 的能力（备份导出、批量启停、重启服务、Resources/Prompts 投影、frontmatter 自动修复、技能提升/复制）——要做就单独立项并先定契约

**Architecture:** 宿主侧新增独立 `skillsManager` 服务（不复用 `mcpManager` namespace），以 `lib/skills-registry.js` 薄封装宿主 `ctx.skills`，以 `lib/skills-file-ops.js` 承担文件级动作（启停/删除/导入，全部按 `(name, scope, root)` 精确定位、不做回退）；市场**不再有随包目录**——唯一来源是 skillhub.cn，由宿主侧直连上游（`lib/skillhub.js`）搜索、取详情与安装，失败只降级（原先那条「目录数据 → 生成器 → 目录产物」的离线管线已于 2026-10-10 整条删除，见顶部「撤回记录」）。客户端在 `lib/client.js` 内新增 `SKILLS_CSS` 与技能组件，面板顶部加「能力层」枚举（MCP / 技能）复用现有悬浮窗与侧栏入口；`apply()` 先探测旧包是否挂载，命中则只渲染让位提示、不注册入口。

**Final validation:**

1. `node --test` 全量通过，0 失败（当次条数记在 `PROGRESS.md` 的 `Latest validation`）。
2. `node --test test/skills-*.test.mjs` 覆盖：作用域精确定位、非法 frontmatter 诊断、启停重命名、让位检测、外部源（skillhub.cn）搜索与安装确认。~~许可门禁拒绝、市场远端过滤~~ **已撤回（2026-10-10，见顶部「撤回记录」）**：随内置精选目录与 skills.sh 下线，对应用例已删。
3. `node --test test/theme-contract.test.mjs`：`SKILLS_CSS` 被全部主题扫描器覆盖（不得假绿），且真实样式表 0 违规。
4. `node --test test/client-lifecycle.test.mjs test/typert-manifest.test.mjs test/package-rename.test.mjs`：新增 RPC 两侧契约 deepEqual、过宿主 `validateTypertManifest`、身份耦合点全部落在新包名上。
5. `node --test test/tasks-spec-integrity.test.mjs`：本 SPEC 的决策 id、约束编号、路径引用与三件套的协议字段可机械解析。
6. `node .tasks/toolbox-ui/prototype/check-prototype.mjs`：设计原型自身过一遍主题契约（用仓库自己的扫描器，不另实现规则）。
7. 真机：在 desktop profile 挂载后，面板能在 MCP / 技能间切换；技能列表显示本机 `~/.agents/skills` 的技能及其真实作用域；启停一个技能后 DSH 的 watcher 生效（`skill` 工具目录随之变化）。改了 `lib/client.js` 就必须走这一步——客户端那半是替身测试，失败表现是「面板渲染不对」，没有任何用例会变红。
8. 改名完成后：`npm pack` 产物可被 `dsh plugin add` 安装，且与旧包共存时新包让位（只有旧包入口）。

## 附录 A：改名触及面（按「改的是哪一类身份」组织）

**必须改（身份耦合，不改会坏）：**

| 位置 | 身份类别 | 说明 |
|---|---|---|
| `package.json` name | npm 包身份 | 由 `packageJson.name` 单点推导，其余引用不许硬编码 |
| `package.json` repository/homepage/bugs | **仓库**身份（≠包名） | 可继续同仓（D13 双包同仓）；改名后仓库名与包名**不再相等**，断言必须各自从真正的来源推导 |
| `lib/typert.js` codec `typeSymbol` | 包级标识 | 宿主按它做跨 realm 判定 |
| `lib/typert.js` invocation `id` / `sourceLocation.file` | 包级标识 | 宿主 loader 校验；`sourceLocation` 指向包内路径 |
| `lib/typert.js` `package` | 包级标识 | 由 `validateTypertManifest(package.json.name, TYPERT)` 校验，必须与 `package.json` 一致 |
| `lib/client.js` `*_CONTRIBUTION.package` + descriptor id | 包级标识 | 与 `typert.js` deepEqual 绑定 |
| `lib/client.js` module id / css 去重键 / `dataset.plugin` | 包级标识 | 样式认领与清理凭据；漏改会让样式变孤儿 |
| `lib/client.js` `UPGRADE_PACKAGE` | 包级标识 | 一键升级目标；漏改会把用户「升级」回旧包 |
| `lib/index.js` `UPDATE_CHECK_URL` | 仓库身份 | GitHub releases API |
| `cordis.patch.yml` `name:` | profile 挂载名 | `id: mcp-manager-ui` 保留（内部标识，测试断言唯一） |

**保留不改（各有理由，测试逐条白名单）：** localStorage 键（改键名不影响功能、会丢用户设置）· `DSH_MCP_MANAGER_DISABLE_UPDATE_CHECK`（改了会让用户已设的开关失效）· `dsh-mcp-*` 样式前缀（约束 7）· 仓库 URL 与环境变量名（事实如此）· 历史设计文档 `docs/mcp-market-design.md`（**按文件**豁免：它记的是「当时包还叫旧名时为什么这么决策」，改它等于改写历史）。

**三条来自实战的改名纪律：**

1. **基于子串的替换规则必须逐条说明它改的是哪一类身份。** 同一字面形态 `包名#` 在契约 id 里是「包名#方法」，在 URL 里是「仓库名#tag」；首版规则越过了这个语义边界，产出了指向**不存在仓库**的安装命令。
2. **定义基准的测试不能参与被测的那次改动。** 旧名必须抽成显式常量（`test/package-rename.test.mjs` 的 `OLD_NAME`），否则改名脚本会顺手改掉它，于是它拿新名去查「旧名残留」——把新包名的每一行都报成漏网、真正的旧名一处未查。
3. **「防漏网」用例必须逐出现判定上下文。** 一条 catch-all 白名单（本意是「指代旧包的说明文字」）匹配任何含旧包名的行，138 行全部放行，改名前后同样通过 = 什么都没防。现在逐出现判定，并加取样下界（一处旧名都没有就说明扫描范围失效）。

## 附录 B：环境与基线

- Worktree：`.worktrees/feature/toolbox-ui` @ `feature/toolbox-ui`（2026-10-11 由 `feature/skills-manager` 改名而来——包名早已是 `dsh-toolbox-ui`，旧名会让这条线看起来还只是技能管理器；从 main `f21196e` 起）；`.worktrees/` 已在 `.gitignore:6`。
- 依赖：`pnpm install --frozen-lockfile`；测试命令 `node --test`。
- **测试基线只增不减**：新加的不变量要补用例；改动后 `node --test` 必须 0 失败，且条数不得低于上一次记录（当次值记在 `PROGRESS.md` 的 `Latest validation`）。
- `DSH_HOME=C:\Users\zhanglu\.dsh`；本机技能实际在 `~/.agents/skills`（rank 500），`~/.dsh/skills`（rank 400）不存在——见约束 12。
- 真机验证用专用 profile：`dsh --profile skillsuitest --port 19687 --no-open`（`node_modules` 指向本工作区）。**不要动**用户正在用的 desktop（19387）与另一个 web 实例（19587）。
- 本文件不写测试条数等易变数字：跑命令取当次值，并记进 `PROGRESS.md` 的 `Latest validation`。

## 附录 C：原型与设计真值

| 文件 | 角色 |
|---|---|
| `prototype/unified-design.html` | **唯一设计真值原型**：单文件、明暗可切、能力层/模式层可切；头部注释说明令牌来源。工程改动前先读它。 |
| `prototype/check-prototype.mjs` | 原型的机械自检：剥掉令牌镜像后把规则区喂给仓库自己的 `scripts/theme-spec.mjs`，结论由权威判据给出。 |
| `prototype/variants.html` | **已否决的布局备选**（决策记录，说明为什么没选它们），不是实现依据。 |

**与原型的一处刻意差异（D20）**：原型的作用域分段是 `全部 / 全局 / 当前项目 / 系统内置`，实装用「全局 + 每个工作区」。对齐外观即可，**不要**为了与原型逐字一致而改语义——多个工作区并存时「当前项目」本身有歧义。

**界面已确认事实**（改动前先读，别再「修」回去）：

- 面板**永远是全屏 overlay**：`McpTab` 全仓只有一处挂载且恒传 `floating: true`，所以视口媒体查询是正确工具，**不需要容器查询**；面板实际尺寸 1000×774（1000px × 88vh）。
- 头部是三列 grid `auto minmax(0,1fr) auto`（标题 | 操作区 | 关闭）：关闭按钮必须钉在第三列，否则切能力层时会横移。
- 技能列表**按作用域分组、作用域只在组头**（288px 侧栏放不下行内作用域徽章）；左栏宽度保持 288px，不要改成 360px。
- 两个详情共用同一套头部原语（`dsh-mcp-d-head` / `-d-title` / `-d-name` / `-d-meta` / `-d-actions`）；头与页签行 `flex:none`，只有 `.dsh-mcp-d-body` 滚动。这几条与面板标题、空状态成块一起被 `test/panel-chrome.test.mjs`、`test/detail-panes.test.mjs`、`test/panel-css-invariants.test.mjs` 钉住。
