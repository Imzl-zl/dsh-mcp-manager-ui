# JSON 导入

面板支持常见 MCP 客户端配置，并在写入前提供结构化预览。导入目标始终是当前 Web profile 的 `cordis.patch.yml`。

## 支持的根格式

Claude、Cursor、Cline、Roo 等客户端常用：

```json
{
  "mcpServers": {
    "example": {
      "command": "npx",
      "args": ["-y", "example-mcp"]
    }
  }
}
```

VS Code 常用：

```json
{
  "servers": {
    "example": {
      "type": "http",
      "url": "https://example.com/mcp"
    }
  }
}
```

也可以导入一个带 `command` 或 `url` 的单个 MCP 对象。

## 合并与替换

| 模式 | 更新同名 MCP | 添加新 MCP | 删除未出现的 MCP |
|---|---:|---:|---:|
| 合并 | 是 | 是 | 否 |
| 替换当前 Profile | 是 | 是 | 是，仅限当前 profile 管理的 MCP |

来自其他 bundle、Agent preset 或存在同名冲突的条目不会被覆盖。替换不会删除非 MCP patch，也不会删除其他配置层拥有的 MCP。

## Transport 映射

- `stdio`：需要 `command`，支持 `args`、`env`、`cwd`
- `http`、`streamable-http`、`streamableHttp`：统一转换为 `streamable-http`，需要 `url`，支持 `headers`
- SSE、WebSocket、OAuth、`headersHelper` 和 `envFile` 无法安全映射，会明确拒绝

## `directTools` 与启停状态

DSH 没有间接工具模式，MCP 工具始终注册为 `mcp__<server>__<tool>`。导入器采用保守转换：

| 输入 | DSH 结果 |
|---|---|
| `directTools: true` | `disabled: false` |
| `directTools: false` | `disabled: true` |
| 缺失 `directTools` | 新条目默认启用；合并已有条目时保留当前状态 |
| 同时提供 `disabled` | 显式 `disabled` 优先 |

面板开关关闭时添加 `disabled: true`，开启时删除 `disabled` 字段。

## 环境变量与密钥

原样导入的 Header 和 env 值会写入 profile 文件。推荐使用环境变量引用：

```json
{
  "headers": {
    "Authorization": "Bearer ${MCP_TOKEN}"
  },
  "env": {
    "API_KEY": "${API_KEY}"
  }
}
```

导入器会将引用转换为受限的 `!!js process.env.NAME` 表达式。任意 JavaScript、未识别的模板变量和需要交互取值的 VS Code `inputs` 会被拒绝，不会静默执行。

面板的 list/status Remote 不返回字面 Header、env 或 args 值；带凭据/query 的 URL 也会被脱敏。args 只要存在就整体显示为“保留原值”标记：未修改时由 Host 整体保留，若要调整则必须完整重填参数，不会把原参数发送到浏览器。

详情页和编辑表单展示配置时默认掩码敏感值（URL 凭据、args、env、headers），点击眼睛图标后经 Host 的 `reveal` 接口读取有效运行值并在会话内临时显示，再次点击隐藏；已显示的值可一键复制到剪贴板。编辑表单的显隐只改变显示层：如果用户没有实际输入新值，保存时仍提交“保留原值”标记，不会把解析后的环境变量密钥写回 profile。`reveal` 只对当前 Web profile 管理的 server 开放，其他配置层（bundle / Agent）的配置只读且不能查看具体值。

手动点击“刷新”会显示刷新中状态，并在完成后报告当前 MCP 数量；后台每 5 秒轮询通过 Host 返回的脱敏列表投影指纹（`revision`）判断是否有真实 UI 变化，未变化时跳过 `setState`。Host 另对 `reveal` 实际读取的有效运行凭据生成进程内 HMAC 信号（`revealRevision`）：即使只有密钥明文变化、脱敏列表仍相同，客户端也会在运行值切换完成时清除详情和编辑表单中会话内已显示的旧值；该信号不能用于反推凭据内容。

## 写入安全

- 写入前必须先解析并预览
- profile 修改使用 Host 侧文件锁和原子替换
- 内容版本变化时以 `FS_STALE_VERSION` 拒绝覆盖
- live 更新失败时，启停操作会尝试回滚持久化修改
- JSON 导入只接受结构化字段，不把输入拼接成 shell 命令
