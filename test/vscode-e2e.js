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
  const connectionPath = path.join(evidence, 'e2e-connection.js');
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
  status.tooltip = '실행 단계와 오류는 Output의 TensorTonic live E2E 및 dist/e2e-report.json에서 확인할 수 있습니다.';
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
      'E2E 테스트 폴더가 열리지 않았습니다. 업데이트된 launch.json으로 실행해 test/workspace 폴더를 열어 주세요.');
    await phase('activating', '확장 프로그램 활성화 중');
    const extension = vscode.extensions.getExtension('choru-local.tensortonic-vscode');
    assert.ok(extension, 'Extension must be installed/discovered');
    api = await extension.activate();
    await phase('starting-connection', '임시 브라우저 연결 준비 중', 'Activated real VS Code extension');
    await api.bridge.start();
    await fs.writeFile(connectionPath, '// Temporary local pairing key. Do not commit or share.\n' + api.bridge.connectionCode(), { mode: 0o600 });
    const deadline = Date.now() + 10 * 60 * 1000;
    const instructions = [
      '# TensorTonic 실제 계정 테스트 — 브라우저 연결 대기',
      '',
      '확장 프로그램이 실행되었습니다. 왼쪽 JavaScript는 로그인된 브라우저와 VS Code를 연결하는 임시 코드입니다.',
      '',
      '1. **이 Mac의 브라우저**에서 [TensorTonic](https://www.tensortonic.com/)을 열고 평소처럼 로그인하세요.',
      '2. TensorTonic 탭의 개발자 도구에서 **Console**을 여세요.',
      '3. 왼쪽 **e2e-connection.js**의 전체 내용을 복사해 해당 Console에서 실행하세요. 이 파일을 공유하거나 Git에 추가하지 마세요.',
      '4. 브라우저에 **로컬 네트워크 접근** 확인창이 나타나면 사용자가 허용해야 합니다. 이 임시 연결이 같은 Mac의 VS Code에 접근하기 위해 필요합니다.',
      '5. TensorTonic 탭을 열어 두세요. 연결되면 문제 열기 → Run → Submit → Agent 첨부 검증이 자동으로 이어집니다.',
      '',
      '**연결 대기 시간은 10분입니다.** 아래 상태 표시줄과 알림에 남은 시간이 표시됩니다. 알림의 취소 버튼으로 중단할 수 있습니다.',
      '',
      '이 테스트는 현재 계정에서 이미 푼 **Softmax from Scratch**만 한 번 재제출합니다. 테스트 중 편집한 코드는 종료 시 원래 내용으로 복원합니다.',
      '',
      'Agent에는 문제·풀이·테스트 파일을 첨부한 작성 창을 엽니다. 실제 AI 답변은 자동으로 요청하거나 검증했다고 표시하지 않습니다.',
      '',
      '진행 상황과 오류: **Output → TensorTonic live E2E**, 또는 [e2e-report.json](./e2e-report.json).',
      '',
    ].join('\n');
    await fs.writeFile(instructionsPath, instructions);
    const instructionsUri = vscode.Uri.file(instructionsPath);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(connectionPath)), { viewColumn: vscode.ViewColumn.One, preview: false });
    if ((await vscode.commands.getCommands(true)).includes('markdown.showPreviewToSide')) {
      await vscode.commands.executeCommand('markdown.showPreviewToSide', instructionsUri);
    } else {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(instructionsUri), { viewColumn: vscode.ViewColumn.Beside, preview: false });
    }
    report.pairingDeadline = new Date(deadline).toISOString();
    await phase('waiting-for-browser', '브라우저 연결 대기 (10:00)', 'Started loopback connection and displayed Korean pairing instructions');
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'TensorTonic E2E: 브라우저 Console에서 임시 연결 코드를 실행해 주세요.',
      cancellable: true,
    }, async (progress, cancellation) => {
      let lastSaved = 0;
      while (!api.bridge.connected && Date.now() < deadline) {
        if (cancellation.isCancellationRequested) throw new Error('사용자가 브라우저 연결 대기를 취소했습니다. Run/Submit은 실행하지 않았습니다.');
        const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        const remaining = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
        const message = `브라우저 연결 대기 — 남은 시간 ${remaining}`;
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
      '10분 안에 브라우저가 연결되지 않았습니다. TensorTonic 탭의 Console 오류와 로컬 네트워크 접근 확인창을 확인한 뒤 테스트를 다시 실행해 주세요.');
    delete report.pairingSecondsRemaining;
    await phase('checking-account', '로그인 계정과 문제 접근 확인 중', 'Paired actual browser and extension loopback connection');
    const access = await api.smokeTest({ ref: { slug: 'pytorch-softmax-from-scratch', planId: 'pytorch-basics' } });
    assert.ok(access.problemCount > 0); assert.equal(access.problem.hasStarterCode, true);
    const catalogue = await api.client.listProblems('pytorch-basics');
    assert.equal(catalogue.some(problem => problem.slug === 'pytorch-softmax-from-scratch' && problem.solved), true,
      'This live test only re-submits an exercise already solved by the signed-in account');
    report.access = access;
    await phase('opening-problem', 'Softmax 문제와 편집기 열기');
    opened = await api.openProblem({ slug: 'pytorch-softmax-from-scratch', planId: 'pytorch-basics', technology: 'pytorch' });
    assert.ok(opened && opened.contextUri);
    await phase('preparing-editor', '저장 전 편집기 코드 검증 준비 중', 'Opened real problem, statement preview, solution and editable public tests');
    const solution = await vscode.workspace.openTextDocument(opened.uri);
    const cases = await vscode.workspace.openTextDocument(opened.testsUri);
    originalCode = solution.getText(); originalCases = cases.getText();
    const metadata = originalCode.split('\n').slice(0, 2).join('\n');
    const testCode = metadata + '\n\nimport torch\n\ndef softmax(logits: torch.Tensor) -> torch.Tensor:\n    m = logits.max(dim=1, keepdim=True).values\n    e = torch.exp(logits - m)\n    return e / e.sum(dim=1, keepdim=True)\n';
    await replace(solution, testCode);
    await replace(cases, JSON.stringify(opened.problem.testCases, null, 2));
    await phase('running-public-tests', '실제 Run 결과 확인 중');
    const runResult = await vscode.commands.executeCommand('tensortonic.run', opened.uri);
    assert.equal(runResult && runResult.status, 'passed', 'Actual Run must pass');
    assert.equal(runResult.passed, runResult.total);
    report.run = { status: runResult.status, passed: runResult.passed, total: runResult.total };
    await phase('submitting', '이미 푼 Softmax 재제출 결과 확인 중', 'Run command submitted current unsaved editor code and displayed passing results');
    const submitResult = await vscode.commands.executeCommand('tensortonic.submit', opened.uri);
    assert.equal(submitResult && submitResult.status, 'passed', 'Actual Submit must pass');
    assert.equal(submitResult.passed, submitResult.total);
    report.submit = { status: submitResult.status, passed: submitResult.passed, total: submitResult.total };
    await phase('checking-agent-tool', 'Agent 문제 읽기 도구 확인 중', 'Submit command received passing server grading and displayed results');
    const toolResult = await vscode.lm.invokeTool('tensortonic_current_problem', { input: {}, toolInvocationToken: undefined });
    const toolText = toolResult.content.filter(part => typeof part.value === 'string').map(part => part.value).join('\n');
    assert.ok(toolText.includes(testCode));
    assert.ok(toolText.includes('Softmax'));
    await phase('opening-agent-composer', 'Agent 작성 창과 파일 첨부 확인 중', 'Real VS Code language-model tool returned selected problem and unsaved code');
    const discussion = await api.discussWithAgent(opened.uri);
    assert.equal(discussion.attachedFiles.length, 3);
    report.agentComposerOpened = true;
    checksPassed = true;
    await phase('restoring-editor', '원래 편집기 내용 복원 중', 'Opened built-in Agent composer with actual problem, solution and tests attached');
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
    await cleanup(async () => {
      try { await fs.unlink(connectionPath); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    });
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
    output.appendLine(`${report.finishedAt} [${report.phase}] ${report.error || 'Run/Submit 및 Agent 첨부 확인 완료. 실제 AI 답변 검증은 별도입니다.'}`);
    await persist();
    status.dispose();
    output.dispose();
  }
  if (failure) throw failure;
};
