import * as vscode from 'vscode';
import { BranchDiffPanel } from './panels/BranchDiffPanel';
import { BranchDiffViewProvider } from './panels/BranchDiffViewProvider';

export function activate(context: vscode.ExtensionContext) {
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
