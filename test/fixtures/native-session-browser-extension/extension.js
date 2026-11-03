'use strict';
const vscode=require('vscode');
// Reuses our previously approved prototype ID in an entirely new mock profile.
exports.activate=context=>{
 const api={secrets:context.secrets,directory:context.globalStorageUri.fsPath};
 if(process.env.TT_SESSION_BROWSER_MOCK==='phase1'||process.env.TT_SESSION_BROWSER_MOCK==='phase2')setImmediate(async()=>{
  try{await require('../../vscode-session-browser-mock').run({vscode});}
  finally{await vscode.commands.executeCommand('workbench.action.closeWindow');}
 });return api;
};
