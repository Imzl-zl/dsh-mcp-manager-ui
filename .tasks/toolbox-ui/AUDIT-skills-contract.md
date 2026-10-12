# 技能面对照 DSH 契约的审查（2026-10-12）

> 审查先行，改在后。本文件是**结论**，证据都标了来源。
> 证据纪律：只认两处原文——宿主源码 `D:\sudy\github\deepseek-harness`（权威契约）与
> 宿主运行包 `C:\Users\zhanglu\.dsh\profiles\node_modules\@deepseek-ai`（0.2.0-rc.2，真机用）。
> README 只用于交叉确认，不作为契约依据（教训 13：宿主的测试助手总是让文件名等于 name，
> 拿测试的假设当契约就会漏掉真实契约）。

---

## 一、宿主契约：技能面到底有什么

| # | 事实 | 出处 |
|---|---|---|
| C1 | **发现只有一层**。`<根>/<某目录>/SKILL.md`（目录捆绑）或 `<根>/<某文件>.md`（扁平）。嵌套的 `**/SKILL.md` 刻意不支持 | `skill-filesystem/src/index.ts:730-758`；README「Discovery is one level deep」 |
| C2 | **形态由磁盘条目定，不由技能名定**：目录条目 → `join(entry.path,'SKILL.md')`；文件条目 → **`entry.name.endsWith('.md')`** | 同上 `:735-739` |
| C3 | **技能名来自 frontmatter**（`name`，kebab-case），与磁盘文件名/目录名**无任何一致性要求** | `:821-830`；真机实测（本文件第四节） |
| C4 | **两个路径字段口径不同**：`resourceBase.path` = locator 的**展示路径**；`path` = `fs.processPath(target)` = **realpath** | `:220-221`、`:752-753`、`:892`；真机实测 |
| C5 | **根有六档 rank**：project-dsh 100 / project-agents 200 / custom 300 / user-dsh 400 / user-agents 500 / bundled 600。项目档**只在传 cwd 时**才进列表 | `:244-264` |
| C6 | **没有「启用/停用技能」这个概念**。frontmatter 只认两个策略字段：`disable-model-invocation` → `modelInvocable`、`user-invocable` → `userInvocable`。驼峰旧键是**抛错**（整条跳过） | `:1007-1023`、`:1019` |
| C7 | 两个策略字段是**两个独立的调用面**：模型面由 `isModelInvocable` 过滤（目录 + 加载都拒），用户面由 `isUserInvocable` 过滤（`/名称` 注入与官方 `/` 菜单） | `tool-skill/src/index.ts:140,147,197,228`、`session-controller/src/skill-catalog.ts:78` |
| C8 | `{modelInvocable:false, userInvocable:false}` 在宿主自己的用例里叫 **`trusted-only`**——是一等状态，不是缺陷 | `skill/tests/skill.spec.ts:170` |
| C9 | `list()` 是**调用无关**的：两个面都关掉的技能**照样出现在 `list()` 里**，`get()` 也照样给得出正文 | `skill/src/index.ts:56-74`；真机实测 |
| C10 | 宿主有 watcher（chokidar，depth 1），变更合并成一次 provider 失效并 emit **`skills/change`** | `:590-599`、`skill/src/index.ts:288-297` |
| C11 | **`skills/change` 没有进 Remote 转发白名单**，而 `registerRemoteEvents` 只允许注册**一个**源（重复注册直接抛 `already registered`） | `api/remotes/src/remote-events.ts:20-48`、`api/remotes/src/index.ts:42`、`api/gateway/src/index.ts:301-303` |
| C12 | 官方 `sessionSkillCatalog.list` 需要**真 sessionId**，只返回 **user-invocable** 条目且**不含正文** | `session-controller/src/skill-catalog.ts:36,78-86` |
| C13 | web-app 把基础行 `skill-filesystem` 置 `disabled: true`，改由**每个 preset 各挂一份** → 文件系统 provider 注册进 preset 的**层**，宿主层读不到用户技能 | `bundle/web-app/cordis.patch.yml:502-503`；真机 profile 实测 |
| C14 | 用户 DSH 根（user-dsh，400）会**跳过 `.system` 子目录**；其余根不跳 | `:256`、`:734` |

---

## 二、逐条审我们的实现

### 1. 识别（discovery）——部分复刻，存在漂移面

| 我们怎么做 | 审 |
|---|---|
| `locateSkill` 从 `resourceBase.path` + `path` 的**末段文件名**推形态与根：`SKILL.md` → bundle、`<name>.md` → flat | **判据本身是错的**（见第三节 A）。C2 说形态由磁盘条目定，而现行 flat 判据用的是**技能名**——C3 明确不保证一致 |
| `skillTargetsView` 复刻 `roots()`（六档 rank、`findProjectRoot` 找 `.git`、`skipSystem`、三档 env） | 复刻点合理（`ctx.skills` 不暴露 `roots()`），但**同一条规则存在两份实现**。其中 `resolveDshHome`/`expandHomePath` **可以直接 import**：`@deepseek-ai/dsh-home-paths` 是已发布的独立包（真机在，`lib/index.js` 有 `resolveDshHome`/`expandHomePath`/`DSH_HOME_ENV`）→ 我们抄的那 6 行可以删掉。`findProjectRoot` 与 `roots()` 仍在 provider 内部，只能继续复刻，且必须有用例钉住 |
| `providerConfig(ctx)` 从 loader 树按包名读 config | ✔ 与 C5 一致：读它**真正在用的** config，不另猜一份 |

**结论**：识别层方向对，但有两处该收：① 形态判据改成「根下的直接条目」（第三节）；② `resolveDshHome` 改成 import 宿主包，删掉复刻。

### 2. 启用 / 停用——自创机制，方向可辩护但**形态选错了**

现状：`SKILL.md` → `SKILL.md.disabled`（`skills-file-ops.js:104-126`）。

- **不违反契约**：纯文件系统操作，宿主确实因此不再发现它（C1/C2 使然，真机实测通过）。
- **但它不是 DSH 的能力**，而且有三处实质代价：

  1. **它破坏共享技能目录对别的工具的可用性**。用户的技能在 `~/.agents/skills`（实测 11 条），
     那是 **Agent Skills 开放标准的共享位置**——VS Code / Copilot、Claude Code、Codex 都扫它。
     `SKILL.md.disabled` **不是任何规范认可的形态**：对它们而言那个技能目录只是「SKILL.md 不见了」，
     VS Code 对已安装技能会因此显示 **Missing files / Repair**。我们为了本面板的开关，
     把用户的东西在**别的工具里**弄坏了。
  2. **状态只存在于名字里**，所以要读它就必须自己扫盘（`scanDisabledSkills`），
     于是产生**第二真值来源**——本轮已连爆两次（陈旧缓存与停用件同身份双行、链接目录的 Dirent 判错）。
  3. **恢复要能算对改名目标**，而改名目标不能按技能名拼（C3）——同一根因的第二份实现。

- **宿主原生有没有等价能力？有，而且是一等的**：`disable-model-invocation: true` + `user-invocable: false`。
  C7 说这两个字段正好关掉**模型自动调用**与**用户显式调用**两个面——技能能进入模型上下文的
  **全部路径**都在这里了；C8 说宿主自己把这种组合当一等状态（`trusted-only`）；
  C9 说面板**照样看得见它、读得出正文**。真机实测（第四节）四件事全部成立。

**结论**：**自创的改名机制该退役，改用宿主的两个原生字段做「停用」。**
这不是「换个写法」，而是把「停用」从**我们发明的第三态**搬回**宿主已有的两态组合**——
第二真值来源、扫盘、改名目标推算、两个数组互斥这四类缺陷**一起消失**（因为它们都是改名机制的产物）。
代价与边界见第五节。

### 3. 自动发现——轮询做不到，但**宿主已经替我们做了**

现状：面板手动刷新（`client.js` 的 `load()` 只在挂载与动作后调用）。

- **能不能订阅 `skills/change`？不能。** C11：它不在 Remote 转发白名单里，而白名单由宿主
  `dsh-api-remotes` **独占**——`registerRemoteEvents` 只接受一个源，第二个注册直接抛错。
  第三方插件**没有**合法途径把 `skills/change` 送到浏览器。这条要如实记下：**不是我们偷懒，是契约没开这个口**。
- **但「真·自动发现」在宿主侧本来就成立**：C10 的 watcher 会让宿主**下一次 `list()` 就返回新目录**
  ——新增/改名/删除技能**无需重启**即到达模型。我们缺的只是「面板知道自己该重取一次」。
- 可用的合法信号：**页面获得焦点 / 面板打开**时重取一次（成本一次 RPC），
  以及动作后重取（已有）。这不是轮询、不猜时机，且对用户表现为「切回来就是新的」。

**结论**：不改契约就做不到推送式自动发现；把「重取时机」挂在**焦点/打开**上，
并在文档里如实写明「宿主重启或面板重取后生效」，比假装轮询更诚实。

### 4. 调用权限——现在的做法是对的，而且要**再往前一步**

现状（`skills-registry.js:174-189`）：行与详情的权限**一律从技能文件的字节里解析**，
不取宿主 summary 的发现缓存（summary 会滞后，改名场景真机实测过）。读不到就是 `null`（不知道）。

- ✔ 这条**与 C6/C7 完全一致**：那两个字段就是宿主判定调用面的唯一依据，从文件读 = 读真值。
- ✔ 「不知道就说不知道」也对：非法 frontmatter 的技能宿主整条跳过，此时没有答案。
- ⚠️ 但它的**定位**仍走 `resolveSkillTarget(name)`——同一个错误来源。修好定位之后，
  这条不需要改语义，只需要改「从哪拿到那个文件」。

**结论**：语义保留，只换定位。

### 5. 作用域读取（`presetScope` 租借）——**保留**，官方那条替代品不够用

现状：`agentPresets.acquireScope()` → `skills.list({scope})`，用完 `Symbol.asyncDispose` 归还。

- **必要性成立**：C13 使然——provider 注册在 preset 层，不借作用域就只看得到 bundled。
  真机 profile 就是这样（`web/cordis.patch.yml` 没动 `skill-filesystem`，基础行是 disabled）。
- **不能用 `sessionSkillCatalog` 替代**：C12——它要真 sessionId，**违反 SPEC 约束 14**
  （面板读取不得依赖存在活动会话），而且只给 user-invocable 且**不含正文**；
  停用后的技能（两个面都关）会被它整个过滤掉——正是面板最需要显示的那一类。
- 归还：`lease[Symbol.asyncDispose]()`，失败不吞成功结果。✔ 稳妥。

**结论**：**保留现状**。这是本轮唯一一条「审完判定无需改动」的项，理由要写进注释，
免得下一轮有人看到「官方有现成的」又去换一遍。

---

## 三、共同的不变量（为什么会出现「改一处、露一处」）

这一轮的三次修复（链接目录 → 扁平链接 → 名字不一致）看起来是三个 bug，其实是**同一个**：

> **我们把「技能身份」（frontmatter 的 `name`）当成了「磁盘位置」用。**
> 而宿主只保证前者，从不保证后者（C3）。

证据链：
- `locateSkill` 用 `file === \`${name}.md\`` 判形态 → 名字不一致时形态判不出（已发布缺陷）
- `resolveSkillTarget` 用 `join(root, name, ...)` 定位 → 名字不一致时**一切操作失败**（本节 A）
- `scanDisabledSkills` 用**磁盘名**当 `name` 报出去 → 同一条技能启用时叫 A、停用时叫 B
- `removeSkill` 用 `join(root, name)` 删 → 名字不一致时删不到（或删错）

**要立的唯一不变量**（一处表达、处处引用）：

> **定位一律以宿主给的真实路径为准；身份（`name`）只用于显示与 wire 上的指认，永不用于拼路径。**
>
> 具体形式：一次操作 = `(根引用, 条目)`，其中
> · **根**由服务端用自己算出的目标集合核对（既有安全不变量，不动）；
> · **条目**= 该根下的**直接子条目**，由「它的真实路径 == 宿主报的 `path`」**匹配**得到（不猜、不拼）；
> · **写盘用条目的展示路径**（`<根>/<条目>`），**绝不用 realpath**——
>   技能的实体可能在用户的同步库里（junction），对 realpath 动改名/删除就是**动用户的数据**。

---

## 四、真机证据（本轮实测，可复跑）

脚本：`.tasks/_probe-shapes.mjs`、`.tasks/_probe-disable.mjs`、`.tasks/_probe-native-disable.mjs`
（真 cordis + 真 `dsh-skill` + 真 `dsh-skill-filesystem` + 真文件系统）

**六种形态下宿主给的字段与「按名字拼」的结果**（`_probe-shapes.mjs`）：

| 技能名（frontmatter） | 磁盘条目 | `resourceBase.path` 末段 | `path` 末段 | 按名字拼 bundle | 按名字拼 flat | 宿主 path |
|---|---|---|---|---|---|---|
| `plain-dir` | `plain-dir/` | `plain-dir` | `SKILL.md` | 有 | 无 | 有 |
| `dir-alias` | `dir-name/` | `dir-name` | `SKILL.md` | **无** | **无** | 有 |
| `plain-flat` | `plain-flat.md` | `skills` | `plain-flat.md` | 无 | 有 | 有 |
| `flat-alias` | `file-name.md` | `skills` | `file-name.md` | **无** | **无** | 有 |
| `linked-dir` | junction → 外部库 | `linked-dir` | `SKILL.md` | 有 | 无 | 有 |
| `linked-alias` | junction `junction-name/` | `junction-name` | `SKILL.md` | **无** | **无** | 有 |

→ **4/6 形态在面板里完全不可操作**（`get()` 按技能名全部正常返回正文，所以宿主侧毫无问题）。
`resourceBase.path` 的末段在**目录捆绑**下恒等于**磁盘目录名**（C4 的构造使然），
这正是「形态/条目从宿主字段取、不从技能名推」可行的依据。

**停用机制**（`_probe-disable.mjs`）：
- `.disabled` 两种形态宿主都看不见 ✔（约定有效）
- 目录里同时有 `SKILL.md` 与 `SKILL.md.disabled` 时，**启用那份胜出** ✔
- 改名后**同一进程内立即 `list()` 仍报旧值**（发现缓存）→ 面板必须自己扫盘（现行做法对）
- junction 的 `path` 指向真实目录、`resourceBase.path` 指向 junction 展示名 ✔

**原生两字段能否表达「完全停用」**（`_probe-native-disable.mjs`）：

```
① 宿主解析       switched-off → {"modelInvocable":false,"userInvocable":false}
② 模型面过滤     isModelInvocable → [ 'normal' ]      ← 被排除
③ 用户面过滤     isUserInvocable  → [ 'normal' ]      ← 被排除
④ 面板仍看得见   list 里在 = true；get() 正文 = 16 字节
```

→ 两个调用面**同时关闭**，而面板**不需要扫盘**就能看见它（C9）。
即：**没有任何一条路径能让模型或用户拿到这个技能，但面板照样管得了它。**

---

## 五、主流怎么做（调研结论，含出处）

| 产品 | 有启停 | 状态存哪 | 怎么表达停用 |
|---|---|---|---|
| Agent Skills 规范 | **没有** | — | 规范字段里没有任何状态位 |
| Claude Code | 有（三套并存） | `settings.json` 的 `skillOverrides` | `"off"` / `"name-only"` / `"user-invocable-only"`（四档） |
| **VS Code / Copilot** | 有 | 走 frontmatter | **两个字段都设** = 官方表格里的 **“Disabled skills”** |
| OpenAI Codex | 有 | `config.toml` | `path` + `enabled=false`（**默认启用、只记例外**） |
| Gemini CLI | 有 | `settings.json` | 名字写进 `skills.disabled` 数组 |
| Cline | 有 | VSCode state | `toggles[SKILL.md 绝对路径] = false` |
| 第一方用「改名/搬文件」的 | **零** | | 只有第三方社区工具（afk / asm / skillswitch）这么做 |

出处：<https://code.visualstudio.com/docs/agent-customization/agent-skills>（“Disabled skills” 那行）、
<https://code.claude.com/docs/en/skills>、<https://github.com/openai/codex/pull/9328>、
<https://geminicli.com/docs/cli/skills>、<https://docs.cline.bot/customization/skills>。

**两条对本案最有用的事实**：
1. 生态里「完全停用」的**官方表达就是把那两个字段都设上**——而 DSH 恰好原生支持这两个字段（C6）。
   我们不需要发明机制，只需要**用对宿主已有的机制**。
2. 状态键用**绝对路径**而不是名字（Cline 的做法）——与本审查第三节的不变量同向：
   **位置是位置，名字是名字。**

---

## 六、建议方案

### 改法一（结构修复，必做）：定位改用宿主给的真实路径

- 行的形状增加**条目**（`entry`：该根下的直接子条目名）与 `kind`，**由宿主字段匹配得出**：
  · 目录捆绑：条目 = `resourceBase.path` 的末段（C4 保证它 = 磁盘目录名）
  · 扁平：条目 = 在根下**按 realpath 匹配** `path` 得到的那一项（覆盖「扁平技能的文件本身是链接、
    且链接名 ≠ 目标名」这种 `path` 末段不可用的形态）
- `resolveSkillTarget` 从「按名字拼」改成「按 (根, 条目) 组装」，并保留：
  · 非法条目名拒绝（单段、无分隔符、非 `.`/`..`）——越界校验仍在
  · bundled 只读拒绝
  · 同一把锁（改用**物理位置**做键，比 `root+name` 更准）
- 删除/改名**只作用于 `<根>/<条目>` 的展示路径**，永不作用 realpath。

### 改法二（机制退役，建议）：停用改用宿主两个原生字段

- 「停用」= 写 `disable-model-invocation: true` + `user-invocable: false`（复用已有的
  `setFrontmatterBoolean`，它对 key 是通用的，**不需要新代码路径**）。
- 「启用」= 把两个字段都去掉（回到默认的两面可调用）。**如实写明**这会重置两个调用面。
- 两个开关**各自独立可见可操作**（模型自动调用 / 用户可调用），「已停用」是从两者**派生**的展示态
  ——与 VS Code 的模型同构：**没有第三态要存，也就没有东西要恢复、没有东西会对不上**。
- **旧 `.disabled` 只保留为一次性迁移读取**：扫到就列出来、提供「恢复」，
  恢复后再让用户用新机制停用。它不是第二真值来源，而是一段有明确终点的兼容代码。

### 改法三（按需，建议不做）：推送式自动发现
契约没开口（C11），不做；改为**焦点/打开时重取**，文档如实写。

---

## 七、修改后必须成立的测试形状

1. **真宿主 + 真文件系统**（不手搓 summary）——教训 13。
2. **名字不一致**必须进真宿主用例：读正文 / 停用 / 启用 / 删除各一条。
3. **用户完整形状**（第五节：DSH_HOME 在工作区内 × 技能全是 junction × 两个工作区）全过。
4. **断言落在「操作真的改了盘」**——教训 14。
5. **每条新用例做变异验证**：把实现改回旧行为确认变红。
6. 发布前用**已发布产物本身**验收——教训 16。
