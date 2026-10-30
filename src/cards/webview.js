'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {resolveCard}=require('./index');
function escape(value){return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
let runtime;
function bundle() {
 if(runtime)return runtime;
 // This static list is packaged first-party extension source, never an API selector/path.
 const names=['math','foundations','training','advanced','index','runtime'];
 const modules=names.map(name=>`${JSON.stringify('./'+name)}:function(module,exports,require){\n${fs.readFileSync(path.join(__dirname,name+'.js'),'utf8')}\n}`).join(',\n');
 runtime=`(()=>{'use strict';const modules={${modules}};const cache={};function require(id){if(!Object.prototype.hasOwnProperty.call(modules,id))throw new Error('Unknown local module');if(!cache[id]){const module={exports:{}};cache[id]=module;modules[id](module,module.exports,require);}return cache[id].exports;}require('./runtime').mount(document,require('./index'));})();`;
 return runtime;
}
function buildCardHtml(problem) {
 const card=resolveCard(problem); const nonce=crypto.randomBytes(24).toString('base64');
 const policy=`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'none'; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none';`;
 const css=`body{font:14px var(--vscode-font-family,system-ui);color:var(--vscode-foreground,#ddd);background:var(--vscode-editor-background,#202020);padding:20px;max-width:1050px;margin:auto}h1{font-size:23px}h2{font-size:17px}.notice,.meta{color:var(--vscode-descriptionForeground,#aaa)}.notice{border-left:3px solid var(--vscode-focusBorder,#58a6ff);padding:10px}form{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}label{display:flex;flex-direction:column;gap:6px}input,select,button{font:inherit;padding:8px;border:1px solid var(--vscode-input-border,#777);border-radius:4px;color:var(--vscode-input-foreground,#eee);background:var(--vscode-input-background,#333)}input:focus,select:focus,button:focus{outline:2px solid var(--vscode-focusBorder,#58a6ff);outline-offset:2px}.buttons{grid-column:1/-1;display:flex;gap:10px}button{cursor:pointer;background:var(--vscode-button-background,#285f95);color:var(--vscode-button-foreground,#fff)}.error{color:var(--vscode-errorForeground,#ff8c8c)}.table-wrap{overflow:auto;margin:20px 0}table{border-collapse:collapse;min-width:60%}caption{text-align:left;font-weight:bold;padding:8px 0}th,td{border:1px solid var(--vscode-panel-border,#555);padding:7px;text-align:right}th{font-weight:600}dl{display:flex;gap:10px;flex-wrap:wrap}dt{font-weight:bold}dd{margin:0 20px 0 0}svg{width:100%;max-height:220px;color:var(--vscode-charts-blue,#58a6ff)}@media(prefers-reduced-motion:reduce){*{animation:none!important}}`;
 return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escape(policy)}"><title>${escape(card?card.title:'Exploration unavailable')}</title><style nonce="${nonce}">${css}</style></head><body><main id="exploration" data-card="${escape(card?card.id:'')}">${card?'':'<h1>Exploration unavailable</h1><p>No independent local exploration is implemented for this problem. This is not a completed interactive card.</p>'}</main>${card?`<script nonce="${nonce}">${bundle()}</script>`:''}</body></html>`;
}
module.exports={buildCardHtml,bundle};
