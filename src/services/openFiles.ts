import * as vscode from 'vscode';
import * as path from 'path';

function normalizeRel(rel: string): string {
  return String(rel).replace(/\\/g, '/').replace(/^\.\//, '');
}

function pathFromGitShow(uri: vscode.Uri): string {
  const raw = uri.query || '';
  const candidates = [raw];
  try {
    candidates.push(decodeURIComponent(raw));
  } catch (e) {
    // query was not encoded
  }
  for (const text of candidates) {
    try {
      const query = JSON.parse(text);
      if (query && query.path) {
        return normalizeRel(query.path);
      }
    } catch (e) {
      // try the next candidate
    }
  }
  return '';
}

function pathFromUri(uri: vscode.Uri | undefined, root: string): string {
  if (!uri) {
    return '';
  }
  if (uri.scheme === 'git-show') {
    return pathFromGitShow(uri);
  }
  if (uri.scheme === 'file' && root) {
    const rel = path.relative(root, uri.fsPath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      return '';
    }
    return normalizeRel(rel);
  }
  return '';
}

function pathsFromTabInput(input: any, root: string): string[] {
  if (!input) {
    return [];
  }
  const uris: vscode.Uri[] = [];
  if (input.modified) {
    uris.push(input.modified);
  }
  if (input.original) {
    uris.push(input.original);
  }
  if (input.uri) {
    uris.push(input.uri);
  }

  const paths: string[] = [];
  for (const uri of uris) {
    const rel = pathFromUri(uri, root);
    if (rel && paths.indexOf(rel) < 0) {
      paths.push(rel);
    }
  }
  return paths;
}

export function collectOpenFilePaths(
  api: typeof vscode,
  root: string
): { active: string; open: string[] } {
  const open: string[] = [];
  const seen: Record<string, boolean> = Object.create(null);

  for (const group of api.window.tabGroups.all) {
    for (const tab of group.tabs) {
      for (const filePath of pathsFromTabInput(tab.input, root)) {
        if (!seen[filePath]) {
          seen[filePath] = true;
          open.push(filePath);
        }
      }
    }
  }

  let active = '';
  const activeTab = api.window.tabGroups.activeTabGroup && api.window.tabGroups.activeTabGroup.activeTab;
  if (activeTab) {
    const paths = pathsFromTabInput(activeTab.input, root);
    if (paths.length) {
      active = paths[0];
    }
  }
  if (!active && api.window.activeTextEditor) {
    active = pathFromUri(api.window.activeTextEditor.document.uri, root);
  }

  return { active, open };
}
