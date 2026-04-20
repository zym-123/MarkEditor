<template>
  <div class="git-tab">
    <!-- Not a repo -->
    <div v-if="!gitStore.repoInfo?.is_repo" class="git-init">
      <div class="git-init-icon">🐙</div>
      <div class="git-init-text">未检测到 Git 仓库</div>
      <button class="git-btn git-btn-primary" @click="handleInit">
        📁 初始化 Git 仓库
      </button>
      <div class="git-init-hint">
        在当前文件夹初始化新的 Git 仓库<br>
        初始化后可进行版本控制
      </div>
    </div>

    <!-- Git repo -->
    <div v-else class="git-content">
      <!-- Branch & Repo Path -->
      <div class="git-header">
        <div class="git-branch">
          <span class="git-label">🌿 分支：</span>
          <select v-model="selectedBranch" class="git-select" @change="handleBranchChange">
            <option v-for="branch in gitStore.branches" :key="branch.name" :value="branch.name">
              {{ branch.name }}{{ branch.is_current ? ' ✓' : '' }}
            </option>
          </select>
        </div>
        <div class="git-repo-path" :title="gitStore.repoInfo.workdir">
          <span class="git-label">📂 仓库：</span>
          <span class="git-path-text">{{ gitStore.repoInfo.workdir }}</span>
        </div>
      </div>

      <!-- Status Summary -->
      <div class="git-status-summary">
        <template v-if="gitStore.repoStatus?.clean">
          <span class="git-status-clean">✅ 仓库干净，无需提交</span>
        </template>
        <template v-else>
          <span v-if="modifiedCount > 0" class="git-status-modified">
            🔀 {{ modifiedCount }} 个文件已修改
          </span>
          <span v-if="untrackedCount > 0" class="git-status-untracked">
            🆕 {{ untrackedCount }} 个新文件
          </span>
          <span v-if="stagedCount > 0" class="git-status-staged">
            📦 {{ stagedCount }} 个文件已暂存
          </span>
        </template>
      </div>

      <!-- Changes Area -->
      <div class="git-section">
        <div class="git-section-header" @click="toggleChangesExpanded">
          <span class="git-toggle">{{ changesExpanded ? '▼' : '▶' }}</span>
          <span class="git-section-title">🔄 变更</span>
          <span class="git-section-count">({{ allChanges.length }})</span>
        </div>
        <div v-show="changesExpanded" class="git-section-content">
          <div v-if="allChanges.length === 0" class="git-empty">
            没有变更
          </div>
          <div v-else class="git-file-list">
            <div
              v-for="file in allChanges"
              :key="file.path"
              class="git-file-item"
              :class="{ 'is-selected': isFileSelected(file.path) }"
              @contextmenu.prevent="showFileContextMenu($event, file)"
            >
              <input
                type="checkbox"
                :checked="isFileSelected(file.path)"
                class="git-checkbox"
                @click.stop
                @change="toggleFileSelection(file.path, file.status)"
              />
              <span class="git-file-status-dot" :class="getStatusClass(file.status)"></span>
              <span
                class="git-file-name"
                :title="file.path"
                @click="toggleFileSelection(file.path, file.status)"
                @dblclick="handleShowFileDiff(file)"
              >{{ file.name }}</span>
              <span class="git-file-status-text">{{ getStatusText(file.status) }}</span>
              <button
                class="git-file-diff-btn"
                @click.stop="handleShowFileDiff(file)"
                title="查看变化"
              >📄</button>
            </div>
          </div>
          <div class="git-section-actions">
            <button
              class="git-btn git-btn-small"
              :disabled="selectedFiles.size === 0"
              @click="handleStageSelected"
            >
              暂存选中
            </button>
            <button
              class="git-btn git-btn-small"
              @click="handleStageAll"
            >
              暂存全部
            </button>
          </div>
        </div>
      </div>

      <!-- Staged Area -->
      <div class="git-section">
        <div class="git-section-header" @click="toggleStagedExpanded">
          <span class="git-toggle">{{ stagedExpanded ? '▼' : '▶' }}</span>
          <span class="git-section-title">📦 暂存</span>
          <span class="git-section-count">({{ stagedCount }})</span>
        </div>
        <div v-show="stagedExpanded" class="git-section-content">
          <div v-if="stagedCount === 0" class="git-empty">
            暂存区为空
          </div>
          <div v-else class="git-file-list">
            <div
              v-for="file in gitStore.repoStatus?.staged_files || []"
              :key="file.path"
              class="git-file-item"
              @click="handleUnstageFile(file.path)"
              @contextmenu.prevent="showFileContextMenu($event, file)"
            >
              <span class="git-file-status-dot" :class="getStatusClass(file.status)"></span>
              <span class="git-file-name" :title="file.path">{{ file.name }}</span>
              <span class="git-file-status-text">{{ getStatusText(file.status) }}</span>
              <button
                class="git-file-diff-btn"
                @click.stop="handleShowFileDiff(file)"
                title="查看变化"
              >📄</button>
              <button class="git-file-remove" @click.stop="handleUnstageFile(file.path)" title="取消暂存">×</button>
            </div>
          </div>
          <div v-if="stagedCount > 0" class="git-section-actions">
            <button class="git-btn git-btn-small" @click="handleUnstageAll">
              重置暂存
            </button>
          </div>
        </div>
      </div>

      <!-- Commit Form -->
      <div v-if="stagedCount > 0" class="git-commit-form">
        <div class="git-commit-label">提交信息：</div>
        <textarea
          v-model="commitMessage"
          class="git-commit-input"
          placeholder="输入本次修改的说明..."
          rows="3"
        ></textarea>
        <div class="git-commit-hint">{{ stagedCount }} 个文件将被提交</div>
        <div class="git-commit-account" @click="showAccountModal = true">
          <span v-if="gitStore.currentAccount">
            <span class="git-account-icon">🧑</span>
            {{ gitStore.currentAccount.name }} &lt;{{ gitStore.currentAccount.email }}&gt;
            <span class="git-account-dropdown">▼</span>
          </span>
          <span v-else class="git-account-empty">
            未配置账号 点击设置
          </span>
        </div>
        <div class="git-commit-actions">
          <button class="git-btn git-btn-small" @click="handleUnstageAll">
            重置暂存
          </button>
          <button
            class="git-btn git-btn-primary"
            :disabled="!commitMessage.trim() || !gitStore.currentAccount"
            @click="handleCommit"
          >
            提交
          </button>
        </div>
      </div>

      <!-- Account Selector Modal -->
      <div v-if="showAccountModal" class="git-modal-mask" @click.self="showAccountModal = false">
        <div class="git-account-modal">
          <div class="git-modal-header">
            <span>选择提交账号</span>
            <button class="git-modal-close" @click="showAccountModal = false">×</button>
          </div>
          <div class="git-account-list">
            <div
              v-for="account in gitStore.accounts"
              :key="account.id"
              class="git-account-item"
              :class="{ 'is-current': account.id === gitStore.currentAccountId }"
              @click="handleSelectAccount(account.id)"
            >
              <div class="git-account-info">
                <span class="git-account-icon">🧑</span>
                <span class="git-account-name">{{ account.name }}</span>
                <span class="git-account-email">&lt;{{ account.email }}&gt;</span>
                <span v-if="account.id === gitStore.currentAccountId" class="git-account-check">✓</span>
              </div>
              <div class="git-account-source">
                {{ getAccountSourceText(account) }}
              </div>
            </div>
            <div v-if="gitStore.accounts.length === 0" class="git-account-empty-list">
              暂无账号，请添加
            </div>
          </div>
          <div class="git-account-divider">或</div>
          <button class="git-btn git-btn-add" @click="showAddAccountModal = true">
            + 添加新账号
          </button>
        </div>
      </div>

      <!-- Add Account Modal -->
      <div v-if="showAddAccountModal" class="git-modal-mask" @click.self="closeAddAccountModal">
        <div class="git-add-account-modal">
          <div class="git-modal-header">
            <span>添加新账号</span>
            <button class="git-modal-close" @click="closeAddAccountModal">×</button>
          </div>
          <div class="git-add-account-form">
            <div class="git-form-group">
              <label>用户名</label>
              <input
                v-model="newAccountName"
                type="text"
                class="git-input"
                placeholder="输入用户名"
              />
            </div>
            <div class="git-form-group">
              <label>邮箱</label>
              <input
                v-model="newAccountEmail"
                type="email"
                class="git-input"
                placeholder="输入邮箱"
                @blur="checkEmailDuplicate"
              />
              <div v-if="emailDuplicateHint" class="git-form-hint-email">
                ⚠️ {{ emailDuplicateHint }}
              </div>
            </div>
          </div>
          <div class="git-modal-footer">
            <button class="git-btn" @click="closeAddAccountModal">取消</button>
            <button
              class="git-btn git-btn-primary"
              :disabled="!newAccountName.trim() || !newAccountEmail.trim() || !!emailDuplicateHint"
              @click="handleAddAccount"
            >
              保存
            </button>
          </div>
        </div>
      </div>

      <!-- Context Menu -->
      <div
        v-if="contextMenu.visible"
        class="git-context-menu"
        :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }"
      >
        <div class="git-context-menu-item" @click.stop="openFileFromContextMenu">
          编辑
        </div>
      </div>

      <!-- Commit History -->
      <div class="git-section git-history">
        <div class="git-section-header" @click="toggleHistoryExpanded">
          <span class="git-toggle">{{ historyExpanded ? '▼' : '▶' }}</span>
          <span class="git-section-title">📜 提交历史</span>
        </div>
        <div v-show="historyExpanded" class="git-section-content" ref="historyListRef" @scroll="handleHistoryScroll">
          <div v-if="gitStore.commitHistory.length === 0" class="git-empty">
            暂无提交记录
          </div>
          <div v-else class="git-commit-list">
            <div
              v-for="commit in gitStore.commitHistory"
              :key="commit.hash"
              class="git-commit-item"
            >
              <div class="git-commit-info">
                <span class="git-commit-hash" :title="commit.hash">{{ commit.short_hash }}</span>
                <span class="git-commit-time">{{ commit.relative_date }}</span>
                <span class="git-commit-files">{{ commit.files_count }} 个文件</span>
              </div>
              <div class="git-commit-message">{{ commit.message }}</div>
              <div class="git-commit-actions">
                <button class="git-btn git-btn-tiny" @click="handleShowDiff(commit)">
                  查看 diff
                </button>
              </div>
            </div>
            <div v-if="gitStore.isLoadingMore" class="git-loading-more">
              加载更多...
            </div>
            <div v-else-if="!gitStore.hasMoreCommits && gitStore.commitHistory.length > 0" class="git-no-more">
              已加载全部 {{ gitStore.commitHistory.length }} 条记录
            </div>
          </div>
        </div>
      </div>

      <!-- Diff Modal -->
      <div v-if="showDiffModal" class="git-diff-modal" @click.self="closeDiffModal">
        <div class="git-diff-content">
          <div class="git-diff-header">
            <div class="git-diff-header-left">
              <button v-if="selectedDiffFile" class="git-diff-back" @click="clearSelectedDiffFile">← 返回</button>
              <span>{{ diffTitle }}</span>
            </div>
            <button class="git-diff-close" @click="closeDiffModal">×</button>
          </div>
          <!-- File List View (only when viewing commit diff with multiple files) -->
          <div v-if="!selectedDiffFile && !viewingSingleFile" class="git-diff-files">
            <div
              v-for="file in gitStore.commitDiffFiles"
              :key="file.path"
              class="git-diff-file-item"
              :class="getFileChangeClass(file.change_type)"
              @click="handleSelectDiffFile(file)"
            >
              <span class="git-diff-file-icon">{{ getFileChangeIcon(file.change_type) }}</span>
              <span class="git-diff-file-name">{{ file.path }}</span>
              <span class="git-diff-file-type">{{ getFileChangeText(file.change_type) }}</span>
            </div>
          </div>
          <!-- File Diff View -->
          <div v-else class="git-diff-body">
            <div
              v-for="(line, i) in diffLines"
              :key="i"
              class="diff-line"
              :class="getDiffLineClass(line)"
            >{{ line }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useGitStore, type FileInfo, type FileChange } from '../../stores/git';
import { useFileTreeStore } from '../../stores/fileTree';
import { useTabsStore } from '../../stores/tabs';
import { useDocumentStore } from '../../stores/document';

const gitStore = useGitStore();
const fileTreeStore = useFileTreeStore();
const tabsStore = useTabsStore();
const documentStore = useDocumentStore();

const selectedBranch = ref('');
const commitMessage = ref('');
const showDiffModal = ref(false);
const diffTitle = ref('');
const changesExpanded = ref(true);
const stagedExpanded = ref(true);
const historyExpanded = ref(true);
const historyListRef = ref<HTMLElement | null>(null);
const selectedDiffFile = ref<FileChange | null>(null);
const viewingSingleFile = ref(false); // True when viewing a single file diff from changes area (not commit)

// Account modal state
const showAccountModal = ref(false);
const showAddAccountModal = ref(false);
const newAccountName = ref('');
const newAccountEmail = ref('');
const emailDuplicateHint = ref('');

// Context menu state
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  file: null as FileInfo | null,
});

// Selection state
const selectedFiles = ref<Map<string, string>>(new Map()); // path -> status

const stagedCount = computed(() => gitStore.repoStatus?.staged_files.length || 0);
const modifiedCount = computed(() => gitStore.repoStatus?.modified_files.length || 0);
const untrackedCount = computed(() => gitStore.repoStatus?.untracked_files.length || 0);

const allChanges = computed(() => {
  const changes: FileInfo[] = [];
  const status = gitStore.repoStatus;
  if (status) {
    changes.push(...status.modified_files);
    changes.push(...status.untracked_files);
  }
  return changes;
});

// Diff display
const diffLines = computed(() => {
  return gitStore.diffContent.split('\n');
});

function getDiffLineClass(line: string) {
  if (line.startsWith('+')) return 'diff-added';
  if (line.startsWith('-')) return 'diff-deleted';
  if (line.startsWith('@@')) return 'diff-hunk';
  if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) return 'diff-header';
  return '';
}

function getFileChangeClass(changeType: string) {
  switch (changeType) {
    case 'added': return 'file-added';
    case 'deleted': return 'file-deleted';
    case 'modified': return 'file-modified';
    case 'renamed': return 'file-renamed';
    default: return 'file-modified';
  }
}

function getFileChangeIcon(changeType: string) {
  switch (changeType) {
    case 'added': return '➕';
    case 'deleted': return '➖';
    case 'modified': return '📝';
    case 'renamed': return '📛';
    default: return '📝';
  }
}

function getFileChangeText(changeType: string) {
  switch (changeType) {
    case 'added': return '新增';
    case 'deleted': return '删除';
    case 'modified': return '修改';
    case 'renamed': return '重命名';
    default: return '修改';
  }
}

async function handleSelectDiffFile(file: FileChange) {
  if (!fileTreeStore.currentFolder) return;

  // Check if file is deleted - can't show diff for deleted files
  if (file.change_type === 'deleted') {
    selectedDiffFile.value = file;
    gitStore.diffContent = '删除文件';
    diffTitle.value = `${file.path} 的变化`;
    showDiffModal.value = true;
    return;
  }

  selectedDiffFile.value = file;
  await gitStore.fetchDiff(fileTreeStore.currentFolder.path, file.path, gitStore.selectedCommit?.hash);
  diffTitle.value = `${file.path} 的变化`;
}

function clearSelectedDiffFile() {
  selectedDiffFile.value = null;
  diffTitle.value = gitStore.selectedCommit ? `${gitStore.selectedCommit.short_hash} - ${gitStore.selectedCommit.message}` : '变更详情';
}

function getStatusClass(status: string) {
  switch (status) {
    case 'modified': return 'modified';
    case 'deleted': return 'deleted';
    case 'staged': return 'staged';
    case 'staged_added': return 'staged-added';
    case 'staged_modified': return 'staged-modified';
    case 'staged_deleted': return 'staged-deleted';
    case 'staged_renamed': return 'staged-renamed';
    case 'untracked': return 'untracked';
    default: return '';
  }
}

function getStatusText(status: string) {
  switch (status) {
    case 'modified': return '已修改';
    case 'deleted': return '已删除';
    case 'staged': return '已暂存';
    case 'staged_added': return '新增';
    case 'staged_modified': return '修改';
    case 'staged_deleted': return '删除';
    case 'staged_renamed': return '重命名';
    case 'untracked': return '新文件';
    default: return status;
  }
}

function isFileSelected(path: string) {
  return selectedFiles.value.has(path);
}

function toggleFileSelection(path: string, status: string) {
  if (selectedFiles.value.has(path)) {
    selectedFiles.value.delete(path);
  } else {
    selectedFiles.value.set(path, status);
  }
}

async function handleStageSelected() {
  const files = Array.from(selectedFiles.value.keys());
  if (files.length === 0) return;

  await gitStore.stageFiles(fileTreeStore.currentFolder?.path || '', files);
  selectedFiles.value.clear();
}

async function handleStageAll() {
  await gitStore.stageAll(fileTreeStore.currentFolder?.path || '');
}

async function handleUnstageFile(path: string) {
  await gitStore.unstageFiles(fileTreeStore.currentFolder?.path || '', [path]);
}

async function handleUnstageAll() {
  await gitStore.unstageAll(fileTreeStore.currentFolder?.path || '');
}

async function handleCommit() {
  if (!commitMessage.value.trim()) return;

  // Check if account is configured
  if (!gitStore.currentAccount) {
    showAccountModal.value = true;
    return;
  }

  const result = await gitStore.commit(
    fileTreeStore.currentFolder?.path || '',
    commitMessage.value
  );

  if (result) {
    commitMessage.value = '';
    alert(`提交成功：${result.substring(0, 7)}`);
  } else if (gitStore.error) {
    alert(`提交失败：${gitStore.error}`);
  }
}

async function handleBranchChange() {
  if (selectedBranch.value !== gitStore.currentBranch) {
    const confirmed = confirm('切换分支会丢失当前未提交的修改，是否继续？');
    if (confirmed) {
      await gitStore.checkoutBranch(fileTreeStore.currentFolder?.path || '', selectedBranch.value);
    } else {
      selectedBranch.value = gitStore.currentBranch;
    }
  }
}

async function handleInit() {
  if (!fileTreeStore.currentFolder) {
    alert('请先打开一个文件夹');
    return;
  }
  await gitStore.initRepo(fileTreeStore.currentFolder.path);
}

function getAccountSourceText(account: any): string {
  switch (account.source) {
    case 'local':
      return `来源: 本地配置${account.repoPath ? ' (' + account.repoPath + ')' : ''}`;
    case 'global':
      return '来源: 全局配置';
    case 'manual':
      return '来源: 手动添加';
    default:
      return '';
  }
}

function handleSelectAccount(id: string) {
  gitStore.selectAccount(id);
  showAccountModal.value = false;
}

function checkEmailDuplicate() {
  if (!newAccountEmail.value.trim()) {
    emailDuplicateHint.value = '';
    return;
  }
  const existing = gitStore.accounts.find(
    a => a.email.toLowerCase() === newAccountEmail.value.trim().toLowerCase()
  );
  if (existing) {
    emailDuplicateHint.value = `该邮箱已存在，将切换到已有账号（${existing.name}）`;
  } else {
    emailDuplicateHint.value = '';
  }
}

async function handleAddAccount() {
  if (!newAccountName.value.trim() || !newAccountEmail.value.trim()) return;
  if (emailDuplicateHint.value) return;

  const repoPath = fileTreeStore.currentFolder?.path;
  if (repoPath) {
    // Add to git local config
    const success = await gitStore.setLocalAccount(repoPath, newAccountName.value.trim(), newAccountEmail.value.trim());
    if (success) {
      closeAddAccountModal();
    } else {
      alert('添加账号失败：' + gitStore.error);
    }
  } else {
    // No repo, just add to local list
    gitStore.addAccount(newAccountName.value.trim(), newAccountEmail.value.trim(), 'manual');
    const account = gitStore.accounts.find(a => a.email === newAccountEmail.value.trim());
    if (account) {
      gitStore.selectAccount(account.id);
    }
    closeAddAccountModal();
  }
}

function closeAddAccountModal() {
  showAddAccountModal.value = false;
  newAccountName.value = '';
  newAccountEmail.value = '';
  emailDuplicateHint.value = '';
}

async function handleShowDiff(commit: any) {
  if (!fileTreeStore.currentFolder) return;
  gitStore.selectedCommit = commit;
  await gitStore.fetchCommitDiffFiles(fileTreeStore.currentFolder.path, commit.hash);
  selectedDiffFile.value = null;
  viewingSingleFile.value = false;
  diffTitle.value = `${commit.short_hash} - ${commit.message}`;
  showDiffModal.value = true;
}

async function handleShowFileDiff(file: any) {
  if (!fileTreeStore.currentFolder) return;

  viewingSingleFile.value = true;
  selectedDiffFile.value = null;

  // Check if file is deleted - can't show diff for deleted files
  if (file.status === 'deleted' || file.status === 'staged_deleted') {
    gitStore.diffContent = '删除文件';
    diffTitle.value = `${file.name} 的变化`;
    showDiffModal.value = true;
    return;
  }

  await gitStore.fetchDiff(fileTreeStore.currentFolder.path, file.path, undefined);
  diffTitle.value = `${file.name} 的变化`;
  showDiffModal.value = true;
}

function closeDiffModal() {
  showDiffModal.value = false;
  selectedDiffFile.value = null;
  viewingSingleFile.value = false;
  gitStore.selectedCommit = null;
}

function hideContextMenu() {
  contextMenu.value.visible = false;
  contextMenu.value.file = null;
  document.removeEventListener('click', hideContextMenu);
}

async function openFileFromContextMenu() {
  if (!contextMenu.value.file) return;
  const file = contextMenu.value.file;

  // Can't open deleted files
  if (file.status === 'deleted' || file.status === 'staged_deleted') {
    hideContextMenu();
    return;
  }

  // Get the workdir (absolute path to repo root)
  const workdir = gitStore.repoInfo?.workdir;
  if (!workdir) {
    hideContextMenu();
    return;
  }

  // Build absolute path - file.path from git is relative like "subdir/test.md"
  // workdir is like "F:\notes" (backslash on Windows) or "F:/note" (forward slash)
  // Rust's read_directory returns backslashes on Windows, so we need to match that
  const useBackslash = workdir.includes('\\') || /^[A-Z]:/.test(workdir);
  const pathSeparator = useBackslash ? '\\' : '/';
  const normalizedWorkdir = workdir.replace(/[\/\\]+$/, ''); // Remove trailing slashes
  const normalizedFilePath = file.path.replace(/[\/\\]+/g, pathSeparator); // Normalize separators
  const absolutePath = normalizedWorkdir + pathSeparator + normalizedFilePath;

  // Find the last path separator in the absolute path
  const lastSlashIndex = Math.max(
    absolutePath.lastIndexOf('/'),
    absolutePath.lastIndexOf('\\')
  );
  const parentPath = absolutePath.substring(0, lastSlashIndex);
  const fileName = file.name;

  // Open parent directory in file tree
  await fileTreeStore.openFolder(parentPath);

  // Read and open the file
  try {
    const result = await fileTreeStore.readFileContentWithMtime(absolutePath);
    tabsStore.openTab(absolutePath, fileName, result.content, result.modified_time);
    documentStore.loadContent(result.content, absolutePath, result.modified_time);
  } catch (e) {
    console.error('Failed to open file:', e);
  }

  hideContextMenu();
}

function showFileContextMenu(event: MouseEvent, file: FileInfo) {
  // Don't show context menu for deleted files
  if (file.status === 'deleted') return;

  event.preventDefault();
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    file,
  };
  document.addEventListener('click', hideContextMenu);
}

function toggleChangesExpanded() {
  changesExpanded.value = !changesExpanded.value;
}

function toggleStagedExpanded() {
  stagedExpanded.value = !stagedExpanded.value;
}

function toggleHistoryExpanded() {
  historyExpanded.value = !historyExpanded.value;
}

function handleHistoryScroll() {
  const el = historyListRef.value;
  if (!el) return;

  // When scrolled to bottom (within 50px), load more
  const threshold = 50;
  const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
  if (remaining < threshold) {
    const path = fileTreeStore.currentFolder?.path;
    if (path && gitStore.hasMoreCommits && !gitStore.isLoadingMore) {
      gitStore.fetchMoreHistory(path);
    }
  }
}

// Watch for branch changes
watch(() => gitStore.currentBranch, (newBranch) => {
  selectedBranch.value = newBranch;
});

// Refresh when folder path changes
watch(() => fileTreeStore.currentFolder?.path, async (newPath, oldPath) => {
  if (newPath && newPath !== oldPath) {
    await gitStore.refresh(newPath);
  }
});

// Initial refresh on mount
onMounted(async () => {
  const path = fileTreeStore.currentFolder?.path;
  if (path) {
    await gitStore.refresh(path);
  }
});
</script>

<style scoped>
.git-tab {
  padding: 12px;
}

/* Init State */
.git-init {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
}

.git-init-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.git-init-text {
  font-size: 14px;
  color: var(--color-text);
  opacity: 0.7;
  margin-bottom: 16px;
}

.git-init-hint {
  font-size: 12px;
  color: var(--color-text);
  opacity: 0.5;
  margin-top: 12px;
}

/* Git Content */
.git-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Header */
.git-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.git-branch,
.git-repo-path {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.git-label {
  color: var(--color-text);
  opacity: 0.7;
}

.git-select {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 13px;
}

.git-path-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text);
  opacity: 0.7;
  font-size: 12px;
}

/* Status Summary */
.git-status-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 12px;
  background: var(--color-hover);
  border-radius: 6px;
  font-size: 13px;
}

.git-status-clean {
  color: #22c55e;
}

.git-status-modified {
  color: #f59f00;
}

.git-status-untracked {
  color: #22c55e;
}

.git-status-staged {
  color: #3b82f6;
}

/* Sections */
.git-section {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  overflow: hidden;
}

.git-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--color-hover);
  cursor: pointer;
  font-size: 13px;
}

.git-toggle {
  font-size: 10px;
  opacity: 0.5;
}

.git-section-title {
  flex: 1;
}

.git-section-count {
  opacity: 0.6;
}

.git-section-content {
  max-height: 200px;
  overflow-y: auto;
}

.git-section-actions {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--color-border);
}

/* File List */
.git-file-list {
  padding: 4px 0;
}

.git-file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
  transition: background-color 0.15s;
}

.git-file-item:hover {
  background: var(--color-hover);
}

.git-file-item.is-selected {
  background: var(--color-selection);
}

.git-checkbox {
  width: 14px;
  height: 14px;
  cursor: pointer;
}

.git-file-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.git-file-status-dot.modified {
  background: #f59f00;
}

.git-file-status-dot.staged {
  background: #3b82f6;
}

.git-file-status-dot.untracked {
  background: #22c55e;
}

.git-file-status-dot.deleted {
  background: #ef4444;
}

.git-file-status-dot.staged {
  background: #3b82f6;
}

.git-file-status-dot.staged-added {
  background: #22c55e;
}

.git-file-status-dot.staged-modified {
  background: #f59f00;
}

.git-file-status-dot.staged-deleted {
  background: #ef4444;
}

.git-file-status-dot.staged-renamed {
  background: #a855f7;
}

.git-file-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-file-status-text {
  font-size: 12px;
  opacity: 0.6;
  margin-left: auto;
  margin-right: 8px;
}

.git-file-diff-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  font-size: 14px;
  cursor: pointer;
  opacity: 0;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.git-file-item:hover .git-file-diff-btn {
  opacity: 0.6;
}

.git-file-diff-btn:hover {
  opacity: 1 !important;
  background: var(--color-hover);
}

.git-file-remove {
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: var(--color-text);
  font-size: 14px;
  cursor: pointer;
  opacity: 0.5;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.git-file-remove:hover {
  opacity: 1;
  background: var(--color-hover);
}

.git-empty {
  padding: 16px;
  text-align: center;
  color: var(--color-text);
  opacity: 0.5;
  font-size: 13px;
}

/* Buttons */
.git-btn {
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s;
  background: var(--color-hover);
  color: var(--color-text);
}

.git-btn:hover:not(:disabled) {
  background: var(--color-border);
}

.git-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.git-btn-primary {
  background: var(--color-accent);
  color: white;
}

.git-btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

.git-btn-small {
  padding: 4px 8px;
  font-size: 12px;
}

.git-btn-tiny {
  padding: 2px 6px;
  font-size: 11px;
}

/* Commit Form */
.git-commit-form {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.git-commit-label {
  font-size: 13px;
  color: var(--color-text);
}

.git-commit-input {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 13px;
  resize: vertical;
  font-family: inherit;
  box-sizing: border-box;
}

.git-commit-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.git-commit-hint {
  font-size: 12px;
  color: var(--color-text);
  opacity: 0.6;
}

.git-commit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* History */
.git-history .git-section-content {
  max-height: 300px;
  overflow-y: auto;
}

.git-commit-list {
  padding: 4px 0;
}

.git-commit-item {
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
}

.git-commit-item:last-child {
  border-bottom: none;
}

.git-commit-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  margin-bottom: 4px;
}

.git-commit-hash {
  font-family: var(--font-mono);
  color: var(--color-accent);
}

.git-commit-time {
  color: var(--color-text);
  opacity: 0.6;
}

.git-commit-files {
  color: var(--color-text);
  opacity: 0.5;
}

.git-commit-message {
  font-size: 13px;
  color: var(--color-text);
  margin-bottom: 4px;
}

.git-commit-actions {
  display: flex;
  gap: 8px;
}

.git-loading-more {
  text-align: center;
  padding: 12px;
  color: var(--color-text);
  opacity: 0.6;
  font-size: 13px;
}

.git-no-more {
  text-align: center;
  padding: 12px;
  color: var(--color-text);
  opacity: 0.4;
  font-size: 12px;
}

/* Diff Modal */
.git-diff-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.git-diff-content {
  width: 80%;
  max-width: 800px;
  max-height: 80%;
  background: var(--color-bg);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.git-diff-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  font-size: 14px;
  font-weight: 500;
}

.git-diff-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.git-diff-back {
  padding: 4px 8px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: transparent;
  color: var(--color-text);
  font-size: 12px;
  cursor: pointer;
}

.git-diff-back:hover {
  background: var(--color-hover);
}

.git-diff-close {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  font-size: 18px;
  cursor: pointer;
  color: var(--color-text);
  opacity: 0.6;
  border-radius: 4px;
}

/* Context Menu */
.git-context-menu {
  position: fixed;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  min-width: 100px;
  padding: 4px 0;
}

.git-context-menu-item {
  padding: 8px 16px;
  cursor: pointer;
  font-size: 13px;
  color: var(--color-text);
}

.git-context-menu-item:hover {
  background: var(--color-hover);
}

.git-diff-close:hover {
  opacity: 1;
  background: var(--color-hover);
}

.git-diff-body {
  flex: 1;
  overflow: auto;
  padding: 8px 0;
  margin: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
}

.diff-line {
  padding: 1px 16px;
  white-space: pre-wrap;
  word-break: break-all;
}

.diff-added {
  background-color: rgba(34, 197, 94, 0.2);
  color: #22c55e;
}

.diff-deleted {
  background-color: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.diff-hunk {
  background-color: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
  font-weight: 500;
}

.diff-header {
  color: #888;
}

/* Diff Files List */
.git-diff-files {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.git-diff-file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 4px;
  font-size: 13px;
  transition: background-color 0.15s;
}

.git-diff-file-item:hover {
  opacity: 0.85;
}

.git-diff-file-icon {
  font-size: 14px;
}

.git-diff-file-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.git-diff-file-type {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 3px;
  opacity: 0.8;
}

.file-added {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.file-added .git-diff-file-type {
  background: rgba(34, 197, 94, 0.2);
}

.file-deleted {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.file-deleted .git-diff-file-type {
  background: rgba(239, 68, 68, 0.2);
}

.file-modified {
  background: rgba(59, 130, 246, 0.1);
  color: #3b82f6;
}

.file-modified .git-diff-file-type {
  background: rgba(59, 130, 246, 0.15);
}

.file-renamed {
  background: rgba(168, 85, 247, 0.1);
  color: #a855f7;
}

.file-renamed .git-diff-file-type {
  background: rgba(168, 85, 247, 0.15);
}

/* Account styles */
.git-commit-account {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--color-text);
  opacity: 0.6;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background-color 0.15s;
}

.git-commit-account:hover {
  background: var(--color-hover);
}

.git-account-icon {
  margin-right: 6px;
}

.git-account-dropdown {
  margin-left: 6px;
  opacity: 0.6;
  font-size: 10px;
}

.git-account-empty {
  color: #e6a23c;
  font-size: 12px;
}

.git-account-empty:hover {
  text-decoration: underline;
}

.git-commit-hint {
  font-size: 12px;
  color: var(--color-text);
  opacity: 0.6;
}

.git-commit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* Account Modal */
.git-modal-mask {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.git-account-modal {
  width: 400px;
  max-height: 500px;
  background: var(--color-bg);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.git-add-account-modal {
  width: 360px;
  background: var(--color-bg);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.git-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  font-size: 14px;
  font-weight: 500;
}

.git-modal-close {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  font-size: 18px;
  cursor: pointer;
  color: var(--color-text);
  opacity: 0.6;
  border-radius: 4px;
}

.git-modal-close:hover {
  opacity: 1;
  background: var(--color-hover);
}

.git-account-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.git-account-item {
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 4px;
  transition: background-color 0.15s;
}

.git-account-item:hover {
  background: var(--color-hover);
}

.git-account-item.is-current {
  background: var(--color-selection);
  border: 1px solid var(--color-accent);
}

.git-account-info {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.git-account-name {
  font-weight: 500;
}

.git-account-email {
  color: var(--color-text);
  opacity: 0.7;
  font-size: 13px;
}

.git-account-check {
  margin-left: auto;
  color: var(--color-accent);
}

.git-account-source {
  font-size: 11px;
  color: var(--color-text);
  opacity: 0.5;
  margin-left: 26px;
}

.git-account-empty-list {
  text-align: center;
  padding: 24px;
  color: var(--color-text);
  opacity: 0.5;
}

.git-account-divider {
  text-align: center;
  padding: 8px;
  color: var(--color-text);
  opacity: 0.5;
  font-size: 12px;
}

.git-btn-add {
  margin: 8px 16px 16px;
  width: calc(100% - 32px);
}

.git-add-account-form {
  padding: 16px;
}

.git-form-group {
  margin-bottom: 12px;
}

.git-form-group label {
  display: block;
  font-size: 12px;
  margin-bottom: 4px;
  color: var(--color-text);
  opacity: 0.7;
}

.git-input {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 13px;
  box-sizing: border-box;
}

.git-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.git-form-hint-email {
  font-size: 12px;
  color: #e6a23c;
  margin-top: 4px;
}

.git-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--color-border);
}
</style>
