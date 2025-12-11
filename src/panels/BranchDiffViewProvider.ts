import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GitService, DiffFile, CommitInfo, DiffResult } from '../services/gitService';

export class BranchDiffViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'branchDiff.panel';
  private _view?: vscode.WebviewView;
  private _gitService?: GitService;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'src', 'webview')]
    };

    this._initGitService();
    webviewView.webview.html = this._getHtmlForWebview();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      await this._handleMessage(message);
    });
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
      case 'openFile':
        await this._openFile(message.filePath, message.targetBranch);
        break;
      case 'refresh':
        await this._sendBranches();
        break;
    }
  }

  private async _sendBranches() {
    if (!this._gitService || !this._view) {
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
    
    try {
      await vscode.commands.executeCommand('vscode.diff', baseUri, targetUri, title);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to open diff: ${error}`);
    }
  }

  private async _openFile(filePath: string, targetBranch: string) {
    if (!this._gitService) { return; }

    const workspaceRoot = this._gitService.getWorkspaceRoot();
    const fileUri = vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), filePath);
    
    try {
      const document = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(document);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to open file: ${error}`);
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
    if (this._view) {
      this._view.webview.postMessage(message);
    }
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
}


