# dsh-mcp-manager-ui

<p align="center">
  <a href="https://linux.do/" title="LINUX DO"><img src="https://cdn.jsdelivr.net/gh/Imzl-zl/dsh-mcp-manager-ui@v1.1.1/docs/images/linux-do-logo.svg" alt="LINUX DO" width="40" height="40"></a>
</p>

DeepSeek Harness Web 的 MCP 管理面板。它在 Web Host 中运行一份，通过右下角悬浮按钮管理当前 Web profile 的 MCP 配置。

## 界面预览

### 管理面板

![MCP 管理面板](https://cdn.jsdelivr.net/gh/Imzl-zl/dsh-mcp-manager-ui@v1.1.1/docs/images/mcp-manager-overview.png)

### 连接详情与操作

![MCP 连接详情](https://cdn.jsdelivr.net/gh/Imzl-zl/dsh-mcp-manager-ui@v1.1.1/docs/images/mcp-manager-detail.jpg)

### 新增 MCP

![新增 MCP](https://cdn.jsdelivr.net/gh/Imzl-zl/dsh-mcp-manager-ui@v1.1.1/docs/images/mcp-manager-add.jpg)

## 功能

- 查看 MCP 状态、传输方式、连接参数和工具列表
- 启用、禁用、重连、添加、编辑和移除 MCP
- 跟随 DSH 深色/浅色主题，并适配窄屏和移动宽度
- 支持 DSH rc.6 的完整 MCP 连接字段：`command`、`args`、`env`、`cwd`、`url`、`headers`、调用超时、启动失败策略和重连策略
- 导入 Claude、Cursor、Cline、Roo 等使用的 `mcpServers` JSON，以及 VS Code 的 `servers` JSON
- JSON 导入支持“合并（同名更新）”和“替换当前 Web profile 管理的 MCP”，写入前提供预览
- 结构化修改 Web profile 的 `cordis.patch.yml`，保留其他插件条目、注释和 `!!js` 环境变量表达式
- Host Remote 与 Web 客户端均随插件生命周期加载和卸载

## 兼容性

| 项目 | 已验证版本 |
|---|---|
| DeepSeek Harness | `0.1.0-rc.6` |
| Node.js | DSH rc.6 自带/支持的运行时 |
| 平台 | Windows；Linux/macOS 使用同一 DSH Web 契约 |

更早的 DSH 预览版本没有兼容承诺。

## 安装

使用 DSH 插件命令安装。不要把 `mcp-manager-ui` 再手工插入 Web profile 的 `cordis.patch.yml`。

```sh
# 正式使用固定 release tag。
dsh plugin --profile web add github:Imzl-zl/dsh-mcp-manager-ui#v1.1.1
```

安装、升级、卸载和本地开发流程见 [安装与升级](docs/installation.md)。

安装后重启 `dsh web`。插件命令会同时完成两件事：

1. 把包加入 Web profile 的 `dependencies`。
2. 把 `dsh-mcp-manager-ui` 加入 `dsh.profile.bundles`。

仓库自己的 `cordis.patch.yml` 已经声明唯一的 Host 条目：

```yaml
- insert:
    - id: mcp-manager-ui
      name: dsh-mcp-manager-ui
```

不要在以下位置重复这段条目：

- `~/.dsh/profiles/web/cordis.patch.yml`
- 任意 Agent preset 的 `agent.cordis.yml`
- 额外的 `--patch` 文件

本插件也不需要全局安装 `@deepseek-ai/dsh-tool-cordis`。需要临时开发 Cordis 插件时，直接新建“创造模式”会话。

卸载：

```sh
dsh plugin --profile web remove dsh-mcp-manager-ui
```

## JSON 兼容范围

DSH rc.6 原生支持两种 MCP transport：

- `stdio`：`command`、`args`、`env`、`cwd`
- `streamable-http`：`url`、`headers`

导入器会识别 `http`、`streamable-http`、`streamableHttp` 等常见别名，并把 `${TOKEN}`、`${env:TOKEN}` 转成 DSH 的 `!!js process.env.TOKEN` 表达式。DSH 当前不支持的 SSE、WebSocket、OAuth、`headersHelper`、`envFile` 等字段会明确报错或提示，不会静默生成不可用配置。

其他 Agent 的 `directTools` 可以是 `true`、`false` 或缺失。DSH 没有间接工具模式并始终把 MCP 工具注册为 `mcp__<server>__<tool>`，因此导入器采用保守映射：`true` 转成 `disabled: false`，`false` 转成 `disabled: true`，缺失时不干预现有启停状态；同时存在显式 `disabled` 时以后者为准。预览会逐项提示这些转换。

“替换”只替换当前 Web profile 的 `cordis.patch.yml` 中由 `@deepseek-ai/dsh-mcp-client` 声明的条目，不会删除其他 bundle 或 Agent preset 自带的 MCP。

完整格式、两种导入模式、启停映射和密钥处理见 [JSON 导入](docs/json-import.md)。

## 文档

- [安装与升级](docs/installation.md)
- [JSON 导入](docs/json-import.md)
- [DeepSeek Harness 官方插件发布指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)

## 开发流程

1. 在“创造模式”中用 `cordis_inspect`、`cordis_define` 和 `cordis_run` 做临时验证。
2. 将确认后的实现写入本仓库。临时动态插件不会自动生成源码文件，也不会在 DSH 重启后恢复。
3. 停止临时动态版本，避免它与仓库版本同时注册 UI 或 Remote。
4. 使用本地路径执行 `dsh plugin --profile web add ...`，验证正式 bundle。
5. 运行测试并启动 Web 做真实操作验证。

```sh
npm test
dsh --profile web --dump-config
dsh web
```

## 包结构

- `package.json`：声明 `dsh.bundle` 和 Web `dsh.client`
- `cordis.patch.yml`：插入唯一的 Host 插件实例
- `lib/index.js`：`mcpManager` Host Remote
- `lib/mcp-config.js`：JSON 规范化与 YAML patch 结构化读写
- `lib/client.js`：响应式 Web UI、Remote 客户端和生命周期清理
- `lib/typert.js`：Remote 契约描述

`lib/` 是预构建产物，GitHub、tarball 和 npm 安装均不需要执行构建脚本。

## 设计约束

`dsh-mcp-manager-ui` 是 Web Host 单实例插件。固定的 Remote namespace 和 UI slot id 是有意设计；重复加载属于配置错误，插件会明确失败，而不是静默忽略。多个 MCP server 则由 `@deepseek-ai/dsh-mcp-client` 的不同 `serverName` 实例管理。

## 相关链接

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [GitHub `dsh-plugin` 主题](https://github.com/topics/dsh-plugin)

## License

MIT
