import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const emitter = new vscode.EventEmitter<void>();

let timer: NodeJS.Timeout | null = null;
let fsWatchers: vscode.FileSystemWatcher[] = [];
let gitBindStarted = false;

function repoSignature(repo: any): string {
  const head = repo.state.HEAD;
  const commit = (head && head.commit) || '';
  const name = (head && head.name) || '';

  const parts: string[] = [];
  for (const change of repo.state.workingTreeChanges || []) {
    parts.push('w:' + change.uri.fsPath + ':' + change.status);
  }
  for (const change of repo.state.indexChanges || []) {
    parts.push('i:' + change.uri.fsPath + ':' + change.status);
  }

  const refs = (repo.state.refs || []).map((ref: any) => {
    return (ref.remote ? ref.remote + '/' : '') + (ref.name || '') + '@' + (ref.commit || '');
  });
  refs.sort();

  return name + '@' + commit + '|' + parts.join(',') + '|' + refs.join(',');
}

function schedule() {
  if (timer) {
    clearTimeout(timer);
  }
  timer = setTimeout(() => {
    timer = null;
    emitter.fire();
  }, 300);
}

function resolveGitDir(workspaceRoot: string): string | null {
  const gitPath = path.join(workspaceRoot, '.git');
  try {
    const stat = fs.statSync(gitPath);
    if (stat.isDirectory()) {
      return gitPath;
    }
    const text = fs.readFileSync(gitPath, 'utf8');
    const match = text.match(/^gitdir:\s*(.+)$/m);
    if (match) {
      return path.resolve(workspaceRoot, match[1].trim());
    }
  } catch (error) {
    return null;
  }
  return null;
}

function watchGitDirs() {
  for (const watcher of fsWatchers) {
    watcher.dispose();
  }
  fsWatchers = [];

  for (const folder of vscode.workspace.workspaceFolders || []) {
    const dir = resolveGitDir(folder.uri.fsPath);
    if (!dir) {
      continue;
    }
    const base = vscode.Uri.file(dir);
    for (const rel of ['HEAD', 'packed-refs', 'FETCH_HEAD', 'refs/**']) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(base, rel));
      watcher.onDidChange(schedule);
      watcher.onDidCreate(schedule);
      watcher.onDidDelete(schedule);
      fsWatchers.push(watcher);
    }
  }
}

function bindGitApi(context: vscode.ExtensionContext) {
  if (gitBindStarted) {
    return;
  }
  gitBindStarted = true;

  const gitExt = vscode.extensions.getExtension('vscode.git');
  if (!gitExt) {
    return;
  }

  const ready = gitExt.isActive ? Promise.resolve() : gitExt.activate();
  ready.then(
    () => {
      if (!gitExt.exports || typeof gitExt.exports.getAPI !== 'function') {
        return;
      }
      const git = gitExt.exports.getAPI(1);
      const seen = new Set<string>();

      const hook = (repo: any) => {
        const key = repo.rootUri.toString();
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        let last = repoSignature(repo);
        context.subscriptions.push(
          repo.state.onDidChange(() => {
            const next = repoSignature(repo);
            if (next !== last) {
              last = next;
              schedule();
            }
          })
        );
      };

      git.repositories.forEach(hook);
      context.subscriptions.push(git.onDidOpenRepository(hook));
    },
    () => {}
  );
}

export function bind(context: vscode.ExtensionContext) {
  watchGitDirs();
  bindGitApi(context);

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.uri.scheme === 'file') {
        schedule();
      }
    })
  );

  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(watchGitDirs));

  context.subscriptions.push({
    dispose() {
      if (timer) {
        clearTimeout(timer);
      }
      for (const watcher of fsWatchers) {
        watcher.dispose();
      }
      emitter.dispose();
    }
  });
}

export const onDidChange: vscode.Event<void> = emitter.event;
