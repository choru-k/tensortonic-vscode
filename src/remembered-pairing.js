'use strict';
const crypto = require('node:crypto');

// Workspace-scoped ownership prevents a second study window from silently
// targeting a different folder. Port collisions fail closed; never scan ports.
function rememberedOptions(vscode, context) {
  if (!context.secrets) return {};
  const identity = vscode.workspace.workspaceFile
    ? vscode.workspace.workspaceFile.toString()
    : (vscode.workspace.workspaceFolders || []).map(folder => folder.uri.toString()).sort().join('\n') || 'empty-window';
  const hash = crypto.createHash('sha256').update(identity).digest('hex');
  const key = `tensortonic.remembered-pairing.v1.${hash}`;
  const preferredPort = 40000 + (parseInt(hash.slice(0, 8), 16) % 20000);
  return { preferredPort, persistence: {
    load: () => context.secrets.get(key),
    save: value => context.secrets.store(key, value),
    delete: () => context.secrets.delete(key),
  } };
}
module.exports = { rememberedOptions };
