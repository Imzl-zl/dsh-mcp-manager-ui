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
const { useState, useEffect, useCallback, useMemo, useRef } = React2;

const MCP_CSS = `.dsh-mcp-wrap,.dsh-mcp-panel-overlay{color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,inherit);--mcp-accent:var(--dsw-alias-brand-primary);--mcp-ok:var(--dsw-alias-state-success-primary);--mcp-err:var(--dsw-alias-state-error-primary);--mcp-warn:var(--dsw-alias-state-warn-primary);--mcp-mut:var(--dsw-alias-label-secondary);--mcp-bg-1:var(--dsw-alias-bg-layer-1);--mcp-bg-2:var(--dsw-alias-bg-layer-2);--mcp-bg-3:var(--dsw-alias-bg-layer-3);--mcp-line:var(--dsw-alias-border-l2)}
.dsh-mcp-wrap{box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:0;gap:14px;padding:4px 2px;font-size:13px;-webkit-font-smoothing:antialiased}
.dsh-mcp-wrap ::-webkit-scrollbar{width:8px;height:8px}
.dsh-mcp-wrap ::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2);border-radius:8px;border:2px solid transparent;background-clip:padding-box}
.dsh-mcp-wrap ::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l2);border:2px solid transparent;background-clip:padding-box}
.dsh-mcp-wrap ::-webkit-scrollbar-track{background:transparent}
.dsh-mcp-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
.dsh-mcp-title{flex:none;white-space:nowrap;font-size:15px;font-weight:650;letter-spacing:.2px;display:flex;align-items:center;gap:8px}
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
.dsh-mcp-side{width:288px;min-width:248px;min-height:0;display:flex;flex-direction:column;gap:8px;border:1px solid var(--mcp-line);border-radius:12px;background:var(--mcp-bg-2);padding:10px;overflow:hidden}
.dsh-mcp-side.embedded{width:auto;min-width:0;flex:1 1 auto;border:0;border-radius:0;background:transparent;padding:0;overflow:visible}
.dsh-mcp-search{position:relative}
.dsh-mcp-search svg{position:absolute;left:10px;top:50%;transform:translateY(-50%);opacity:.5}
.dsh-mcp-search input{width:100%;box-sizing:border-box;padding:8px 10px 8px 30px;border-radius:9px;border:1px solid var(--mcp-line);background:var(--mcp-bg-1);color:var(--dsw-alias-label-primary);font-size:12px;outline:none;transition:border-color .15s,box-shadow .15s}
.dsh-mcp-search input::placeholder{color:var(--mcp-mut)}
.dsh-mcp-search input:focus{border-color:var(--mcp-accent);box-shadow:none}
.dsh-mcp-list{flex:1 1 auto;min-height:52px;overflow-y:auto;display:flex;flex-direction:column;gap:3px;margin:0 -4px;padding:0 4px}
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
.dsh-mcp-badge.scope-ws{color:var(--mcp-accent);border-color:var(--mcp-accent);background:var(--dsw-alias-interactive-bg-hover-accent)}
.dsh-mcp-detail{flex:1;min-width:0;display:flex;flex-direction:column;gap:10px;border:1px solid var(--mcp-line);border-radius:12px;background:var(--mcp-bg-2);padding:16px;overflow-y:auto}
.dsh-mcp-d-empty{display:flex;flex:1;align-items:center;justify-content:center;color:var(--mcp-mut);font-size:13px;gap:8px}
.dsh-mcp-d-empty::before{content:"";width:34px;height:34px;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover-accent);border:1px solid var(--mcp-accent)}
.dsh-mcp-d-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
.dsh-mcp-d-name{font-size:17px;font-weight:700;letter-spacing:.2px;display:flex;align-items:center;gap:8px;min-width:0;overflow-wrap:anywhere}
.dsh-mcp-d-meta{display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap}
.dsh-mcp-d-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.dsh-mcp-d-scope-hint{font-size:11.5px;color:var(--mcp-mut)}
.dsh-mcp-card{border:1px solid var(--mcp-line);border-radius:10px;padding:12px 14px;background:var(--mcp-bg-1)}
.dsh-mcp-card h4{margin:0 0 9px;font-size:10.5px;font-weight:650;color:var(--mcp-mut);text-transform:uppercase;letter-spacing:.8px;display:flex;align-items:center;gap:6px}
.dsh-mcp-card h4::after{content:"";flex:1;height:1px;background:var(--mcp-line);margin-left:2px}
.dsh-mcp-kv{display:grid;grid-template-columns:auto minmax(0,1fr);gap:5px 14px;font-size:12px;word-break:break-all}
.dsh-mcp-kv>*{min-width:0}
.dsh-mcp-kv b{color:var(--mcp-mut);font-weight:500;white-space:normal;overflow-wrap:anywhere}
.dsh-mcp-tools{display:flex;flex-direction:column;gap:5px}
.dsh-mcp-tool{display:flex;gap:9px;padding:7px 9px;border-radius:8px;background:var(--mcp-bg-1);border:1px solid transparent;transition:background .12s,border-color .12s}
.dsh-mcp-tool:hover{border-color:var(--mcp-line);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mcp-tool-name{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;color:var(--dsw-alias-brand-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46%}
.dsh-mcp-tool-desc{font-size:11.5px;color:var(--mcp-mut);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mcp-empty-list{padding:20px;text-align:center;color:var(--mcp-mut);font-size:12px}
.dsh-mcp-overlay{position:fixed;inset:0;background:var(--dsw-alias-bg-overlay);display:flex;align-items:center;justify-content:center;z-index:200;padding:12px;animation:mcpFade .14s ease-out}
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
.dsh-mcp-input-action{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:start}.dsh-mcp-input-action textarea{min-width:0}.dsh-mcp-kv-row-actions{display:flex;gap:5px;align-items:center;height:34px}.dsh-mcp-inline-icon{box-sizing:border-box;width:34px!important;height:34px!important;padding:0!important;flex:none}
.dsh-mcp-kv-del{box-sizing:border-box;width:34px;height:34px;padding:0!important;display:inline-flex;align-items:center;justify-content:center;flex:none}
.dsh-mcp-secret{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:100%}.dsh-mcp-secret-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:pre-wrap;word-break:break-all}.dsh-mcp-secret-btn{width:24px;height:24px;flex:none;padding:0;border:1px solid var(--mcp-line);border-radius:6px;background:var(--dsw-alias-button-elevated-fill);color:var(--mcp-mut);cursor:pointer}.dsh-mcp-secret-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--mcp-accent)}.dsh-mcp-secret-list{display:flex;flex-direction:column;gap:5px;min-width:0}.dsh-mcp-secret-row{display:grid;grid-template-columns:minmax(0,40%) minmax(0,1fr);gap:8px;align-items:center;min-width:0}.dsh-mcp-secret-row b{min-width:0;overflow-wrap:anywhere}.dsh-mcp-log{margin-top:10px;padding:9px 11px;border-left:3px solid var(--mcp-err);background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--mcp-err);font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word}.dsh-mcp-log.warn{border-left-color:var(--mcp-warn);color:var(--mcp-warn);background:var(--dsw-alias-state-warn-tertiary)}
.dsh-mcp-kv-add{display:flex;justify-content:flex-end;margin-top:2px}
.dsh-mcp-kv-del{border:1px solid var(--mcp-line);background:var(--dsw-alias-button-elevated-fill);color:var(--mcp-mut);cursor:pointer;font-size:14px;padding:3px 9px;border-radius:7px;line-height:18px;transition:color .12s,background .12s,border-color .12s}
.dsh-mcp-kv-del:hover{color:var(--mcp-err);background:var(--dsw-alias-interactive-bg-hover-danger);border-color:var(--dsw-alias-state-error-primary)}
.dsh-mcp-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px;flex-wrap:wrap}
.dsh-mcp-advanced{margin-top:14px}.dsh-mcp-check{display:flex!important;align-items:center;gap:8px;margin:9px 0!important;color:var(--dsw-alias-label-primary)!important}.dsh-mcp-check input{width:auto!important}.dsh-mcp-number-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.dsh-mcp-number-grid .dsh-mcp-field{margin-bottom:0}.dsh-mcp-import-preview{font-size:12px;line-height:1.6;color:var(--mcp-mut);white-space:pre-wrap}.dsh-mcp-import-json{min-height:220px;resize:vertical;font-family:ui-monospace,Consolas,monospace!important}
.dsh-mcp-builtin-modal{box-sizing:border-box;width:700px;height:min(760px,84vh);display:flex;flex-direction:column;overflow:hidden}.dsh-mcp-builtin-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 10px;flex:none}.dsh-mcp-builtin-toolbar .dsh-mcp-check{margin:0!important;font-size:12px}.dsh-mcp-builtin-count{font-size:11.5px;color:var(--mcp-mut)}.dsh-mcp-builtin-list{display:flex;flex-direction:column;gap:8px;min-height:0;overflow-y:auto;padding-right:2px}.dsh-mcp-builtin-modal>.dsh-mcp-modal-actions{flex:none}.dsh-mcp-builtin-row{display:grid;grid-template-columns:18px minmax(0,1fr) minmax(74px,auto);gap:11px;align-items:start;padding:11px 12px;border:1px solid var(--mcp-line);border-radius:8px;background:var(--mcp-bg-1);cursor:pointer;transition:border-color .12s,background .12s;flex:none}.dsh-mcp-builtin-row:hover{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-interactive-bg-hover)}.dsh-mcp-builtin-row.installed{cursor:default;background:var(--mcp-bg-2)}.dsh-mcp-builtin-row.installed:hover{border-color:var(--mcp-line);background:var(--mcp-bg-2)}.dsh-mcp-builtin-select{box-sizing:border-box;width:16px!important;height:16px!important;margin:2px 0 0!important;accent-color:var(--mcp-accent);cursor:pointer}.dsh-mcp-builtin-select:disabled{cursor:default}.dsh-mcp-builtin-main{min-width:0;display:flex;flex-direction:column;gap:5px}.dsh-mcp-builtin-name{font-size:13px;font-weight:650;overflow-wrap:anywhere}.dsh-mcp-builtin-summary{font-size:11.5px;color:var(--mcp-mut);line-height:1.45}.dsh-mcp-builtin-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.dsh-mcp-builtin-access{font-size:10.5px;color:var(--mcp-mut)}.dsh-mcp-builtin-config{font-family:ui-monospace,Consolas,monospace;font-size:10.5px;line-height:1.45;color:var(--dsw-alias-brand-text);overflow-wrap:anywhere;white-space:normal}.dsh-mcp-builtin-status{min-width:0;text-align:right;font-size:11px;color:var(--mcp-mut);line-height:1.45;overflow-wrap:anywhere}.dsh-mcp-builtin-status.ready{color:var(--dsw-alias-state-success-primary)}.dsh-mcp-builtin-loading{padding:30px 12px;text-align:center;color:var(--mcp-mut);font-size:12px}
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
.dsh-mcp-panel-overlay{position:fixed;inset:0;background:var(--dsw-alias-bg-overlay);display:flex;align-items:center;justify-content:center;z-index:180;padding:26px;pointer-events:auto;animation:mcpFade .14s ease-out}
.dsh-mcp-panel{box-sizing:border-box;width:1000px;max-width:95vw;height:88vh;background:var(--mcp-bg-2);border:1px solid var(--mcp-line);border-radius:16px;box-shadow:0 30px 90px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden;animation:mcpPop .18s cubic-bezier(.2,.9,.3,1.15)}
.dsh-mcp-panel .dsh-mcp-wrap{height:100%;min-height:0;padding:18px}
.dsh-mcp-filters{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.dsh-mcp-filters select{width:100%;box-sizing:border-box;padding:6px 24px 6px 8px;border-radius:8px;border:1px solid var(--mcp-line);background:var(--mcp-bg-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:11.5px;outline:none;transition:border-color .15s;appearance:none;-webkit-appearance:none;background-image:linear-gradient(45deg,transparent 50%,var(--mcp-mut) 50%),linear-gradient(135deg,var(--mcp-mut) 50%,transparent 50%);background-position:calc(100% - 13px) 50%,calc(100% - 9px) 50%;background-size:4px 4px,4px 4px;background-repeat:no-repeat}
.dsh-mcp-filters select:focus{border-color:var(--mcp-accent)}
.dsh-mcp-tool{flex-direction:column;padding:0;gap:0}
.dsh-mcp-tool-head{display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:8px}
.dsh-mcp-tool-head.interactive{cursor:pointer}
.dsh-mcp-tool-head.interactive:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mcp-tool-head.interactive:focus-visible{outline:1px solid var(--mcp-accent);outline-offset:-1px}
.dsh-mcp-tool-caret{flex:none;color:var(--mcp-mut);font-size:10px;width:14px;text-align:center}
.dsh-mcp-tool-body{padding:2px 9px 10px;display:flex;flex-direction:column;gap:8px}
.dsh-mcp-params{display:flex;flex-direction:column;gap:6px}
.dsh-mcp-param{border:1px solid var(--mcp-line);border-radius:8px;padding:7px 9px;background:var(--mcp-bg-1)}
.dsh-mcp-param-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.dsh-mcp-param-name{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;color:var(--dsw-alias-brand-text);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.dsh-mcp-param-type{font-size:10px;color:var(--mcp-mut);border:1px solid var(--mcp-line);border-radius:5px;padding:1px 5px;font-family:ui-monospace,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60%}
.dsh-mcp-req{font-size:10px;color:var(--dsw-alias-state-warn-primary);border:1px solid var(--dsw-alias-state-warn-primary);border-radius:5px;padding:1px 5px}
.dsh-mcp-opt{font-size:10px;color:var(--mcp-mut);border:1px solid var(--mcp-line);border-radius:5px;padding:1px 5px}
.dsh-mcp-param-desc{font-size:11px;color:var(--mcp-mut);margin-top:4px;line-height:1.5;white-space:normal;word-break:break-word}
.dsh-mcp-param-enum{font-size:10.5px;color:var(--mcp-mut);margin-top:3px;font-family:ui-monospace,Consolas,monospace;word-break:break-all}
.dsh-mcp-tool-rawbtn{align-self:flex-start;border:1px solid var(--mcp-line);border-radius:7px;background:var(--dsw-alias-button-elevated-fill);color:var(--mcp-mut);font-size:11px;padding:4px 9px;cursor:pointer;transition:color .12s,border-color .12s}
.dsh-mcp-tool-rawbtn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}
.dsh-mcp-json{font-family:ui-monospace,Consolas,monospace;font-size:11px;line-height:1.5;background:var(--mcp-bg-1);border:1px solid var(--mcp-line);border-radius:8px;padding:9px;overflow:auto;white-space:pre;max-height:260px;color:var(--dsw-alias-label-primary);margin:0}
@keyframes mcpPop{from{opacity:0;transform:scale(.965) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes mcpFade{from{opacity:0}to{opacity:1}}
.dsh-mcp-tabs{display:flex;gap:6px;align-items:center;overflow-x:auto;scrollbar-width:none;position:relative;flex:none;padding:2px 0}.dsh-mcp-tabs::-webkit-scrollbar{display:none}.dsh-mcp-tab{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:9px;border:1px solid var(--mcp-line);background:var(--mcp-bg-1);color:var(--mcp-mut);font-size:12px;cursor:pointer;flex:none;white-space:nowrap;transition:background .13s,border-color .13s,color .13s;line-height:1.4}.dsh-mcp-tab:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l3)}.dsh-mcp-tab.sel{color:var(--dsw-alias-label-primary);border-color:var(--mcp-accent);background:var(--dsw-alias-interactive-bg-hover-accent);font-weight:600}.dsh-mcp-tab-count{font-size:10px;font-weight:500;padding:0 6px;border-radius:999px;background:var(--mcp-line);color:var(--mcp-mut);line-height:15px}.dsh-mcp-tab-pop{position:absolute;top:calc(100% + 5px);right:0;z-index:60;background:var(--mcp-bg-2);border:1px solid var(--mcp-line);border-radius:11px;box-shadow:0 14px 34px rgba(0,0,0,.28);padding:6px;display:flex;flex-direction:column;gap:2px;min-width:170px}.dsh-mcp-tab-pop .dsh-mcp-tab{width:100%}.dsh-mcp-ws-body{width:288px;min-width:248px;min-height:0;display:flex;flex-direction:column;gap:10px;overflow-y:auto;overflow-x:hidden}.dsh-mcp-section{display:flex;flex-direction:column;gap:8px;min-height:0;border:1px solid var(--mcp-line);border-radius:12px;background:var(--mcp-bg-2);padding:10px;overflow:hidden}.dsh-mcp-section.local{flex:0 1 auto;min-height:124px;max-height:62%;border-color:var(--mcp-accent)}.dsh-mcp-section.global{flex:1 1 0;min-height:124px}.dsh-mcp-section-title{font-size:10.5px;font-weight:650;color:var(--mcp-mut);text-transform:uppercase;letter-spacing:.6px;display:flex;align-items:center;gap:6px;flex:none}.dsh-mcp-section.local .dsh-mcp-section-title{color:var(--dsw-alias-label-primary)}.dsh-mcp-section-title::after{content:"";flex:1;height:1px;background:var(--mcp-line)}.dsh-mcp-section-count{flex:none;font-size:10px;font-weight:600;letter-spacing:0;padding:0 6px;border-radius:999px;background:var(--mcp-line);color:var(--mcp-mut);line-height:15px}.dsh-mcp-section.local .dsh-mcp-section-count{background:var(--dsw-alias-interactive-bg-hover-accent);color:var(--mcp-accent)}.dsh-mcp-global-list{display:flex;flex-direction:column;gap:3px;overflow-y:auto;min-height:52px;margin:0 -4px;padding:0 4px}
.dsh-mcp-item.muted{opacity:.52}
.dsh-mcp-item.muted:hover{opacity:.85}
.dsh-mcp-global-search{position:relative;flex:none}
.dsh-mcp-global-search svg{position:absolute;left:10px;top:50%;transform:translateY(-50%);opacity:.5}
.dsh-mcp-global-search input{width:100%;box-sizing:border-box;padding:7px 10px 7px 30px;border-radius:8px;border:1px solid var(--mcp-line);background:var(--mcp-bg-1);color:var(--dsw-alias-label-primary);font-size:11.5px;outline:none;transition:border-color .15s}
.dsh-mcp-global-search input::placeholder{color:var(--mcp-mut)}
.dsh-mcp-section.global.collapsed{flex:none;min-height:0;border-color:transparent;background:transparent;padding:0;overflow:visible}
.dsh-mcp-section-toggle{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;flex:none;padding:7px 9px;border:1px solid transparent;border-radius:9px;background:transparent;color:var(--mcp-mut);font:inherit;font-size:10.5px;font-weight:650;text-transform:uppercase;letter-spacing:.6px;text-align:left;cursor:pointer;transition:background .13s,color .13s,border-color .13s}
.dsh-mcp-section-toggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-mcp-section.collapsed .dsh-mcp-section-toggle{border-color:var(--mcp-line);background:var(--mcp-bg-2)}
.dsh-mcp-caret{flex:none;width:10px;font-size:9px}
.dsh-mcp-section-toggle-label{flex:none}
.dsh-mcp-section-summary{margin-left:auto;flex:none;font-size:10.5px;font-weight:500;text-transform:none;letter-spacing:0;color:var(--mcp-mut)}
.dsh-mcp-eye{box-sizing:border-box;width:30px;height:26px;flex:none;padding:0;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--mcp-line);border-radius:7px;background:var(--dsw-alias-button-elevated-fill);color:var(--mcp-mut);cursor:pointer;transition:color .12s,border-color .12s,background .12s}
.dsh-mcp-eye:hover{color:var(--dsw-alias-label-primary);border-color:var(--mcp-accent)}
.dsh-mcp-eye.off{color:var(--mcp-err);border-color:var(--mcp-err);background:var(--dsw-alias-interactive-bg-hover-danger)}
.dsh-mcp-eye:disabled{opacity:.5;cursor:not-allowed}
/* 响应式覆盖必须位于全部基础规则之后：同特异性下后出现者胜出。 */
@media (max-width:760px){.dsh-mcp-panel-overlay{padding:10px}.dsh-mcp-panel{max-width:none;width:100%;height:calc(100dvh - 20px);border-radius:10px}.dsh-mcp-panel .dsh-mcp-wrap{padding:12px}.dsh-mcp-head{align-items:flex-start}.dsh-mcp-body{flex-direction:column;overflow-y:auto;overflow-x:hidden}.dsh-mcp-side,.dsh-mcp-ws-body{width:auto;min-width:0;max-height:none;flex:none}.dsh-mcp-side:not(.embedded) .dsh-mcp-list{max-height:38vh}.dsh-mcp-section.local,.dsh-mcp-section.global{flex:none;min-height:0;max-height:none}.dsh-mcp-section.local .dsh-mcp-list{max-height:30vh}.dsh-mcp-global-list{max-height:30vh}.dsh-mcp-detail{padding:12px;flex:none}.dsh-mcp-d-head{flex-direction:column}.dsh-mcp-kv-edit{grid-template-columns:minmax(90px,35%) minmax(0,1fr) auto}}
@media (max-width:480px){.dsh-mcp-head{flex-direction:column}.dsh-mcp-head-actions{width:100%;justify-content:flex-start}.dsh-mcp-btn{padding:7px 9px}.dsh-mcp-radio-row,.dsh-mcp-number-grid{grid-template-columns:1fr}.dsh-mcp-modal{max-width:none;width:100%;padding:14px}.dsh-mcp-kv{grid-template-columns:1fr;gap:4px}.dsh-mcp-kv>b{margin-top:4px}.dsh-mcp-secret-row{grid-template-columns:1fr;gap:4px}.dsh-mcp-secret{width:100%}.dsh-mcp-kv-edit{grid-template-columns:1fr auto}.dsh-mcp-kv-edit input:first-child{grid-column:1 / -1}.dsh-mcp-tool{flex-direction:column}.dsh-mcp-tool-name{max-width:100%}.dsh-mcp-tool-desc{white-space:normal}.dsh-mcp-builtin-toolbar{align-items:flex-start;flex-direction:column}.dsh-mcp-builtin-row{grid-template-columns:18px minmax(0,1fr)}.dsh-mcp-builtin-status{grid-column:2;text-align:left}}
`;

const h = React2.createElement;
const MAX_TIMER_DELAY_MS = 2147483647;
const REDACTED_VALUE = '__DSH_MCP_REDACTED__';
const PRESERVED_VALUE_LABEL = '••••••（保留原值）';
const MASKED_VALUE = '••••••';
const toFormValue = (value) => value === REDACTED_VALUE ? PRESERVED_VALUE_LABEL : String(value || '');
const fromFormValue = (value) => value === PRESERVED_VALUE_LABEL ? REDACTED_VALUE : value;
const displayValue = (value) => value === REDACTED_VALUE ? MASKED_VALUE : value;
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
  eye: 'M1.5 8s2.3-4 6.5-4 6.5 4 6.5 4-2.3 4-6.5 4S1.5 8 1.5 8zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  eyeOff: 'M2 2l12 12M6.1 4.3A7 7 0 0 1 8 4c4.2 0 6.5 4 6.5 4a8.7 8.7 0 0 1-2 2.5M9.9 11.7A7 7 0 0 1 8 12c-4.2 0-6.5-4-6.5-4a9 9 0 0 1 2-2.5',
  copy: 'M6 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1zM3.5 3.5h6.5v6.5',
};

// ── 常用 MCP 预设模板（主流管理器常见的“浏览即添加”能力）────────────
// 预设只填充表单，不直接写入；命令依赖本机 npx / uvx，保存前请确认可用。
const MCP_PRESETS = [
  { id: 'filesystem', serverName: 'filesystem', label: 'Filesystem · 本地文件读写', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/allowed/dir'] },
  { id: 'memory', serverName: 'memory', label: 'Memory · 知识图谱记忆', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
  { id: 'sequential-thinking', serverName: 'sequential-thinking', label: 'Sequential Thinking · 分步推理', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] },
  { id: 'time', serverName: 'time', label: 'Time · 时区时间工具（需 uvx）', transport: 'stdio', command: 'uvx', args: ['mcp-server-time'] },
  { id: 'git', serverName: 'git', label: 'Git · 版本控制（需 uvx）', transport: 'stdio', command: 'uvx', args: ['mcp-server-git'] },
];

// ── 工具参数 JSON Schema 的可读化渲染辅助 ────────────────────────────
function clearRevealState(generation, setValues, setBusy) {
  generation.current += 1;
  setValues({});
  setBusy?.('');
}
function consumeRevision(ref, next) {
  if (typeof next !== 'string') return false;
  const changed = ref.current !== '' && next !== ref.current;
  ref.current = next;
  return changed;
}
async function copyText(text) {
  let area;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof window !== 'undefined' && window.isSecureContext) {
      await navigator.clipboard.writeText(String(text));
      return true;
    }
    area = document.createElement('textarea');
    area.value = String(text);
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    return document.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    area?.remove();
  }
}
function describeType(node) {
  if (!node || typeof node !== 'object') return 'any';
  if (Array.isArray(node.type)) return node.type.join(' | ');
  if (node.anyOf || node.oneOf) {
    const branches = node.anyOf || node.oneOf || [];
    return branches.map(describeType).filter((value, index, list) => list.indexOf(value) === index).join(' | ');
  }
  if (node.type === 'array') return node.items ? 'array<' + describeType(node.items) + '>' : 'array';
  return typeof node.type === 'string' ? node.type : 'any';
}
function enumText(node) {
  return node && Array.isArray(node.enum) ? node.enum.map((value) => JSON.stringify(value)).join(', ') : '';
}

// 标签页估算宽度：用于溢出折叠（中文按 15px、ASCII 按 8px 粗估，含 padding）。
function estimateTabWidth(label, hasCount) {
  let width = 0;
  for (const ch of label) width += ch.charCodeAt(0) > 255 ? 15 : 8;
  return width + 26 + (hasCount ? 26 : 0);
}

// 作用域标签页：全局固定首位；项目超出宽度时折叠为「…N」弹出层。
const ScopeTabs = ({ tabs, active, onSelect }) => {
  const barRef = useRef(null);
  const [barWidth, setBarWidth] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    if (typeof ResizeObserver === 'undefined') { setBarWidth(el.clientWidth); return; }
    const update = () => setBarWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { setMoreOpen(false); }, [active]);
  useEffect(() => {
    if (!moreOpen) return;
    const close = (e) => { if (!barRef.current || !barRef.current.contains(e.target)) setMoreOpen(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [moreOpen]);
  const visibleCount = useMemo(() => {
    if (!barWidth || tabs.length === 0) return tabs.length;
    let acc = 0;
    let count = 0;
    for (let i = 0; i < tabs.length; i += 1) {
      const w = estimateTabWidth(tabs[i].label, tabs[i].count !== undefined) + 8;
      if (acc + w > barWidth) break;
      acc += w;
      count += 1;
    }
    if (count >= tabs.length) return tabs.length;
    // 有溢出时至少保留一个 tab，并为「…N」预留宽度。
    const moreWidth = 58;
    while (count > 1 && acc + moreWidth > barWidth) {
      count -= 1;
      acc -= estimateTabWidth(tabs[count].label, tabs[count].count !== undefined) + 8;
    }
    return count;
  }, [tabs, barWidth]);
  const hidden = visibleCount < tabs.length ? tabs.slice(visibleCount) : [];
  const visible = visibleCount < tabs.length ? tabs.slice(0, visibleCount) : tabs;
  return h('div', { className: 'dsh-mcp-tabs', ref: barRef },
    visible.map((tab) =>
      h('div', { key: tab.key, role: 'tab', 'aria-selected': active === tab.key, className: 'dsh-mcp-tab' + (active === tab.key ? ' sel' : ''), onClick: () => onSelect(tab.key), title: tab.title || tab.label },
        tab.label,
        tab.count !== undefined ? h('span', { className: 'dsh-mcp-tab-count' }, tab.count) : null,
      ),
    ),
    hidden.length ? h('div', { key: '__more__', role: 'tab', className: 'dsh-mcp-tab more', onClick: (e) => { e.stopPropagation(); setMoreOpen((value) => !value); } }, h('b', null, '…'), hidden.length) : null,
    moreOpen && hidden.length ? h('div', { className: 'dsh-mcp-tab-pop', onClick: (e) => e.stopPropagation() },
      hidden.map((tab) =>
        h('div', { key: tab.key, role: 'tab', 'aria-selected': active === tab.key, className: 'dsh-mcp-tab' + (active === tab.key ? ' sel' : ''), onClick: () => { setMoreOpen(false); onSelect(tab.key); }, title: tab.title || tab.label },
          tab.label,
          tab.count !== undefined ? h('span', { className: 'dsh-mcp-tab-count' }, tab.count) : null,
        ),
      ),
    ) : null,
  );
};
function flattenParameters(schema) {
  if (!schema || typeof schema !== 'object') return { required: [], properties: [] };
  const required = Array.isArray(schema.required) ? schema.required : [];
  const props = schema.properties;
  if (!props || typeof props !== 'object') return { required, properties: [] };
  const requiredSet = new Set(required);
  const properties = Object.keys(props).map((name) => {
    const node = props[name] && typeof props[name] === 'object' ? props[name] : {};
    return {
      name,
      type: describeType(node),
      description: node.description || '',
      required: requiredSet.has(name),
      hasDefault: Object.prototype.hasOwnProperty.call(node, 'default'),
      default: node.default,
      enumText: enumText(node),
    };
  });
  return { required, properties };
}
const ToolRow = ({ tool }) => {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState(false);
  const hasSchema = !!tool.parameters && typeof tool.parameters === 'object';
  const { properties } = hasSchema ? flattenParameters(tool.parameters) : { properties: [] };
  const toggle = () => setOpen((value) => !value);
  const headProps = hasSchema ? {
    className: 'dsh-mcp-tool-head interactive',
    role: 'button',
    tabIndex: 0,
    'aria-expanded': open,
    title: open ? '收起参数' : '查看参数',
    onClick: toggle,
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } },
  } : { className: 'dsh-mcp-tool-head' };
  return h('div', { className: 'dsh-mcp-tool' },
    h('div', headProps,
      h('span', { className: 'dsh-mcp-tool-name', title: tool.name }, tool.name),
      h('span', { className: 'dsh-mcp-tool-desc', title: tool.description }, tool.description || ''),
      hasSchema ? h('span', { className: 'dsh-mcp-tool-caret', 'aria-hidden': true }, open ? '▾' : '▸') : null,
    ),
    open && hasSchema ? h('div', { className: 'dsh-mcp-tool-body' },
      properties.length ? h('div', { className: 'dsh-mcp-params' },
        properties.map((p) => h('div', { key: p.name, className: 'dsh-mcp-param' },
          h('div', { className: 'dsh-mcp-param-head' },
            h('code', { className: 'dsh-mcp-param-name' }, p.name),
            p.required ? h('span', { className: 'dsh-mcp-req' }, '必填') : h('span', { className: 'dsh-mcp-opt' }, '可选'),
            h('span', { className: 'dsh-mcp-param-type' }, p.type),
          ),
          p.description ? h('div', { className: 'dsh-mcp-param-desc' }, p.description) : null,
          p.enumText ? h('div', { className: 'dsh-mcp-param-enum' }, '可选值：' + p.enumText) : null,
          p.hasDefault ? h('div', { className: 'dsh-mcp-param-enum' }, '默认值：' + JSON.stringify(p.default)) : null,
        )),
      ) : null,
      h('button', { type: 'button', className: 'dsh-mcp-tool-rawbtn', onClick: () => setRaw((value) => !value) }, raw ? '收起原始 JSON' : '查看原始 JSON'),
      raw ? h('pre', { className: 'dsh-mcp-json' }, JSON.stringify(tool.parameters, null, 2)) : null,
    ) : null,
  );
};

const Btn = ({ cls, icon, onClick, disabled, children }) =>
  h('button', { type: 'button', className: 'dsh-mcp-btn' + (cls ? ' ' + cls : ''), onClick, disabled }, icon ? h(Icon, { d: ICONS[icon] }) : null, children);

// 服务器列表。embedded=true 时作为项目 tab 的分区内容渲染：去掉自身卡片外框，
// 并在条目较少时隐藏搜索/过滤（否则控件会挤占本就有限的列表高度）。
const CONTROLS_THRESHOLD = 6;
const ServerList = ({ servers, total, selected, query, onQuery, onSelect, onToggle, busy, transportFilter, statusFilter, onTransportFilter, onStatusFilter, embedded, workspace, emptyHint, mountErrors }) => {
  const count = total === undefined ? servers.length : total;
  const showControls = !embedded || count > CONTROLS_THRESHOLD;
  const mountError = (s) => mountErrors?.get(s.serverName);
  // 项目 MCP 随会话挂载，面板无从探测连接状态：状态点保持中性，除非它确实挂载失败过。
  const dotPhase = (s) => (mountError(s) ? 'failed' : s.scope === 'workspace' ? 'idle' : s.status || s.phase);
  const toggleLocked = (s) => busy || !s.managed || (s.scope !== 'workspace' && !s.enabled && s.phase !== 'stopped');
  return h('div', { className: 'dsh-mcp-side' + (embedded ? ' embedded' : '') },
    showControls ? h('div', { className: 'dsh-mcp-search' }, h(Icon, { d: ICONS.search }), h('input', { placeholder: '搜索 MCP…', value: query, onChange: (e) => onQuery(e.target.value) })) : null,
    showControls ? h('div', { className: 'dsh-mcp-filters' },
      h('select', { value: transportFilter, onChange: (e) => onTransportFilter(e.target.value), 'aria-label': '按传输过滤' },
        h('option', { value: 'all' }, '全部传输'),
        h('option', { value: 'http' }, 'HTTP'),
        h('option', { value: 'stdio' }, 'stdio'),
      ),
      h('select', { value: statusFilter, onChange: (e) => onStatusFilter(e.target.value), 'aria-label': '按状态过滤' },
        h('option', { value: 'all' }, '全部状态'),
        workspace ? null : h('option', { value: 'connected' }, '已连接'),
        workspace ? null : h('option', { value: 'failed' }, '失败'),
        h('option', { value: 'disabled' }, '已禁用'),
      ),
    ) : null,
    h('div', { className: 'dsh-mcp-list' },
      servers.length === 0
        ? h('div', { className: 'dsh-mcp-empty-list' }, count === 0 && emptyHint ? emptyHint : '没有匹配的 MCP')
        : servers.map((s) =>
            h('div', { key: s.serverName, role: 'button', tabIndex: 0, 'aria-selected': selected === s.serverName, className: 'dsh-mcp-item' + (selected === s.serverName ? ' sel' : ''), onClick: () => onSelect(s.serverName), onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(s.serverName); } } },
              h(Dot, { phase: dotPhase(s) }),
              h('div', { className: 'dsh-mcp-item-main' },
                h('div', { className: 'dsh-mcp-item-name' }, s.serverName),
                h('div', { className: 'dsh-mcp-item-sub' },
                  h(Badge, { cls: s.transport === 'http' ? 't-http' : 't-stdio' }, s.transport === 'http' ? 'HTTP' : 'stdio'),
                  h('span', null, s.scope === 'workspace' ? '随会话挂载' : s.toolCount + ' 工具'),
                  mountError(s) ? h(Badge, { cls: 's-err' }, '挂载失败') : null,
                ),
              ),
              h(Toggle, { on: s.enabled, disabled: toggleLocked(s), title: s.managed ? (s.enabled ? '禁用' : '启用') : '来自其他配置层，只读', onChange: () => onToggle(s) }),
            ),
          ),
    ),
  );
};

// 可见性按钮：与「启用」滑块刻意用不同控件——滑块表示启用状态，眼睛表示在本项目是否可见。
const EyeToggle = ({ hidden, disabled, onChange, label }) =>
  h('button', {
    type: 'button',
    className: 'dsh-mcp-eye' + (hidden ? ' off' : ''),
    disabled,
    'aria-pressed': !hidden,
    'aria-label': (hidden ? '已屏蔽：' : '可见：') + label,
    title: hidden ? '已在此项目屏蔽，点击恢复可见' : '在此项目可见，点击屏蔽',
    onClick: (e) => { e.stopPropagation(); onChange(!hidden); },
  }, h(Icon, { d: ICONS[hidden ? 'eyeOff' : 'eye'], size: 15 }));

// 项目 tab 中的「全局 MCP（可屏蔽）」列表：配置只读，可点选查看详情，可切换本项目可见性。
// 搜索框置于滚动列表之外，避免随列表滚走。
const GlobalServerList = ({ servers, exclude, onToggleExclude, onSelect, selected, busy }) => {
  const [q, setQ] = useState('');
  const hidden = new Set(exclude || []);
  const query = (q || '').toLowerCase();
  const list = query ? servers.filter((s) => s.serverName.toLowerCase().includes(query)) : servers;
  return h(React2.Fragment, null,
    servers.length > CONTROLS_THRESHOLD ? h('div', { className: 'dsh-mcp-global-search' }, h(Icon, { d: ICONS.search }), h('input', { placeholder: '搜索全局 MCP…', value: q, onChange: (e) => setQ(e.target.value) })) : null,
    h('div', { className: 'dsh-mcp-global-list' },
      servers.length === 0
        ? h('div', { className: 'dsh-mcp-empty-list' }, '没有全局 MCP')
        : list.length === 0
          ? h('div', { className: 'dsh-mcp-empty-list' }, '没有匹配的全局 MCP')
          : list.map((s) => {
              const isHidden = hidden.has(s.serverName);
              return h('div', {
                key: s.serverName,
                role: 'button',
                tabIndex: 0,
                'aria-selected': selected === s.serverName,
                className: 'dsh-mcp-item' + (selected === s.serverName ? ' sel' : '') + (isHidden ? ' muted' : ''),
                onClick: () => onSelect(s.serverName),
                onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(s.serverName); } },
              },
                h(Dot, { phase: s.status || s.phase }),
                h('div', { className: 'dsh-mcp-item-main' },
                  h('div', { className: 'dsh-mcp-item-name' }, s.serverName),
                  h('div', { className: 'dsh-mcp-item-sub' },
                    h(Badge, { cls: s.transport === 'http' ? 't-http' : 't-stdio' }, s.transport === 'http' ? 'HTTP' : 'stdio'),
                    h('span', null, s.toolCount + ' 工具'),
                    isHidden ? h(Badge, { cls: 's-off' }, '已屏蔽') : null,
                  ),
                ),
                // 眼睛 = 可见性，与项目 MCP 的启用滑块在语义与外观上都区分开。
                h(EyeToggle, { hidden: isHidden, disabled: busy, label: s.serverName, onChange: (next) => onToggleExclude(s.serverName, next) }),
              );
            }),
    ),
  );
};

const ServerDetail = ({ server, tools, onToggle, onReconnect, onEdit, onRemove, busy, onReveal, revealed, onCopy, excluded, onToggleExclude }) => {
  if (!server)
    return h('div', { className: 'dsh-mcp-detail' }, h('div', { className: 'dsh-mcp-d-empty' }, '选择一个 MCP 查看详情'));
  const env = server.env || {};
  const headers = server.headers || {};
  const envKeys = Object.keys(env);
  const headerKeys = Object.keys(headers);
  const revealId = (field, key) => server.serverName + ':' + field + (key !== undefined ? ':' + key : '');
  const revealedValue = (field, key) => {
    const r = revealed[revealId(field, key)];
    if (!r || r.value === undefined) return undefined;
    return Array.isArray(r.value) ? r.value.join(' ') : String(r.value);
  };
  // 项目 MCP 由会话挂载，管理面板不持有其连接：状态保持中性，除非它确实挂载失败过
  // （workspaceServerView 不产生 lastError，此处的 lastError 只会来自挂载失败）。
  const isWorkspace = server.scope === 'workspace';
  const mountFailed = isWorkspace && !!server.lastError;
  // 在项目 tab 里查看的全局 MCP：配置属于全局作用域，此处只读，仅能切换本项目可见性。
  const isForeign = server.foreign === 'global';
  const status = mountFailed ? 'failed' : isWorkspace ? 'idle' : server.status || server.phase || 'waiting';
  const statusCls = server.enabled ? (status === 'connected' ? 's-on' : status === 'failed' ? 's-err' : '') : 's-off';
  const statusText = !server.enabled
    ? '已禁用'
    : mountFailed
      ? '挂载失败'
      : isWorkspace
        ? '随会话挂载'
        : status === 'connected' ? '已连接' : status === 'failed' ? '连接失败' : status === 'unknown' ? '状态未知' : status === 'loading' || status === 'waiting' ? '连接中…' : '已停止';
  const mut = (v) => {
    const visible = displayValue(v);
    return typeof visible === 'string' && visible.length > 90 ? visible.slice(0, 88) + '…' : visible;
  };
  const RevealBtn = ({ field, keyName, label, fallback }) => {
    const state = revealed[revealId(field, keyName)];
    const shown = revealedValue(field, keyName) !== undefined ? revealedValue(field, keyName) : mut(fallback);
    const revealedNow = state?.value !== undefined;
    return h('span', { className: 'dsh-mcp-secret' },
      h('span', { className: 'dsh-mcp-secret-value', title: shown }, shown),
      revealedNow ? h('button', { type: 'button', className: 'dsh-mcp-secret-btn', title: '复制 ' + label, 'aria-label': '复制 ' + label, onClick: () => onCopy(shown) }, h(Icon, { d: ICONS.copy })) : null,
      h('button', { type: 'button', className: 'dsh-mcp-secret-btn', disabled: state?.pending, title: revealedNow ? '隐藏 ' + label : '显示 ' + label, 'aria-label': '显示/隐藏 ' + label, onClick: () => onReveal(server, field, keyName) }, state?.pending ? '…' : h(Icon, { d: ICONS[revealedNow ? 'eyeOff' : 'eye'] })),
    );
  };
  const RevealRow = ({ field, keyName, label }) =>
    h('div', { className: 'dsh-mcp-secret-row' },
      h('b', null, keyName),
      h(RevealBtn, { field, keyName, label, fallback: String(env[keyName] ?? headers[keyName] ?? '') }),
    );
  return h('div', { className: 'dsh-mcp-detail' },
    h('div', { className: 'dsh-mcp-d-head' },
      h('div', null,
        h('div', { className: 'dsh-mcp-d-name' }, server.serverName),
        h('div', { className: 'dsh-mcp-d-meta' },
          h(Dot, { phase: status }),
          h(Badge, { cls: statusCls + ' dot' }, statusText),
          h(Badge, { cls: server.transport === 'http' ? 't-http' : 't-stdio' }, server.transport === 'http' ? 'HTTP' : 'stdio'),
          h(Badge, { cls: isWorkspace ? 'scope-ws' : '' }, isWorkspace ? '项目配置' : '全局配置'),
          isWorkspace ? null : h(Badge, null, server.toolCount + ' 个工具'),
        ),
      ),
      h('div', { className: 'dsh-mcp-d-actions' },
        isForeign
          ? h(React2.Fragment, null,
              h('span', { className: 'dsh-mcp-d-scope-hint' }, excluded ? '已在此项目屏蔽' : '在此项目可见'),
              h(EyeToggle, { hidden: excluded, disabled: busy, label: server.serverName, onChange: (next) => onToggleExclude(server.serverName, next) }),
            )
          : h(React2.Fragment, null,
              h(Toggle, { on: server.enabled, disabled: busy || !server.managed, onChange: () => onToggle(server), title: server.managed ? (server.enabled ? '禁用' : '启用') : '来自其他配置层，只读' }),
              h(Btn, { icon: 'edit', onClick: () => onEdit(server), disabled: busy || !server.managed, children: '编辑' }),
              h(Btn, { icon: 'refresh', onClick: () => onReconnect(server), disabled: busy || !server.enabled || !server.managed || isWorkspace, title: isWorkspace ? '项目 MCP 随会话自动挂载，无需手动重连' : '重连', children: '重连' }),
              h(Btn, { cls: 'danger', icon: 'trash', onClick: () => onRemove(server), disabled: busy || !server.managed, children: '移除' }),
            ),
      ),
    ),
    isForeign ? h('div', { className: 'dsh-mcp-log warn' }, '此 MCP 由全局配置提供。要改它的连接配置，请切到「全局」标签页；在这里只能决定它对本项目是否可见。') : null,
    server.lastError ? h('div', { className: 'dsh-mcp-log', title: '来自 mcp-client 最近日志' }, server.lastError) : null,
    server.toolCountAmbiguous ? h('div', { className: 'dsh-mcp-log warn' }, '工具命名与其他 serverName 前缀重叠，无法可靠判断归属；请避免在 serverName 中使用双下划线。') : null,
    h('div', { className: 'dsh-mcp-card' },
      h('h4', null, '连接信息'),
      h('div', { className: 'dsh-mcp-kv' },
        h('b', null, '传输'), h('span', null, server.transport === 'http' ? 'Streamable HTTP' : 'stdio'),
        server.url ? h('b', null, 'URL') : null, server.url ? h(RevealBtn, { field: 'url', label: 'URL', fallback: server.url }) : null,
        server.command ? h('b', null, '命令') : null, server.command ? h('span', null, mut(server.command)) : null,
        server.args && server.args.length ? h('b', null, '参数') : null, server.args && server.args.length ? h(RevealBtn, { field: 'args', label: '参数', fallback: server.args.map(mut).join(' ') }) : null,
        server.cwd ? h('b', null, '工作目录') : null, server.cwd ? h('span', null, mut(server.cwd)) : null,
        h('b', null, '启用'), h('span', null, server.enabled ? '是' : '否（补丁中 disabled: true）'),
        h('b', null, '配置来源'), h('span', null, server.conflict ? '存在重复 serverName（冲突，只读）' : isForeign ? '全局配置（在「全局」标签页可编辑）' : isWorkspace ? '项目配置 .dsh/mcp.json（可编辑，随会话挂载）' : server.managed ? '当前 Web profile（可编辑）' : '其他 bundle / Agent（只读）'),
        server.toolCallTimeoutMs ? h('b', null, '调用超时') : null, server.toolCallTimeoutMs ? h('span', null, server.toolCallTimeoutMs + ' ms') : null,
        h('b', null, '启动失败策略'), h('span', null, server.failOnStartupError ? '阻止插件启动' : '记录错误并继续'),
        server.reconnect ? h('b', null, '自动重连') : null, server.reconnect ? h('span', null, server.reconnect.enabled === false ? '关闭' : `${server.reconnect.initialDelayMs || 500}–${server.reconnect.maxDelayMs || 30000} ms，最多 ${server.reconnect.maxAttempts || 10} 次`) : null,
        headerKeys.length ? h('b', null, 'Headers') : null, headerKeys.length ? h('div', { className: 'dsh-mcp-secret-list' }, headerKeys.map((k) => h(RevealRow, { key: k, field: 'headers', keyName: k, label: 'Header ' + k }))) : null,
        envKeys.length ? h('b', null, '环境变量') : null, envKeys.length ? h('div', { className: 'dsh-mcp-secret-list' }, envKeys.map((k) => h(RevealRow, { key: k, field: 'env', keyName: k, label: '环境变量 ' + k }))) : null,
      ),
    ),
    h('div', { className: 'dsh-mcp-card' },
      h('h4', null, '工具（' + tools.length + '）'),
      h('div', { className: 'dsh-mcp-tools' },
        tools.length === 0
          ? h('div', { className: 'dsh-mcp-empty-list' }, server.toolCountAmbiguous ? '工具归属存在命名歧义' : server.scope === 'workspace' ? '项目 MCP 工具在会话内注册，管理面板无法枚举；连接状态请见会话侧' : '暂无工具')
          : tools.map((t) => h(ToolRow, { key: t.name, tool: t })),
      ),
    ),
  );
};

const AddEditModal = ({ open, onClose, onSubmit, busy, initial, onRevealValue, revealEpoch, scopeName }) => {
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
  const [revealBusy, setRevealBusy] = useState('');
  const [editRevealed, setEditRevealed] = useState({});
  const editRevealGeneration = useRef(0);
  const editing = !!initial;
  const applyPreset = (id) => {
    const preset = MCP_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    setName(preset.serverName);
    setTransport(preset.transport);
    setUrl('');
    setCommand(preset.command || '');
    setArgs((preset.args || []).join('\n'));
    setCwd('');
    setHeaders([{ k: '', v: '' }]);
    setEnvs([{ k: '', v: '' }]);
    setError('');
  };
  useEffect(() => {
    clearRevealState(editRevealGeneration, setEditRevealed, setRevealBusy);
  }, [revealEpoch]);
  useEffect(() => {
    editRevealGeneration.current += 1;
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
    setRevealBusy('');
    setEditRevealed({});
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
  const editRevealId = (field, key) => (initial?.serverName || 'new') + ':' + field + (key !== undefined ? ':' + key : '');
  const formatRevealedValue = (value) => Array.isArray(value)
    ? value.join('\n')
    : value && typeof value === 'object'
      ? Object.entries(value).map(([key, item]) => `${key}=${typeof item === 'object' ? JSON.stringify(item) : String(item)}`).join('\n')
      : String(value ?? '');
  const visibleEditValue = (field, key, fallback) => Object.hasOwn(editRevealed, editRevealId(field, key)) ? editRevealed[editRevealId(field, key)] : fallback;
  const hideEditReveal = (field, key) => setEditRevealed((prev) => {
    const next = { ...prev };
    delete next[editRevealId(field, key)];
    return next;
  });
  const toggleEditReveal = async (field, key) => {
    if (!editing || !initial) return;
    const id = editRevealId(field, key);
    if (Object.hasOwn(editRevealed, id)) { hideEditReveal(field, key); return; }
    const generation = editRevealGeneration.current;
    setRevealBusy(id); setError('');
    try {
      const value = await onRevealValue(initial, field, key);
      if (generation !== editRevealGeneration.current) return;
      setEditRevealed((prev) => ({ ...prev, [id]: formatRevealedValue(value) }));
    } catch (e) {
      if (generation !== editRevealGeneration.current) return;
      setError(String(e?.message || e));
    } finally {
      if (generation === editRevealGeneration.current) setRevealBusy('');
    }
  };
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
  const revealIcon = (id, label, onClick) => {
    const shown = Object.hasOwn(editRevealed, id);
    return h('button', { type: 'button', className: 'dsh-mcp-btn dsh-mcp-inline-icon', disabled: revealBusy === id, title: (shown ? '隐藏原值：' : '显示原值：') + label, 'aria-label': (shown ? '隐藏原值：' : '显示原值：') + label, onClick }, revealBusy === id ? '…' : h(Icon, { d: ICONS[shown ? 'eyeOff' : 'eye'] }));
  };
  return h('div', { className: 'dsh-mcp-overlay', onClick: (e) => e.target === e.currentTarget && onClose() },
    h('div', { ref: dialogRef, className: 'dsh-mcp-modal', role: 'dialog', 'aria-modal': true, 'aria-label': editing ? '编辑 MCP' : '添加 MCP', tabIndex: -1, onKeyDown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } } },
      h('h3', null, (editing ? '编辑 MCP' : '添加 MCP') + (scopeName && scopeName !== '全局' ? '（' + scopeName + '）' : '')),
      !editing ? h('div', { className: 'dsh-mcp-field' },
        h('label', null, '从预设模板快速填充（可选，命令需本机 npx/uvx）'),
        h('select', { value: '', onChange: (e) => applyPreset(e.target.value), 'aria-label': '选择预设模板' },
          h('option', { value: '' }, '— 选择预设 —'),
          MCP_PRESETS.map((p) => h('option', { key: p.id, value: p.id }, p.label)),
        ),
      ) : null,
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
            h('div', { className: 'dsh-mcp-input-action' },
              h('input', { value: visibleEditValue('url', undefined, url), onChange: (e) => { hideEditReveal('url'); setUrl(e.target.value); }, placeholder: 'https://example.com/mcp' }),
              editing && url === PRESERVED_VALUE_LABEL ? revealIcon('url', 'URL', () => toggleEditReveal('url')) : null,
            ),
          )
        : h('div', null,
            h('div', { className: 'dsh-mcp-field' }, h('label', null, '命令'), h('input', { value: command, onChange: (e) => setCommand(e.target.value), placeholder: 'npx 或 C:\\path\\to\\bin.exe' })),
            h('div', { className: 'dsh-mcp-field' },
              h('label', null, '参数（每行一个，原样传给进程）'),
              h('div', { className: 'dsh-mcp-input-action' },
                h('textarea', { rows: 4, value: visibleEditValue('args', undefined, args), onChange: (e) => { hideEditReveal('args'); setArgs(e.target.value); }, placeholder: '-y\nmcp-server@latest' }),
                editing && args === PRESERVED_VALUE_LABEL ? revealIcon('args', '参数', () => toggleEditReveal('args')) : null,
              ),
            ),
            h('div', { className: 'dsh-mcp-field' }, h('label', null, '工作目录 cwd（可选）'), h('input', { value: cwd, onChange: (e) => setCwd(e.target.value), placeholder: 'C:\\path\\to\\workspace' })),
          ),
      h('div', { className: 'dsh-mcp-field' },
        h('label', null, transport === 'http' ? 'Headers（可选）' : '环境变量（可选，值写 !!js process.env.KEY 引用密钥）'),
        kvRows.map((row, i) => {
          const field = transport === 'http' ? 'headers' : 'env';
          const originalKey = row.originalKey || row.k;
          const id = editRevealId(field, originalKey);
          return h('div', { key: i, className: 'dsh-mcp-kv-edit' },
            h('input', { placeholder: transport === 'http' ? 'Authorization' : 'API_KEY', value: row.k, onChange: (e) => { hideEditReveal(field, originalKey); kv(kvRows, setKvRows, i, 'k', e.target.value); } }),
            h('input', { placeholder: transport === 'http' ? 'Bearer … 或 !!js process.env.KEY' : 'value', value: visibleEditValue(field, originalKey, row.v), onChange: (e) => { hideEditReveal(field, originalKey); kv(kvRows, setKvRows, i, 'v', e.target.value); } }),
            h('div', { className: 'dsh-mcp-kv-row-actions' },
              editing && row.v === PRESERVED_VALUE_LABEL ? revealIcon(id, row.k, () => toggleEditReveal(field, originalKey)) : null,
              h('button', { type: 'button', className: 'dsh-mcp-kv-del', onClick: () => delRow(kvRows, setKvRows, i), title: '删除此项', 'aria-label': '删除 ' + (row.k || '配置项') }, '✕'),
            ),
          );
        }),
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

function builtinConfigurationText(item) {
  const config = item?.configuration || {};
  if (config.url) {
    const headers = Object.entries(config.headers || {}).map(([key, value]) => `${key}: ${value}`);
    return [config.url, ...headers].join(' · ');
  }
  return [config.command, ...(config.args || [])].filter(Boolean).join(' ');
}

const BuiltinInstallModal = ({ open, onClose, call, busy, setBusy, onInstalled, scope, knownNames }) => {
  const isWorkspace = scope !== 'global' && scope !== undefined;
  const dialogRef = useRef(null);
  const loadGeneration = useRef(0);
  const knownNamesRef = useRef(knownNames);
  const [catalog, setCatalog] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { knownNamesRef.current = knownNames; }, [knownNames]);
  const loadCatalog = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true); setError('');
    try {
      const res = await call('builtins');
      if (!res?.ok) throw new Error(res?.error || '读取内置 MCP 失败');
      if (generation !== loadGeneration.current) return;
      // 项目作用域：已配置状态按当前项目的 serverName 判定（host 目录基于全局 effective）。
      const list = (res.builtins || []).map((item) => {
        if (!isWorkspace) return item;
        const configured = (knownNamesRef.current || []).some((s) => s.serverName === item.name);
        return configured ? { ...item, installed: true, installedAs: [item.name] } : item;
      });
      setCatalog(list);
    } catch (e) {
      if (generation === loadGeneration.current) setError(String(e?.message || e));
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [call, isWorkspace]);
  useEffect(() => {
    if (!open) { loadGeneration.current += 1; return; }
    setCatalog([]); setSelected([]); setError('');
    loadCatalog();
  }, [open, loadCatalog]);
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);
  if (!open) return null;

  const availableIds = catalog.filter((item) => !item.installed).map((item) => item.id);
  const allSelected = availableIds.length > 0 && availableIds.every((id) => selected.includes(id));
  const toggleSelected = (id, checked) => setSelected((current) => checked
    ? (current.includes(id) ? current : [...current, id])
    : current.filter((value) => value !== id));
  const install = async () => {
    if (!selected.length) return;
    setBusy(true); setError('');
    try {
      const res = isWorkspace
        ? await call('installWorkspaceBuiltins', { wsPath: scope, ids: selected })
        : await call('installBuiltins', { ids: selected });
      if (!res?.ok) throw new Error(res?.error || '安装内置 MCP 失败');
      onInstalled(res);
      onClose();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return h('div', { className: 'dsh-mcp-overlay', onClick: (e) => !busy && e.target === e.currentTarget && onClose() },
    h('div', { ref: dialogRef, className: 'dsh-mcp-modal dsh-mcp-builtin-modal', role: 'dialog', 'aria-modal': true, 'aria-label': '选择内置 MCP', tabIndex: -1, onKeyDown: (e) => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose(); } } },
      h('h3', null, '选择内置 MCP' + (isWorkspace ? '（项目）' : '')),
      h('div', { className: 'dsh-mcp-builtin-toolbar' },
        h('label', { className: 'dsh-mcp-check' },
          h('input', { type: 'checkbox', checked: allSelected, disabled: loading || !availableIds.length, onChange: (e) => setSelected(e.target.checked ? availableIds : []) }),
          '全选可安装',
        ),
        h('span', { className: 'dsh-mcp-builtin-count' }, `${catalog.length - availableIds.length} 已配置 · ${availableIds.length} 可安装`),
      ),
      loading ? h('div', { className: 'dsh-mcp-builtin-loading' }, '正在读取内置目录…') : null,
      !loading ? h('div', { className: 'dsh-mcp-builtin-list' },
        catalog.map((item) => h('label', { key: item.id, className: 'dsh-mcp-builtin-row' + (item.installed ? ' installed' : '') },
          h('input', {
            type: 'checkbox',
            className: 'dsh-mcp-builtin-select',
            checked: selected.includes(item.id),
            disabled: item.installed || busy,
            onChange: (e) => toggleSelected(item.id, e.target.checked),
            'aria-label': item.installed ? `${item.label} 已配置` : `选择 ${item.label}`,
          }),
          h('span', { className: 'dsh-mcp-builtin-main' },
            h('span', { className: 'dsh-mcp-builtin-name' }, item.label),
            h('span', { className: 'dsh-mcp-builtin-summary' }, item.summary),
            h('span', { className: 'dsh-mcp-builtin-meta' },
              h(Badge, { cls: item.transport === 'streamable-http' ? 't-http' : 't-stdio' }, item.transport === 'streamable-http' ? 'HTTP' : 'stdio'),
              h('span', { className: 'dsh-mcp-builtin-access' }, item.access),
            ),
            h('code', { className: 'dsh-mcp-builtin-config' }, builtinConfigurationText(item)),
          ),
          h('span', { className: 'dsh-mcp-builtin-status' + (item.installed ? ' ready' : '') }, item.installed
            ? '已配置' + (item.installedAs?.length ? `：${item.installedAs.join(', ')}` : '')
            : '可安装'),
        )),
      ) : null,
      error ? h('div', { className: 'dsh-mcp-d-err' }, error) : null,
      h('div', { className: 'dsh-mcp-modal-actions' },
        h(Btn, { onClick: onClose, disabled: busy, children: '取消' }),
        error && !catalog.length ? h(Btn, { onClick: loadCatalog, disabled: loading || busy, children: loading ? '重试中…' : '重试' }) : null,
        h(Btn, { cls: 'primary', onClick: install, disabled: busy || loading || !selected.length, children: busy ? '安装中…' : `安装选中（${selected.length}）` }),
      ),
    ),
  );
};

const JsonImportModal = ({ open, onClose, call, busy, setBusy, onImported, scope, scopeName }) => {
  const isWorkspace = scope !== 'global' && scope !== undefined;
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
      const res = isWorkspace
        ? await call('previewWorkspaceImport', { wsPath: scope, json: text, mode })
        : await call('previewImport', { json: text, mode });
      if (!res?.ok) throw new Error(res?.error || 'JSON 解析失败');
      setPreview(res);
    } catch (e) { setError(String(e?.message || e)); }
    finally { setBusy(false); }
  };
  const applyImport = async () => {
    if (!preview) return runPreview();
    if (preview.conflicts?.length) return setError('存在其他配置层的同名 MCP，不能覆盖：' + preview.conflicts.join(', '));
    if (mode === 'replace') {
      const message = isWorkspace
        ? '替换会删除该项目中未出现在 JSON 里的 MCP。确认继续？'
        : '替换会删除当前 Web profile 中未出现在 JSON 里的 MCP。确认继续？';
      if (!confirm(message)) return;
    }
    setBusy(true); setError('');
    try {
      const res = isWorkspace
        ? await call('importWorkspaceJson', { wsPath: scope, json: text, mode })
        : await call('importJson', { json: text, mode });
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
      h('h3', null, '导入 MCP JSON' + (isWorkspace && scopeName && scopeName !== '全局' ? '（' + scopeName + '）' : '')),
      h('div', { className: 'dsh-mcp-field' },
        h('label', null, '支持 Claude/Cursor/Cline/Roo 的 mcpServers、VS Code 的 servers，以及单个 MCP 对象'),
        h('textarea', { className: 'dsh-mcp-import-json', value: text, onChange: (e) => { setText(e.target.value); setPreview(null); }, placeholder: '{\n  "mcpServers": {\n    "example": { "command": "npx", "args": ["-y", "example-mcp"] }\n  }\n}' }),
      ),
      h('div', { className: 'dsh-mcp-radio-row' },
        h('label', { className: mode === 'merge' ? 'sel' : '' }, h('input', { type: 'radio', checked: mode === 'merge', onChange: () => { setMode('merge'); setPreview(null); } }), '合并（同名更新）'),
        h('label', { className: mode === 'replace' ? 'sel' : '' }, h('input', { type: 'radio', checked: mode === 'replace', onChange: () => { setMode('replace'); setPreview(null); } }), isWorkspace ? '替换该项目' : '替换当前 Profile'),
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

const POLL_INTERVAL_MS = 5000;

// 面板靠轮询反映 MCP 连接状态。标签页不可见时没人看这份数据，却照样每 5s 打两个 RPC，
// 因此隐藏期间跳过拉取，并在重新可见时立刻补一次，避免用户回来先看到一屏陈旧状态。
function startVisibilityAwarePolling(doc, timer, intervalMs, run) {
  const visible = () => !doc || doc.visibilityState !== 'hidden';
  const disposeInterval = timer.interval(() => { if (visible()) run(); }, intervalMs);
  if (!doc || typeof doc.addEventListener !== 'function') return disposeInterval;
  const onVisibilityChange = () => { if (visible()) run(); };
  doc.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    disposeInterval();
    doc.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

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
  const [builtinOpen, setBuiltinOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [toast, setToast] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [transportFilter, setTransportFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  // ---- workspace 项目层 ----
  const [scope, setScope] = useState('global');
  const [workspaces, setWorkspaces] = useState([]);
  const [globalServers, setGlobalServers] = useState([]);
  const [exclude, setExclude] = useState([]);
  const [mountErrors, setMountErrors] = useState([]);
  const [restrictError, setRestrictError] = useState(null);
  const [liveAgents, setLiveAgents] = useState(0);
  const [globalOpen, setGlobalOpen] = useState(false);
  const loadSeq = useRef(0);
  const manualRefreshSeq = useRef(0);
  const revisionRef = useRef('');
  const revealRevisionRef = useRef('');
  const [revealed, setRevealed] = useState({});
  const revealGeneration = useRef(0);
  const clearRevealed = useCallback(() => {
    clearRevealState(revealGeneration, setRevealed);
  }, []);

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

  const load = useCallback(async (notify = false) => {
    const seq = ++loadSeq.current;
    if (notify) { manualRefreshSeq.current = seq; setRefreshing(true); }
    try {
      const isWorkspace = scope !== 'global';
      const viewPromise = isWorkspace ? call('getWorkspaceView', { wsPath: scope }) : call('list');
      const [res, wsRes] = await Promise.all([viewPromise, call('listWorkspaces')]);
      if (seq !== loadSeq.current) return;
      if (wsRes && wsRes.ok) setWorkspaces(wsRes.workspaces || []);
      if (res && res.ok) {
        if (isWorkspace) {
          const next = res.servers || [];
          setGlobalServers(res.global || []);
          setExclude(res.exclude || []);
          setMountErrors(res.mountErrors || []);
          setRestrictError(res.restrictError || null);
          setLiveAgents(res.liveAgents || 0);
          setError(res.error || '');
          if (!Object.hasOwn(res, 'revision') || res.revision !== revisionRef.current) {
            revisionRef.current = res.revision || '';
            setServers(next);
          }
          if (notify) flash('已刷新项目 MCP，共 ' + next.length + ' 个');
        } else {
          const next = res.servers || [];
          if (consumeRevision(revealRevisionRef, res.revealRevision)) clearRevealed();
          const hasRevision = Object.hasOwn(res, 'revision');
          if (!hasRevision || res.revision !== revisionRef.current) {
            revisionRef.current = res.revision || '';
            setServers(next);
          }
          setError('');
          if (notify) flash('已刷新，共 ' + next.length + ' 个 MCP');
        }
      } else {
        const message = (res && res.error) || '加载失败';
        setError(message);
        if (notify) flash(message, 'err');
      }
    } catch (e) {
      if (seq !== loadSeq.current) return;
      const message = String((e && e.message) || e);
      setError(message);
      if (notify) flash(message, 'err');
    } finally {
      if (notify && manualRefreshSeq.current === seq) setRefreshing(false);
    }
  }, [call, clearRevealed, flash, scope]);

  useEffect(() => {
    load(false);
    return startVisibilityAwarePolling(typeof document === 'undefined' ? null : document, timer, POLL_INTERVAL_MS, () => load(false));
  }, [load, timer]);

  // 挂载失败按 serverName 索引：既标到列表行上，也注入详情的错误区，避免「顶部报错但那一行看着正常」。
  const mountErrorMap = useMemo(() => new Map((mountErrors || []).map((m) => [m.serverName, m.error])), [mountErrors]);

  // 选中项可能来自项目列表或（项目 tab 下的）全局列表；后者标记为 foreign，详情区据此只读。
  const selectedServer = useMemo(() => {
    const local = servers.find((s) => s.serverName === selected);
    if (local) {
      const failure = mountErrorMap.get(selected);
      return failure ? { ...local, lastError: failure } : local;
    }
    if (scope === 'global') return null;
    const global = globalServers.find((s) => s.serverName === selected);
    return global ? { ...global, managed: false, foreign: 'global' } : null;
  }, [servers, globalServers, selected, scope, mountErrorMap]);

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
  }, [selected, selectedServer?.toolRevision, call]);

  const act = useCallback(
    async (method, args, successMsg) => {
      setBusy(true);
      try {
        const res = await call(method, args);
        if (res && res.ok) {
          flash(successMsg || (res.note || method + ' 成功'));
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
    const next = !s.enabled;
    // 乐观更新：本地先翻转，操作完成后由 load 校准。
    revisionRef.current = '';
    setServers((prev) => prev.map((x) => (x.serverName === s.serverName ? { ...x, enabled: next } : x)));
    if (scope === 'global') {
      return act(next ? 'enable' : 'disable', s.serverName, (next ? '已启用 ' : '已禁用 ') + s.serverName);
    }
    // 项目层：写 disabled 字段到项目配置。
    const spec = { ...s, name: s.serverName, transport: s.transport === 'stdio' ? 'stdio' : 'streamable-http', disabled: !next };
    return act('updateWorkspaceServer', { wsPath: scope, spec }, (next ? '已启用 ' : '已禁用 ') + s.serverName);
  };
  const onReconnect = (s) => {
    if (s.scope === 'workspace') return;
    act('reconnect', s.serverName, '已请求重连 ' + s.serverName);
  };
  const onRemove = (s) => {
    const isWorkspace = s.scope === 'workspace';
    if (confirm('确认移除 MCP「' + s.serverName + '」？将从' + (isWorkspace ? '项目配置' : '当前 Web profile 配置') + '中删除。')) {
      clearRevealed();
      if (isWorkspace) act('removeWorkspaceServer', { wsPath: scope, name: s.serverName }, '已移除 ' + s.serverName);
      else act('removeServer', s.serverName, '已移除 ' + s.serverName);
    }
  };
  const onToggleExclude = (serverName, hidden) => {
    if (busy || scope === 'global') return;
    revisionRef.current = '';
    setGlobalServers((prev) => prev.map((s) => (s.serverName === serverName ? { ...s, excluded: hidden } : s)));
    setExclude((prev) => (hidden ? (prev.includes(serverName) ? prev : [...prev, serverName]) : prev.filter((name) => name !== serverName)));
    act('setWorkspaceExclude', { wsPath: scope, serverName, hidden }, hidden ? ('已在项目内屏蔽 ' + serverName) : ('已取消屏蔽 ' + serverName));
  };
  useEffect(() => { clearRevealed(); }, [selected, clearRevealed]);
  const revealValue = useCallback(async (server, field, key) => {
    if (!server.managed) throw new Error('该 MCP 来自其他配置层，配置只读，无法查看具体值');
    const res = server.scope === 'workspace'
      ? await call('revealWorkspaceServer', { wsPath: scope, name: server.serverName, field, key })
      : await call('reveal', { name: server.serverName, field, key });
    if (!res?.ok) throw new Error(res?.error || '读取配置失败');
    return res.value;
  }, [call, scope]);
  const onCopy = useCallback((text) => {
    copyText(text).then((ok) => flash(ok ? '已复制到剪贴板' : '复制失败', ok ? 'ok' : 'err'));
  }, [flash]);
  const onReveal = useCallback(async (server, field, key) => {
    const id = server.serverName + ':' + field + (key !== undefined ? ':' + key : '');
    if (revealed[id]?.value !== undefined) { setRevealed((prev) => ({ ...prev, [id]: false })); return; }
    if (revealed[id]?.pending) return;
    const generation = revealGeneration.current;
    setRevealed((prev) => ({ ...prev, [id]: { pending: true } }));
    try {
      const value = await revealValue(server, field, key);
      if (generation !== revealGeneration.current) return;
      setRevealed((prev) => ({ ...prev, [id]: { value, field, key } }));
    } catch (e) {
      if (generation !== revealGeneration.current) return;
      setRevealed((prev) => ({ ...prev, [id]: false }));
      flash(String(e?.message || e), 'err');
    }
  }, [flash, revealValue, revealed]);
  const onSubmit = async (spec, setFormError) => {
    setBusy(true);
    const isWorkspace = scope !== 'global';
    try {
      const res = isWorkspace
        ? (editTarget
            ? await call('updateWorkspaceServer', { wsPath: scope, spec })
            : await call('addWorkspaceServer', { wsPath: scope, spec }))
        : (editTarget ? await call('update', spec) : await call('add', spec));
      if (res && res.ok) {
        clearRevealed();
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
    clearRevealed();
    flash(res.note || '已导入 MCP JSON');
    timer.timeout(load, 1200);
  };
  const onBuiltinsInstalled = (res) => {
    clearRevealed();
    flash(res.note || '已安装所选内置 MCP');
    timer.timeout(load, 1200);
  };

  const filtered = useMemo(() => {
    const q = (query || '').toLowerCase();
    return servers.filter((s) => {
      if (transportFilter !== 'all' && s.transport !== transportFilter) return false;
      if (statusFilter !== 'all') {
        const status = s.status || s.phase || 'waiting';
        if (statusFilter === 'connected' && status !== 'connected') return false;
        if (statusFilter === 'failed' && status !== 'failed') return false;
        if (statusFilter === 'disabled' && s.enabled) return false;
      }
      if (!q) return true;
      return s.serverName.toLowerCase().includes(q) || (s.url || s.command || '').toLowerCase().includes(q);
    });
  }, [servers, query, transportFilter, statusFilter]);

  const visibleGlobalCount = useMemo(() => {
    const hidden = new Set(exclude || []);
    return globalServers.reduce((count, s) => (hidden.has(s.serverName) ? count : count + 1), 0);
  }, [globalServers, exclude]);

  const scopeTabs = useMemo(() => {
    const tabs = [{ key: 'global', label: '全局' }];
    for (const ws of workspaces) {
      tabs.push({ key: ws.path, label: ws.name, count: ws.serverCount, title: ws.path + (ws.error ? '（配置无效：' + ws.error + '）' : '') });
    }
    return tabs;
  }, [workspaces]);
  const scopeName = scope === 'global' ? '全局' : (workspaces.find((ws) => ws.path === scope)?.name || scope);
  const switchScope = useCallback((next) => {
    if (next === scope) return;
    setScope(next);
    setSelected('');
    setQuery('');
    // 状态过滤在两种作用域下语义不同（项目 MCP 无连接态），切换时归零避免「空列表且控件已隐藏」。
    setTransportFilter('all');
    setStatusFilter('all');
    setGlobalOpen(false);
    setAddOpen(false);
    setImportOpen(false);
    setBuiltinOpen(false);
    setEditTarget(null);
    setError('');
    revisionRef.current = '';
    clearRevealed();
  }, [scope, clearRevealed]);

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
        h(Btn, { icon: 'refresh', onClick: () => load(true), disabled: refreshing, children: refreshing ? '刷新中…' : '刷新' }),
        h(Btn, { onClick: () => setImportOpen(true), children: '导入 JSON（' + scopeName + '）' }),
        h(Btn, { icon: 'plug', onClick: () => setBuiltinOpen(true), children: '内置 MCP（' + scopeName + '）' }),
        h(Btn, { cls: 'primary', icon: 'plus', onClick: openAdd, children: scope === 'global' ? '添加 MCP' : '添加项目 MCP（' + scopeName + '）' }),
        onClose ? h(Btn, { icon: 'x', onClick: onClose, children: '关闭' }) : null,
      ),
    ),
    h(ScopeTabs, { tabs: scopeTabs, active: scope, onSelect: switchScope }),
    error ? h('div', { className: 'dsh-mcp-d-err' }, error) : null,
    scope !== 'global' && mountErrors.length ? h('div', { className: 'dsh-mcp-log' }, mountErrors.length + ' 个项目 MCP 未能挂载到会话：' + mountErrors.map((m) => m.serverName).join('、') + '。点开对应条目查看具体错误。') : null,
    scope !== 'global' && restrictError ? h('div', { className: 'dsh-mcp-log' }, '可见性未能应用到运行中的会话：' + restrictError.error) : null,
    scope === 'global'
      ? h(
          'div',
          { className: 'dsh-mcp-body' },
          h(ServerList, { servers: filtered, total: servers.length, selected, query, onQuery: setQuery, onSelect: setSelected, onToggle, busy, transportFilter, statusFilter, onTransportFilter: setTransportFilter, onStatusFilter: setStatusFilter }),
          h(ServerDetail, {
            server: selectedServer,
            tools,
            onToggle,
            onReconnect,
            onEdit: openEdit,
            onRemove,
            busy,
            onReveal,
            revealed,
            onCopy,
          }),
        )
      : h(
          'div',
          { className: 'dsh-mcp-body' },
          h('div', { className: 'dsh-mcp-ws-body', 'data-ws-path': scope },
            h('div', { className: 'dsh-mcp-section local' },
              h('div', { className: 'dsh-mcp-section-title' },
                '此项目的 MCP',
                h('span', { className: 'dsh-mcp-section-count' }, servers.length),
              ),
              h(ServerList, {
                servers: filtered,
                total: servers.length,
                selected,
                query,
                onQuery: setQuery,
                onSelect: setSelected,
                onToggle,
                busy,
                transportFilter,
                statusFilter,
                onTransportFilter: setTransportFilter,
                onStatusFilter: setStatusFilter,
                embedded: true,
                workspace: true,
                emptyHint: '此项目还没有 MCP。用右上角「添加项目 MCP」或「内置 MCP」写入 .dsh/mcp.json',
                mountErrors: mountErrorMap,
              }),
            ),
            h('div', { className: 'dsh-mcp-section global' + (globalOpen ? '' : ' collapsed') },
              // 全局可见性是低频操作，默认收成一行摘要，把高度让给本 tab 的主角——项目 MCP。
              h('button', {
                type: 'button',
                className: 'dsh-mcp-section-toggle',
                'aria-expanded': globalOpen,
                onClick: () => setGlobalOpen((value) => !value),
              },
                h('span', { className: 'dsh-mcp-caret', 'aria-hidden': true }, globalOpen ? '▾' : '▸'),
                h('span', { className: 'dsh-mcp-section-toggle-label' }, '全局 MCP'),
                h('span', { className: 'dsh-mcp-section-summary' },
                  globalServers.length === 0
                    ? '无'
                    : visibleGlobalCount + '/' + globalServers.length + ' 对本项目可见'
                      // 屏蔽只作用于运行中的会话；没有会话时切换不会有立竿见影的效果，先说清楚。
                      + (liveAgents ? '　·　' + liveAgents + ' 个会话运行中' : '　·　无运行中的会话')),
              ),
              globalOpen ? h(GlobalServerList, { servers: globalServers, exclude, onToggleExclude, onSelect: setSelected, selected, busy }) : null,
            ),
          ),
          h(ServerDetail, {
            server: selectedServer,
            tools,
            onToggle,
            onReconnect,
            onEdit: openEdit,
            onRemove,
            busy,
            onReveal,
            revealed,
            onCopy,
            excluded: exclude.includes(selected),
            onToggleExclude,
          }),
        ),
    h(BuiltinInstallModal, { open: builtinOpen, onClose: () => setBuiltinOpen(false), call, busy, setBusy, onInstalled: onBuiltinsInstalled, scope, knownNames: servers }),
    h(AddEditModal, { open: addOpen, onClose: () => { setAddOpen(false); setEditTarget(null); }, onSubmit, busy, initial: editTarget, onRevealValue: revealValue, revealEpoch: revealGeneration.current, scopeName }),
    h(JsonImportModal, { open: importOpen, onClose: () => setImportOpen(false), call, busy, setBusy, onImported, scope, scopeName }),
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
    { id: 'dsh-mcp-manager-ui#mcpManager/builtins', service: 'mcpManager', namespace: 'mcpManager', method: 'builtins', invocation: { kind: 'direct' }, parameters: [], result: mcpCodec('BuiltinCatalogResult') },
    { id: 'dsh-mcp-manager-ui#mcpManager/installBuiltins', service: 'mcpManager', namespace: 'mcpManager', method: 'installBuiltins', invocation: { kind: 'direct' }, parameters: [mcpParam('payload', 'BuiltinInstallPayload')], result: mcpCodec('BuiltinInstallResult') },
    { id: 'dsh-mcp-manager-ui#mcpManager/add', service: 'mcpManager', namespace: 'mcpManager', method: 'add', invocation: { kind: 'direct' }, parameters: [mcpParam('spec', 'Spec')], result: mcpCodec('NoteResult') },
    { id: 'dsh-mcp-manager-ui#mcpManager/update', service: 'mcpManager', namespace: 'mcpManager', method: 'update', invocation: { kind: 'direct' }, parameters: [mcpParam('spec', 'Spec')], result: mcpCodec('NoteResult') },
    { id: 'dsh-mcp-manager-ui#mcpManager/removeServer', service: 'mcpManager', namespace: 'mcpManager', method: 'removeServer', invocation: { kind: 'direct' }, parameters: [mcpParam('name', 'String')], result: mcpCodec('NoteResult') },
    { id: 'dsh-mcp-manager-ui#mcpManager/reveal', service: 'mcpManager', namespace: 'mcpManager', method: 'reveal', invocation: { kind: 'direct' }, parameters: [mcpParam('payload', 'ImportPayload')], result: mcpCodec('RevealResult') },
    { id: 'dsh-mcp-manager-ui#mcpManager/previewImport', service: 'mcpManager', namespace: 'mcpManager', method: 'previewImport', invocation: { kind: 'direct' }, parameters: [mcpParam('payload', 'ImportPayload')], result: mcpCodec('ImportPreview') },
    { id: 'dsh-mcp-manager-ui#mcpManager/importJson', service: 'mcpManager', namespace: 'mcpManager', method: 'importJson', invocation: { kind: 'direct' }, parameters: [mcpParam('payload', 'ImportPayload')], result: mcpCodec('ImportResult') },
    { id: 'dsh-mcp-manager-ui#mcpManager/listWorkspaces', service: 'mcpManager', namespace: 'mcpManager', method: 'listWorkspaces', invocation: { kind: 'direct' }, parameters: [], result: mcpCodec('WorkspaceListResult') },
    { id: 'dsh-mcp-manager-ui#mcpManager/getWorkspaceView', service: 'mcpManager', namespace: 'mcpManager', method: 'getWorkspaceView', invocation: { kind: 'direct' }, parameters: [mcpParam('payload', 'ImportPayload')], result: mcpCodec('WorkspaceViewResult') },
    { id: 'dsh-mcp-manager-ui#mcpManager/addWorkspaceServer', service: 'mcpManager', namespace: 'mcpManager', method: 'addWorkspaceServer', invocation: { kind: 'direct' }, parameters: [mcpParam('payload', 'ImportPayload')], result: mcpCodec('NoteResult') },
    { id: 'dsh-mcp-manager-ui#mcpManager/updateWorkspaceServer', service: 'mcpManager', namespace: 'mcpManager', method: 'updateWorkspaceServer', invocation: { kind: 'direct' }, parameters: [mcpParam('payload', 'ImportPayload')], result: mcpCodec('NoteResult') },
    { id: 'dsh-mcp-manager-ui#mcpManager/removeWorkspaceServer', service: 'mcpManager', namespace: 'mcpManager', method: 'removeWorkspaceServer', invocation: { kind: 'direct' }, parameters: [mcpParam('payload', 'ImportPayload')], result: mcpCodec('NoteResult') },
    { id: 'dsh-mcp-manager-ui#mcpManager/setWorkspaceExclude', service: 'mcpManager', namespace: 'mcpManager', method: 'setWorkspaceExclude', invocation: { kind: 'direct' }, parameters: [mcpParam('payload', 'ImportPayload')], result: mcpCodec('NoteResult') },
    { id: 'dsh-mcp-manager-ui#mcpManager/installWorkspaceBuiltins', service: 'mcpManager', namespace: 'mcpManager', method: 'installWorkspaceBuiltins', invocation: { kind: 'direct' }, parameters: [mcpParam('payload', 'BuiltinInstallPayload')], result: mcpCodec('BuiltinInstallResult') },
    { id: 'dsh-mcp-manager-ui#mcpManager/previewWorkspaceImport', service: 'mcpManager', namespace: 'mcpManager', method: 'previewWorkspaceImport', invocation: { kind: 'direct' }, parameters: [mcpParam('payload', 'ImportPayload')], result: mcpCodec('ImportPreview') },
    { id: 'dsh-mcp-manager-ui#mcpManager/importWorkspaceJson', service: 'mcpManager', namespace: 'mcpManager', method: 'importWorkspaceJson', invocation: { kind: 'direct' }, parameters: [mcpParam('payload', 'ImportPayload')], result: mcpCodec('ImportResult') },
    { id: 'dsh-mcp-manager-ui#mcpManager/revealWorkspaceServer', service: 'mcpManager', namespace: 'mcpManager', method: 'revealWorkspaceServer', invocation: { kind: 'direct' }, parameters: [mcpParam('payload', 'ImportPayload')], result: mcpCodec('RevealResult') }
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
