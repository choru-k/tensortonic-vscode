'use strict';
// Actual VS Code API + packaged extension + real loopback HTTP. Browser globals
// and upstream TensorTonic responses are simulated. NEVER contacts a live API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const OUT = path.resolve(__dirname, '../dist/vscode-mock-integration.json');
exports.run = async function run() {
  const vscode = require('vscode');
  const report = { startedAt: new Date().toISOString(), vscode: vscode.version,
    success: false, actualExtensionHost: true, actualLoopbackHttp: true,
    simulatedBrowser: true, mockedUpstream: true, liveRequests: 0, checks: [] };
  let api, companion;
  const requests = [];
  const ref = {slug:'vm-only-double',apiId:'vm-only-double',planId:'pytorch-basics',technology:'Python'};
  const secondRef = {...ref, slug:'vm-only-other', apiId:'vm-only-other'};
  let releaseSubmit;
  let holdSubmit = false;
  const raw = {id:'vm-only-double',title:'VM fixture: double',description:'Return $2x$.\n\n<script>alert("inert")</script>',starterCode:'def double(x):\n    pass\n',testCases:[{id:'public-1',inputs:{x:2},isPublic:true},{id:'hidden',inputs:{x:'PRIVATE_SENTINEL'},isPublic:false}],solution:'ANSWER_SENTINEL'};
  const wait = async predicate => { const deadline=Date.now()+10000; while(!predicate()){ assert.ok(Date.now()<deadline,'bounded readiness wait'); await new Promise(r=>setTimeout(r,20)); } };
  const replace = async (doc,content) => { const edit=new vscode.WorkspaceEdit();edit.replace(doc.uri,new vscode.Range(new vscode.Position(0,0),doc.positionAt(doc.getText().length)),content);assert.equal(await vscode.workspace.applyEdit(edit),true); };
  const ok = label => { report.checks.push(label); fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(report,null,2)); };
  try {
    const extension=vscode.extensions.getExtension('choru-local.tensortonic-vscode');
    assert.ok(extension,'installed extension discovered');
    report.extensionPath=extension.extensionPath;
    report.extensionVersion=extension.packageJSON.version;
    api=await extension.activate();
    assert.equal((await api.smokeTest()).connected,false);
    const commands=await vscode.commands.getCommands(true);
    for(const id of api.commands) assert.ok(commands.includes(id),id);
    ok('Extension activates; all 15 commands register; initially disconnected');
    await api.bridge.start();
    const origin='https://www.tensortonic.com';
    const sandbox={location:{origin,href:origin+'/'},URL,AbortController,AbortSignal,console:{info(){},warn(){},error(){}},
      fetch:async(url,options={})=>{
        const target=new URL(url);
        if(target.origin==='https://api.tensortonic.com'){
          const request={method:options.method||'GET',path:target.pathname,body:options.body?JSON.parse(options.body):undefined}; requests.push(request);
          assert.equal(options.credentials,'include');assert.equal(options.redirect,'error');
          let data;
          if(request.path==='/api/problems/list') data={problems:[{id:ref.apiId,sourceId:ref.apiId,slug:ref.slug,planId:ref.planId,title:raw.title,source:'python',category:'Python',solved:false}],pagination:{hasMore:false}};
          else if(request.path===`/api/study-plans/${ref.planId}/problems/${ref.apiId}`) data=raw;
          else if(request.path===`/api/study-plans/${secondRef.planId}/problems/${secondRef.apiId}`) data={...raw,title:'Other VM problem',id:secondRef.apiId};
          else if(request.path.endsWith('/run')||request.path.endsWith('/submit')) {
            if (holdSubmit && request.path.endsWith('/submit')) await new Promise(resolve => { releaseSubmit=resolve; });
            data={status:'passed',passed:1,total:1,mocked:true};
          }
          else throw new Error('Unexpected upstream path (blocked): '+request.path);
          return {ok:true,status:200,json:async()=>request.method==='POST'?data:({status:'success',data})};
        }
        if(target.origin!==`http://127.0.0.1:${api.bridge.port}`)throw new Error('External network blocked');
        return fetch(url,{...options,headers:{...options.headers,Origin:origin}});
      }};
    sandbox.window=sandbox;
    sandbox.top=sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(extension.extensionPath,'src/browser-connector.js'),'utf8'),sandbox);
    for(const name of ['shared.js','companion.js']) vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../browser-companion',name),'utf8'),sandbox);
    companion=sandbox.__tensorTonicCompanion;
    const paired=await companion.connect(api.bridge.pairingCode());
    assert.ok(['connecting','connected'].includes(paired.phase));
    await wait(()=>api.bridge.connected);
    const access=await api.smokeTest();assert.equal(access.problemCount,1);assert.equal(access.problem.testCaseCount,1);
    ok('Companion redeems one-use ticket over actual HTTP; original connector lists fake Python problem');
    const opened=await api.openProblem(ref);assert.ok(opened.uri&&opened.testsUri&&opened.contextUri);
    const solution=await vscode.workspace.openTextDocument(opened.uri), cases=await vscode.workspace.openTextDocument(opened.testsUri), context=await vscode.workspace.openTextDocument(opened.contextUri);
    const originalCode=solution.getText(), originalTests=cases.getText(), originalContext=context.getText();
    assert.match(originalCode,/tensortonic:/);assert.equal(JSON.parse(originalTests).length,1);assert.ok(!originalContext.includes('PRIVATE_SENTINEL'));assert.ok(!originalContext.includes('ANSWER_SENTINEL'));
    ok('Real workspace creates solution, public tests and safe agent context; hidden/reference data omitted');
    const lenses=await vscode.commands.executeCommand('vscode.executeCodeLensProvider',opened.uri);
    assert.ok(lenses&&lenses.some(x=>x.command&&x.command.command==='tensortonic.run'));
    assert.ok(lenses.some(x=>x.command&&x.command.command==='tensortonic.discussWithAgent'));
    ok('Real Python document receives Run/Submit/Description/Test cases/Agent CodeLens');
    const edited=originalCode+'\n# UNSAVED_VM_SENTINEL\n';await replace(solution,edited);
    const customCases=[{id:'custom-vm',inputs:{x:7},expected:14}];await replace(cases,JSON.stringify(customCases));
    assert.equal(solution.isDirty,true);assert.equal(cases.isDirty,true);
    const ran=await vscode.commands.executeCommand('tensortonic.run',opened.uri);assert.equal(ran.mocked,true);
    const request=requests.find(x=>x.path.endsWith('/run'));assert.equal(request.body.code,edited);assert.deepEqual(request.body.testCases,[{id:'custom-vm',inputs:{x:7}}]);
    ok('Actual Run command reads unsaved solution/tests; simulated grading returns result');
    const submitted=await vscode.commands.executeCommand('tensortonic.submit',opened.uri);assert.equal(submitted.mocked,true);
    assert.equal(requests.filter(x=>x.path.endsWith('/submit')).length,1);
    assert.equal(requests.find(x=>x.path.endsWith('/submit')).body.code,edited);
    ok('Actual Submit command sends exactly once to fake upstream and receives simulated result');
    holdSubmit=true;
    const firstSubmit=vscode.commands.executeCommand('tensortonic.submit',opened.uri);
    await wait(()=>typeof releaseSubmit==='function');
    const pendingGetCount=requests.filter(x=>x.method==='GET').length;
    assert.equal(await vscode.commands.executeCommand('tensortonic.submit',opened.uri),undefined);
    assert.equal(await vscode.commands.executeCommand('tensortonic.run',opened.uri),undefined);
    assert.equal(requests.filter(x=>x.method==='GET').length,pendingGetCount);
    assert.equal(requests.filter(x=>x.path.endsWith('/submit')).length,2);
    holdSubmit=false;releaseSubmit();assert.equal((await firstSubmit).mocked,true);
    ok('Rapid duplicate Submit/Run commands cannot queue a second grading request');
    const count=requests.filter(x=>x.method==='POST').length;await replace(cases,'invalid-json');
    assert.equal(await vscode.commands.executeCommand('tensortonic.run',opened.uri),undefined);
    assert.equal(requests.filter(x=>x.method==='POST').length,count);await replace(cases,JSON.stringify(customCases));
    ok('Invalid unsaved test JSON is rejected without a grading request');
    await api.openProblem(ref);assert.equal(solution.getText(),edited);assert.equal(cases.getText(),JSON.stringify(customCases));
    ok('Reopening preserves unsaved code and edited test cases');
    const secondOpened=await api.openProblem(secondRef);
    await vscode.window.showTextDocument(solution,{viewColumn:vscode.ViewColumn.One});
    const firstContextBeforeDescription=context.getText();
    await vscode.commands.executeCommand('tensortonic.description',secondOpened.uri);
    assert.equal(context.getText(),firstContextBeforeDescription);
    assert.ok((await vscode.workspace.openTextDocument(secondOpened.contextUri)).getText().includes('Other VM problem'));
    ok('Explicit Description keeps another selected solution context unchanged');
    if(commands.includes('workbench.action.chat.open')) await vscode.commands.executeCommand('workbench.action.chat.open');
    if(vscode.lm&&typeof vscode.lm.invokeTool==='function'){
      const result=await vscode.lm.invokeTool('tensortonic_current_problem',{input:{},toolInvocationToken:undefined});
      const value=result.content.map(x=>typeof x.value==='string'?x.value:'').join('\n');assert.ok(value.includes('UNSAVED_VM_SENTINEL'));assert.ok(!value.includes('PRIVATE_SENTINEL'));assert.ok(!value.includes('Other VM problem'));ok('Real language-model tool follows A → B → A → chat selection and unsaved code');
    }
    await replace(context,originalContext+'\nPERSONAL_NOTE_SENTINEL\n');
    await assert.rejects(api.currentContext(opened.uri),/edited/);assert.ok(context.getText().includes('PERSONAL_NOTE_SENTINEL'));await replace(context,originalContext);
    ok('Dirty personal notes in generated context are protected against overwrite');
    if(commands.includes('workbench.action.chat.open')){
      const discussion=await api.discussWithAgent(opened.uri);assert.equal(discussion.attachedFiles.length,3);
      ok('Built-in Agent composer command accepts three real file attachments; no message sent');
      // Optional short visual-inspection window; never sends the draft query.
      if(process.env.TENSORTONIC_UI_HOLD==='1') await new Promise(resolve=>setTimeout(resolve,30000));
    }else report.agentComposer='unavailable';
    await replace(solution,originalCode);await replace(cases,originalTests);await replace(context,originalContext);
    await companion.disconnect();
    await vscode.commands.executeCommand('tensortonic.disconnect');
    assert.equal(api.bridge.connected,false);assert.equal(api.bridge.token,undefined);
    ok('Actual Disconnect command closes bridge and invalidates capability');
    report.agentReplyVerified=false;report.success=true;
  }catch(error){report.error=error.stack||String(error);throw error;}
  finally{if(companion)await companion.disconnect();if(api)await api.bridge.stop();report.finishedAt=new Date().toISOString();report.requestCounts={get:requests.filter(x=>x.method==='GET').length,post:requests.filter(x=>x.method==='POST').length};fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(report,null,2));}
};
