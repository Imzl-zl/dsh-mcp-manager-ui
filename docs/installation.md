# 安装与升级

本文区分正式安装和本地开发安装。正式使用推荐 GitHub、npm 或 tarball，不要长期依赖开发目录的 `link:`。

## 环境要求

- DeepSeek Harness `0.1.5-rc.1` 及以上（已验证至 `0.1.5-rc.2`）
- 已初始化的 `web` profile
- Node.js 和 pnpm 可由 DSH 的插件命令正常调用

插件把 DSH 宿主 API 声明为 `>=0.1.5-rc.1 <0.2.0` 的 peer 依赖。只支持 0.1.5 起，因为插件用了两个 0.1.5 才有的官方能力：`mcp-client` 按注册作用域判 `serverName` 唯一性（项目级 MCP 的同名能力建立在此），以及 `setup` 把 agent 作为第二个参数传给插件（项目 MCP 挂载需要 agent 的 cwd）。开发基线跟随已验证的最新 RC，并镜像每一个 peer 依赖；升级 DSH 后运行 `pnpm install && npm test` 验证。

## 安装

推荐用 npm 安装：包里的 `^1.x` 范围让后续 `dsh plugin update` 能自动升级小版本。

```sh
dsh plugin --profile web add dsh-mcp-manager-ui@^1.2.1
```

也可以固定 GitHub release tag（适合需要锁定某个具体版本时）：

```sh
# 固定 release tag
dsh plugin --profile web add github:Imzl-zl/dsh-mcp-manager-ui#v1.2.1

# 或固定某个 commit
dsh plugin --profile web add github:Imzl-zl/dsh-mcp-manager-ui#<commit>
```

两种方式的**代码与运行行为完全相同**（包里带预构建的 `lib/`，不需要运行 `prepare`，也不需要配置 `allowBuilds`）；区别只在升级：`^1.x` 范围能被 `dsh plugin update` 自动推进，而 tag/commit 是不可变规格、`update` 只会重新解析同一个规格。

如果之前安装的是本地开发目录或另一种规格，先移除旧依赖：

```sh
dsh plugin --profile web remove dsh-mcp-manager-ui
```

安装完成后重启 Web Host：

```sh
dsh web
```

## 验证安装

检查 profile 的有效配置：

```sh
dsh --profile web --dump-config
```

输出中应出现：

```yaml
id: mcp-manager-ui
name: dsh-mcp-manager-ui
```

打开 DSH Web 后，右下角应出现 MCP 管理按钮。面板能够读取当前 profile 中的 MCP，并对可管理条目执行启停、编辑、重连和删除。

安装插件或启动 Web Host 不会自动安装内置 MCP。需要时打开面板，点击“内置 MCP”，选择 Exa、Tavily、Firecrawl、Chrome DevTools 或 Playwright 后再确认安装。已存在于当前 profile、其他 bundle 或 Agent preset 的同类配置会显示为“已配置”并跳过，不会被覆盖。前三项默认使用官方免密限额入口；Chrome DevTools 和 Playwright 通过本机 `npx` 启动，需满足相应 Node.js/浏览器要求。

## 升级

```sh
dsh plugin --profile web update dsh-mcp-manager-ui
```

升级后重启 `dsh web`。

按安装时的规格，行为不同：

| 安装规格 | `update` 的效果 | 怎么跨版本 |
|---|---|---|
| `dsh-mcp-manager-ui@^1.2.1`（npm，推荐） | 在 `^1.x` 内自动升到最新（含 1.2.2、1.3.0），不会跨到 2.0.0 | 已是自动；跨大版本显式安装 `@^2` |
| `github:...#v1.2.1`（tag） | 重新解析同一个 tag，**不会动** | 换成新 tag 重新 `add`：`... #v1.2.2` |
| `github:...#<commit>` | 同上，固定在 commit | 用新 commit/tag 重新 `add` |
| `github:...#main`（分支） | 拉取最新 main | 已是自动；但不推荐生产（无 release 门槛） |
| `link:<本地目录>`（开发） | 不适用 | 在 checkout 里 `git pull` 后重启 `dsh web` |

为什么 tag 不会自动跨版本：`dsh plugin` 是 `pnpm` 的薄转发器，`update` 就是「按 package.json 里的 spec 再解析一次」，而 git tag 是不可变规格、没有范围语义（`pnpm update --help`："Updates packages to their latest version **based on the specified range**"）。

面板自带非强制的更新提示（查 GitHub Releases，每天最多一次、可关闭、绝不自动更新）；npm 安装的用户不需要它，直接 `update` 即可。每个 release 都会同时发布到 npm 与 GitHub Releases，两者版本一致。

## 发布流程（维护者）

npm 与 GitHub Releases 必须**同一次发布里都更新**：用户从 npm 升级，面板的更新提示查 GitHub Releases。两者版本不一致就会出现「提示说有新版、`update` 却拿不到」。

```sh
# 1) 改版本：package.json + README/docs 里的版本与 tag 引用，并跑全量测试
npm test

# 2) 提交并打 tag（tag 与上面提交必须一致）
git add -A && git commit -m "..."
git push origin main
git tag -a v1.2.1 -m "v1.2.1 ..." && git push origin v1.2.1

# 3) 发布到 npm（先 npm login；若开了 2FA 用 --otp）
npm publish

# 4) 建 GitHub Release（面板更新提示的数据源）
gh release create v1.2.1 --title "dsh-mcp-manager-ui v1.2.1" --notes-file <notes>
```

`npm publish` 不会跑构建（包内已含 `lib/`，也没有 `prepare`/`prepublishOnly`），发布的就是提交里的文件；因此**先提交、再发布**，否则 npm 上的包会与 tag 内容不一致。发布前用 `npm pack --dry-run` 核对内容与体积。

## 卸载

```sh
dsh plugin --profile web remove dsh-mcp-manager-ui
```

卸载插件不会自动删除当前 profile 中已有的 `@deepseek-ai/dsh-mcp-client` 条目。

## 本地开发安装

本地开发才使用目录安装：

```sh
cd C:\sudy\github\dsh-mcp-manager-ui
pnpm install
dsh plugin --profile web add C:\sudy\github\dsh-mcp-manager-ui
```

修改 Host 代码后需要重启 `dsh web`；浏览器 bundle 是否热更新取决于当前 DSH 的 client HMR 状态。

## 常见问题

### `Remote package ... is already registered`

插件被重复装配。确认 bundle、profile patch、Agent preset 和额外 `--patch` 中只有一个 `mcp-manager-ui` 条目。

### `file access denied under workspace-write mode`

旧版本错误地通过会话文件系统写 profile。当前版本使用固定目标的 Host 原子写入，不需要切换到 `danger-full-access`。升级插件并重启 Web Host。

### 面板能看见但修改后立即恢复

先查看页面上的错误提示，再确认 profile 文件没有被其他进程同时编辑。插件使用内容版本检查，检测到外部修改时会拒绝覆盖。

### 项目 MCP 显示「挂载失败」或「作用域故障」

两者不是同一类故障，面板顶部的横幅和行上的标记会告诉你是哪一类：

- **挂载失败**：本插件在会话 setup 阶段就没挂上（`${VAR}` 求值为空、`failOnStartupError: true` 下启动失败、工具注册被拒等）。点开那一行的详情看具体原因。
- **作用域故障**：连接本身是好的，但工具不在共享作用域层（落到了全局层）。原因是 `@deepseek-ai/dsh-scope` 在宿主与插件之间解析成了两份模块实例（作用域标签是模块内的 Symbol）。先核对两点：
  1. profile 的 `pnpm-workspace.yaml` 是否仍是官方写入的形状——它必须带 **`autoInstallPeers: false`**，否则 pnpm 会把 9 个 `@deepseek-ai/dsh-*` peer 装进 profile 自己的 `node_modules`，插件就会解析到第二份宿主包（这正是官方注释写明要避免的事）。
  2. 安装的依赖树里是否只有一份 `@deepseek-ai/dsh-scope`。
  修好后重启 `dsh web` 即可恢复。

同一项目的多个会话不会因并发而撞 `serverName`：项目 MCP 按 `(项目, serverName)` 共用一份连接（0.1.5 起 `mcp-client` 按注册作用域判重），所以这个错误不会因「同项目开了两个会话」而出现。
