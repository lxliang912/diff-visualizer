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
      const filePath = 'file' in file ? file.file : '';
      
      if ('insertions' in file && file.insertions > 0 && ('deletions' in file && file.deletions === 0)) {
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

  async getCommitHistory(baseBranch: string, targetBranch: string): Promise<CommitInfo[]> {
    const log = await this.git.log({
      from: baseBranch,
      to: targetBranch,
      format: {
        hash: '%H',
        parents: '%P',
        message: '%s',
        author_name: '%an',
        date: '%ai'
      }
    });

    return log.all.map((commit: any) => ({
      hash: commit.hash,
      shortHash: commit.hash.substring(0, 7),
      message: commit.message,
      author: commit.author_name,
      date: this.formatDate(commit.date),
      parents: commit.parents ? commit.parents.split(' ').filter((p: string) => p) : []
    }));
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
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return 'today';
    } else if (diffDays === 1) {
      return 'yesterday';
    } else if (diffDays < 7) {
      return `${diffDays}d`;
    } else {
      return date.toLocaleDateString();
    }
  }
}

