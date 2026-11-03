'use strict';

const { recognizedSolution } = require('./study-navigation');

const column = value => Number.isInteger(value) && value > 0 && value <= 9 ? value : undefined;
const uriKey = document => document?.uri?.toString();

class StudyLayout {
  constructor(vscode) {
    this.vscode = vscode;
    this._disposed = false;
    this._generation = 0;
    this._decided = false;
    this._listeners = [];
  }

  _columns() {
    const groups = this.vscode.window.tabGroups?.all;
    if (!Array.isArray(groups) || !groups.length) return undefined;
    const columns = [...new Set(groups.map(group => column(group.viewColumn)).filter(Boolean))];
    return columns.length ? columns : undefined;
  }

  get problemColumn() {
    const columns = this._columns();
    if (!columns) return this._problemColumn || this.vscode.ViewColumn.One;
    if (columns.includes(this._problemColumn)) return this._problemColumn;
    return columns.find(value => value !== this._codeColumn) || columns[0];
  }

  rememberProblemColumn(value) {
    this._problemColumn = column(value);
  }

  _observe(editor) {
    if (this._disposed || !column(editor?.viewColumn) || !recognizedSolution(editor.document)) return;
    this._codeColumn = editor.viewColumn;
    this._codeUri = uriKey(editor.document);
  }

  _watch() {
    if (this._watching) return;
    this._watching = true;
    const window = this.vscode.window;
    if (typeof window.onDidChangeActiveTextEditor === 'function') {
      this._listeners.push(window.onDidChangeActiveTextEditor(editor => this._observe(editor)));
    }
    if (typeof window.onDidChangeVisibleTextEditors === 'function') {
      this._listeners.push(window.onDidChangeVisibleTextEditors(editors => {
        const remembered = editors.find(editor => uriKey(editor.document) === this._codeUri);
        this._observe(remembered || editors.find(editor => recognizedSolution(editor.document)));
      }));
    }
  }

  async _decide(isCurrent) {
    const before = this._columns();
    let layout;
    try { layout = await this.vscode.commands.executeCommand('vscode.getEditorLayout'); }
    catch (_) { /* Older hosts retain their existing editor groups. */ }
    if (!isCurrent()) return;
    this._decided = true;
    const after = this._columns();
    const unchanged = !before || !after || JSON.stringify(before) === JSON.stringify(after);
    const single = Array.isArray(layout?.groups) && layout.groups.length === 1 &&
      layout.groups[0] && typeof layout.groups[0] === 'object' && layout.groups[0].groups === undefined;
    if (!single || !unchanged || (after && after.length !== 1)) return;
    try {
      // Stable command schema: orientation 0 means one row with columns.
      // https://code.visualstudio.com/api/references/commands
      // Also verified against the installed VS Code 1.144.0 command metadata.
      await this.vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{}, {}] });
      if (this._disposed) return;
      this._codeColumn = this.vscode.ViewColumn.Two;
      this._problemColumn = this.vscode.ViewColumn.One;
      this._initialPlacement = true;
    } catch (_) { /* Layout failure must not prevent opening the solution. */ }
  }

  async _prepare(isCurrent) {
    while (isCurrent()) {
      if (this._pending) { await this._pending; continue; }
      if (this._decided) return;
      const pending = this._decide(isCurrent);
      this._pending = pending;
      try { await pending; }
      finally { if (this._pending === pending) this._pending = undefined; }
    }
  }

  _solutionColumn(document) {
    const columns = this._columns();
    if (this._initialPlacement) {
      this._initialPlacement = false;
      if (!columns || columns.includes(this.vscode.ViewColumn.Two)) return this.vscode.ViewColumn.Two;
    }
    const visible = (this.vscode.window.visibleTextEditors || []).filter(editor =>
      column(editor.viewColumn) && recognizedSolution(editor.document) && (!columns || columns.includes(editor.viewColumn)));
    const exact = visible.find(editor => uriKey(editor.document) === uriKey(document));
    const active = this.vscode.window.activeTextEditor;
    const selected = exact || visible.find(editor => editor === active) ||
      visible.find(editor => uriKey(editor.document) === this._codeUri) || visible[0];
    if (selected) return selected.viewColumn;
    if (columns) return columns.includes(this._codeColumn) ? this._codeColumn : columns[columns.length - 1];
    // Absolute columns keep incomplete host APIs bounded; never use Beside.
    return column(active?.viewColumn) || this.vscode.ViewColumn.One;
  }

  async showSolution(document, { isCurrent = () => true } = {}) {
    const generation = ++this._generation;
    const current = () => !this._disposed && generation === this._generation && isCurrent();
    if (!current()) return undefined;
    this._watch();
    await this._prepare(current);
    if (!current()) return undefined;
    const viewColumn = this._solutionColumn(document);
    let editor;
    try { editor = await this.vscode.window.showTextDocument(document, { viewColumn, preview: false, preserveFocus: false }); }
    catch (error) { if (!current()) return undefined; throw error; }
    if (!current()) return undefined;
    this._codeColumn = column(editor?.viewColumn) || viewColumn;
    this._codeUri = uriKey(document);
    return editor;
  }

  dispose() {
    this._disposed = true;
    this._generation++;
    for (const listener of this._listeners) listener?.dispose();
    this._listeners = [];
  }
}

module.exports = { StudyLayout };
