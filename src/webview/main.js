const vscode = acquireVsCodeApi();

const previousState = vscode.getState();
let state = previousState ? {
  ...previousState,
  expandedFolders: new Set(previousState.expandedFolders || [])
} : {
  baseBranch: '',
  targetBranch: '',
  branches: { local: [], remote: [], current: '' },
  diffFiles: [],
  commits: [],
  expandedFolders: new Set(),
  totalStats: { additions: 0, deletions: 0 }
};

function saveState() {
  vscode.setState({
    ...state,
    expandedFolders: Array.from(state.expandedFolders)
  });
}

const baseBranchSelect = document.getElementById('baseBranch');
const targetBranchSelect = document.getElementById('targetBranch');
const refreshBtn = document.getElementById('refreshBtn');
const fileTree = document.getElementById('fileTree');
const commitList = document.getElementById('commitList');
const commitSearch = document.getElementById('commitSearch');
const changesCount = document.getElementById('changesCount');
const totalAdditions = document.getElementById('totalAdditions');
const totalDeletions = document.getElementById('totalDeletions');

function init() {
  baseBranchSelect.addEventListener('change', onBranchChange);
  targetBranchSelect.addEventListener('change', onBranchChange);
  refreshBtn.addEventListener('click', onRefresh);
  commitSearch.addEventListener('input', onCommitSearch);
  
  document.getElementById('changesHeader').addEventListener('click', () => {
    toggleSection('changesHeader', 'changesBody');
  });
  document.getElementById('commitsHeader').addEventListener('click', () => {
    toggleSection('commitsHeader', 'commitsBody');
  });
  
  fileTree.addEventListener('click', (e) => {
    const target = e.target.closest('.tree-item');
    if (!target) return;
    
    const type = target.dataset.type;
    const path = target.dataset.path;
    
    if (type === 'folder') {
      e.stopPropagation();
      const icon = target.querySelector('.icon');
      const childrenEl = target.nextElementSibling;
      
      if (state.expandedFolders.has(path)) {
        state.expandedFolders.delete(path);
        icon.textContent = '▶';
        childrenEl.classList.remove('expanded');
      } else {
        state.expandedFolders.add(path);
        icon.textContent = '▼';
        childrenEl.classList.add('expanded');
      }
      saveState();
    } else if (type === 'file') {
      const filePath = path;
      vscode.postMessage({
        command: 'openDiff',
        baseBranch: state.baseBranch,
        targetBranch: state.targetBranch,
        filePath: filePath
      });
    }
  });
  
  fileTree.addEventListener('click', (e) => {
    const openFileBtn = e.target.closest('.open-file-btn');
    if (!openFileBtn) return;
    
    e.stopPropagation();
    const fileEl = openFileBtn.closest('.tree-item.file');
    if (fileEl) {
      const filePath = fileEl.dataset.path;
      vscode.postMessage({
        command: 'openFile',
        filePath: filePath,
        targetBranch: state.targetBranch
      });
    }
  });
  
  initResizer();
  
  if (previousState && previousState.branches && previousState.branches.local.length > 0) {
    populateBranchSelects(state.branches, true);
    baseBranchSelect.value = state.baseBranch;
    targetBranchSelect.value = state.targetBranch;
    updateSelectTitle(baseBranchSelect);
    updateSelectTitle(targetBranchSelect);
    if (state.diffFiles && state.diffFiles.length > 0) {
      renderFileTree(state.diffFiles, state.totalStats || { additions: 0, deletions: 0 }, true);
    }
    if (state.commits && state.commits.length > 0) {
      renderCommits(state.commits);
    }
  } else {
    vscode.postMessage({ command: 'getBranches' });
  }
}

function initResizer() {
  const resizer = document.getElementById('resizer');
  const changesSection = document.querySelector('.changes-section');
  const commitsSection = document.querySelector('.commits-section');
  const content = document.querySelector('.content');
  
  let isResizing = false;
  let startY = 0;
  let startChangesHeight = 0;
  
  resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    startY = e.clientY;
    startChangesHeight = changesSection.offsetHeight;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    
    const deltaY = e.clientY - startY;
    const contentHeight = content.offsetHeight;
    const newChangesHeight = Math.max(60, Math.min(contentHeight - 100, startChangesHeight + deltaY));
    
    changesSection.style.flex = 'none';
    changesSection.style.height = newChangesHeight + 'px';
    commitsSection.style.flex = '1';
  });
  
  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

function toggleSection(headerId, bodyId) {
  const header = document.getElementById(headerId);
  const body = document.getElementById(bodyId);
  const section = header.closest('section');
  header.classList.toggle('collapsed');
  body.classList.toggle('collapsed');
  section.classList.toggle('collapsed');
}

function onBranchChange() {
  state.baseBranch = baseBranchSelect.value;
  state.targetBranch = targetBranchSelect.value;
  updateSelectTitle(baseBranchSelect);
  updateSelectTitle(targetBranchSelect);
  saveState();
  
  if (state.baseBranch && state.targetBranch) {
    loadDiff();
  }
}

function loadDiff() {
  fileTree.innerHTML = '<div class="loading">Loading changes...</div>';
  commitList.innerHTML = '<div class="loading">Loading commits...</div>';
  
  vscode.postMessage({
    command: 'getDiff',
    baseBranch: state.baseBranch,
    targetBranch: state.targetBranch
  });
  
  vscode.postMessage({
    command: 'getCommitHistory',
    baseBranch: state.baseBranch,
    targetBranch: state.targetBranch
  });
}

function onRefresh() {
  vscode.postMessage({ command: 'refresh' });
  if (state.baseBranch && state.targetBranch) {
    loadDiff();
  }
}

function onCommitSearch(e) {
  const query = e.target.value.toLowerCase();
  renderCommits(state.commits.filter(c => 
    c.message.toLowerCase().includes(query) || 
    c.author.toLowerCase().includes(query) ||
    c.shortHash.toLowerCase().includes(query)
  ));
}

function updateSelectTitle(select) {
  select.title = select.value || 'Select branch';
}

function populateBranchSelects(branches, skipLoadDiff = false) {
  state.branches = branches;
  
  const createOptions = (select, selectedValue) => {
    select.innerHTML = '<option value="">Select branch</option>';
    
    if (branches.local.length > 0) {
      const localGroup = document.createElement('optgroup');
      localGroup.label = 'Local';
      branches.local.forEach(branch => {
        const option = document.createElement('option');
        option.value = branch;
        option.textContent = branch;
        option.title = branch;
        if (branch === selectedValue) option.selected = true;
        localGroup.appendChild(option);
      });
      select.appendChild(localGroup);
    }
    
    if (branches.remote.length > 0) {
      const remoteGroup = document.createElement('optgroup');
      remoteGroup.label = 'Remote';
      branches.remote.forEach(branch => {
        const option = document.createElement('option');
        option.value = branch;
        option.textContent = branch;
        option.title = branch;
        if (branch === selectedValue) option.selected = true;
        remoteGroup.appendChild(option);
      });
      select.appendChild(remoteGroup);
    }
    
    updateSelectTitle(select);
  };
  
  createOptions(baseBranchSelect, state.baseBranch || 'master');
  createOptions(targetBranchSelect, state.targetBranch || branches.current);
  
  if (!state.baseBranch) {
    baseBranchSelect.value = branches.local.includes('master') ? 'master' : 
                             branches.local.includes('main') ? 'main' : '';
  }
  if (!state.targetBranch) {
    targetBranchSelect.value = branches.current;
  }
  
  state.baseBranch = baseBranchSelect.value;
  state.targetBranch = targetBranchSelect.value;
  saveState();
  
  if (!skipLoadDiff && state.baseBranch && state.targetBranch) {
    loadDiff();
  }
}

function buildFileTree(files) {
  const tree = {};
  
  files.forEach(file => {
    const parts = file.path.split('/');
    let current = tree;
    
    parts.forEach((part, index) => {
      if (index === parts.length - 1) {
        current[part] = { type: 'file', data: file };
      } else {
        if (!current[part]) {
          current[part] = { type: 'folder', children: {} };
        }
        current = current[part].children;
      }
    });
  });
  
  return tree;
}

function collectAllFolders(files) {
  const folders = new Set();
  files.forEach(file => {
    const parts = file.path.split('/');
    let current = '';
    for (let i = 0; i < parts.length - 1; i++) {
      current = current ? `${current}/${parts[i]}` : parts[i];
      folders.add(current);
    }
  });
  return folders;
}

function renderFileTree(files, totalStats, isRestore = false) {
  if (!isRestore) {
  state.diffFiles = files;
    state.totalStats = totalStats;
  }
  
  changesCount.textContent = `${files.length} Changes`;
  totalAdditions.textContent = `+${totalStats.additions}`;
  totalDeletions.textContent = `-${totalStats.deletions}`;
  
  if (files.length === 0) {
    fileTree.innerHTML = '<div class="empty-state">No changes between branches</div>';
    if (!isRestore) saveState();
    return;
  }
  
  if (!isRestore && state.expandedFolders.size === 0) {
    state.expandedFolders = collectAllFolders(files);
  }
  if (!isRestore) saveState();
  
  const tree = buildFileTree(files);
  fileTree.innerHTML = '';
  
  const fragment = document.createDocumentFragment();
  renderTreeNode(tree, fragment, '', 0);
  fileTree.appendChild(fragment);
}

function renderTreeNode(node, container, path, depth) {
  const sortedKeys = Object.keys(node).sort((a, b) => {
    const aIsFolder = node[a].type === 'folder';
    const bIsFolder = node[b].type === 'folder';
    if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
    return a.localeCompare(b);
  });
  
  const indent = 16 + depth * 16;
  
  const createGuide = (i) => {
    const guide = document.createElement('span');
    guide.className = 'tree-guide';
    guide.style.left = `${21 + i * 16}px`;
    return guide;
  };
  
  sortedKeys.forEach(key => {
    const item = node[key];
    const fullPath = path ? `${path}/${key}` : key;
    if (item.type === 'folder') {
      const folderEl = document.createElement('div');
      folderEl.className = 'tree-item folder';
      folderEl.style.paddingLeft = `${indent}px`;
      folderEl.dataset.path = fullPath;
      folderEl.dataset.type = 'folder';
      
      for (let i = 0; i < depth; i++) {
        folderEl.appendChild(createGuide(i));
      }
      
      const icon = document.createElement('span');
      icon.className = 'icon';
      icon.textContent = state.expandedFolders.has(fullPath) ? '▼' : '▶';
      folderEl.appendChild(icon);
      
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = key;
      folderEl.appendChild(name);
      
      const childrenEl = document.createElement('div');
      childrenEl.className = `folder-children ${state.expandedFolders.has(fullPath) ? 'expanded' : ''}`;
      
      container.appendChild(folderEl);
      container.appendChild(childrenEl);
      
      renderTreeNode(item.children, childrenEl, fullPath, depth + 1);
    } else {
      const fileEl = document.createElement('div');
      fileEl.className = 'tree-item file';
      fileEl.style.paddingLeft = `${indent}px`;
      fileEl.dataset.path = item.data.path;
      fileEl.dataset.type = 'file';
      
      for (let i = 0; i < depth; i++) {
        fileEl.appendChild(createGuide(i));
      }
      
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = key;
      fileEl.appendChild(name);
      
      const fileActions = document.createElement('span');
      fileActions.className = 'file-actions';
      
      const iconMap = {
        added: 'A',
        modified: 'M',
        deleted: 'D',
        renamed: 'R'
      };
      
      const isDeleted = item.data.status === 'deleted';
      if (!isDeleted) {
        const openFileBtn = document.createElement('span');
        openFileBtn.className = 'open-file-btn';
        openFileBtn.title = '打开文件';
        openFileBtn.textContent = '✎';
        fileActions.appendChild(openFileBtn);
      }
      
      const fileStats = document.createElement('span');
      fileStats.className = 'file-stats';
      if (item.data.additions > 0) {
        const additions = document.createElement('span');
        additions.className = 'additions';
        additions.textContent = `+${item.data.additions}`;
        fileStats.appendChild(additions);
      }
      if (item.data.deletions > 0) {
        const deletions = document.createElement('span');
        deletions.className = 'deletions';
        deletions.textContent = `-${item.data.deletions}`;
        fileStats.appendChild(deletions);
      }
      fileActions.appendChild(fileStats);
      fileEl.appendChild(fileActions);
      
      const statusIcon = document.createElement('span');
      statusIcon.className = `icon status-${item.data.status}`;
      statusIcon.textContent = iconMap[item.data.status] || '•';
      fileEl.appendChild(statusIcon);
      
      container.appendChild(fileEl);
    }
  });
}

function renderCommits(commits) {
  if (commits.length === 0) {
    commitList.innerHTML = '<div class="empty-state">No commits to display</div>';
    return;
  }
  
  const fragment = document.createDocumentFragment();
  commits.forEach(commit => {
    const item = document.createElement('div');
    item.className = 'commit-item';
    item.dataset.hash = commit.hash;
    
    const header = document.createElement('div');
    header.className = 'commit-header';
    
    const hash = document.createElement('span');
    hash.className = 'commit-hash';
    hash.textContent = commit.shortHash;
    header.appendChild(hash);
    
    const date = document.createElement('span');
    date.className = 'commit-date';
    date.textContent = commit.date;
    header.appendChild(date);
    
    const author = document.createElement('span');
    author.className = 'commit-author';
    author.textContent = commit.author;
    header.appendChild(author);
    
    item.appendChild(header);
    
    const message = document.createElement('div');
    message.className = 'commit-message';
    message.textContent = commit.message;
    item.appendChild(message);
    
    fragment.appendChild(item);
  });
  
  commitList.innerHTML = '';
  commitList.appendChild(fragment);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

window.addEventListener('message', event => {
  const message = event.data;
  
  switch (message.command) {
    case 'branches':
      populateBranchSelects(message.data);
      break;
    case 'diff':
      renderFileTree(message.data.files, {
        additions: message.data.totalAdditions,
        deletions: message.data.totalDeletions
      });
      break;
    case 'commits':
      state.commits = message.data;
      renderCommits(message.data);
      saveState();
      break;
    case 'error':
      console.error(message.message);
      break;
  }
});

init();

