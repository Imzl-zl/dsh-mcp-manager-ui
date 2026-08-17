# 安装与升级

本文区分正式安装和本地开发安装。正式使用推荐 GitHub、npm 或 tarball，不要长期依赖开发目录的 `link:`。

## 环境要求

- DeepSeek Harness `0.1.0-rc.6`
- 已初始化的 `web` profile
- Node.js 和 pnpm 可由 DSH 的插件命令正常调用

## 从 GitHub 正式安装

如果之前安装的是本地开发目录，先移除旧依赖：

```sh
dsh plugin --profile web remove dsh-mcp-manager-ui
```

然后安装 GitHub 仓库。生产环境建议固定 tag 或 commit，避免后续推送静默改变安装内容：

```sh
# 推荐：固定 release tag
dsh plugin --profile web add github:Imzl-zl/dsh-mcp-manager-ui#v1.1.0

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

## 升级

```sh
dsh plugin --profile web update dsh-mcp-manager-ui
```

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
