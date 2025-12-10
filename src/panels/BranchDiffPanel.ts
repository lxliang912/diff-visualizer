import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GitService, DiffFile, CommitInfo, DiffResult } from '../services/gitService';

export class BranchDiffPanel {
  public static currentPanel: BranchDiffPanel | undefined;
  public static readonly viewType = 'branchDiff';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _gitService: GitService | undefined;

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (BranchDiffPanel.currentPanel) {
      BranchDiffPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      BranchDiffPanel.viewType,
      'Branch Diff',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'src', 'webview')],
        retainContextWhenHidden: true
      }
    );

    BranchDiffPanel.currentPanel = new BranchDiffPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._initGitService();
    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        await this._handleMessage(message);
      },
      null,
      this._disposables
    );
  }

  private _initGitService() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      this._gitService = new GitService(workspaceFolders[0].uri.fsPath);
    }
  }

  private async _handleMessage(message: any) {
    switch (message.command) {
      case 'getBranches':
        await this._sendBranches();
        break;
      case 'getDiff':
        await this._sendDiff(message.baseBranch, message.targetBranch);
        break;
      case 'getCommitHistory':
        await this._sendCommitHistory(message.baseBranch, message.targetBranch);
        break;
      case 'openDiff':
        await this._openDiffEditor(message.baseBranch, message.targetBranch, message.filePath);
        break;
      case 'refresh':
        await this._sendBranches();
        break;
    }
  }

  private async _sendBranches() {
    if (!this._gitService) {
      this._postMessage({ command: 'error', message: 'No workspace folder found' });
      return;
    }

    try {
      const branches = await this._gitService.getAllBranches();
      const currentBranch = (await this._gitService.getBranches()).current;
      this._postMessage({
        command: 'branches',
        data: { ...branches, current: currentBranch }
      });
    } catch (error) {
      this._postMessage({ command: 'error', message: `Failed to get branches: ${error}` });
    }
  }

  private async _sendDiff(baseBranch: string, targetBranch: string) {
    if (!this._gitService) { return; }

    try {
      const diff = await this._gitService.getDiffFiles(baseBranch, targetBranch);
      this._postMessage({ command: 'diff', data: diff });
    } catch (error) {
      this._postMessage({ command: 'error', message: `Failed to get diff: ${error}` });
    }
  }

  private async _sendCommitHistory(baseBranch: string, targetBranch: string) {
    if (!this._gitService) { return; }

    try {
      const commits = await this._gitService.getCommitHistory(baseBranch, targetBranch);
      this._postMessage({ command: 'commits', data: commits });
    } catch (error) {
      this._postMessage({ command: 'error', message: `Failed to get commits: ${error}` });
    }
  }

  private async _openDiffEditor(baseBranch: string, targetBranch: string, filePath: string) {
    if (!this._gitService) { return; }

    const workspaceRoot = this._gitService.getWorkspaceRoot();
    
    const baseUri = vscode.Uri.from({
      scheme: 'git-show',
      path: `/${baseBranch}/${filePath}`,
      query: JSON.stringify({ branch: baseBranch, path: filePath, root: workspaceRoot })
    });
    
    const targetUri = vscode.Uri.from({
      scheme: 'git-show',
      path: `/${targetBranch}/${filePath}`,
      query: JSON.stringify({ branch: targetBranch, path: filePath, root: workspaceRoot })
    });

    const title = `${path.basename(filePath)} (${baseBranch} ↔ ${targetBranch})`;
    
    console.log('Opening diff with:');
    console.log('baseUri:', baseUri.toString());
    console.log('targetUri:', targetUri.toString());
    
    try {
      await vscode.commands.executeCommand('vscode.diff', baseUri, targetUri, title);
    } catch (error) {
      console.error('Diff error:', error);
      vscode.window.showErrorMessage(`Failed to open diff: ${error}`);
    }
  }

  private _getLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const languageMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescriptreact',
      '.js': 'javascript',
      '.jsx': 'javascriptreact',
      '.vue': 'vue',
      '.json': 'json',
      '.html': 'html',
      '.css': 'css',
      '.less': 'less',
      '.scss': 'scss',
      '.md': 'markdown',
      '.py': 'python',
      '.java': 'java',
      '.go': 'go',
      '.rs': 'rust',
      '.sh': 'shellscript'
    };
    return languageMap[ext] || 'plaintext';
  }

  private _postMessage(message: any) {
    this._panel.webview.postMessage(message);
  }

  public update() {
    this._update();
  }

  private _update() {
    this._panel.webview.html = this._getHtmlForWebview();
  }

  private _getHtmlForWebview(): string {
    const webviewPath = path.join(this._extensionUri.fsPath, 'src', 'webview');
    
    const htmlPath = path.join(webviewPath, 'index.html');
    const cssPath = path.join(webviewPath, 'styles.css');
    const jsPath = path.join(webviewPath, 'main.js');

    let html = fs.readFileSync(htmlPath, 'utf-8');
    const css = fs.readFileSync(cssPath, 'utf-8');
    const js = fs.readFileSync(jsPath, 'utf-8');

    html = html.replace('/* INJECT_CSS */', css);
    html = html.replace('/* INJECT_JS */', js);

    return html;
  }

  public dispose() {
    BranchDiffPanel.currentPanel = undefined;

    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}

