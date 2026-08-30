# 安装与升级

本文区分正式安装和本地开发安装。正式使用推荐 GitHub、npm 或 tarball，不要长期依赖开发目录的 `link:`。

## 环境要求

- DeepSeek Harness `0.1.0-rc.7` 及以上（已验证至 `0.1.0-rc.8`）
- 已初始化的 `web` profile
- Node.js 和 pnpm 可由 DSH 的插件命令正常调用

插件把 DSH 宿主 API 声明为 `^0.1.0-rc.7` 的 peer 依赖，自动兼容 `0.1.0-rc.7` 到 `0.2.0` 之前的所有版本。开发基线跟随同一范围；升级 DSH 后运行 `pnpm update && npm test` 验证即可，无需修改插件版本号。`0.2.0` 属于新的兼容边界，需要重新验证后再放宽。

## 从 GitHub 正式安装

如果之前安装的是本地开发目录，先移除旧依赖：

```sh
dsh plugin --profile web remove dsh-mcp-manager-ui
```

然后安装 GitHub 仓库。生产环境建议固定 tag 或 commit，避免后续推送静默改变安装内容：

```sh
# 推荐：固定 release tag
dsh plugin --profile web add github:Imzl-zl/dsh-mcp-manager-ui#v1.1.7

# 或固定某个 commit
dsh plugin --profile web add github:Imzl-zl/dsh-mcp-manager-ui#<commit>
```

仓库提交了预构建的 `lib/`，GitHub 安装不需要运行 `prepare`，也不需要为安装脚本配置 `allowBuilds`。

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

固定 tag 安装时，`dsh plugin update` 只会重新解析同一个 spec，不会自动跨到新版本——升级需要用新 tag 重新执行 `add`。若想始终跟随最新提交，可以把 spec 固定到 `#main`，之后 `update` 会拉取最新 main；但这可能包含未经充分验证的提交，生产环境不推荐。面板自带非强制的更新提示，有新版时会在面板顶部显示可关闭的提示条，由你决定是否升级。

如果使用 GitHub commit 固定安装，需要用新的 spec 重新执行 `add`。升级后重启 `dsh web`。

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

### 项目 MCP 显示「挂载失败：serverName 已被占用」

项目 MCP 是每个会话各自挂载的，而官方 `@deepseek-ai/dsh-mcp-client` 的 `serverName` 在应用根全局唯一：同一项目的并发会话里，只有先挂载的那个拿到项目 MCP，其余会话报此错误。面板会在项目标签页顶部提示当前运行中的会话数。关闭占用会话（或重启 `dsh web`）后新开会话即可恢复；会话中修改项目配置同样要新开会话才生效。
