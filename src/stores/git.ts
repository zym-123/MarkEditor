import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

// ============= Types =============

export interface RepoInfo {
  is_repo: boolean;
  workdir: string;
  current_branch: string | null;
}

export interface FileInfo {
  path: string;
  name: string;
  status: string;
}

export interface RepoStatus {
  current_branch: string;
  staged_files: FileInfo[];
  modified_files: FileInfo[];
  untracked_files: FileInfo[];
  clean: boolean;
}

export interface CommitInfo {
  hash: string;
  short_hash: string;
  message: string;
  author: string;
  date: string;
  relative_date: string;
  files_count: number;
}

export interface FileChange {
  path: string;
  change_type: string;
}

export interface BranchInfo {
  name: string;
  is_current: boolean;
}

export interface GitAccount {
  id: string;
  name: string;
  email: string;
  source: 'local' | 'global' | 'manual';
  repoPath?: string;
  createdAt: number;
}

export interface DetectedAccount {
  found: boolean;
  account: { name: string; email: string } | null;
  source: string;
}

// ============= localStorage helpers =============

const ACCOUNTS_KEY = 'markeditor_git_accounts';
const CURRENT_ACCOUNT_ID_KEY = 'markeditor_git_current_account_id';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

function loadAccounts(): GitAccount[] {
  try {
    const stored = localStorage.getItem(ACCOUNTS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // ignore
  }
  return [];
}

function saveAccounts(accounts: GitAccount[]) {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    // ignore
  }
}

function loadCurrentAccountId(): string | null {
  try {
    return localStorage.getItem(CURRENT_ACCOUNT_ID_KEY);
  } catch {
    return null;
  }
}

function saveCurrentAccountId(id: string | null) {
  try {
    if (id) {
      localStorage.setItem(CURRENT_ACCOUNT_ID_KEY, id);
    } else {
      localStorage.removeItem(CURRENT_ACCOUNT_ID_KEY);
    }
  } catch {
    // ignore
  }
}

// ============= Store =============

export const useGitStore = defineStore('git', () => {
  // Existing state
  const repoInfo = ref<RepoInfo | null>(null);
  const repoStatus = ref<RepoStatus | null>(null);
  const commitHistory = ref<CommitInfo[]>([]);
  const branches = ref<BranchInfo[]>([]);
  const currentBranch = ref<string>('');
  const isLoading = ref(false);
  const isLoadingMore = ref(false);
  const hasMoreCommits = ref(true);
  const error = ref<string | null>(null);

  // Account state
  const accounts = ref<GitAccount[]>(loadAccounts());
  const currentAccountId = ref<string | null>(loadCurrentAccountId());
  const isDetectingAccount = ref(false);

  // Selected files for staging
  const selectedStagedFiles = ref<Set<string>>(new Set());
  const selectedModifiedFiles = ref<Set<string>>(new Set());
  const selectedUntrackedFiles = ref<Set<string>>(new Set());

  // Diff state
  const showDiff = ref(false);
  const diffContent = ref('');
  const selectedCommit = ref<CommitInfo | null>(null);
  const commitDiffFiles = ref<FileChange[]>([]);

  // ============= Computed =============

  const currentAccount = computed(() => {
    if (!currentAccountId.value) return null;
    return accounts.value.find(a => a.id === currentAccountId.value) || null;
  });

  // ============= Helper functions =============

  async function invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(command, args);
  }

  // ============= Account methods =============

  function isEmailDuplicated(email: string, excludeId?: string): boolean {
    return accounts.value.some(
      a => a.email.toLowerCase() === email.toLowerCase() && a.id !== excludeId
    );
  }

  function addAccount(name: string, email: string, source: 'local' | 'global' | 'manual' = 'manual', repoPath?: string): GitAccount {
    const account: GitAccount = {
      id: generateId(),
      name,
      email,
      source,
      repoPath,
      createdAt: Date.now(),
    };
    accounts.value.push(account);
    saveAccounts(accounts.value);
    return account;
  }

  function removeAccount(id: string) {
    const index = accounts.value.findIndex(a => a.id === id);
    if (index !== -1) {
      accounts.value.splice(index, 1);
      saveAccounts(accounts.value);
      // If removed current account, clear selection
      if (currentAccountId.value === id) {
        currentAccountId.value = null;
        saveCurrentAccountId(null);
      }
    }
  }

  function selectAccount(id: string | null) {
    currentAccountId.value = id;
    saveCurrentAccountId(id);
  }

  async function detectForRepo(repoPath: string): Promise<void> {
    isDetectingAccount.value = true;
    try {
      const detected = await invoke<DetectedAccount>('detect_git_account', { path: repoPath });

      if (!detected.found || !detected.account) {
        // No account found, use existing local account if available
        if (accounts.value.length > 0 && !currentAccountId.value) {
          selectAccount(accounts.value[0].id);
        }
        return;
      }

      const { name, email } = detected.account;
      const source = detected.source as 'local' | 'global';

      // Check if this account already exists
      const existing = accounts.value.find(a => a.email.toLowerCase() === email.toLowerCase());
      if (existing) {
        // Use existing account
        selectAccount(existing.id);
      } else {
        // Add new account and select it
        const newAccount = addAccount(name, email, source, source === 'local' ? repoPath : undefined);
        selectAccount(newAccount.id);
      }
    } catch (e) {
      error.value = String(e);
    } finally {
      isDetectingAccount.value = false;
    }
  }

  async function setLocalAccount(repoPath: string, name: string, email: string): Promise<boolean> {
    try {
      await invoke('set_git_account', { path: repoPath, name, email });

      // Update or add account with local source
      const existing = accounts.value.find(a => a.email.toLowerCase() === email.toLowerCase());
      if (existing) {
        existing.name = name;
        existing.source = 'local';
        existing.repoPath = repoPath;
        saveAccounts(accounts.value);
      } else {
        addAccount(name, email, 'local', repoPath);
      }

      // Select this account
      const account = accounts.value.find(a => a.email.toLowerCase() === email.toLowerCase());
      if (account) {
        selectAccount(account.id);
      }

      return true;
    } catch (e) {
      error.value = String(e);
      return false;
    }
  }

  // ============= Git operations =============

  async function refreshRepoInfo(path: string) {
    try {
      const info = await invoke<RepoInfo>('get_repo_info', { path });
      repoInfo.value = info;
      return info;
    } catch (e) {
      error.value = String(e);
      return null;
    }
  }

  async function initRepo(path: string): Promise<boolean> {
    try {
      await invoke('init_repository', { path });
      await refreshRepoInfo(path);
      await fetchStatus(path);
      return true;
    } catch (e) {
      error.value = String(e);
      return false;
    }
  }

  async function fetchStatus(path: string) {
    if (!repoInfo.value?.is_repo) return;

    try {
      isLoading.value = true;
      const status = await invoke<RepoStatus>('get_repository_status', { path });
      repoStatus.value = status;
      currentBranch.value = status.current_branch;
    } catch (e) {
      error.value = String(e);
    } finally {
      isLoading.value = false;
    }
  }

  async function stageFiles(path: string, files: string[]): Promise<boolean> {
    try {
      await invoke('stage_files', { path, files });
      await fetchStatus(path);
      return true;
    } catch (e) {
      error.value = String(e);
      return false;
    }
  }

  async function unstageFiles(path: string, files: string[]): Promise<boolean> {
    try {
      await invoke('unstage_files', { path, files });
      await fetchStatus(path);
      return true;
    } catch (e) {
      error.value = String(e);
      return false;
    }
  }

  async function stageAll(path: string): Promise<boolean> {
    try {
      await invoke('stage_all', { path });
      await fetchStatus(path);
      return true;
    } catch (e) {
      error.value = String(e);
      return false;
    }
  }

  async function unstageAll(path: string): Promise<boolean> {
    try {
      await invoke('unstage_all', { path });
      await fetchStatus(path);
      return true;
    } catch (e) {
      error.value = String(e);
      return false;
    }
  }

  async function commit(path: string, message: string): Promise<string | null> {
    const account = currentAccount.value;
    if (!account) {
      error.value = '请先配置 Git 用户信息';
      return null;
    }

    try {
      const hash = await invoke<string>('commit_files', {
        path,
        message,
        authorName: account.name,
        authorEmail: account.email,
      });

      await fetchStatus(path);
      await fetchHistory(path);
      return hash;
    } catch (e) {
      error.value = String(e);
      return null;
    }
  }

  async function fetchHistory(path: string, limit: number = 20, offset: number = 0): Promise<CommitInfo[]> {
    if (!repoInfo.value?.is_repo) return [];

    try {
      const history = await invoke<CommitInfo[]>('get_commit_history', { path, limit, offset });
      if (offset === 0) {
        commitHistory.value = history;
      } else {
        commitHistory.value.push(...history);
      }
      hasMoreCommits.value = history.length === limit;
      return history;
    } catch (e) {
      error.value = String(e);
      return [];
    }
  }

  async function fetchMoreHistory(path: string, limit: number = 20): Promise<CommitInfo[]> {
    if (isLoadingMore.value || !hasMoreCommits.value) return [];
    isLoadingMore.value = true;
    try {
      const offset = commitHistory.value.length;
      const history = await invoke<CommitInfo[]>('get_commit_history', { path, limit, offset });
      commitHistory.value.push(...history);
      hasMoreCommits.value = history.length === limit;
      return history;
    } catch (e) {
      error.value = String(e);
      return [];
    } finally {
      isLoadingMore.value = false;
    }
  }

  async function fetchCommitFiles(path: string, commitHash: string): Promise<FileChange[]> {
    try {
      const files = await invoke<FileChange[]>('get_commit_files', { path, commitHash });
      return files;
    } catch (e) {
      error.value = String(e);
      return [];
    }
  }

  async function fetchCommitDiffFiles(path: string, commitHash: string): Promise<FileChange[]> {
    try {
      const files = await invoke<FileChange[]>('get_commit_files', { path, commitHash });
      commitDiffFiles.value = files;
      return files;
    } catch (e) {
      error.value = String(e);
      return [];
    }
  }

  async function fetchDiff(path: string, filePath: string, commitHash?: string): Promise<string> {
    try {
      const diff = await invoke<string>('get_diff', { path, filePath, commitHash });
      diffContent.value = diff;
      return diff;
    } catch (e) {
      error.value = String(e);
      return '';
    }
  }

  async function fetchBranches(path: string): Promise<BranchInfo[]> {
    if (!repoInfo.value?.is_repo) return [];

    try {
      const branchList = await invoke<BranchInfo[]>('get_branches', { path });
      branches.value = branchList;
      return branchList;
    } catch (e) {
      error.value = String(e);
      return [];
    }
  }

  async function checkoutBranch(path: string, branch: string): Promise<boolean> {
    try {
      await invoke('checkout_branch', { path, branch });
      await refreshRepoInfo(path);
      await fetchStatus(path);
      await fetchBranches(path);
      return true;
    } catch (e) {
      error.value = String(e);
      return false;
    }
  }

  function getWorkdir(): string {
    return repoInfo.value?.workdir || '';
  }

  function clearSelection() {
    selectedStagedFiles.value.clear();
    selectedModifiedFiles.value.clear();
    selectedUntrackedFiles.value.clear();
  }

  async function refresh(path: string) {
    // Clear old state when switching repos
    commitHistory.value = [];
    branches.value = [];
    selectedCommit.value = null;
    commitDiffFiles.value = [];
    diffContent.value = '';
    hasMoreCommits.value = true;

    await refreshRepoInfo(path);
    if (repoInfo.value?.is_repo) {
      // Load status first (most important), then history and branches in background
      await fetchStatus(path);
      // Load history and branches in parallel after status is ready
      fetchHistory(path);
      fetchBranches(path);
      // Detect git account in background
      detectForRepo(path);
    }
  }

  return {
    // State
    repoInfo,
    repoStatus,
    commitHistory,
    branches,
    currentBranch,
    isLoading,
    isLoadingMore,
    hasMoreCommits,
    error,
    selectedStagedFiles,
    selectedModifiedFiles,
    selectedUntrackedFiles,
    showDiff,
    diffContent,
    selectedCommit,
    commitDiffFiles,
    // Account state
    accounts,
    currentAccountId,
    currentAccount,
    isDetectingAccount,
    // Account methods
    isEmailDuplicated,
    addAccount,
    removeAccount,
    selectAccount,
    detectForRepo,
    setLocalAccount,
    // Actions
    refreshRepoInfo,
    initRepo,
    fetchStatus,
    stageFiles,
    unstageFiles,
    stageAll,
    unstageAll,
    commit,
    fetchHistory,
    fetchMoreHistory,
    fetchCommitFiles,
    fetchCommitDiffFiles,
    fetchDiff,
    fetchBranches,
    checkoutBranch,
    getWorkdir,
    clearSelection,
    refresh,
  };
});