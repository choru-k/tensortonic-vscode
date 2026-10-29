'use strict';

// Run this in the user's real VS Code Extension Development Host. This is a
// live account test: it submits an already-solved Softmax exercise once.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

exports.run = async function run() {
  const vscode = require('vscode');
  const root = path.resolve(__dirname, '..');
  const evidence = path.join(root, 'dist');
  await fs.mkdir(evidence, { recursive: true });
  const report = { startedAt: new Date().toISOString(), success: false, steps: [] };
  let api;
  let originalCode;
  let originalCases;
  let opened;
  const replace = async (document, content) => {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(new vscode.Position(0, 0), document.positionAt(document.getText().length)), content);
    assert.equal(await vscode.workspace.applyEdit(edit), true);
  };
  try {
    const extension = vscode.extensions.getExtension('choru-local.tensortonic-vscode');
    assert.ok(extension, 'Extension must be installed/discovered');
    api = await extension.activate();
    report.steps.push('Activated real VS Code extension');
    await api.bridge.start();
    const connectionPath = path.join(evidence, 'e2e-connection.js');
    await fs.writeFile(connectionPath, '// Temporary local pairing key. Do not commit or share.\n' + api.bridge.connectionCode(), { mode: 0o600 });
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(connectionPath)), { preview: false });
    void vscode.window.showInformationMessage('Live TensorTonic E2E: run the displayed connection code in your signed-in TensorTonic browser tab. This test re-submits the previously solved Softmax exercise.');
    const deadline = Date.now() + 300000;
    while (!api.bridge.connected && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(api.bridge.connected, true, 'Connect the signed-in browser before the five-minute deadline');
    report.steps.push('Paired actual browser and extension loopback connection');
    const access = await api.smokeTest({ ref: { slug: 'pytorch-softmax-from-scratch', planId: 'pytorch-basics' } });
    assert.ok(access.problemCount > 0); assert.equal(access.problem.hasStarterCode, true);
    const catalogue = await api.client.listProblems('pytorch-basics');
    assert.equal(catalogue.some(problem => problem.slug === 'pytorch-softmax-from-scratch' && problem.solved), true,
      'This live test only re-submits an exercise already solved by the signed-in account');
    report.access = access;
    opened = await api.openProblem({ slug: 'pytorch-softmax-from-scratch', planId: 'pytorch-basics', technology: 'pytorch' });
    assert.ok(opened && opened.contextUri);
    report.steps.push('Opened real problem, statement preview, solution and editable public tests');
    const solution = await vscode.workspace.openTextDocument(opened.uri);
    const cases = await vscode.workspace.openTextDocument(opened.testsUri);
    originalCode = solution.getText(); originalCases = cases.getText();
    const metadata = originalCode.split('\n').slice(0, 2).join('\n');
    const testCode = metadata + '\n\nimport torch\n\ndef softmax(logits: torch.Tensor) -> torch.Tensor:\n    m = logits.max(dim=1, keepdim=True).values\n    e = torch.exp(logits - m)\n    return e / e.sum(dim=1, keepdim=True)\n';
    await replace(solution, testCode);
    await replace(cases, JSON.stringify(opened.problem.testCases, null, 2));
    const runResult = await vscode.commands.executeCommand('tensortonic.run', opened.uri);
    assert.equal(runResult && runResult.status, 'passed', 'Actual Run must pass');
    assert.equal(runResult.passed, runResult.total);
    report.run = { status: runResult.status, passed: runResult.passed, total: runResult.total };
    report.steps.push('Run command submitted current unsaved editor code and displayed passing results');
    const submitResult = await vscode.commands.executeCommand('tensortonic.submit', opened.uri);
    assert.equal(submitResult && submitResult.status, 'passed', 'Actual Submit must pass');
    assert.equal(submitResult.passed, submitResult.total);
    report.submit = { status: submitResult.status, passed: submitResult.passed, total: submitResult.total };
    report.steps.push('Submit command received passing server grading and displayed results');
    const toolResult = await vscode.lm.invokeTool('tensortonic_current_problem', { input: {}, toolInvocationToken: undefined });
    const toolText = toolResult.content.filter(part => typeof part.value === 'string').map(part => part.value).join('\n');
    assert.ok(toolText.includes(testCode));
    assert.ok(toolText.includes('Softmax'));
    report.steps.push('Real VS Code language-model tool returned selected problem and unsaved code');
    const discussion = await api.discussWithAgent(opened.uri);
    assert.equal(discussion.attachedFiles.length, 3);
    report.steps.push('Opened built-in Agent composer with actual problem, solution and tests attached');
    report.agentComposerOpened = true;
    report.agentReplyVerified = false;
    report.success = true;
  } catch (error) {
    report.error = error && error.message || String(error);
    throw error;
  } finally {
    if (opened && originalCode !== undefined) {
      await replace(await vscode.workspace.openTextDocument(opened.uri), originalCode);
      await replace(await vscode.workspace.openTextDocument(opened.testsUri), originalCases);
    }
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(evidence, 'e2e-report.json'), JSON.stringify(report, null, 2));
    await fs.unlink(path.join(evidence, 'e2e-connection.js')).catch(() => {});
    if (api) await api.bridge.stop();
  }
};
