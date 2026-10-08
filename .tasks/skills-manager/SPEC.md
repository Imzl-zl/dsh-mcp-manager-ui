# Skills 管理 + 市场（同一代码库双包）— Execution Spec

**Goal:** 在 `dsh-toolbox-ui` 这条产品线里新增 Skills 能力面（管理 + 市场），与既有 MCP 能力并列；`main` 上的 `dsh-mcp-manager-ui` 保持 MCP-only 并继续维护。

**Decisions:** 以下 17 条已在设计阶段由用户确认（consensus: confirmed）。原 DESIGN.md 已按 planning cutover 删除，本 SPEC 为此后的唯一设计真值。

| id | 决策 | owner |
|---|---|---|
| D0 | 管理与市场**一起做**，不做「只有市场」的半成品 | user |
| D1 | 复用宿主 `ctx.skills`（list/get/snapshot），不自建技能扫描 | model |
| D2/D9 | 改名为新包；**旧包不 deprecate**，`main` 保持 MCP-only 并继续维护（两条线并行） | user |
| D2b | 市场安装**跟随当前选中的作用域**，不每次询问 | user |
| D5 | `extractPanelCss` 改为支持多 `*_CSS` 常量（已实施） | model |
| D6 | 市场以**内置精选目录**为主，skills.sh 作搜索补充 | user |
| D7 | IA = 双层标签（能力层 MCP/技能 → 模式层 管理/市场）；**作用域只在管理模式** | model |
| D8 | 管理行按（名称 + 作用域）精确操作；新增「被遮蔽 / 非法条目」提示 | model |
| D10 | 入口维持现状（`shell.overlay` + `sidebar.footer.action`），不用 `sidebar.panellist` | user |
| D11 | 管理页 = 左列表 + 右详情；市场页 = 卡片网格 | user |
| D12 | 市场源分档，许可门禁为硬闸门 | model |
| D13 | **同一代码库双包发布**；MCP 修复走 `git merge` 而非 cherry-pick | user |
| D14 | 新包名 `dsh-toolbox-ui` | user |
| D15 | 新包检测到旧包时**主动让位**（须排除自身条目，见任务 13） | user |
| D16 | **先做功能，最后改名** | user |
| D17 | skills 服务作独立子插件（自带 `inject = ["skills"]`），现有 gateway 的 inject 不变 | model |
| D18 | `SKILLS_CSS` 与 `MCP_CSS` **合并为一次** `__injectCss` 调用 | model |

**Constraints:**

1. **宿主基线 `0.2.0-rc.2`**，peer 下限维持 `>=0.1.5-rc.1 <0.2.0`（D10 不用 panellist 槽位，故无需抬高下限）。
2. **skills 侧根目录由宿主决定**，本插件只读不猜：`<projectRoot>/.dsh/skills`(100) · `<projectRoot>/.agents/skills`(200) · custom(300) · `<dshHome>/skills`(400，跳过 `.system`) · `<agentsHome>/skills`(500) · bundled(600，只读)。
3. **禁用 = `SKILL.md` ↔ `SKILL.md.disabled` 重命名**。DSH 无 `disabled` 字段（MCP 有、skills 没有），这是唯一可行做法；bundled 根只读，不可禁用/删除。
   - 已验证 watcher 会响应：`isRelevantWatchEvent` 对目录捆绑只看 `segments[1] === "SKILL.md"`（`dsh-skill-filesystem/lib/index.js`），改名触发 unlink → provider 失效 → 下次查询刷新。
   - 已验证不会被误扫：宿主的扁平文件规则要求 `name.endsWith(".md")`，`x.md.disabled` 不匹配；目录捆绑按固定路径 `<dir>/SKILL.md` 读取，改名后读取失败即静默跳过。
   - **架构缺口（实现必须处理）**：禁用后技能从宿主目录中**消失**，因此面板**无法**从 `ctx.skills.list()` 得知「某个技能存在但被禁用」。已禁用技能的展示与「启用」操作，必须由本插件**自行扫描各 root 下的 `SKILL.md.disabled` / `<name>.md.disabled`** 得到，再与宿主目录做差集。这也是「管理」相对「模型目录」的第二个独有价值（第一个是非法条目的诊断）。
4. **frontmatter 按 DSH 源码校验**：`name` 必须匹配 `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`；必需 `name`+`description`；可选 **`whenToUse`（驼峰）**、`metadata`、`disable-model-invocation`、`user-invocable`。**不是**外部规范的 `when_to_use`（那是 Claude Code 的字段）。DSH 明确拒绝驼峰式 `disableModelInvocation`。
5. **契约两侧必须同步**：`lib/typert.js` 的 `TYPERT` 与 `lib/client.js` 的 `*_CONTRIBUTION` 由 `test/client-lifecycle.test.mjs` 逐字段 deepEqual 绑定；codec 必须**同时**写 `schema` 与 `create()`（`test/typert-manifest.test.mjs`）。
6. **样式闸门**：新增样式必须并入 `*_CSS` 常量（`extractPanelCss` 已支持多常量）；禁字面色值/自造圆角；别名层唯一宿主为 `body`；全圆角同规则补 `corner-shape:round`；等宽只用 `--ds-font-family-code`。
7. **`dsh-mcp-*` 样式前缀保留不改**（16 处，内部类名，与包名无关），以减少与 main 的合并冲突。
8. **许可门禁是硬闸门**：`anthropics/skills` 的 docx/pdf/pptx/xlsx 的 `LICENSE.txt` 禁止「在服务之外保留副本」，**默认不可安装**；同仓库 `algorithmic-art` 等为 Apache-2.0，故必须**逐技能**判定，不得按仓库聚合。
9. **市场来源必须白名单 owner**：skills.sh 的 `source` 字段实测含仿冒同名（`obra/superpowers` vs `obra/superpowers-skills`）与非 GitHub 值（`smithery.ai/…`）。
10. **让位检测失败时 fail-open**（照常注册入口）：漏检最坏是两个按钮，误判则用户完全打不开面板。
11. **不开新网络依赖**：本插件历史上唯一 HTTP 是 `checkForUpdate()`；市场首屏必须离线可用（内置目录），远端搜索失败必须静默降级。
12. **UI 不得写死 skill 根路径**：本机实测 `~/.dsh/skills`（rank 400）**不存在**，11 个技能全在 `~/.agents/skills`（rank 500）。因此「全局」作用域必须按宿主返回的 `source`（`user-dsh` / `user-agents` / `project-dsh` / `project-agents` / `custom` / `bundled`）显示其真实路径，不得假设某一级存在。同理，作用域选择器的候选项应来自实际发现的 source 集合，而非硬编码列表。
13. **每个作用域要各调一次 `list()`**：`ctx.skills.list(options = {})` 的 `cwd` 可选；provider 的 `roots(cwd)` 只在 `cwd !== undefined` 时才加入项目根（`dsh-skill-filesystem/lib/index.js` 的 `includeDefaultRoots && cwd !== void 0` 分支）。所以：不传 `cwd` = 只有用户级/自定义/bundled 技能；要看某项目的技能必须显式传该项目的 `cwd`。管理面板要同时呈现「全局 + 各项目」，必须对每个工作区各发起一次查询并合并，且合并结果需保留 `source` 以区分同名条目。
14. **管理动作不依赖会话**：面板的读取与文件操作都不得要求存在活动会话（与官方 `ctx.remote.skills.list` 不同——那个需要真实 `sessionId`，会激活冷 Agent，故本插件必须走自己的 RPC）。
15. **第二个服务在同一 patch 条目内挂载**：`cordis.patch.yml` 只有一条 `- id: mcp-manager-ui / name: <包名>`，且 `test/package-contract.test.mjs:59-60` 断言该 id 与 name **各出现恰好 1 次**——所以不得为 skills 新增 patch 条目。Cordis 支持子插件挂载（`ctx.plugin(plugin, config)`，见 `cordis/lib/index.js:1619`，官方包大量使用），故 `SkillsManagerGateway` 由现有插件的 `apply`/构造内 `ctx.plugin(SkillsManagerGateway)` 挂载，或直接在同一类上以第二个服务键注册。`TypertRemoteService` 的构造签名是 `(ctx, serviceKey, options?)`，`serviceKey` 同时是 Cordis 服务键与默认 wire namespace（`dsh-typert-protocol` 的 `TypertRemoteService` 声明）：MCP 用 `mcpManager`，skills 用 `skillsManager`，两者互不影响。
16. **`skills` 不得进入现有插件的 `static inject`**：Cordis 的 `inject` 是**依赖声明**——服务缺失时该 fiber 只是保持不激活并等待，**不报错也不激活**（`cordis/lib/index.js` 的 `notify()` → `fiber._refresh()`）。若把 `skills` 加进现有 gateway 的 `inject`，则任何未挂载 `@deepseek-ai/dsh-skill` 的 profile（用户可禁用该内置插件）都会让**整个 MCP 面板一起失效**——这是不可接受的回归。正确做法：现有 gateway 的 `inject` 保持 `["loader","tools"]` 不变；`SkillsManagerGateway` 作为**独立子插件**声明自己的 `inject = ["skills"]`，其未满足时只影响 skills 能力面。客户端同理：取不到 `remote.skillsManager` 时按「技能服务未连接」降级，MCP 面板照常可用（沿用现有 `call()` 的 `{ok:false,error}` 降级形态）。

**Non-goals:**

- 不实现宿主 skills 运行时（registry/provider/工具/斜杠命令由 DSH 提供）
- 不做 skills 分组、跨工作区批量迁移（`dsh-skill-mcp-panel` 已有；与本次目标无关）
- 不做技能正文编辑（只读展示 + 打开外部预览）
- 不改 MCP 侧既有行为与配置语义
- 不在本轮引入 `sidebar.panellist` 全页面板

**Architecture:** 宿主侧新增独立 `skillsManager` 服务（不复用 `mcpManager` namespace），以 `lib/skills-registry.js` 薄封装宿主 `ctx.skills`，以 `lib/skills-file-ops.js` 承担文件级动作（启停/删除/导入，全部按 `(name, scope, root)` 精确定位、不做回退）；市场数据走「`.tasks/skills-verified.yaml` → `scripts/build-skills-catalog.mjs` → `lib/skills-catalog.js`」的离线生成管线，与 MCP 目录同构。客户端在 `lib/client.js` 内新增 `SKILLS_CSS` 与技能组件，面板顶部加「能力层」枚举（MCP / 技能）复用现有悬浮窗与侧栏入口；`apply()` 先探测旧包是否挂载，命中则只渲染让位提示、不注册入口。

**Final validation:**

1. `node --test` 全量通过（基线 285 → 新增用例后更多），0 失败。
2. `node --test test/skills-*.test.mjs` 覆盖：作用域精确定位、非法 frontmatter 诊断、启停重命名、许可门禁拒绝、让位检测。
3. `node --test test/theme-contract.test.mjs`：`SKILLS_CSS` 被全部 11 个扫描器覆盖（不得假绿），且真实样式表 0 违规。
4. `node --test test/client-lifecycle.test.mjs` + `test/typert-manifest.test.mjs`：新增 RPC 两侧契约 deepEqual 且过宿主 `validateTypertManifest`。
5. 真机：在 desktop profile 挂载后，面板能在 MCP / 技能间切换；技能列表显示本机 11 个 `~/.agents/skills` 技能及其真实作用域；启停一个技能后 DSH 的 watcher 生效（`skill` 工具目录随之变化）。
6. 改名完成后：`npm pack` 产物可被 `dsh plugin add` 安装，且与旧包共存时新包让位（只有旧包入口）。

-----

## 附录 A：改名触及面（任务 16 的执行依据）

**必须改（身份耦合，不改会坏）：**

| 位置 | 现值 | 说明 |
|---|---|---|
| `package.json` name | `dsh-mcp-manager-ui` | npm 包身份 |
| `package.json` repository/homepage/bugs | `Imzl-zl/dsh-mcp-manager-ui` | 可继续同仓（双包同仓）；`package-contract.test.mjs:58` 有对应断言 |
| `lib/typert.js` `typeSymbol` (×1) | `dsh-mcp-manager-ui/typert#…` | 宿主 loader 校验 |
| `lib/typert.js` `id` (×27) | `dsh-mcp-manager-ui#mcpManager/…` | 宿主 loader 校验 |
| `lib/typert.js` `package` | `dsh-mcp-manager-ui` | **由 `validateTypertManifest(package.json.name, TYPERT)` 校验，必须与 package.json 一致** |
| `lib/client.js` `MCP_CONTRIBUTION.package` + descriptor id | 同上 | 与 typert.js deepEqual 绑定（`client-lifecycle.test.mjs`） |
| `lib/client.js` module id + css id + `dataset.plugin` | 同上 | 样式认领/清理凭据 |
| `lib/index.js` `UPDATE_CHECK_URL` | GitHub releases API | 指向新包仓库或同仓 |
| `cordis.patch.yml` `name:` | `dsh-mcp-manager-ui` | 用户 profile 挂载名；`id: mcp-manager-ui` 可保留（内部标识） |
| `lib/client.js` `UPGRADE_PACKAGE` | `dsh-mcp-manager-ui` | 一键升级目标包名 |

**保留不改**：localStorage 键 17 处（`/entry`、`/fab-pos`、`.updateHint.dismissed`、`.whatsNew.seen`，键名不影响功能）；**16 处 `dsh-mcp-*` className 前缀**（内部样式命名，与包名无关；改了会与 main 大面积冲突，且 `theme-contract` 的 class 扫描正则写死 `dsh-mcp-` 前缀）。

## 附录 B：已核实的实现陷阱（实现时直接避开）

| 陷阱 | 事实（证据） | 正确做法 |
|---|---|---|
| **样式注入互相覆盖** | `__injectCss` 的 id 与 `data-plugin-css` 写死为 `'dsh-mcp-manager-ui/mcp.css'`（`client.js:10`）；同 id 二次调用会复用同一 `<style>` 并覆写 `textContent` | `SKILLS_CSS` 与 `MCP_CSS` **合并为一次注入**，否则 skills 样式会静默冲掉 MCP 面板样式 |
| **第二次 `$mount` 必抛错** | `$mount` → `mountContribution` → `typert.remotes.register()`，register 按 `contribution.package` 去重：`dsh-typert-registry/lib/index.js:143` 抛 `Remote package "…" is already registered` | skills 的 descriptor **合并进同一个** `MCP_CONTRIBUTION`（descriptor 校验只按 endpoint `namespace/method` 与 id 去重，天然支持多 namespace），保持**一次** `$mount` |
| **让位检测命中自身** | 本插件自己的 loader name 就是 `package.json.name`（`cordis.patch.yml` 的 `name`），而改名（任务 16）在最后 | 检测时排除自身：按 `entry.options.id !== 'mcp-manager-ui'` 过滤（该 id 由 `package-contract.test.mjs:59-60` 断言唯一） |
| **禁用后技能从宿主目录消失** | 宿主按固定路径 `<dir>/SKILL.md` 读取，改名后读取失败即静默跳过；`isRelevantWatchEvent` 对目录捆绑只看 `segments[1] === "SKILL.md"`，改名触发 unlink → provider 失效 | 面板必须**自行扫描 `.disabled`** 才能展示已禁用技能并提供「启用」 |
| **`list()` 不传 cwd 就没有项目技能** | provider 的 `roots(cwd)` 只在 `cwd !== undefined` 时才 push 项目根（`includeDefaultRoots && cwd !== void 0`） | 对每个工作区**各调一次** `list({cwd})` 再合并，并保留 `source` 以区分同名 |
| **本机没有 `~/.dsh/skills`** | 实测 rank 400 的 `~/.dsh/skills` **不存在**，11 个技能全在 rank 500 的 `~/.agents/skills` | UI **不得写死**根路径；按宿主返回的 `source` 显示真实路径 |
| **原子写没有 rename** | `dsh-atomic-write` 只导出 `writeFileAtomic` 与 `withFileLock` | 启停用 `node:fs/promises` 的 `rename`；读-改-写类动作在 `withFileLock` 内做 |
| **`skills` 进 inject 会连累 MCP 面板** | Cordis 的 inject 是依赖声明——服务缺失时 fiber 只保持不激活并等待，**不报错**（`cordis/lib/index.js` 的 `notify()` → `fiber._refresh()`） | 现有 gateway 的 `inject` 保持 `["loader","tools"]`；skills 服务作独立子插件自带 `inject = ["skills"]` |
| **新增 peer 要同步 4 处** | `@deepseek-ai/dsh-skill` 当前不在 `peerDependencies`；`dsh-skill` 也**不在 lockfile**（故加 devDependency 会动 lockfile，注意 `--frozen-lockfile`） | 同步：`package.json` peer+dev、`package-contract.test.mjs` 的 `dshHostPackages`、`package-artifact.test.mjs` 同一数组、`pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` |
| **版本 bump 牵连两处硬编码** | `package-contract.test.mjs:41` 与 `package-artifact.test.mjs:84` 硬编码 `'1.5.0'`；release-notes 文件名由 `packageJson.version` 推导（`:132`） | 任务 15 必须含 `package.json` 版本 bump，且 validation 必须包含 `package-artifact` |

## 附录 C：环境与基线

- Worktree：`.worktrees/feature/skills-manager` @ `feature/skills-manager`（从 main `f21196e` 起）；`.worktrees/` 已在 `.gitignore:6`。
- 依赖：`pnpm install --frozen-lockfile` 已完成（47 包）；测试命令 `node --test`；基线 **285 pass / 0 fail**。
- 本机：`DSH_HOME=C:\Users\zhanglu\.dsh`；技能实际在 `~/.agents/skills`（11 个：zhanggui 系列等）。
- 原型（可点，已验证明暗两套）：`.tasks/skills-manager/prototype/panel.html`；布局备选对比：`variants.html`。
