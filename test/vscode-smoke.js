'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Runs in VS Code's real extension host via --extensionTestsPath.
exports.run = async function run() {
  const vscode = require('vscode');
  const extension = vscode.extensions.getExtension('choru-local.tensortonic-vscode');
  assert.ok(extension, 'VS Code discovers the extension');
  const api = await extension.activate();
  const result = await api.smokeTest();
  assert.equal(result.activated, true);
  assert.equal(result.connected, false);
  const commands = await vscode.commands.getCommands(true);
  for (const command of api.commands) assert.ok(commands.includes(command), `Registered command ${command}`);
  fs.writeFileSync(path.resolve(__dirname, '../dist/vscode-smoke-result.json'), JSON.stringify({ success: true, ...result }, null, 2));
};
