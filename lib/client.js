window.__ModuleLoader__.load({
	id: 'dsh-mcp-manager-ui',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
// MCP 管理 UI browser bundle：右下角浮动按钮打开响应式管理面板。
var React = require('react');
var __injectCss = function(text) {
  if (typeof document === 'undefined') return () => {};
  var id = 'dsh-mcp-manager-ui/mcp.css';
  var tag = document.querySelector('style[data-plugin-css="' + id + '"]');
  var created = false;
  if (!tag) {
    tag = document.createElement('style');
    tag.dataset.pluginCss = id;
    document.head.appendChild(tag);
    created = true;
  }
  try {
    tag.textContent = text;
  } catch (error) {
    if (created) tag.remove();
    throw error;
  }
  return () => tag.remove();
};
const React2 = React;
const { useState, useEffect, useCallback, useRef } = React2;

const MCP_CSS = `.dsh-mcp-wrap,.dsh-mcp-panel-overlay{color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,inherit);--mcp-accent:var(--dsw-alias-brand-primary);--mcp-ok:var(--dsw-alias-state-success-primary);--mcp-err:var(--dsw-alias-state-error-primary);--mcp-warn:var(--dsw-alias-state-warn-primary);--mcp-mut:var(--dsw-alias-label-secondary);--mcp-bg-1:var(--dsw-alias-bg-layer-1);--mcp-bg-2:var(--dsw-alias-bg-layer-2);--mcp-bg-3:var(--dsw-alias-bg-layer-3);--mcp-line:var(--dsw-alias-border-l2)}
.dsh-mcp-wrap{display:flex;flex-direction:column;height:100%;min-height:0;gap:14px;padding:4px 2px;font-size:13px;-webkit-font-smoothing:antialiased}
.dsh-mcp-wrap ::-webkit-scrollbar{width:8px;height:8px}
.dsh-mcp-wrap ::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2);border-radius:8px;border:2px solid transparent;background-clip:padding-box}
.dsh-mcp-wrap ::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l2);border:2px solid transparent;background-clip:padding-box}
.dsh-mcp-wrap ::-webkit-scrollbar-track{background:transparent}
.dsh-mcp-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
.dsh-mcp-title{font-size:15px;font-weight:650;letter-spacing:.2px;display:flex;align-items:center;gap:8px}
.dsh-mcp-title::before{content:"";width:4px;height:16px;border-radius:2px;background:var(--mcp-accent)}
.dsh-mcp-head-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.dsh-mcp-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--mcp-line);border-radius:8px;padding:6px 12px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font-size:12px;font-weight:500;cursor:pointer;transition:background .15s,border-color .15s}
.dsh-mcp-btn:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l3)}
.dsh-mcp-btn:active{background:var(--dsw-alias-interactive-bg-active)}
.dsh-mcp-btn:disabled{opacity:.4;cursor:not-allowed;transform:none;box-shadow:none}
.dsh-mcp-btn.primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-inverted)}
.dsh-mcp-btn.primary:hover{background:var(--dsw-alias-button-primary-hover)}
.dsh-mcp-btn.danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.dsh-mcp-btn.danger:hover{background:var(--dsw-alias-interactive-bg-hover-danger);border-color:var(--dsw-alias-state-error-primary)}
.dsh-mcp-body{display:flex;gap:12px;flex:1;min-height:0}
.dsh-mcp-side{width:288px;min-width:248px;display:flex;flex-direction:column;gap:8px;border:1px solid var(--mcp-line);border-radius:12px;background:var(--mcp-bg-2);padding:10px;overflow:hidden}
.dsh-mcp-search{position:relative}
.dsh-mcp-search svg{position:absolute;left:10px;top:50%;transform:translateY(-50%);opacity:.5}
.dsh-mcp-search input{width:100%;box-sizing:border-box;padding:8px 10px 8px 30px;border-radius:9px;border:1px solid var(--mcp-line);background:var(--mcp-bg-1);color:var(--dsw-alias-label-primary);font-size:12px;outline:none;transition:border-color .15s,box-shadow .15s}
.dsh-mcp-search input::placeholder{color:var(--mcp-mut)}
.dsh-mcp-search input:focus{border-color:var(--mcp-accent);box-shadow:none}
.dsh-mcp-list{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:3px;margin:0 -4px;padding:0 4px}
.dsh-mcp-item{position:relative;display:flex;align-items:center;gap:9px;padding:8px 9px;border-radius:9px;cursor:pointer;border:1px solid transparent;transition:background .13s,border-color .13s}
.dsh-mcp-item:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.dsh-mcp-item.sel{background:var(--dsw-alias-interactive-bg-hover-accent);border-color:var(--mcp-accent)}
.dsh-mcp-item.sel::before{content:"";position:absolute;left:-1px;top:20%;bottom:20%;width:3px;border-radius:3px;background:var(--mcp-accent)}
.dsh-mcp-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--mcp-mut);box-shadow:inset 0 0 0 1px rgba(0,0,0,.3)}
.dsh-mcp-dot.connected{background:var(--mcp-ok);box-shadow:0 0 4px rgba(52,199,123,.7),inset 0 0 0 1px rgba(0,0,0,.2)}
.dsh-mcp-dot.failed{background:var(--mcp-err);box-shadow:0 0 6px rgba(240,100,90,.7),inset 0 0 0 1px rgba(0,0,0,.2)}
.dsh-mcp-dot.loading{background:var(--mcp-warn);animation:mcpBlink 1.1s infinite}
@keyframes mcpBlink{50%{opacity:.35}}
.dsh-mcp-item-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.dsh-mcp-item-name{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:.1px}
.dsh-mcp-item-sub{font-size:10.5px;color:var(--mcp-mut);display:flex;gap:6px;align-items:center}
.dsh-mcp-badge{display:inline-flex;align-items:center;padding:1.5px 7px;border-radius:999px;font-size:10.5px;font-weight:500;line-height:16px;border:1px solid var(--mcp-line);color:var(--mcp-mut);background:var(--mcp-bg-1)}
.dsh-mcp-badge.dot::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor;margin-right:5px;opacity:.85}
.dsh-mcp-badge.t-http{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-state-business-tertiary)}
.dsh-mcp-badge.t-stdio{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-state-warn-tertiary)}
.dsh-mcp-badge.s-on{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-state-success-primary);background:var(--dsw-alias-state-success-tertiary)}
.dsh-mcp-badge.s-on.dot::before{background:var(--dsw-alias-state-success-primary)}
.dsh-mcp-badge.s-err.dot::before{background:var(--dsw-alias-state-error-primary)}
.dsh-mcp-badge.s-off{color:var(--mcp-mut);border-color:var(--mcp-line)}
.dsh-mcp-badge.s-err{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover-danger)}
.dsh-mcp-detail{flex:1;min-width:0;display:flex;flex-direction:column;gap:10px;border:1px solid var(--mcp-line);border-radius:12px;background:var(--mcp-bg-2);padding:16px;overflow-y:auto}
.dsh-mcp-d-empty{display:flex;flex:1;align-items:center;justify-content:center;color:var(--mcp-mut);font-size:13px;gap:8px}
.dsh-mcp-d-empty::before{content:"";width:34px;height:34px;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover-accent);border:1px solid var(--mcp-accent)}
.dsh-mcp-d-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
.dsh-mcp-d-name{font-size:17px;font-weight:700;letter-spacing:.2px;display:flex;align-items:center;gap:8px}
.dsh-mcp-d-meta{display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap}
.dsh-mcp-d-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.dsh-mcp-card{border:1px solid var(--mcp-line);border-radius:10px;padding:12px 14px;background:var(--mcp-bg-1)}
.dsh-mcp-card h4{margin:0 0 9px;font-size:10.5px;font-weight:650;color:var(--mcp-mut);text-transform:uppercase;letter-spacing:.8px;display:flex;align-items:center;gap:6px}
.dsh-mcp-card h4::after{content:"";flex:1;height:1px;background:var(--mcp-line);margin-left:2px}
.dsh-mcp-kv{display:grid;grid-template-columns:auto 1fr;gap:5px 14px;font-size:12px;word-break:break-all}
.dsh-mcp-kv b{color:var(--mcp-mut);font-weight:500;white-space:nowrap}
.dsh-mcp-tools{display:flex;flex-direction:column;gap:5px}
.dsh-mcp-tool{display:flex;gap:9px;padding:7px 9px;border-radius:8px;background:var(--mcp-bg-1);border:1px solid transparent;transition:background .12s,border-color .12s}
.dsh-mcp-tool:hover{border-color:var(--mcp-line);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mcp-tool-name{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;color:var(--dsw-alias-brand-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46%}
.dsh-mcp-tool-desc{font-size:11.5px;color:var(--mcp-mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mcp-empty-list{padding:20px;text-align:center;color:var(--mcp-mut);font-size:12px}
.dsh-mcp-overlay{position:fixed;inset:0;background:var(--dsw-alias-bg-overlay);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;z-index:200;padding:12px;animation:mcpFade .14s ease-out}
.dsh-mcp-modal{box-sizing:border-box;width:560px;max-width:92vw;max-height:84vh;overflow-y:auto;background:var(--mcp-bg-2);border:1px solid var(--mcp-line);border-radius:14px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.3);animation:mcpPop .16s ease-out}
.dsh-mcp-modal h3{margin:0 0 16px;font-size:15px;font-weight:650;display:flex;align-items:center;gap:8px}
.dsh-mcp-modal h3::before{content:"";width:4px;height:14px;border-radius:2px;background:var(--mcp-accent)}
.dsh-mcp-field{margin-bottom:14px}
.dsh-mcp-field label{display:block;font-size:11.5px;color:var(--mcp-mut);margin-bottom:6px;font-weight:500}
.dsh-mcp-field input,.dsh-mcp-field select,.dsh-mcp-field textarea{width:100%;box-sizing:border-box;padding:8px 11px;border-radius:9px;border:1px solid var(--mcp-line);background:var(--mcp-bg-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;outline:none;transition:border-color .15s,box-shadow .15s}
.dsh-mcp-field input::placeholder{color:var(--mcp-mut)}
.dsh-mcp-field input:focus,.dsh-mcp-field select:focus,.dsh-mcp-field textarea:focus{border-color:var(--mcp-accent);box-shadow:none}
.dsh-mcp-radio-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.dsh-mcp-radio-row label{display:flex;align-items:center;gap:8px;margin:0;border:1px solid var(--mcp-line);border-radius:9px;padding:9px 12px;background:var(--mcp-bg-1);color:var(--dsw-alias-label-primary);cursor:pointer;font-size:12.5px;transition:border-color .12s,background .12s}
.dsh-mcp-radio-row label:hover{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mcp-radio-row label.sel{border-color:var(--mcp-accent);background:var(--dsw-alias-interactive-bg-hover-accent)}
.dsh-mcp-radio-row input[type='radio']{width:15px;height:15px;flex:none;margin:0;padding:0;appearance:none;-webkit-appearance:none;border:1.5px solid var(--dsw-alias-border-l3);border-radius:50%;background:transparent;position:relative;cursor:pointer;transition:border-color .12s,background .12s}
.dsh-mcp-radio-row input[type='radio']:checked{border-color:var(--mcp-accent);background:radial-gradient(circle,var(--dsw-alias-label-primary-inverted) 0 4px,var(--mcp-accent) 4.5px)}
.dsh-mcp-radio-row input[type='radio']:hover{border-color:var(--mcp-accent)}
.dsh-mcp-kv-edit{display:grid;grid-template-columns:38% 1fr auto;gap:8px;margin-bottom:8px;align-items:center}
.dsh-mcp-kv-edit input{width:100%;min-width:0;box-sizing:border-box}
.dsh-mcp-kv-add{display:flex;justify-content:flex-end;margin-top:2px}
.dsh-mcp-kv-del{border:1px solid var(--mcp-line);background:var(--dsw-alias-button-elevated-fill);color:var(--mcp-mut);cursor:pointer;font-size:14px;padding:3px 9px;border-radius:7px;line-height:18px;transition:color .12s,background .12s,border-color .12s}
.dsh-mcp-kv-del:hover{color:var(--mcp-err);background:var(--dsw-alias-interactive-bg-hover-danger);border-color:var(--dsw-alias-state-error-primary)}
.dsh-mcp-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px;flex-wrap:wrap}
.dsh-mcp-advanced{margin-top:14px}.dsh-mcp-check{display:flex!important;align-items:center;gap:8px;margin:9px 0!important;color:var(--dsw-alias-label-primary)!important}.dsh-mcp-check input{width:auto!important}.dsh-mcp-number-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.dsh-mcp-number-grid .dsh-mcp-field{margin-bottom:0}.dsh-mcp-import-preview{font-size:12px;line-height:1.6;color:var(--mcp-mut);white-space:pre-wrap}.dsh-mcp-import-json{min-height:220px;resize:vertical;font-family:ui-monospace,Consolas,monospace!important}
.dsh-mcp-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--dsw-alias-toast-bg);backdrop-filter:blur(10px);border:1px solid var(--mcp-line);color:var(--dsw-alias-label-primary);padding:10px 18px;border-radius:12px;font-size:12.5px;z-index:300;box-shadow:0 12px 40px rgba(0,0,0,.3);max-width:70vw;animation:mcpPop .16s ease-out}
.dsh-mcp-toast.err{border-color:var(--dsw-alias-state-error-primary)}
.dsh-mcp-toast.ok{border-color:var(--dsw-alias-state-success-primary)}
.dsh-mcp-toggle{position:relative;width:34px;height:19px;box-sizing:border-box;border-radius:999px;border:1px solid var(--dsw-alias-border-l3);cursor:pointer;background:var(--dsw-alias-button-ghost-active-fill);transition:background .18s,border-color .18s;flex:none;box-shadow:none}
.dsh-mcp-toggle.on{background:var(--mcp-accent);border-color:transparent}
.dsh-mcp-toggle:disabled{opacity:.65;cursor:not-allowed}
.dsh-mcp-toggle::after{content:"";position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:var(--dsw-alias-brand-primary-invert);transition:left .18s,background .18s;box-shadow:0 1px 3px rgba(0,0,0,.25)}
.dsh-mcp-toggle.on::after{left:17px;background:var(--dsw-alias-label-primary-inverted)}
.dsh-mcp-d-err{font-size:12.5px;color:var(--mcp-err);margin-top:8px;white-space:pre-wrap}
.dsh-mcp-fab{position:fixed;right:22px;bottom:22px;width:50px;height:50px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 20px rgba(0,0,0,.25);z-index:190;transition:transform .16s,background .16s;pointer-events:auto}
.dsh-mcp-fab:hover{transform:scale(1.05);background:var(--dsw-alias-button-primary-hover)}
.dsh-mcp-fab:active{transform:scale(.97)}
.dsh-mcp-fab svg{width:22px;height:22px}
.dsh-mcp-panel-overlay{position:fixed;inset:0;background:var(--dsw-alias-bg-overlay);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:180;padding:26px;pointer-events:auto;animation:mcpFade .14s ease-out}
.dsh-mcp-panel{box-sizing:border-box;width:1000px;max-width:95vw;height:88vh;background:var(--mcp-bg-2);border:1px solid var(--mcp-line);border-radius:16px;box-shadow:0 30px 90px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden;animation:mcpPop .18s cubic-bezier(.2,.9,.3,1.15)}
.dsh-mcp-panel .dsh-mcp-wrap{height:100%;min-height:0;padding:18px}
@media (max-width:760px){.dsh-mcp-panel-overlay{padding:10px}.dsh-mcp-panel{max-width:none;width:100%;height:calc(100dvh - 20px);border-radius:10px}.dsh-mcp-panel .dsh-mcp-wrap{padding:12px}.dsh-mcp-head{align-items:flex-start}.dsh-mcp-body{flex-direction:column}.dsh-mcp-side{width:auto;min-width:0;max-height:34%;flex:none}.dsh-mcp-detail{padding:12px}.dsh-mcp-d-head{flex-direction:column}.dsh-mcp-kv-edit{grid-template-columns:minmax(90px,35%) minmax(0,1fr) auto}}
@media (max-width:480px){.dsh-mcp-head{flex-direction:column}.dsh-mcp-head-actions{width:100%;justify-content:flex-start}.dsh-mcp-btn{padding:7px 9px}.dsh-mcp-radio-row,.dsh-mcp-number-grid{grid-template-columns:1fr}.dsh-mcp-modal{max-width:none;width:100%;padding:14px}.dsh-mcp-kv-edit{grid-template-columns:1fr auto}.dsh-mcp-kv-edit input:first-child{grid-column:1 / -1}.dsh-mcp-tool{flex-direction:column}.dsh-mcp-tool-name{max-width:100%}.dsh-mcp-tool-desc{white-space:normal}}
@keyframes mcpPop{from{opacity:0;transform:scale(.965) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes mcpFade{from{opacity:0}to{opacity:1}}
`;

const h = React2.createElement;
const MAX_TIMER_DELAY_MS = 2147483647;
const REDACTED_VALUE = '__DSH_MCP_REDACTED__';
const PRESERVED_VALUE_LABEL = '••••••（保留原值）';
const toFormValue = (value) => value === REDACTED_VALUE ? PRESERVED_VALUE_LABEL : String(value || '');
const fromFormValue = (value) => value === PRESERVED_VALUE_LABEL ? REDACTED_VALUE : value;
const displayValue = (value) => value === REDACTED_VALUE ? '••••••' : value;
function setOwn(target, key, value) {
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}

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

const ServerList = ({ servers, selected, query, onQuery, onSelect, onToggle, busy }) =>
  h('div', { className: 'dsh-mcp-side' },
    h('div', { className: 'dsh-mcp-search' }, h(Icon, { d: ICONS.search }), h('input', { placeholder: '搜索 MCP…', value: query, onChange: (e) => onQuery(e.target.value) })),
    h('div', { className: 'dsh-mcp-list' },
      servers.length === 0
        ? h('div', { className: 'dsh-mcp-empty-list' }, '没有匹配的 MCP')
        : servers.map((s) =>
            h('div', { key: s.serverName, role: 'button', tabIndex: 0, 'aria-selected': selected === s.serverName, className: 'dsh-mcp-item' + (selected === s.serverName ? ' sel' : ''), onClick: () => onSelect(s.serverName), onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(s.serverName); } } },
              h(Dot, { phase: s.phase }),
              h('div', { className: 'dsh-mcp-item-main' },
                h('div', { className: 'dsh-mcp-item-name' }, s.serverName),
                h('div', { className: 'dsh-mcp-item-sub' },
                  h(Badge, { cls: s.transport === 'http' ? 't-http' : 't-stdio' }, s.transport === 'http' ? 'HTTP' : 'stdio'),
                  h('span', null, s.toolCount + ' 工具'),
                ),
              ),
              h(Toggle, { on: s.enabled, disabled: busy || !s.managed || (!s.enabled && s.phase !== 'stopped'), title: s.managed ? (s.enabled ? '禁用' : '启用') : '来自其他配置层，只读', onChange: () => onToggle(s) }),
            ),
          ),
    ),
  );

const ServerDetail = ({ server, tools, onToggle, onReconnect, onEdit, onRemove, busy }) => {
  if (!server)
    return h('div', { className: 'dsh-mcp-detail' }, h('div', { className: 'dsh-mcp-d-empty' }, '← 从左侧选择一个 MCP'));
  const env = server.env || {};
  const headers = server.headers || {};
  const envKeys = Object.keys(env);
  const headerKeys = Object.keys(headers);
  const statusCls = server.enabled ? (server.phase === 'connected' ? 's-on' : server.phase === 'failed' ? 's-err' : '') : 's-off';
  const statusText = server.enabled ? (server.phase === 'connected' ? '已连接' : server.phase === 'failed' ? '连接失败' : server.phase === 'loading' || server.phase === 'waiting' ? '连接中…' : '已停止') : '已禁用';
  const mut = (v) => {
    const visible = displayValue(v);
    return typeof visible === 'string' && visible.length > 90 ? visible.slice(0, 88) + '…' : visible;
  };
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
        h(Toggle, { on: server.enabled, disabled: busy || !server.managed, onChange: () => onToggle(server), title: server.managed ? (server.enabled ? '禁用' : '启用') : '来自其他配置层，只读' }),
        h(Btn, { icon: 'edit', onClick: () => onEdit(server), disabled: busy || !server.managed, children: '编辑' }),
        h(Btn, { icon: 'refresh', onClick: () => onReconnect(server), disabled: busy || !server.enabled || !server.managed, children: '重连' }),
        h(Btn, { cls: 'danger', icon: 'trash', onClick: () => onRemove(server), disabled: busy || !server.managed, children: '移除' }),
      ),
    ),
    h('div', { className: 'dsh-mcp-card' },
      h('h4', null, '连接信息'),
      h('div', { className: 'dsh-mcp-kv' },
        h('b', null, '传输'), h('span', null, server.transport === 'http' ? 'Streamable HTTP' : 'stdio'),
        server.url ? h('b', null, 'URL') : null, server.url ? h('span', null, mut(server.url)) : null,
        server.command ? h('b', null, '命令') : null, server.command ? h('span', null, mut(server.command)) : null,
        server.args && server.args.length ? h('b', null, '参数') : null, server.args && server.args.length ? h('span', null, server.args.map(mut).join(' ')) : null,
        server.cwd ? h('b', null, '工作目录') : null, server.cwd ? h('span', null, mut(server.cwd)) : null,
        h('b', null, '启用'), h('span', null, server.enabled ? '是' : '否（补丁中 disabled: true）'),
        h('b', null, '配置来源'), h('span', null, server.conflict ? '存在重复 serverName（冲突，只读）' : server.managed ? '当前 Web profile（可编辑）' : '其他 bundle / Agent（只读）'),
        server.toolCallTimeoutMs ? h('b', null, '调用超时') : null, server.toolCallTimeoutMs ? h('span', null, server.toolCallTimeoutMs + ' ms') : null,
        h('b', null, '启动失败策略'), h('span', null, server.failOnStartupError ? '阻止插件启动' : '记录错误并继续'),
        server.reconnect ? h('b', null, '自动重连') : null, server.reconnect ? h('span', null, server.reconnect.enabled === false ? '关闭' : `${server.reconnect.initialDelayMs || 500}–${server.reconnect.maxDelayMs || 30000} ms，最多 ${server.reconnect.maxAttempts || 10} 次`) : null,
        headerKeys.length ? h('b', null, 'Headers') : null, headerKeys.length ? h('span', null, headerKeys.join(', ')) : null,
        envKeys.length ? h('b', null, '环境变量') : null, envKeys.length ? h('span', null, envKeys.join(', ')) : null,
      ),
    ),
    h('div', { className: 'dsh-mcp-card' },
      h('h4', null, '工具（' + tools.length + '）'),
      h('div', { className: 'dsh-mcp-tools' },
        tools.length === 0
          ? h('div', { className: 'dsh-mcp-empty-list' }, '暂无工具')
          : tools.map((t) =>
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
  const dialogRef = useRef(null);
  const [name, setName] = useState('');
  const [transport, setTransport] = useState('http');
  const [url, setUrl] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [cwd, setCwd] = useState('');
  const [toolCallTimeoutMs, setToolCallTimeoutMs] = useState('60000');
  const [failOnStartupError, setFailOnStartupError] = useState(false);
  const [reconnectEnabled, setReconnectEnabled] = useState(true);
  const [initialDelayMs, setInitialDelayMs] = useState('500');
  const [maxDelayMs, setMaxDelayMs] = useState('30000');
  const [maxAttempts, setMaxAttempts] = useState('10');
  const [headers, setHeaders] = useState([{ k: '', v: '' }]);
  const [envs, setEnvs] = useState([{ k: '', v: '' }]);
  const [error, setError] = useState('');
  const editing = !!initial;
  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.serverName);
      setTransport(initial.transport === 'http' ? 'http' : 'stdio');
      setUrl(toFormValue(initial.url || ''));
      setCommand(initial.command || '');
      setArgs(Array.isArray(initial.args) ? initial.args.map(toFormValue).join('\n') : '');
      setCwd(initial.cwd || '');
      setToolCallTimeoutMs(String(initial.toolCallTimeoutMs || 60000));
      setFailOnStartupError(initial.failOnStartupError === true);
      setReconnectEnabled(initial.reconnect?.enabled !== false);
      setInitialDelayMs(String(initial.reconnect?.initialDelayMs || 500));
      setMaxDelayMs(String(initial.reconnect?.maxDelayMs || 30000));
      setMaxAttempts(String(initial.reconnect?.maxAttempts || 10));
      const hd = Object.keys(initial.headers || {}).map((k) => ({ k, originalKey: k, v: toFormValue(initial.headers[k]) }));
      setHeaders(hd.length ? hd : [{ k: '', v: '' }]);
      const ev = Object.keys(initial.env || {}).map((k) => ({ k, originalKey: k, v: toFormValue(initial.env[k]) }));
      setEnvs(ev.length ? ev : [{ k: '', v: '' }]);
    } else {
      setName(''); setTransport('http'); setUrl(''); setCommand(''); setArgs(''); setCwd('');
      setToolCallTimeoutMs('60000'); setFailOnStartupError(false); setReconnectEnabled(true);
      setInitialDelayMs('500'); setMaxDelayMs('30000'); setMaxAttempts('10');
      setHeaders([{ k: '', v: '' }]); setEnvs([{ k: '', v: '' }]);
    }
    setError('');
  }, [open, initial]);
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);
  if (!open) return null;
  const kv = (rows, setRows, i, field, v) => {
    const next = rows.slice();
    const row = { ...next[i], [field]: v };
    if (field === 'k' && row.v === PRESERVED_VALUE_LABEL && v !== row.originalKey) row.v = '';
    next[i] = row;
    setRows(next);
  };
  const addRow = (rows, setRows) => setRows([...rows, { k: '', v: '' }]);
  const delRow = (rows, setRows, i) => setRows(rows.filter((_, x) => x !== i));
  const submit = () => {
    const n = (name || '').trim();
    if (!n) return setError('请填写 MCP 名称');
    const spec = { name: n, transport };
    if (transport === 'http') {
      spec.url = fromFormValue(url.trim());
      const hd = {};
      headers.forEach((r) => { if (r.k.trim()) setOwn(hd, r.k.trim(), fromFormValue(r.v)); });
      if (Object.keys(hd).length) spec.headers = hd;
    } else {
      spec.command = command.trim();
      const parts = args.split(/\r?\n/).map((s) => fromFormValue(s.trim())).filter(Boolean);
      if (parts.length) spec.args = parts;
      if (cwd.trim()) spec.cwd = cwd.trim();
      const ev = {};
      envs.forEach((r) => { if (r.k.trim()) setOwn(ev, r.k.trim(), fromFormValue(r.v)); });
      if (Object.keys(ev).length) spec.env = ev;
    }
    const timeout = Number(toolCallTimeoutMs);
    const initialDelay = Number(initialDelayMs);
    const maxDelay = Number(maxDelayMs);
    const attempts = Number(maxAttempts);
    if (!Number.isSafeInteger(timeout) || timeout <= 0 || !Number.isSafeInteger(attempts) || attempts <= 0) return setError('工具超时和最大尝试次数必须是正整数');
    if (!Number.isFinite(initialDelay) || initialDelay <= 0 || initialDelay > MAX_TIMER_DELAY_MS || !Number.isFinite(maxDelay) || maxDelay <= 0 || maxDelay > MAX_TIMER_DELAY_MS) return setError('重连延迟必须是有效正数且不超过 2147483647 ms');
    if (initialDelay > maxDelay) return setError('首次延迟不能大于最大延迟');
    spec.toolCallTimeoutMs = timeout;
    spec.failOnStartupError = failOnStartupError;
    spec.reconnect = { enabled: reconnectEnabled, initialDelayMs: initialDelay, maxDelayMs: maxDelay, maxAttempts: attempts };
    onSubmit(spec, setError);
  };
  const kvRows = transport === 'http' ? headers : envs;
  const setKvRows = transport === 'http' ? setHeaders : setEnvs;
  return h('div', { className: 'dsh-mcp-overlay', onClick: (e) => e.target === e.currentTarget && onClose() },
    h('div', { ref: dialogRef, className: 'dsh-mcp-modal', role: 'dialog', 'aria-modal': true, 'aria-label': editing ? '编辑 MCP' : '添加 MCP', tabIndex: -1, onKeyDown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } } },
      h('h3', null, editing ? '编辑 MCP' : '添加 MCP'),
      h('div', { className: 'dsh-mcp-field' },
        h('label', null, 'MCP 名称（唯一标识，不可改）'),
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
            h('div', { className: 'dsh-mcp-field' }, h('label', null, '参数（每行一个，原样传给进程）'), h('textarea', { rows: 4, value: args, onChange: (e) => setArgs(e.target.value), placeholder: '-y\nmcp-server@latest' })),
            h('div', { className: 'dsh-mcp-field' }, h('label', null, '工作目录 cwd（可选）'), h('input', { value: cwd, onChange: (e) => setCwd(e.target.value), placeholder: 'C:\\path\\to\\workspace' })),
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
      h('div', { className: 'dsh-mcp-card dsh-mcp-advanced' },
        h('h4', null, '运行策略'),
        h('div', { className: 'dsh-mcp-field' }, h('label', null, '工具调用超时（毫秒）'), h('input', { type: 'number', min: 1, value: toolCallTimeoutMs, onChange: (e) => setToolCallTimeoutMs(e.target.value) })),
        h('label', { className: 'dsh-mcp-check' }, h('input', { type: 'checkbox', checked: failOnStartupError, onChange: (e) => setFailOnStartupError(e.target.checked) }), '首次连接失败时阻止插件启动'),
        h('label', { className: 'dsh-mcp-check' }, h('input', { type: 'checkbox', checked: reconnectEnabled, onChange: (e) => setReconnectEnabled(e.target.checked) }), '断开后自动重连'),
        h('div', { className: 'dsh-mcp-number-grid' },
          h('div', { className: 'dsh-mcp-field' }, h('label', null, '首次延迟 ms'), h('input', { type: 'number', min: 1, step: 'any', value: initialDelayMs, onChange: (e) => setInitialDelayMs(e.target.value) })),
          h('div', { className: 'dsh-mcp-field' }, h('label', null, '最大延迟 ms'), h('input', { type: 'number', min: 1, step: 'any', value: maxDelayMs, onChange: (e) => setMaxDelayMs(e.target.value) })),
          h('div', { className: 'dsh-mcp-field' }, h('label', null, '最大尝试次数'), h('input', { type: 'number', min: 1, value: maxAttempts, onChange: (e) => setMaxAttempts(e.target.value) })),
        ),
      ),
      error ? h('div', { className: 'dsh-mcp-d-err' }, error) : null,
      h('div', { className: 'dsh-mcp-modal-actions' },
        h(Btn, { onClick: onClose, children: '取消' }),
        h(Btn, { cls: 'primary', onClick: submit, disabled: busy, children: busy ? '保存中…' : (editing ? '保存' : '添加') }),
      ),
    ),
  );
};

const JsonImportModal = ({ open, onClose, call, busy, setBusy, onImported }) => {
  const dialogRef = useRef(null);
  const [text, setText] = useState('');
  const [mode, setMode] = useState('merge');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setPreview(null); setError(''); } }, [open]);
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);
  if (!open) return null;
  const runPreview = async () => {
    setBusy(true); setError('');
    try {
      const res = await call('previewImport', { json: text, mode });
      if (!res?.ok) throw new Error(res?.error || 'JSON 解析失败');
      setPreview(res);
    } catch (e) { setError(String(e?.message || e)); }
    finally { setBusy(false); }
  };
  const applyImport = async () => {
    if (!preview) return runPreview();
    if (preview.conflicts?.length) return setError('存在其他配置层的同名 MCP，不能覆盖：' + preview.conflicts.join(', '));
    if (mode === 'replace' && !confirm('替换会删除当前 Web profile 中未出现在 JSON 里的 MCP。确认继续？')) return;
    setBusy(true); setError('');
    try {
      const res = await call('importJson', { json: text, mode });
      if (!res?.ok) throw new Error(res?.error || '导入失败');
      onImported(res);
      onClose();
    } catch (e) { setError(String(e?.message || e)); }
    finally { setBusy(false); }
  };
  const summary = preview ? [
    '新增：' + (preview.added?.join(', ') || '无'),
    '更新：' + (preview.updated?.join(', ') || '无'),
    mode === 'replace' ? '移除：' + (preview.removed?.join(', ') || '无') : null,
    preview.conflicts?.length ? '冲突：' + preview.conflicts.join(', ') : null,
    ...(preview.warnings || []).map((warning) => '提示：' + warning),
  ].filter(Boolean).join('\n') : '';
  return h('div', { className: 'dsh-mcp-overlay', onClick: (e) => e.target === e.currentTarget && onClose() },
    h('div', { ref: dialogRef, className: 'dsh-mcp-modal', role: 'dialog', 'aria-modal': true, 'aria-label': '导入 MCP JSON', tabIndex: -1, onKeyDown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } } },
      h('h3', null, '导入 MCP JSON'),
      h('div', { className: 'dsh-mcp-field' },
        h('label', null, '支持 Claude/Cursor/Cline/Roo 的 mcpServers、VS Code 的 servers，以及单个 MCP 对象'),
        h('textarea', { className: 'dsh-mcp-import-json', value: text, onChange: (e) => { setText(e.target.value); setPreview(null); }, placeholder: '{\n  "mcpServers": {\n    "example": { "command": "npx", "args": ["-y", "example-mcp"] }\n  }\n}' }),
      ),
      h('div', { className: 'dsh-mcp-radio-row' },
        h('label', { className: mode === 'merge' ? 'sel' : '' }, h('input', { type: 'radio', checked: mode === 'merge', onChange: () => { setMode('merge'); setPreview(null); } }), '合并（同名更新）'),
        h('label', { className: mode === 'replace' ? 'sel' : '' }, h('input', { type: 'radio', checked: mode === 'replace', onChange: () => { setMode('replace'); setPreview(null); } }), '替换当前 Profile'),
      ),
      summary ? h('div', { className: 'dsh-mcp-card dsh-mcp-import-preview' }, summary) : null,
      error ? h('div', { className: 'dsh-mcp-d-err' }, error) : null,
      h('div', { className: 'dsh-mcp-modal-actions' },
        h(Btn, { onClick: onClose, children: '取消' }),
        h(Btn, { onClick: runPreview, disabled: busy || !text.trim(), children: busy ? '解析中…' : '预览' }),
        h(Btn, { cls: 'primary', onClick: applyImport, disabled: busy || !text.trim(), children: preview ? '确认导入' : '解析并预览' }),
      ),
    ),
  );
};

const McpTab = (props) => {
  const { call, onClose, floating, timer } = props;
  const panelRef = useRef(null);
  const [servers, setServers] = useState([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [tools, setTools] = useState([]);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (floating) panelRef.current?.focus();
  }, [floating]);

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

  useEffect(() => {
    let cancelled = false;
    setTools([]);
    if (!selected) return () => { cancelled = true; };
    (async () => {
      try {
        const res = await call('tools', selected);
        if (!cancelled && res?.ok) setTools(res.tools || []);
      } catch {
        if (!cancelled) setTools([]);
      }
    })();
    return () => { cancelled = true; };
  }, [selected, call]);

  const act = useCallback(
    async (method, name, successMsg) => {
      setBusy(true);
      try {
        const res = await call(method, name);
        if (res && res.ok) {
          flash(successMsg || (res.note || method + ' ' + name + ' 成功'));
        } else {
          flash((res && res.error) || method + ' 失败', 'err');
        }
      } catch (e) {
        flash(String((e && e.message) || e), 'err');
      } finally {
        setBusy(false);
        timer.timeout(load, 250);
      }
    },
    [call, flash, load, timer],
  );

  const onToggle = (s) => {
    if (busy || !s.managed) return;
    // 乐观更新：本地先翻转，操作完成后由 load 校准
    const next = !s.enabled;
    setServers((prev) => prev.map((x) => (x.serverName === s.serverName ? { ...x, enabled: next } : x)));
    return act(next ? 'enable' : 'disable', s.serverName, (next ? '已启用 ' : '已禁用 ') + s.serverName);
  };
  const onReconnect = (s) => act('reconnect', s.serverName, '已请求重连 ' + s.serverName);
  const onRemove = (s) => {
    if (confirm('确认移除 MCP「' + s.serverName + '」？将从当前 Web profile 配置中删除。')) act('removeServer', s.serverName, '已移除 ' + s.serverName);
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
  const onImported = (res) => {
    flash(res.note || '已导入 MCP JSON');
    timer.timeout(load, 1200);
  };

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
      h('div', { className: 'dsh-mcp-title' }, 'MCP 管理'),
      h(
        'div',
        { className: 'dsh-mcp-head-actions' },
        h(Btn, { icon: 'refresh', onClick: load, children: '刷新' }),
        h(Btn, { onClick: () => setImportOpen(true), children: '导入 JSON' }),
        h(Btn, { cls: 'primary', icon: 'plus', onClick: openAdd, children: '添加 MCP' }),
        onClose ? h(Btn, { icon: 'x', onClick: onClose, children: '关闭' }) : null,
      ),
    ),
    error ? h('div', { className: 'dsh-mcp-d-err' }, error) : null,
    h(
      'div',
      { className: 'dsh-mcp-body' },
      h(ServerList, { servers: filtered, selected, query, onQuery: setQuery, onSelect: setSelected, onToggle, busy }),
      h(ServerDetail, {
        server: selectedServer,
        tools,
        onToggle,
        onReconnect,
        onEdit: openEdit,
        onRemove,
        busy,
      }),
    ),
    h(AddEditModal, { open: addOpen, onClose: () => { setAddOpen(false); setEditTarget(null); }, onSubmit, busy, initial: editTarget }),
    h(JsonImportModal, { open: importOpen, onClose: () => setImportOpen(false), call, busy, setBusy, onImported }),
    toast
      ? h('div', { className: 'dsh-mcp-toast ' + toast.kind }, toast.msg)
      : null,
  );

  if (floating)
    return h(
      'div',
      { className: 'dsh-mcp-panel-overlay', onClick: (e) => e.target === e.currentTarget && onClose && onClose() },
      h('div', { ref: panelRef, className: 'dsh-mcp-panel', role: 'dialog', 'aria-modal': true, 'aria-label': 'MCP 管理面板', tabIndex: -1, onKeyDown: (e) => { if (e.key === 'Escape' && onClose) onClose(); } }, inner),
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
    open ? null : h(
      'button',
      { type: 'button', className: 'dsh-mcp-fab', title: 'MCP 管理面板', 'aria-label': '打开 MCP 管理面板', 'aria-expanded': false, onClick: () => setOpen(true) },
      h(Icon, { d: ICONS.plug, size: 22 }),
    ),
  );
};

function createTimer() {
  const timeouts = new Set();
  const intervals = new Set();
  return {
    timeout(fn, ms) {
      const id = setTimeout(() => {
        timeouts.delete(id);
        fn();
      }, ms);
      timeouts.add(id);
      return () => {
        clearTimeout(id);
        timeouts.delete(id);
      };
    },
    interval(fn, ms) {
      const id = setInterval(fn, ms);
      intervals.add(id);
      return () => {
        clearInterval(id);
        intervals.delete(id);
      };
    },
    dispose() {
      for (const id of timeouts) clearTimeout(id);
      for (const id of intervals) clearInterval(id);
      timeouts.clear();
      intervals.clear();
    },
  };
}

function mcpCodec(m) { return { mode: 'strict', typeSymbol: 'dsh-mcp-manager-ui/typert#' + m, schema: { parse: (v) => v } }; }
function mcpParam(name, sym) { return { name: name, wire: name, source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-mcp-manager-ui/typert#' + sym, schema: { parse: (v) => { if (sym === 'String' && typeof v !== 'string') throw new TypeError('Expected string'); return v; } } } }; }
const MCP_CONTRIBUTION = {
  package: 'dsh-mcp-manager-ui',
  descriptors: [
    { id: 'dsh-mcp-manager-ui#mcpManager/list', service: 'mcpManager', namespace: 'mcpManager', method: 'list', invocation: { kind: 'direct' }, parameters: [], result: mcpCodec('ListResult') },
    { id: 'dsh-mcp-manager-ui#mcpManager/status', service: 'mcpManager', namespace: 'mcpManager', method: 'status', invocation: { kind: 'direct' }, parameters: [mcpParam('name', 'String')], result: mcpCodec('StatusResult') },
    { id: 'dsh-mcp-manager-ui#mcpManager/enable', service: 'mcpManager', namespace: 'mcpManager', method: 'enable', invocation: { kind: 'direct' }, parameters: [mcpParam('name', 'String')], result: mcpCodec('NoteResult') },
    { id: 'dsh-mcp-manager-ui#mcpManager/disable', service: 'mcpManager', namespace: 'mcpManager', method: 'disable', invocation: { kind: 'direct' }, parameters: [mcpParam('name', 'String')], result: mcpCodec('NoteResult') },
    { id: 'dsh-mcp-manager-ui#mcpManager/reconnect', service: 'mcpManager', namespace: 'mcpManager', method: 'reconnect', invocation: { kind: 'direct' }, parameters: [mcpParam('name', 'String')], result: mcpCodec('NoteResult') },
    { id: 'dsh-mcp-manager-ui#mcpManager/tools', service: 'mcpManager', namespace: 'mcpManager', method: 'tools', invocation: { kind: 'direct' }, parameters: [mcpParam('name', 'String')], result: mcpCodec('ToolsResult') },
    { id: 'dsh-mcp-manager-ui#mcpManager/add', service: 'mcpManager', namespace: 'mcpManager', method: 'add', invocation: { kind: 'direct' }, parameters: [mcpParam('spec', 'Spec')], result: mcpCodec('NoteResult') },
    { id: 'dsh-mcp-manager-ui#mcpManager/update', service: 'mcpManager', namespace: 'mcpManager', method: 'update', invocation: { kind: 'direct' }, parameters: [mcpParam('spec', 'Spec')], result: mcpCodec('NoteResult') },
    { id: 'dsh-mcp-manager-ui#mcpManager/removeServer', service: 'mcpManager', namespace: 'mcpManager', method: 'removeServer', invocation: { kind: 'direct' }, parameters: [mcpParam('name', 'String')], result: mcpCodec('NoteResult') },
    { id: 'dsh-mcp-manager-ui#mcpManager/previewImport', service: 'mcpManager', namespace: 'mcpManager', method: 'previewImport', invocation: { kind: 'direct' }, parameters: [mcpParam('payload', 'ImportPayload')], result: mcpCodec('ImportPreview') },
    { id: 'dsh-mcp-manager-ui#mcpManager/importJson', service: 'mcpManager', namespace: 'mcpManager', method: 'importJson', invocation: { kind: 'direct' }, parameters: [mcpParam('payload', 'ImportPayload')], result: mcpCodec('ImportResult') }
  ].map((descriptor) => ({ ...descriptor, sourceLocation: { file: 'dsh-mcp-manager-ui/lib/typert.js', line: 7, column: 1 } }))
};
async function apply(ctx) {
  const disposeMount = await ctx.remote.$mount(MCP_CONTRIBUTION);
  let disposeCss;
  let timer;
  let cleanupPromise;
  const cleanup = () => {
    cleanupPromise ??= (async () => {
      try {
        timer?.dispose();
      } finally {
        try {
          disposeCss?.();
        } finally {
          await disposeMount();
        }
      }
    })();
    return cleanupPromise;
  };

  try {
    disposeCss = __injectCss(MCP_CSS);
    timer = createTimer();
    const call = async (method, args) => {
      const svc = (typeof ctx.get === 'function' ? ctx.get('remote.mcpManager') : null) || null;
      if (!svc || typeof svc[method] !== 'function') return { ok: false, error: 'MCP 管理服务未连接（面板仍可用）' };
      const r = args === undefined || args === null ? await svc[method]() : await svc[method](args);
      if (r && r.ok) return { ok: true, ...((r.value && typeof r.value === 'object') ? r.value : {}) };
      if (r && !r.ok) return { ok: false, error: (r.error && (r.error.message || r.error.code)) || '调用失败' };
      return r;
    };
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register({ name: 'shell.overlay', id: 'mcp-fab', order: 1000, label: 'MCP', inject: () => ({ call, timer }) }, McpFab),
    );
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
const inject = ['slots', 'remote', 'typert'];
exports.apply = apply;
exports.inject = inject;

		return module.exports;
	}
});
