'use strict';
// Independently authored, bounded numerical helpers for local learning widgets.
const LIMIT = 64;
function number(value, name = 'Value', min = -10000, max = 10000) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') throw new Error(`${name} must be a number.`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} must be finite and between ${min} and ${max}.`);
  return n;
}
function integer(value, name = 'Value', min = 1, max = LIMIT) { const n = number(value,name,min,max); if (!Number.isInteger(n)) throw new Error(`${name} must be an integer.`); return n; }
function vector(value, name = 'Vector', maxLength = LIMIT) {
  const s = typeof value === 'string' ? value.trim().replace(/^\[/,'').replace(/\]$/,'') : value;
  if (typeof s === 'string' && s.length > 4096) throw new Error(`${name} is too long.`);
  const a = Array.isArray(s) ? s : typeof s === 'string' && s ? s.split(/[\s,]+/) : [];
  if (!a.length || a.length > maxLength) throw new Error(`${name} needs 1–${maxLength} numbers.`);
  return a.map(x => number(x,name));
}
function matrix(value, name = 'Matrix', maxSize = 8) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error(`${name} needs semicolon-separated rows.`);
  const rows = value.split(';').map(r => vector(r,name,maxSize));
  if (!rows.length || rows.length > maxSize || rows.some(r => r.length !== rows[0].length)) throw new Error(`${name} must be rectangular, at most ${maxSize} × ${maxSize}.`);
  return rows;
}
function softmax(a) { const max = Math.max(...a); const e = a.map(x => Math.exp(x-max)); const sum = e.reduce((s,x)=>s+x,0); return e.map(x=>x/sum); }
function mean(a) { return a.reduce((s,x)=>s+x,0)/a.length; }
function dot(a,b) { if(a.length!==b.length) throw new Error('Vector lengths must match.'); return a.reduce((s,x,i)=>s+x*b[i],0); }
function random(seed) { let state=integer(seed,'Seed',0,2147483647); return () => { state=(Math.imul(1664525,state)+1013904223)>>>0; return state/4294967296; }; }
const field = (key,label,value,extra={}) => ({key,label,value:String(value),type:'text',...extra});
const table = (title,columns,rows) => ({title,columns,rows});
module.exports={LIMIT,number,integer,vector,matrix,softmax,mean,dot,random,field,table};
