'use strict';
const crypto=require('node:crypto');
const {BrowserSessionAcquirer}=require('./acquisition');
const {ProposedBrowserCookieSource}=require('./browser-cookie-source');

// Scope is fixed by the production factory. Every new import still requires
// this explicit local consent, even when a browser login already exists.
function createConfirmedBrowserAcquirer(vscode,{plan,source,gradingAvailable=false}={}){
  return new BrowserSessionAcquirer({
    plan,source:source||new ProposedBrowserCookieSource(vscode,{plan}),
    confirm:async(details,{signal})=>{
      if(signal.aborted)return false;
      const retention=details.retention==='server'?'Keep the session across restarts only until the server cookie expires or access is revoked. A verified server Set-Cookie may renew its own expiry; the extension never invents a longer lifetime. Session-only cookies with no explicit expiry are not retained. There is no forced daily or guaranteed monthly reconnect.':'Keep the session across restarts for at most '+(details.maxLocalAgeMs%3600000===0?details.maxLocalAgeMs/3600000+' hours':Math.floor(details.maxLocalAgeMs/60000)+' minutes')+', or until earlier website expiry/revocation.';
      const scope='Domain: '+details.domains.join(', ')+(details.attributes?.path?' · Path: '+details.attributes.path:'')+(details.requireSecure?' · Secure':'')+(details.requireHttpOnly?' · HttpOnly':'')+(details.attributes?.sameSite?' · SameSite='+details.attributes.sameSite:'');
      const detail=details.sources.map(source=>source.names.join(', ')+' at '+source.url).join('\n')+'\n'+scope+'\n\nThe browser protocol returns all cookies applicable to each exact URL into memory before local name filtering. Only the selected session names are persisted in encrypted SecretStorage; other names are immediately discarded and never logged. No other sites are queried. '+retention+' A leaked session could grant account access. Never copy Google/GitHub sessions or another browser profile. The owned page closes after capture; reading problems then works with all browser tabs closed. Clear saved session deletes local access without logging out other devices. '+(gradingAvailable?'Explicit Run and Submit can send your selected Python solution and test cases through this saved session. No action is sent automatically and uncertain actions are never replayed.':'Run and Submit are unavailable for this read-only transport.');
      const choice=await vscode.window.showInformationMessage('Save the reviewed website session?',{modal:true,detail},'Save approved session');
      return !signal.aborted&&choice==='Save approved session';
    },
    // An action notification can pause Integrated Browser. A temporary status
    // action leaves the owned page usable during normal human login/2FA.
    waitForLogin:(handle,{signal})=>new Promise(resolve=>{
      const id='tensortonic.captureApprovedSession.'+crypto.randomUUID(),cancelId=id+'.cancel';const item=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right),cancelItem=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
      const commands=[];let done=false,closed;const finish=value=>{if(done)return;done=true;signal.removeEventListener('abort',abort);item.dispose();cancelItem.dispose();closed?.dispose();for(const command of commands)command.dispose();resolve(value);};const abort=()=>finish(false);
      try{commands.push(vscode.commands.registerCommand(id,()=>finish(true)));commands.push(vscode.commands.registerCommand(cancelId,()=>finish(false)));}catch{finish(false);return;}
      item.text='$(key) Capture session';item.tooltip='Finish normal login and return to TensorTonic, then capture only the approved session.';item.command=id;cancelItem.text='$(close) Cancel sign-in';cancelItem.tooltip='Close only this login page without saving a new session.';cancelItem.command=cancelId;
      closed=handle.onDidClose?.(()=>finish(false));if(done){closed?.dispose();return;}signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();else{item.show();cancelItem.show();}
    }),
  });
}
module.exports={createConfirmedBrowserAcquirer};
