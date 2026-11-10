import * as vscode from 'vscode';
import { BranchDiffPanel } from './panels/BranchDiffPanel';
import { BranchDiffViewProvider } from './panels/BranchDiffViewProvider';
import { GitService } from './services/gitService';
import * as repoEvents from './services/repoEvents';

class GitShowContentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this._onDidChange.event;
  private _openUris = new Map<string, vscode.Uri>();

  public invalidate() {
    for (const uri of this._openUris.values()) {
      this._onDidChange.fire(uri);
    }
  }

  public dispose() {
    this._onDidChange.dispose();
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    this._openUris.set(uri.toString(), uri);
    try {
      const query = JSON.parse(uri.query);
      const { branch, path, root } = query;
      if (branch === '__empty__') {
        return '';
      }
      const gitService = new GitService(root);
      return await gitService.getFileContent(branch, path);
    } catch (error) {
      console.error('GitShowContentProvider error:', error);
      return '';
    }
  }
}

export function activate(context: vscode.ExtensionContext) {
  const gitShowProvider = new GitShowContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('git-show', gitShowProvider)
  );
  context.subscriptions.push({ dispose: () => gitShowProvider.dispose() });

  repoEvents.bind(context);
  context.subscriptions.push(repoEvents.onDidChange(() => gitShowProvider.invalidate()));

  const provider = new BranchDiffViewProvider(context.extensionUri);
  
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('branchDiff.panel', provider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  const compareCommand = vscode.commands.registerCommand('branchDiff.compare', () => {
    BranchDiffPanel.createOrShow(context.extensionUri);
  });

  context.subscriptions.push(compareCommand);
}

export function deactivate() {}
