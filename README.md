# dsh-mcp-manager-ui

DeepSeek Harness Web 的 MCP 服务器管理面板（持久化、图形化）。

像 TUI 的 `/mcp` 一样，直接在 Web GUI 里管理 MCP server：右下角悬浮球（FAB）一键打开面板，也可以从 **设置 → 插件 → MCP** 标签进入。所有改动实时生效并写入 `cordis.patch.yml`，重启后保留。

## 功能 Features

- 📋 列出全部 MCP server 及**工具数量**（从真实 schema 统计）
- 🔎 点进任一 server 查看**实时状态**：启用与否、传输（HTTP/stdio）、URL、Headers、工具列表（含完整描述）
- ⚡ 开关（启用/禁用）、重连、编辑、添加、移除 —— 全部**实时生效**并持久化到 patch 文件
- 🔄 面板内刷新
- 🏷️ 注册为 `dsh-plugin` 标准 bundle：`dsh.bundle.patch` + `dsh.client`（`lib/` 为**已构建产物**，安装无需 build 权限）

## 安装 Install

需要已安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Web profile（`dsh web`）。

```sh
# 方式一：直接安装到 web profile（推荐）
#   - lib/ 是预构建产物，无 prepare 脚本 → 触碰不到 pnpm 的 allowBuilds 授权
#   - 建议固定 commit 安装：#<commit>
dsh plugin --profile web add github:<OWNER>/dsh-mcp-manager-ui

# 方式二：本地打包的 tarball（无网络/无 Git 时）
#   cd dsh-mcp-manager-ui && pnpm pack
#   dsh plugin --profile web add ./dsh-mcp-manager-ui-1.0.0.tgz

# 方式三：npm（若发布到 registry）
#   dsh plugin --profile web add dsh-mcp-manager-ui
```

安装完成后：

1. **重启** `dsh web`（bundle 层在启动时编排）。
2. 打开 Web GUI → 右下角出现 **MCP** 悬浮球；或 **设置 → 插件 → MCP**。
3. 点悬浮球 → 面板列出所有 MCP server。

卸载：

```sh
dsh plugin --profile web remove dsh-mcp-manager-ui
# 重启 dsh web
```

## 从源码构建？不需要

`lib/` 三个文件已经是我这边构建好的产物（`lib/index.js` 为 ESM host `apply` 模块 + `@Remote` 方法、`lib/client.js` 为 web 客户端 bundle、`lib/typert.js` 为 host remote 契约清单），仓库直接提交，**无需 build 脚本**。

## 工作原理 How it works

- 主机侧：`lib/index.js` 用 `@deepseek-ai/dsh-typert-protocol` 注册 `mcpManager` 命名空间（list/status/enable/disable/reconnect/tools/add/update/removeServer），直接操作 profile 的插件条目（`entry.update` 实时 + patch 持久化）。
- 客户端侧：`dsh.client` 声明 Web 平台依赖，`./client` 导出浏览器 bundle，通过官方 `ctx.remote.$mount(contribution)` 挂载 `remote.mcpManager`，调用 host。UI 注册在 `shell.overlay`（FAB）与 `settings.plugins.tab`（设置页标签）。
- 依赖：`@deepseek-ai/dsh-typert-protocol`（npm 已发布）。

## 开发背景

发布前为自己的 profile 手工装配过（`cordis.patch.yml` insert + 复刻内置 bundle 机制）；本仓库按官方 [Publish a plugin](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md) 的标准 bundle 结构整理，可被 `dsh plugin` 与社区市场（GitHub `dsh-plugin` topic）识别。

## License

MIT