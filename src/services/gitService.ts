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

  private shouldFormatAsList(parts: string[]): boolean {
    if (parts.length < 2) return false;
    
    const firstPart = parts[0].trim();
    const restParts = parts.slice(1);
    
    if (firstPart.length > 100) return false;
    
    const restAllHaveContent = restParts.every(part => part.trim().length > 5);
    if (!restAllHaveContent) return false;
    
    const restAllLookLikeItems = restParts.every(part => {
      const trimmed = part.trim();
      return trimmed.length > 10 && (trimmed.includes('，') || trimmed.includes('。') || trimmed.includes('、') || trimmed.length > 20);
    });
    
    return restAllLookLikeItems;
  }

  async getCommitHistory(baseBranch: string, targetBranch: string): Promise<CommitInfo[]> {
    const result = await this.git.raw([
      'log',
      `${baseBranch}..${targetBranch}`,
      '--format=%H%n%an%n%aI%n%s%n%b%n---COMMIT-SEPARATOR---',
      '--'
    ]);
    
    if (!result.trim()) {
      return [];
    }
    
    const commits: CommitInfo[] = [];
    const blocks = result.trim().split('---COMMIT-SEPARATOR---');
    
    for (const block of blocks) {
      const lines = block.trim().split('\n');
      if (lines.length < 4) continue;
      
      const hash = lines[0].trim();
      const author = lines[1].trim();
      const date = lines[2].trim();
      let subject = lines[3].trim();
      let body = lines.slice(4).join('\n').trim();
      
      let message = subject;
      
      if (body) {
        const hasNewlines = body.includes('\n');
        
        if (hasNewlines) {
          message = `${subject}\n${body}`;
        } else {
          const bodyParts = body.split(' - ').filter(part => part.trim());
          if (bodyParts.length > 1 && this.shouldFormatAsList(bodyParts)) {
            const formattedBody = bodyParts
              .map(part => {
                const trimmed = part.trim();
                return trimmed.startsWith('-') ? trimmed : `- ${trimmed}`;
              })
              .join('\n');
            message = `${subject}\n${formattedBody}`;
          } else {
            message = `${subject}\n${body}`;
          }
        }
      } else {
        const subjectParts = subject.split(' - ').filter(part => part.trim());
        if (subjectParts.length > 1 && this.shouldFormatAsList(subjectParts)) {
          subject = subjectParts[0];
          const bodyParts = subjectParts.slice(1).map(part => part.trim());
          const formattedBody = bodyParts
            .map(part => part.startsWith('-') ? part : `- ${part}`)
            .join('\n');
          message = `${subject}\n${formattedBody}`;
        }
      }
      
      commits.push({
        hash,
        shortHash: hash.substring(0, 7),
        message: message.trim(),
        author,
        date: this.formatDate(date),
        parents: []
      });
    }
    
    return commits;
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

