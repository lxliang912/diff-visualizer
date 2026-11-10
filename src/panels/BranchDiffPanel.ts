import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { GitService } from '../services/gitService';

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

    const repoEvents = require('../services/repoEvents');
    this._disposables.push(
      repoEvents.onDidChange(() => {
        this._postMessage({ command: 'repoChanged' });
      })
    );

    const sendOpenFiles = () => this._sendOpenFiles();
    this._disposables.push(vscode.window.tabGroups.onDidChangeTabs(sendOpenFiles));
    this._disposables.push(vscode.window.onDidChangeActiveTextEditor(sendOpenFiles));
    this._panel.onDidChangeViewState(
      () => {
        if (this._panel.visible) {
          sendOpenFiles();
        }
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
        this._sendOpenFiles();
        break;
      case 'openFile':
        await this._openFile(message.filePath, message.targetBranch);
        this._sendOpenFiles();
        break;
      case 'getOpenFiles':
        this._sendOpenFiles();
        break;
      case 'refresh':
        await this._sendBranches();
        break;
    }
  }

  private async _sendBranches() {
    if (!this._gitService) {
      this._postMessage({ command: 'error', area: 'branches', message: 'No workspace folder found' });
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
      this._postMessage({ command: 'error', area: 'branches', message: `Failed to get branches: ${error}` });
    }
  }

  private async _sendDiff(baseBranch: string, targetBranch: string) {
    if (!this._gitService) { return; }

    try {
      const diff = await this._gitService.getDiffFiles(baseBranch, targetBranch);
      this._postMessage({ command: 'diff', data: diff });
    } catch (error) {
      this._postMessage({ command: 'error', area: 'diff', message: `Failed to get diff: ${error}` });
    }
  }

  private async _sendCommitHistory(baseBranch: string, targetBranch: string) {
    if (!this._gitService) { return; }

    try {
      const commits = await this._gitService.getCommitHistory(baseBranch, targetBranch);
      this._postMessage({ command: 'commits', data: commits });
    } catch (error) {
      this._postMessage({ command: 'error', area: 'commits', message: `Failed to get commits: ${error}` });
    }
  }

  private async _openDiffEditor(baseBranch: string, targetBranch: string, filePath: string) {
    if (!this._gitService) { return; }

    const workspaceRoot = this._gitService.getWorkspaceRoot();
    const useWorkingTree = await this._gitService.shouldUseWorkingTree(targetBranch);

    const baseUri = vscode.Uri.from({
      scheme: 'git-show',
      path: `/${baseBranch}/${filePath}`,
      query: JSON.stringify({ branch: baseBranch, path: filePath, root: workspaceRoot })
    });

    const absPath = path.join(workspaceRoot, filePath);
    const targetBranchName = useWorkingTree ? '__worktree__' : targetBranch;
    const targetUri = useWorkingTree && fs.existsSync(absPath)
      ? vscode.Uri.file(absPath)
      : vscode.Uri.from({
          scheme: 'git-show',
          path: `/${targetBranchName}/${filePath}`,
          query: JSON.stringify({
            branch: useWorkingTree ? '__empty__' : targetBranch,
            path: filePath,
            root: workspaceRoot
          })
        });

    const title = useWorkingTree
      ? `${path.basename(filePath)} (${baseBranch} ↔ 工作区)`
      : `${path.basename(filePath)} (${baseBranch} ↔ ${targetBranch})`;

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

  private _sendOpenFiles() {
    const openFiles = require('../services/openFiles');
    const root = this._gitService ? this._gitService.getWorkspaceRoot() : '';
    this._postMessage({
      command: 'openFiles',
      data: openFiles.collectOpenFilePaths(vscode, root)
    });
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
