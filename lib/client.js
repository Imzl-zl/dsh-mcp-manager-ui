window.__ModuleLoader__.load({
	id: 'dsh-mcp-manager-ui',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
// MCP 管理 UI —— browser half v3.2（作为 cordis_define 的 code.client 传入）
// 运行在浏览器：整个文件是 async function body，参数面 = (React, console, styles, host, harness)。
// 无 JSX/TS/import，一律 React.createElement。host.call(method, args) 调 host half 的 harness.handle。
// v3.2：视觉全面升级（克制配色/深色渐变层次/玻璃拟态/精致动效）；定时器用 timer 服务。
// 入口：右下角浮动按钮（shell.overlay）+ 设置页 MCP 标签，共用 McpTab。
var React = require('react');
var __injectCss = function(text) {
  var id = 'dsh-mcp-manager-ui/mcp.css';
  if (typeof document !== 'undefined' && !document.querySelector('style[data-plugin-css="' + id + '"]')) {
    var tag = document.createElement('style');
    tag.dataset.pluginCss = id;
    tag.textContent = text;
    document.head.appendChild(tag);
  }
};
const React2 = React;
const { useState, useEffect, useCallback } = React2;

__injectCss(`.dsh-mcp-wrap{display:flex;flex-direction:column;height:100%;min-height:420px;gap:14px;padding:4px 2px;color:var(--dsw-alias-label-primary,#e8eaf0);font-size:13px;--mcp-accent:#3b82f6;--mcp-ok:#34c77b;--mcp-err:#f0645a;--mcp-warn:#e0a83f;--mcp-mut:var(--dsw-alias-label-secondary,#98a1b3);--mcp-bg-1:var(--dsw-alias-bg-layer-1,#12141a);--mcp-bg-2:var(--dsw-alias-bg-layer-2,#191c24);--mcp-line:rgba(255,255,255,.075);-webkit-font-smoothing:antialiased}
.dsh-mcp-wrap ::-webkit-scrollbar{width:8px;height:8px}
.dsh-mcp-wrap ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:8px;border:2px solid transparent;background-clip:padding-box}
.dsh-mcp-wrap ::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.22);border:2px solid transparent;background-clip:padding-box}
.dsh-mcp-wrap ::-webkit-scrollbar-track{background:transparent}
.dsh-mcp-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
.dsh-mcp-title{font-size:15px;font-weight:650;letter-spacing:.2px;display:flex;align-items:center;gap:8px}
.dsh-mcp-title::before{content:"";width:4px;height:16px;border-radius:2px;background:var(--mcp-accent)}
.dsh-mcp-head-actions{display:flex;gap:8px}
.dsh-mcp-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--mcp-line);border-radius:8px;padding:6px 12px;background:#262a33;color:var(--dsw-alias-label-primary,#e8eaf0);font-size:12px;font-weight:500;cursor:pointer;transition:background .15s,border-color .15s}
.dsh-mcp-btn:hover{background:#2e333d;border-color:rgba(255,255,255,.18)}
.dsh-mcp-btn:active{background:#23272f}
.dsh-mcp-btn:disabled{opacity:.4;cursor:not-allowed;transform:none;box-shadow:none}
.dsh-mcp-btn.primary{background:var(--mcp-accent);border-color:transparent;color:#fff}
.dsh-mcp-btn.primary:hover{background:#4a90ff}
.dsh-mcp-btn.danger{color:#f0645a;border-color:rgba(240,100,90,.35)}
.dsh-mcp-btn.danger:hover{background:rgba(240,100,90,.12);border-color:rgba(240,100,90,.5)}
.dsh-mcp-body{display:flex;gap:12px;flex:1;min-height:0}
.dsh-mcp-side{width:288px;min-width:248px;display:flex;flex-direction:column;gap:8px;border:1px solid var(--mcp-line);border-radius:12px;background:linear-gradient(180deg,rgba(255,255,255,.02),transparent 120px),var(--mcp-bg-2);padding:10px;overflow:hidden}
.dsh-mcp-search{position:relative}
.dsh-mcp-search svg{position:absolute;left:10px;top:50%;transform:translateY(-50%);opacity:.5}
.dsh-mcp-search input{width:100%;box-sizing:border-box;padding:8px 10px 8px 30px;border-radius:9px;border:1px solid var(--mcp-line);background:var(--mcp-bg-1);color:var(--dsw-alias-label-primary,#e8eaf0);font-size:12px;outline:none;transition:border-color .15s,box-shadow .15s}
.dsh-mcp-search input::placeholder{color:var(--mcp-mut)}
.dsh-mcp-search input:focus{border-color:rgba(59,130,246,.6);box-shadow:0 0 0 3px rgba(59,130,246,.16)}
.dsh-mcp-list{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:3px;margin:0 -4px;padding:0 4px}
.dsh-mcp-item{position:relative;display:flex;align-items:center;gap:9px;padding:8px 9px;border-radius:9px;cursor:pointer;border:1px solid transparent;transition:background .13s,border-color .13s}
.dsh-mcp-item:hover{background:rgba(255,255,255,.045);border-color:rgba(255,255,255,.05)}
.dsh-mcp-item.sel{background:rgba(59,130,246,.1);border-color:rgba(59,130,246,.4)}
.dsh-mcp-item.sel::before{content:"";position:absolute;left:-1px;top:20%;bottom:20%;width:3px;border-radius:3px;background:var(--mcp-accent)}
.dsh-mcp-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--mcp-mut);box-shadow:inset 0 0 0 1px rgba(0,0,0,.3)}
.dsh-mcp-dot.connected{background:var(--mcp-ok);box-shadow:0 0 4px rgba(52,199,123,.7),inset 0 0 0 1px rgba(0,0,0,.2)}
.dsh-mcp-dot.failed{background:var(--mcp-err);box-shadow:0 0 6px rgba(240,100,90,.7),inset 0 0 0 1px rgba(0,0,0,.2)}
.dsh-mcp-dot.loading{background:var(--mcp-warn);animation:mcpBlink 1.1s infinite}
@keyframes mcpBlink{50%{opacity:.35}}
.dsh-mcp-item-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.dsh-mcp-item-name{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.1px}
.dsh-mcp-item-sub{font-size:10.5px;color:var(--mcp-mut);display:flex;gap:6px;align-items:center}
.dsh-mcp-badge{display:inline-flex;align-items:center;padding:1.5px 7px;border-radius:999px;font-size:10px;line-height:16px;border:1px solid var(--mcp-line);color:var(--mcp-mut);background:rgba(255,255,255,.03)}
.dsh-mcp-badge.dot::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor;margin-right:5px;opacity:.85}
.dsh-mcp-badge.t-http{color:#6fb7ff;border-color:rgba(111,183,255,.35);background:rgba(111,183,255,.07)}
.dsh-mcp-badge.t-stdio{color:#d3a66e;border-color:rgba(211,166,110,.35);background:rgba(211,166,110,.07)}
.dsh-mcp-badge.s-on{color:var(--mcp-ok);border-color:rgba(52,199,123,.35);background:rgba(52,199,123,.08)}
.dsh-mcp-badge.s-off{color:var(--mcp-mut);border-color:var(--mcp-line)}
.dsh-mcp-badge.s-err{color:var(--mcp-err);border-color:rgba(240,100,90,.4);background:rgba(240,100,90,.08)}
.dsh-mcp-detail{flex:1;min-width:0;display:flex;flex-direction:column;gap:10px;border:1px solid var(--mcp-line);border-radius:12px;background:linear-gradient(180deg,rgba(255,255,255,.02),transparent 140px),var(--mcp-bg-2);padding:16px;overflow-y:auto}
.dsh-mcp-d-empty{display:flex;flex:1;align-items:center;justify-content:center;color:var(--mcp-mut);font-size:13px;gap:8px}
.dsh-mcp-d-empty::before{content:"";width:34px;height:34px;border-radius:10px;background:rgba(59,130,246,.12);border:1px solid rgba(59,130,246,.35)}
.dsh-mcp-d-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
.dsh-mcp-d-name{font-size:17px;font-weight:700;letter-spacing:.2px;display:flex;align-items:center;gap:8px}
.dsh-mcp-d-meta{display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap}
.dsh-mcp-d-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.dsh-mcp-card{border:1px solid var(--mcp-line);border-radius:10px;padding:12px 14px;background:linear-gradient(180deg,rgba(255,255,255,.025),transparent 80px),var(--mcp-bg-1)}
.dsh-mcp-card h4{margin:0 0 9px;font-size:10.5px;font-weight:650;color:var(--mcp-mut);text-transform:uppercase;letter-spacing:.8px;display:flex;align-items:center;gap:6px}
.dsh-mcp-card h4::after{content:"";flex:1;height:1px;background:var(--mcp-line);margin-left:2px}
.dsh-mcp-kv{display:grid;grid-template-columns:auto 1fr;gap:5px 14px;font-size:12px;word-break:break-all}
.dsh-mcp-kv b{color:var(--mcp-mut);font-weight:500;white-space:nowrap}
.dsh-mcp-tools{display:flex;flex-direction:column;gap:5px}
.dsh-mcp-tool{display:flex;gap:9px;padding:7px 9px;border-radius:8px;background:var(--mcp-bg-1);border:1px solid transparent;transition:background .12s,border-color .12s}
.dsh-mcp-tool:hover{border-color:var(--mcp-line);background:rgba(255,255,255,.03)}
.dsh-mcp-tool-name{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;color:#93c5fd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46%}
.dsh-mcp-tool-desc{font-size:11.5px;color:var(--mcp-mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mcp-empty-list{padding:20px;text-align:center;color:var(--mcp-mut);font-size:12px}
.dsh-mcp-overlay{position:fixed;inset:0;background:rgba(8,9,12,.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;z-index:200;animation:mcpFade .14s ease-out}
.dsh-mcp-modal{width:560px;max-width:92vw;max-height:84vh;overflow-y:auto;background:var(--mcp-bg-2);border:1px solid var(--mcp-line);border-radius:14px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.6);animation:mcpPop .16s ease-out}
.dsh-mcp-modal h3{margin:0 0 16px;font-size:15px;font-weight:650;display:flex;align-items:center;gap:8px}
.dsh-mcp-modal h3::before{content:"";width:4px;height:14px;border-radius:2px;background:var(--mcp-accent)}
.dsh-mcp-field{margin-bottom:14px}
.dsh-mcp-field label{display:block;font-size:11.5px;color:var(--mcp-mut);margin-bottom:6px;font-weight:500}
.dsh-mcp-field input,.dsh-mcp-field select{width:100%;box-sizing:border-box;padding:8px 11px;border-radius:9px;border:1px solid var(--mcp-line);background:var(--mcp-bg-1);color:var(--dsw-alias-label-primary,#e8eaf0);font-size:12.5px;outline:none;transition:border-color .15s,box-shadow .15s}
.dsh-mcp-field input::placeholder{color:var(--mcp-mut)}
.dsh-mcp-field input:focus,.dsh-mcp-field select:focus{border-color:rgba(59,130,246,.6);box-shadow:0 0 0 3px rgba(59,130,246,.16)}
.dsh-mcp-radio-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.dsh-mcp-radio-row label{display:flex;align-items:center;gap:8px;margin:0;border:1px solid var(--mcp-line);border-radius:9px;padding:9px 12px;background:var(--mcp-bg-1);color:var(--dsw-alias-label-primary,#e8eaf0);cursor:pointer;font-size:12.5px;transition:border-color .12s,background .12s}
.dsh-mcp-radio-row label:hover{border-color:rgba(255,255,255,.22);background:rgba(255,255,255,.02)}
.dsh-mcp-radio-row label.sel{border-color:rgba(59,130,246,.6);background:rgba(59,130,246,.1)}
.dsh-mcp-radio-row input[type='radio']{width:15px;height:15px;flex:none;margin:0;padding:0;appearance:none;-webkit-appearance:none;border:1.5px solid rgba(255,255,255,.28);border-radius:50%;background:transparent;position:relative;cursor:pointer;transition:border-color .12s,background .12s}
.dsh-mcp-radio-row input[type='radio']:checked{border-color:var(--mcp-accent);background:radial-gradient(circle,#fff 0 4px,var(--mcp-accent) 4.5px)}
.dsh-mcp-radio-row input[type='radio']:hover{border-color:rgba(255,255,255,.5)}
.dsh-mcp-kv-edit{display:grid;grid-template-columns:38% 1fr auto;gap:8px;margin-bottom:8px;align-items:center}
.dsh-mcp-kv-edit input{width:100%;min-width:0;box-sizing:border-box}
.dsh-mcp-kv-add{display:flex;justify-content:flex-end;margin-top:2px}
.dsh-mcp-kv-del{border:1px solid var(--mcp-line);background:#262a33;color:var(--mcp-mut);cursor:pointer;font-size:14px;padding:3px 9px;border-radius:7px;line-height:18px;transition:color .12s,background .12s,border-color .12s}
.dsh-mcp-kv-del:hover{color:var(--mcp-err);background:rgba(240,100,90,.1);border-color:rgba(240,100,90,.4)}
.dsh-mcp-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
.dsh-mcp-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:rgba(30,33,42,.92);backdrop-filter:blur(10px);border:1px solid var(--mcp-line);color:var(--dsw-alias-label-primary,#e8eaf0);padding:10px 18px;border-radius:12px;font-size:12.5px;z-index:300;box-shadow:0 12px 40px rgba(0,0,0,.55);max-width:70vw;animation:mcpPop .16s ease-out}
.dsh-mcp-toast.err{border-color:rgba(240,100,90,.55)}
.dsh-mcp-toast.ok{border-color:rgba(52,199,123,.5)}
.dsh-mcp-toggle{position:relative;width:34px;height:19px;border-radius:999px;border:none;cursor:pointer;background:#3a3f4a;transition:background .18s;flex:none;box-shadow:inset 0 1px 2px rgba(0,0,0,.35)}
.dsh-mcp-toggle.on{background:var(--mcp-accent)}
.dsh-mcp-toggle:disabled{opacity:.5;cursor:not-allowed}
.dsh-mcp-toggle::after{content:"";position:absolute;top:2.5px;left:2.5px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .18s;box-shadow:0 1px 3px rgba(0,0,0,.4)}
.dsh-mcp-toggle.on::after{left:17.5px}
.dsh-mcp-d-err{font-size:12.5px;color:var(--mcp-err);margin-top:8px;white-space:pre-wrap}
.dsh-mcp-fab{position:fixed;right:22px;bottom:22px;width:50px;height:50px;border-radius:50%;border:1px solid rgba(255,255,255,.16);background:var(--mcp-accent);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(0,0,0,.4);z-index:190;transition:transform .16s,background .16s;pointer-events:auto}
.dsh-mcp-fab:hover{transform:scale(1.05);background:#4a90ff}
.dsh-mcp-fab:active{transform:scale(.97)}
.dsh-mcp-fab svg{width:22px;height:22px}
.dsh-mcp-panel-overlay{position:fixed;inset:0;background:rgba(8,9,12,.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:180;padding:26px;pointer-events:auto;animation:mcpFade .14s ease-out}
.dsh-mcp-panel{width:1000px;max-width:95vw;height:88vh;background:var(--mcp-bg-2);border:1px solid var(--mcp-line);border-radius:16px;box-shadow:0 30px 90px rgba(0,0,0,.65),0 0 0 1px rgba(255,255,255,.04) inset;display:flex;flex-direction:column;overflow:hidden;animation:mcpPop .18s cubic-bezier(.2,.9,.3,1.15)}
.dsh-mcp-panel .dsh-mcp-wrap{height:100%;min-height:0;padding:18px}
@keyframes mcpPop{from{opacity:0;transform:scale(.965) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes mcpFade{from{opacity:0}to{opacity:1}}
`);

const h = React2.createElement;

const Toggle = ({ on, disabled, onChange, title }) =>
  h('button', { type: 'button', className: 'dsh-mcp-toggle' + (on ? ' on' : ''), disabled, title, onClick: (e) => { e.stopPropagation(); if (onChange) onChange(!on); } });

const Dot = ({ phase }) => {
  const cls = phase === 'connected' ? 'connected' : phase === 'failed' ? 'failed' : phase === 'loading' || phase === 'waiting' ? 'loading' : '';
  return h('span', { className: 'dsh-mcp-dot ' + cls });
};

const Badge = ({ cls, children }) => h('span', { className: 'dsh-mcp-badge ' + (cls || '') }, children);

const Icon = ({ d, size }) =>
  h('svg', { width: size || 13, height: size || 13, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }, h('path', { d }));

const ICONS = {
  search: 'M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM13.5 13.5L11 11',
  plus: 'M8 3v10M3 8h10',
  refresh: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3',
  trash: 'M3 4h10M6.5 4V2.8a.8.8 0 0 1 .8-.8h1.4a.8.8 0 0 1 .8.8V4M4.5 4l.6 9a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-9M6.7 7v4.5M9.3 7v4.5',
  plug: 'M6 2v4M10 2v4M4.5 6h7V8a3.5 3.5 0 0 1-7 0zM8 11.5V14',
  x: 'M4 4l8 8M12 4l-8 8',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
};

const Btn = ({ cls, icon, onClick, disabled, children }) =>
  h('button', { type: 'button', className: 'dsh-mcp-btn' + (cls ? ' ' + cls : ''), onClick, disabled }, icon ? h(Icon, { d: ICONS[icon] }) : null, children);

const ServerList = ({ servers, selected, query, onQuery, onSelect, onToggle }) =>
  h('div', { className: 'dsh-mcp-side' },
    h('div', { className: 'dsh-mcp-search' }, h(Icon, { d: ICONS.search }), h('input', { placeholder: '搜索服务器…', value: query, onChange: (e) => onQuery(e.target.value) })),
    h('div', { className: 'dsh-mcp-list' },
      servers.length === 0
        ? h('div', { className: 'dsh-mcp-empty-list' }, '没有匹配的服务器')
        : servers.map((s) =>
            h('div', { key: s.serverName, className: 'dsh-mcp-item' + (selected === s.serverName ? ' sel' : ''), onClick: () => onSelect(s.serverName) },
              h(Dot, { phase: s.phase }),
              h('div', { className: 'dsh-mcp-item-main' },
                h('div', { className: 'dsh-mcp-item-name' }, s.serverName),
                h('div', { className: 'dsh-mcp-item-sub' },
                  h(Badge, { cls: s.transport === 'http' ? 't-http' : 't-stdio' }, s.transport === 'http' ? 'HTTP' : 'stdio'),
                  h('span', null, s.toolCount + ' 工具'),
                ),
              ),
              h(Toggle, { on: s.enabled, disabled: !s.enabled && s.phase !== 'stopped', onChange: () => onToggle(s) }),
            ),
          ),
    ),
  );

const ServerDetail = ({ server, tools, toolQuery, onToolQuery, onToggle, onReconnect, onEdit, onRemove, busy }) => {
  if (!server)
    return h('div', { className: 'dsh-mcp-detail' }, h('div', { className: 'dsh-mcp-d-empty' }, '← 从左侧选择一个 MCP server'));
  const env = server.env || {};
  const headers = server.headers || {};
  const envKeys = Object.keys(env);
  const headerKeys = Object.keys(headers);
  const filtered = tools.filter(
    (t) => !toolQuery || t.name.toLowerCase().includes(toolQuery.toLowerCase()) || (t.description || '').toLowerCase().includes(toolQuery.toLowerCase()),
  );
  const statusCls = server.enabled ? (server.phase === 'connected' ? 's-on' : server.phase === 'failed' ? 's-err' : '') : 's-off';
  const statusText = server.enabled ? (server.phase === 'connected' ? '已连接' : server.phase === 'failed' ? '连接失败' : server.phase === 'loading' || server.phase === 'waiting' ? '连接中…' : '已停止') : '已禁用';
  const mut = (v) => (typeof v === 'string' && v.length > 90 ? v.slice(0, 88) + '…' : v);
  return h('div', { className: 'dsh-mcp-detail' },
    h('div', { className: 'dsh-mcp-d-head' },
      h('div', null,
        h('div', { className: 'dsh-mcp-d-name' }, server.serverName),
        h('div', { className: 'dsh-mcp-d-meta' },
          h(Dot, { phase: server.phase }),
          h(Badge, { cls: statusCls + ' dot' }, statusText),
          h(Badge, { cls: server.transport === 'http' ? 't-http' : 't-stdio' }, server.transport === 'http' ? 'HTTP' : 'stdio'),
          h(Badge, null, server.toolCount + ' 个工具'),
        ),
      ),
      h('div', { className: 'dsh-mcp-d-actions' },
        h(Toggle, { on: server.enabled, disabled: busy, onChange: () => onToggle(server), title: server.enabled ? '禁用' : '启用' }),
        h(Btn, { icon: 'edit', onClick: () => onEdit(server), disabled: busy, children: '编辑' }),
        h(Btn, { icon: 'refresh', onClick: () => onReconnect(server), disabled: busy || !server.enabled, children: '重连' }),
        h(Btn, { cls: 'danger', icon: 'trash', onClick: () => onRemove(server), disabled: busy, children: '移除' }),
      ),
    ),
    h('div', { className: 'dsh-mcp-card' },
      h('h4', null, '连接信息'),
      h('div', { className: 'dsh-mcp-kv' },
        h('b', null, '传输'), h('span', null, server.transport === 'http' ? 'Streamable HTTP' : 'stdio'),
        server.url ? h('b', null, 'URL') : null, server.url ? h('span', null, mut(server.url)) : null,
        server.command ? h('b', null, '命令') : null, server.command ? h('span', null, mut(server.command)) : null,
        server.args && server.args.length ? h('b', null, '参数') : null, server.args && server.args.length ? h('span', null, server.args.join(' ')) : null,
        h('b', null, '启用'), h('span', null, server.enabled ? '是' : '否（补丁中 disabled: true）'),
        headerKeys.length ? h('b', null, 'Headers') : null, headerKeys.length ? h('span', null, headerKeys.map((k) => k + ': ' + mut(String(headers[k]).slice(0, 12)) + (String(headers[k]).length > 12 ? '…' : '')).join('; ')) : null,
        envKeys.length ? h('b', null, '环境变量') : null, envKeys.length ? h('span', null, envKeys.map((k) => k + '=' + (String(env[k]).includes('process.env.') ? '${' + String(env[k]).split('process.env.')[1].replace(/[^A-Za-z0-9_]/g, '') + '}' : '••••••')).join('; ')) : null,
      ),
    ),
    h('div', { className: 'dsh-mcp-card' },
      h('h4', null, '工具（' + tools.length + '）'),
      h('div', { className: 'dsh-mcp-search', style: { marginBottom: 8 } }, h(Icon, { d: ICONS.search }), h('input', { placeholder: '搜索工具…', value: toolQuery, onChange: (e) => onToolQuery(e.target.value) })),
      h('div', { className: 'dsh-mcp-tools' },
        filtered.length === 0
          ? h('div', { className: 'dsh-mcp-empty-list' }, '没有匹配的工具')
          : filtered.map((t) =>
              h('div', { key: t.name, className: 'dsh-mcp-tool', title: t.description || t.name },
                h('span', { className: 'dsh-mcp-tool-name' }, t.name),
                h('span', { className: 'dsh-mcp-tool-desc' }, t.description || ''),
              ),
            ),
      ),
    ),
  );
};

const AddEditModal = ({ open, onClose, onSubmit, busy, initial }) => {
  const [name, setName] = useState('');
  const [transport, setTransport] = useState('http');
  const [url, setUrl] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [headers, setHeaders] = useState([{ k: '', v: '' }]);
  const [envs, setEnvs] = useState([{ k: '', v: '' }]);
  const [error, setError] = useState('');
  const editing = !!initial;
  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.serverName);
      setTransport(initial.transport === 'http' ? 'http' : 'stdio');
      setUrl(initial.url || '');
      setCommand(initial.command || '');
      setArgs(Array.isArray(initial.args) ? initial.args.join(', ') : '');
      const hd = Object.keys(initial.headers || {}).map((k) => ({ k, v: String(initial.headers[k]) }));
      setHeaders(hd.length ? hd : [{ k: '', v: '' }]);
      const ev = Object.keys(initial.env || {}).map((k) => ({ k, v: String(initial.env[k]) }));
      setEnvs(ev.length ? ev : [{ k: '', v: '' }]);
    } else {
      setName(''); setTransport('http'); setUrl(''); setCommand(''); setArgs('');
      setHeaders([{ k: '', v: '' }]); setEnvs([{ k: '', v: '' }]);
    }
    setError('');
  }, [open, initial]);
  if (!open) return null;
  const kv = (rows, setRows, i, field, v) => { const next = rows.slice(); next[i] = { ...next[i], [field]: v }; setRows(next); };
  const addRow = (rows, setRows) => setRows([...rows, { k: '', v: '' }]);
  const delRow = (rows, setRows, i) => setRows(rows.filter((_, x) => x !== i));
  const submit = () => {
    const n = (name || '').trim();
    if (!n) return setError('请填写服务器名称');
    const spec = { name: n, transport };
    if (transport === 'http') {
      spec.url = url.trim();
      const hd = {};
      headers.forEach((r) => { if (r.k.trim()) hd[r.k.trim()] = r.v; });
      if (Object.keys(hd).length) spec.headers = hd;
    } else {
      spec.command = command.trim();
      const parts = args.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
      if (parts.length) spec.args = parts;
      const ev = {};
      envs.forEach((r) => { if (r.k.trim()) ev[r.k.trim()] = r.v; });
      if (Object.keys(ev).length) spec.env = ev;
    }
    onSubmit(spec, setError);
  };
  const kvRows = transport === 'http' ? headers : envs;
  const setKvRows = transport === 'http' ? setHeaders : setEnvs;
  return h('div', { className: 'dsh-mcp-overlay', onClick: (e) => e.target === e.currentTarget && onClose() },
    h('div', { className: 'dsh-mcp-modal' },
      h('h3', null, editing ? '编辑 MCP 服务器' : '添加 MCP 服务器'),
      h('div', { className: 'dsh-mcp-field' },
        h('label', null, '名称（唯一标识，不可改）'),
        h('input', { value: name, disabled: editing, onChange: (e) => setName(e.target.value), placeholder: 'my-server' }),
      ),
      h('div', { className: 'dsh-mcp-field' },
        h('label', null, '传输类型'),
        h('div', { className: 'dsh-mcp-radio-row' },
          h('label', { className: transport === 'http' ? 'sel' : '' }, h('input', { type: 'radio', checked: transport === 'http', onChange: () => setTransport('http') }), 'HTTP（远程）'),
          h('label', { className: transport === 'stdio' ? 'sel' : '' }, h('input', { type: 'radio', checked: transport === 'stdio', onChange: () => setTransport('stdio') }), 'stdio（本地进程）'),
        ),
      ),
      transport === 'http'
        ? h('div', { className: 'dsh-mcp-field' },
            h('label', null, 'URL'),
            h('input', { value: url, onChange: (e) => setUrl(e.target.value), placeholder: 'https://example.com/mcp' }),
          )
        : h('div', null,
            h('div', { className: 'dsh-mcp-field' }, h('label', null, '命令'), h('input', { value: command, onChange: (e) => setCommand(e.target.value), placeholder: 'npx 或 C:\\path\\to\\bin.exe' })),
            h('div', { className: 'dsh-mcp-field' }, h('label', null, '参数（逗号或换行分隔）'), h('input', { value: args, onChange: (e) => setArgs(e.target.value), placeholder: '-y, mcp-server@latest' })),
          ),
      h('div', { className: 'dsh-mcp-field' },
        h('label', null, transport === 'http' ? 'Headers（可选）' : '环境变量（可选，值写 !!js process.env.KEY 引用密钥）'),
        kvRows.map((row, i) =>
          h('div', { key: i, className: 'dsh-mcp-kv-edit' },
            h('input', { placeholder: transport === 'http' ? 'Authorization' : 'API_KEY', value: row.k, onChange: (e) => kv(kvRows, setKvRows, i, 'k', e.target.value) }),
            h('input', { placeholder: transport === 'http' ? 'Bearer … 或 !!js process.env.KEY' : 'value', value: row.v, onChange: (e) => kv(kvRows, setKvRows, i, 'v', e.target.value) }),
            h('button', { type: 'button', className: 'dsh-mcp-kv-del', onClick: () => delRow(kvRows, setKvRows, i) }, '✕'),
          ),
        ),
        h('div', { className: 'dsh-mcp-kv-add' }, h(Btn, { onClick: () => addRow(kvRows, setKvRows), children: '+ 添加' })),
      ),
      error ? h('div', { className: 'dsh-mcp-d-err' }, error) : null,
      h('div', { className: 'dsh-mcp-modal-actions' },
        h(Btn, { onClick: onClose, children: '取消' }),
        h(Btn, { cls: 'primary', onClick: submit, disabled: busy, children: busy ? '保存中…' : (editing ? '保存' : '添加') }),
      ),
    ),
  );
};

const McpTab = (props) => {
  const { call, onClose, floating, timer } = props;
  const [servers, setServers] = useState([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [tools, setTools] = useState([]);
  const [toolQuery, setToolQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [toast, setToast] = useState('');

  const flash = useCallback(
    (msg, kind) => {
      setToast({ msg, kind: kind || 'ok' });
      timer.timeout(() => setToast(''), 3200);
    },
    [timer],
  );

  const load = useCallback(async () => {
    try {
      const res = await call('list');
      if (res && res.ok) {
        setServers(res.servers || []);
        setError('');
      } else {
        setError((res && res.error) || '加载失败');
      }
    } catch (e) {
      setError(String((e && e.message) || e));
    }
  }, [call]);

  useEffect(() => {
    load();
    const dispose = timer.interval(load, 5000);
    return dispose;
  }, [load, timer]);

  const selectedServer = servers.find((s) => s.serverName === selected) || null;

  const loadTools = useCallback(async (name) => {
    const res = await call('tools', name);
    if (res && res.ok) setTools(res.tools || []);
  }, [call]);

  useEffect(() => {
    setToolQuery('');
    if (selectedServer) loadTools(selectedServer.serverName);
    else setTools([]);
  }, [selected, selectedServer, loadTools]);

  const act = useCallback(
    async (method, name, successMsg) => {
      setBusy(true);
      try {
        const res = await call(method, name);
        if (res && res.ok) {
          flash(successMsg || (res.note || method + ' ' + name + ' 成功'));
          timer.timeout(load, 1200);
        } else {
          flash((res && res.error) || method + ' 失败', 'err');
        }
      } catch (e) {
        flash(String((e && e.message) || e), 'err');
      } finally {
        setBusy(false);
      }
    },
    [call, flash, load, timer],
  );

  const onToggle = (s) => {
    // 乐观更新：本地先翻转，host 持久化后由 load 校准
    const next = !s.enabled;
    setServers((prev) => prev.map((x) => (x.serverName === s.serverName ? { ...x, enabled: next } : x)));
    return act(next ? 'enable' : 'disable', s.serverName, (next ? '已启用 ' : '已禁用 ') + s.serverName);
  };
  const onReconnect = (s) => act('reconnect', s.serverName, '已请求重连 ' + s.serverName);
  const onRemove = (s) => {
    if (confirm('确认移除 MCP server「' + s.serverName + '」？将从配置文件中删除。')) act('removeServer', s.serverName, '已移除 ' + s.serverName);
  };
  const onSubmit = async (spec, setFormError) => {
    setBusy(true);
    try {
      const res = editTarget ? await call('update', spec) : await call('add', spec);
      if (res && res.ok) {
        flash(editTarget ? '已保存 ' + spec.name : '已添加 ' + spec.name);
        setAddOpen(false);
        setEditTarget(null);
        timer.timeout(load, 1500);
      } else {
        setFormError((res && res.error) || (editTarget ? '保存失败' : '添加失败'));
      }
    } catch (e) {
      setFormError(String((e && e.message) || e));
    } finally {
      setBusy(false);
    }
  };
  const openAdd = () => { setEditTarget(null); setAddOpen(true); };
  const openEdit = (s) => { setEditTarget(s); setAddOpen(true); };

  const filtered = servers.filter(
    (s) =>
      !query ||
      s.serverName.toLowerCase().includes(query.toLowerCase()) ||
      (s.url || s.command || '').toLowerCase().includes(query.toLowerCase()),
  );

  const inner = h(
    'div',
    { className: 'dsh-mcp-wrap' },
    h(
      'div',
      { className: 'dsh-mcp-head' },
      h('div', { className: 'dsh-mcp-title' }, 'MCP Servers'),
      h(
        'div',
        { className: 'dsh-mcp-head-actions' },
        h(Btn, { icon: 'refresh', onClick: load, children: '刷新' }),
        h(Btn, { cls: 'primary', icon: 'plus', onClick: openAdd, children: '添加服务器' }),
        onClose ? h(Btn, { icon: 'x', onClick: onClose, children: '关闭' }) : null,
      ),
    ),
    error ? h('div', { className: 'dsh-mcp-d-err' }, error) : null,
    h(
      'div',
      { className: 'dsh-mcp-body' },
      h(ServerList, { servers: filtered, selected, query, onQuery: setQuery, onSelect: setSelected, onToggle }),
      h(ServerDetail, {
        server: selectedServer,
        tools,
        toolQuery,
        onToolQuery: setToolQuery,
        onToggle,
        onReconnect,
        onEdit: openEdit,
        onRemove,
        busy,
      }),
    ),
    h(AddEditModal, { open: addOpen, onClose: () => { setAddOpen(false); setEditTarget(null); }, onSubmit, busy, initial: editTarget }),
    toast
      ? h('div', { className: 'dsh-mcp-toast ' + toast.kind }, toast.msg)
      : null,
  );

  if (floating)
    return h(
      'div',
      { className: 'dsh-mcp-panel-overlay', onClick: (e) => e.target === e.currentTarget && onClose && onClose() },
      h('div', { className: 'dsh-mcp-panel' }, inner),
    );
  return inner;
};

// ── 右下角浮动按钮（shell.overlay 常驻）──────────────────────────────
const McpFab = ({ call, timer }) => {
  const [open, setOpen] = useState(false);
  return h(
    React2.Fragment,
    null,
    open ? h(McpTab, { call, timer, onClose: () => setOpen(false), floating: true }) : null,
    h(
      'button',
      { type: 'button', className: 'dsh-mcp-fab', title: 'MCP 管理面板', onClick: () => setOpen(!open) },
      h(Icon, { d: ICONS.plug, size: 22 }),
    ),
  );
};

function mcpCodec(m) { return { mode: 'strict', typeSymbol: 'dsh-mcp-manager-ui/typert#' + m, schema: { parse: (v) => v } }; }
function mcpParam(name, sym) { return { name: name, wire: name, source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-mcp-manager-ui/typert#' + sym, schema: { parse: (v) => v } } }; }
const MCP_CONTRIBUTION = {
  package: 'dsh-mcp-manager-ui',
  descriptors: [
    { id: 'dsh-mcp-manager-ui#mcpManager/list', service: 'mcpManager', namespace: 'mcpManager', method: 'list', invocation: { kind: 'direct' }, parameters: [], result: mcpCodec('list') },
    { id: 'dsh-mcp-manager-ui#mcpManager/status', service: 'mcpManager', namespace: 'mcpManager', method: 'status', invocation: { kind: 'direct' }, parameters: [mcpParam('name', 'name')], result: mcpCodec('status') },
    { id: 'dsh-mcp-manager-ui#mcpManager/enable', service: 'mcpManager', namespace: 'mcpManager', method: 'enable', invocation: { kind: 'direct' }, parameters: [mcpParam('name', 'name')], result: mcpCodec('enable') },
    { id: 'dsh-mcp-manager-ui#mcpManager/disable', service: 'mcpManager', namespace: 'mcpManager', method: 'disable', invocation: { kind: 'direct' }, parameters: [mcpParam('name', 'name')], result: mcpCodec('disable') },
    { id: 'dsh-mcp-manager-ui#mcpManager/reconnect', service: 'mcpManager', namespace: 'mcpManager', method: 'reconnect', invocation: { kind: 'direct' }, parameters: [mcpParam('name', 'name')], result: mcpCodec('reconnect') },
    { id: 'dsh-mcp-manager-ui#mcpManager/tools', service: 'mcpManager', namespace: 'mcpManager', method: 'tools', invocation: { kind: 'direct' }, parameters: [mcpParam('name', 'name')], result: mcpCodec('tools') },
    { id: 'dsh-mcp-manager-ui#mcpManager/add', service: 'mcpManager', namespace: 'mcpManager', method: 'add', invocation: { kind: 'direct' }, parameters: [mcpParam('spec', 'spec')], result: mcpCodec('add') },
    { id: 'dsh-mcp-manager-ui#mcpManager/update', service: 'mcpManager', namespace: 'mcpManager', method: 'update', invocation: { kind: 'direct' }, parameters: [mcpParam('spec', 'spec')], result: mcpCodec('update') },
    { id: 'dsh-mcp-manager-ui#mcpManager/removeServer', service: 'mcpManager', namespace: 'mcpManager', method: 'removeServer', invocation: { kind: 'direct' }, parameters: [mcpParam('name', 'name')], result: mcpCodec('removeServer') }
  ]
};
async function apply(ctx) {
  let disposeMount = () => {};
  if (ctx.remote && typeof ctx.remote.$mount === 'function') {
    try { disposeMount = await ctx.remote.$mount(MCP_CONTRIBUTION); }
    catch (e) { console.error('[mcp-manager-ui] mount failed', (e && e.message) || e); }
  }
  const call = async (method, args) => {
    const svc = (typeof ctx.get === 'function' ? ctx.get('remote.mcpManager') : null) || null;
    if (!svc || typeof svc[method] !== 'function') return { ok: false, error: 'MCP 管理服务未连接（面板仍可用）' };
    const r = args === undefined || args === null ? await svc[method]() : await svc[method](args);
    if (r && r.ok) return { ok: true, ...((r.value && typeof r.value === 'object') ? r.value : {}) };
    if (r && !r.ok) return { ok: false, error: (r.error && (r.error.message || r.error.code)) || '调用失败' };
    return r;
  };
  const timer = { timeout: (fn, ms) => setTimeout(fn, ms), interval: (fn, ms) => { const id = setInterval(fn, ms); return () => clearInterval(id); } };
  ctx.slots.inject('settings.plugins.tab', () =>
    ctx.slots.register({ name: 'settings.plugins.tab', id: 'mcp', order: 30, label: 'MCP', inject: () => ({ call, timer }) }, McpTab),
  );
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({ name: 'shell.overlay', id: 'mcp-fab', order: 1000, label: 'MCP', inject: () => ({ call, timer }) }, McpFab),
  );
  return () => { disposeMount(); };
}
const inject = ['slots', 'remote', 'typert'];
exports.apply = apply;
exports.inject = inject;

		return module.exports;
	}
});
