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
  const reportPath = path.join(evidence, 'e2e-report.json');
  const instructionsPath = path.join(evidence, 'e2e-instructions.md');
  const report = {
    startedAt: new Date().toISOString(), success: false, phase: 'starting', steps: [],
    agentComposerOpened: false, agentReplyVerified: false,
    workspaceFolders: (vscode.workspace.workspaceFolders || []).map(folder => folder.uri.fsPath),
  };
  // Persist every phase atomically, including before activation, so a killed
  // extension host leaves diagnostics instead of an absent or partial report.
  const persist = async () => {
    report.updatedAt = new Date().toISOString();
    const temporary = reportPath + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(report, null, 2));
    await fs.rename(temporary, reportPath);
  };
  await persist();
  const output = vscode.window.createOutputChannel('TensorTonic live E2E');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
  status.name = 'TensorTonic live E2E';
  status.tooltip = 'See Output → TensorTonic live E2E and dist/e2e-report.json for progress and errors.';
  status.show();
  const phase = async (name, message, completedStep) => {
    report.phase = name;
    if (completedStep) report.steps.push(completedStep);
    status.text = `$(sync~spin) TensorTonic E2E: ${message}`;
    output.appendLine(`${new Date().toISOString()} [${name}] ${message}`);
    await persist();
  };
  let api;
  let originalCode;
  let originalCases;
  let opened;
  let failure;
  let checksPassed = false;
  const replace = async (document, content) => {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(new vscode.Position(0, 0), document.positionAt(document.getText().length)), content);
    assert.equal(await vscode.workspace.applyEdit(edit), true);
  };
  try {
    // VS Code removes a launch folder if it is already open in the parent.
    // Both launch configurations therefore open the distinct test/workspace.
    assert.ok(report.workspaceFolders.length,
      'The E2E test folder is not open. Use the updated launch.json to open test/workspace.');
    await phase('activating', 'Activating the extension');
    const extension = vscode.extensions.getExtension('choru-local.tensortonic-vscode');
    assert.ok(extension, 'Extension must be installed/discovered');
    api = await extension.activate();
    await phase('starting-connection', 'Preparing a temporary browser connection', 'Activated real VS Code extension');
    const deadline = Date.now() + 10 * 60 * 1000;
    const instructions = [
      '# TensorTonic live-account test — waiting for browser connection',
      '',
      'The extension is running. TensorTonic Browser Companion must already be installed in a permitted browser. Stop this test if you do not have permission to install it.',
      '',
      '1. Open [TensorTonic](https://www.tensortonic.com/) in a browser **on the same computer as VS Code** and sign in normally.',
      '2. In the VS Code **Connect browser companion** prompt, select **Copy pairing code**.',
      '3. Open the companion popup on the TensorTonic tab, paste the pairing code, and select **Connect this tab**. The code expires after two minutes and can be used only once. No console is needed.',
      '4. If the browser asks for **local-network access**, the user must review and permit it. This temporary connection is needed to reach VS Code on the same computer. Do not bypass an organization policy that blocks it.',
      '5. Keep the TensorTonic tab open. After pairing, the test automatically opens the problem, runs and submits code, and checks Agent attachments.',
      '',
      '**The connection wait is limited to 10 minutes.** The status bar and notification show the time remaining. Use Cancel in the notification to stop.',
      '',
      'This test submits **Softmax from Scratch** once more only if it is already solved by the current account. Editor changes made during the test are restored when it ends.',
      '',
      'The test opens an Agent draft with the problem, solution, and test files attached. It does not automatically request an AI response or mark one as verified.',
      '',
      'Progress and errors: **Output → TensorTonic live E2E**, or [e2e-report.json](./e2e-report.json).',
      '',
    ].join('\n');
    await fs.writeFile(instructionsPath, instructions);
    const instructionsUri = vscode.Uri.file(instructionsPath);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(instructionsUri), { viewColumn: vscode.ViewColumn.One, preview: false });
    if ((await vscode.commands.getCommands(true)).includes('markdown.showPreviewToSide')) {
      await vscode.commands.executeCommand('markdown.showPreviewToSide', instructionsUri);
    } else {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(instructionsUri), { viewColumn: vscode.ViewColumn.Beside, preview: false });
    }
    report.pairingDeadline = new Date(deadline).toISOString();
    await phase('waiting-for-browser', 'Waiting for browser connection (10:00)', 'Displayed no-console browser companion pairing instructions');
    void vscode.commands.executeCommand('tensortonic.connect');
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'TensorTonic E2E: enter the pairing code in the browser companion.',
      cancellable: true,
    }, async (progress, cancellation) => {
      let lastSaved = 0;
      while (!api.bridge.connected && Date.now() < deadline) {
        if (cancellation.isCancellationRequested) throw new Error('The user canceled the browser connection wait. No Run or Submit was performed.');
        const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        const remaining = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
        const message = `Waiting for browser connection — ${remaining} remaining`;
        status.text = `$(sync~spin) TensorTonic E2E: ${message}`;
        progress.report({ message });
        if (Date.now() - lastSaved >= 5000) {
          report.pairingSecondsRemaining = seconds;
          await persist();
          lastSaved = Date.now();
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    });
    assert.equal(api.bridge.connected, true,
      'The browser did not connect within 10 minutes. Check the browser companion error and local-network permission prompt before running the test again.');
    delete report.pairingSecondsRemaining;
    await phase('checking-account', 'Checking the signed-in account and problem access', 'Paired actual browser and extension loopback connection');
    const access = await api.smokeTest({ ref: { slug: 'pytorch-softmax-from-scratch', planId: 'pytorch-basics' } });
    assert.ok(access.problemCount > 0); assert.equal(access.problem.hasStarterCode, true);
    const catalogue = await api.client.listProblems('pytorch-basics');
    assert.equal(catalogue.some(problem => problem.slug === 'pytorch-softmax-from-scratch' && problem.solved), true,
      'This live test only re-submits an exercise already solved by the signed-in account');
    report.access = access;
    await phase('opening-problem', 'Opening the Softmax problem and editor');
    opened = await api.openProblem({ slug: 'pytorch-softmax-from-scratch', planId: 'pytorch-basics', technology: 'pytorch' });
    assert.ok(opened && opened.contextUri);
    await phase('preparing-editor', 'Preparing to verify unsaved editor code', 'Opened real problem, statement preview, solution and editable public tests');
    const solution = await vscode.workspace.openTextDocument(opened.uri);
    const cases = await vscode.workspace.openTextDocument(opened.testsUri);
    originalCode = solution.getText(); originalCases = cases.getText();
    const metadata = originalCode.split('\n').slice(0, 2).join('\n');
    const testCode = metadata + '\n\nimport torch\n\ndef softmax(logits: torch.Tensor) -> torch.Tensor:\n    m = logits.max(dim=1, keepdim=True).values\n    e = torch.exp(logits - m)\n    return e / e.sum(dim=1, keepdim=True)\n';
    await replace(solution, testCode);
    await replace(cases, JSON.stringify(opened.problem.testCases, null, 2));
    await phase('running-public-tests', 'Checking the live Run result');
    const runResult = await vscode.commands.executeCommand('tensortonic.run', opened.uri);
    assert.equal(runResult && runResult.status, 'passed', 'Actual Run must pass');
    assert.equal(runResult.passed, runResult.total);
    report.run = { status: runResult.status, passed: runResult.passed, total: runResult.total };
    await phase('submitting', 'Checking resubmission of the already-solved Softmax problem', 'Run command submitted current unsaved editor code and displayed passing results');
    const submitResult = await vscode.commands.executeCommand('tensortonic.submit', opened.uri);
    assert.equal(submitResult && submitResult.status, 'passed', 'Actual Submit must pass');
    assert.equal(submitResult.passed, submitResult.total);
    report.submit = { status: submitResult.status, passed: submitResult.passed, total: submitResult.total };
    await phase('checking-agent-tool', 'Checking the Agent problem-context tool', 'Submit command received passing server grading and displayed results');
    const toolResult = await vscode.lm.invokeTool('tensortonic_current_problem', { input: {}, toolInvocationToken: undefined });
    const toolText = toolResult.content.filter(part => typeof part.value === 'string').map(part => part.value).join('\n');
    assert.ok(toolText.includes(testCode));
    assert.ok(toolText.includes('Softmax'));
    await phase('opening-agent-composer', 'Checking the Agent composer and file attachments', 'Real VS Code language-model tool returned selected problem and unsaved code');
    const discussion = await api.discussWithAgent(opened.uri);
    assert.equal(discussion.attachedFiles.length, 3);
    report.agentComposerOpened = true;
    checksPassed = true;
    await phase('restoring-editor', 'Restoring the original editor contents', 'Opened built-in Agent composer with actual problem, solution and tests attached');
  } catch (error) {
    failure = error;
    report.error = error && error.message || String(error);
    output.appendLine(`ERROR: ${report.error}`);
  } finally {
    const cleanupErrors = [];
    const cleanup = async operation => {
      try { await operation(); }
      catch (error) { cleanupErrors.push(error && error.message || String(error)); }
    };
    if (opened && originalCode !== undefined) {
      await cleanup(async () => replace(await vscode.workspace.openTextDocument(opened.uri), originalCode));
      await cleanup(async () => replace(await vscode.workspace.openTextDocument(opened.testsUri), originalCases));
    }
    if (api) await cleanup(() => api.bridge.stop());
    if (cleanupErrors.length) {
      report.cleanupErrors = cleanupErrors;
      if (!failure) {
        failure = new Error(`E2E cleanup failed: ${cleanupErrors.join('; ')}`);
        report.error = failure.message;
      }
    }
    report.success = checksPassed && !failure && cleanupErrors.length === 0;
    report.phase = report.success ? 'completed' : 'failed';
    report.finishedAt = new Date().toISOString();
    output.appendLine(`${report.finishedAt} [${report.phase}] ${report.error || 'Run/Submit and Agent attachments verified. An actual AI response requires separate verification.'}`);
    await persist();
    status.dispose();
    output.dispose();
  }
  if (failure) throw failure;
};
