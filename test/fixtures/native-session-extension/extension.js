'use strict';
// Isolated synthetic test host only; never installed into the normal profile.
exports.activate=context=>{
  const api={secrets:context.secrets,directory:context.globalStorageUri.fsPath};
  // VS Code forces storage into memory with --extensionTestsPath. A normal
  // owned development host is needed to test persistence across two launches.
  if(process.env.TT_SESSION_NATIVE_AUTO==='1')setImmediate(async()=>{
    try{await require('../../vscode-session-mock').run();}
    finally{await require('vscode').commands.executeCommand('workbench.action.closeWindow');}
  });
  return api;
};
