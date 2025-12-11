import simpleGit, { SimpleGit, BranchSummary, LogResult } from 'simple-git';
import * as path from 'path';

export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  parents: string[];
}

export interface DiffResult {
  files: DiffFile[];
  totalAdditions: number;
  totalDeletions: number;
}

export class GitService {
  private git: SimpleGit;
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.git = simpleGit(workspaceRoot);
  }

  async getBranches(): Promise<{ current: string; all: string[] }> {
    const branchSummary: BranchSummary = await this.git.branch();
    return {
      current: branchSummary.current,
      all: branchSummary.all.filter(b => !b.startsWith('remotes/'))
    };
  }

  async getAllBranches(): Promise<{ local: string[]; remote: string[] }> {
    const branchSummary: BranchSummary = await this.git.branch(['-a']);
    const local: string[] = [];
    const remote: string[] = [];

    branchSummary.all.forEach(branch => {
      if (branch.startsWith('remotes/')) {
        const remoteBranch = branch.replace('remotes/', '');
        if (!remoteBranch.includes('HEAD')) {
          remote.push(remoteBranch);
        }
      } else {
        local.push(branch);
      }
    });

    return { local, remote };
  }

  async getDiffFiles(baseBranch: string, targetBranch: string): Promise<DiffResult> {
    const diffSummary = await this.git.diffSummary([baseBranch, targetBranch]);
    
    const files: DiffFile[] = diffSummary.files.map(file => {
      let status: DiffFile['status'] = 'modified';
      let filePath = 'file' in file ? file.file : '';
      
      const isRenamed = filePath.includes('{') && filePath.includes(' => ') && filePath.includes('}');
      if (isRenamed) {
        filePath = this.parseRenamedPath(filePath);
        status = 'renamed';
      } else if ('insertions' in file && file.insertions > 0 && ('deletions' in file && file.deletions === 0)) {
        status = 'added';
      } else if ('deletions' in file && file.deletions > 0 && ('insertions' in file && file.insertions === 0)) {
        status = 'deleted';
      }

      return {
        path: filePath,
        additions: 'insertions' in file ? file.insertions : 0,
        deletions: 'deletions' in file ? file.deletions : 0,
        status
      };
    });

    return {
      files,
      totalAdditions: diffSummary.insertions,
      totalDeletions: diffSummary.deletions
    };
  }

  private parseRenamedPath(filePath: string): string {
    const regex = /\{([^}]*) => ([^}]*)\}/g;
    return filePath.replace(regex, (_, oldPart, newPart) => newPart);
  }

  async getCommitHistory(baseBranch: string, targetBranch: string): Promise<CommitInfo[]> {
    const result = await this.git.raw([
      'log',
      `${baseBranch}..${targetBranch}`,
      '--format=%H|%an|%aI|%s',
      '--'
    ]);
    
    if (!result.trim()) {
      return [];
    }
    
    return result.trim().split('\n').map(line => {
      const [hash, author, date, ...messageParts] = line.split('|');
      const message = messageParts.join('|');
      return {
        hash,
        shortHash: hash.substring(0, 7),
        message,
        author,
        date: this.formatDate(date),
        parents: []
      };
    });
  }

  async getFileContent(branch: string, filePath: string): Promise<string> {
    try {
      const content = await this.git.show([`${branch}:${filePath}`]);
      return content;
    } catch {
      return '';
    }
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  private formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }
}

