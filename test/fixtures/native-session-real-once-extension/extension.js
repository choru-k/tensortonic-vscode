'use strict';
const vscode=require('vscode');
exports.activate=context=>{
 const api={secrets:context.secrets,directory:context.globalStorageUri.fsPath};
 if(process.env.TT_REAL_SESSION_ONCE==='approved-read-and-clean')setImmediate(async()=>{
  try{await require('../../vscode-session-real-once').run({vscode});}
  finally{await vscode.commands.executeCommand('workbench.action.closeWindow');}
 });return api;
};
