import * as vscode from 'vscode';
import { BranchDiffPanel } from './panels/BranchDiffPanel';
import { BranchDiffViewProvider } from './panels/BranchDiffViewProvider';
import { GitService } from './services/gitService';

class GitShowContentProvider implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    console.log('GitShowContentProvider called with uri:', uri.toString());
    console.log('uri.query:', uri.query);
    try {
      const query = JSON.parse(uri.query);
      const { branch, path, root } = query;
      console.log('Parsed query:', { branch, path, root });
      const gitService = new GitService(root);
      const content = await gitService.getFileContent(branch, path);
      console.log('Content length:', content.length);
      return content;
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
