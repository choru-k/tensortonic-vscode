'use strict';
// Copied into a disposable staged manifest only. Never part of the review VSIX.
const vscode=require('vscode');
if(!process.env.TT_INTEGRATED_SYNTHETIC_RUNNER)throw Error('External synthetic runner required');
module.exports=require(process.env.TT_INTEGRATED_SYNTHETIC_RUNNER).makeEntry(vscode,__dirname);
