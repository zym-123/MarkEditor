<template>
  <div class="toolbar" @keydown="handleKeydown">
    <div class="toolbar-group">
      <button type="button" class="toolbar-btn" title="新建 (Ctrl+N)" @click="newFile">
        <span class="icon file-icon">📄</span>
      </button>
      <button type="button" class="toolbar-btn" title="新建文件夹" @click="newFolder" :disabled="!fileTreeStore.currentFolder">
        <span class="icon folder-icon">📁</span>
      </button>

      <!-- 打开按钮 - 带下拉菜单 -->
      <div
        class="dropdown-container"
        @mouseenter="handleMouseEnter"
        @mouseleave="handleMouseLeave"
      >
        <button type="button" class="toolbar-btn" title="打开 (Ctrl+O)" @click="openItem">
          <span class="icon">📂</span>
        </button>
        <div class="dropdown-menu" v-if="dropdownVisible">
          <button class="dropdown-item dropdown-item-action" @click="openFile">
            <span class="dropdown-item-icon">📄</span>
            <span>打开文件</span>
          </button>
          <button class="dropdown-item dropdown-item-action" @click="openFolder">
            <span class="dropdown-item-icon">📁</span>
            <span>打开文件夹</span>
          </button>
          <div class="dropdown-divider" v-if="settingsStore.recentFiles.length > 0"></div>
          <div class="dropdown-recent-list" v-if="settingsStore.recentFiles.length > 0">
            <div
              v-for="item in settingsStore.recentFiles"
              :key="item.path"
              class="dropdown-item"
              @click="openRecentItem(item)"
            >
              <span class="dropdown-item-icon">{{ item.isDirectory ? '📁' : '📄' }}</span>
              <span class="dropdown-item-name" :title="item.path">{{ item.name }}</span>
              <button
                class="dropdown-item-remove"
                @click.stop="removeRecentItem(item.path)"
                title="删除"
              >×</button>
            </div>
          </div>
          <div class="dropdown-divider" v-if="settingsStore.recentFiles.length > 0"></div>
          <button
            class="dropdown-item dropdown-item-clear"
            @click="clearRecentFiles"
            v-if="settingsStore.recentFiles.length > 0"
          >
            <span class="dropdown-item-icon">🗑️</span>
            <span>清空历史</span>
          </button>
        </div>
      </div>

      <button type="button" class="toolbar-btn" title="删除文件" @click="deleteCurrentFile" :disabled="!documentStore.filePath">
        <span class="icon">🗑️</span>
      </button>
      <button type="button" class="toolbar-btn" title="另存为" @click="saveFile">
        <span class="icon">💾</span>
      </button>
    </div>

    <div class="toolbar-divider"></div>

    <div class="toolbar-group">
      <button
        type="button"
        class="toolbar-btn"
        :class="{ 'is-disabled': !canUndo }"
        title="撤销 (Ctrl+Z)"
        @click="undo"
      >
        <span class="icon">↩</span>
      </button>
      <button
        type="button"
        class="toolbar-btn"
        :class="{ 'is-disabled': !canRedo }"
        title="重做 (Ctrl+Y)"
        @click="redo"
      >
        <span class="icon">↪</span>
      </button>
    </div>

    <div class="toolbar-spacer"></div>

    <div class="toolbar-group">
      <button
        class="toolbar-btn"
        title="切换主题"
        @click="toggleTheme"
      >
        <span class="icon">{{ isDark ? '☀️' : '🌙' }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { useSettingsStore } from '../../stores/settings';
import { useDocumentStore } from '../../stores/document';
import { useFileTreeStore } from '../../stores/fileTree';
import { useTabsStore } from '../../stores/tabs';

const settingsStore = useSettingsStore();
const documentStore = useDocumentStore();
const fileTreeStore = useFileTreeStore();
const tabsStore = useTabsStore();

const isDark = computed(() => {
  if (settingsStore.theme === 'dark') return true;
  if (settingsStore.theme === 'light') return false;
  return document.documentElement.hasAttribute('data-theme');
});

const canUndo = computed(() => documentStore.canUndo());
const canRedo = computed(() => documentStore.canRedo());

// 下拉菜单状态
const dropdownVisible = ref(false);
let hideTimeout: number | null = null;

function handleMouseEnter() {
  if (hideTimeout) {
    clearTimeout(hideTimeout);
    hideTimeout = null;
  }
  dropdownVisible.value = true;
}

function handleMouseLeave() {
  hideTimeout = window.setTimeout(() => {
    dropdownVisible.value = false;
  }, 150);
}

// 打开最近记录
async function openRecentItem(item: { path: string; isDirectory: boolean }) {
  dropdownVisible.value = false;
  try {
    if (item.isDirectory) {
      await fileTreeStore.openFolder(item.path);
    } else {
      const parentPath = getParentPath(item.path);
      if (parentPath) {
        await fileTreeStore.openFolder(parentPath);
      }
      const fileName = item.path.split(/[\\/]/).pop() || 'untitled.md';
      const result = await fileTreeStore.readFileContentWithMtime(item.path);
      const existingTab = tabsStore.tabs.find(t => t.filePath === item.path);
      if (existingTab) {
        tabsStore.activeTabId = existingTab.id;
        documentStore.loadContent(result.content, item.path, result.modified_time);
      } else {
        tabsStore.openTab(item.path, fileName, result.content, result.modified_time);
        documentStore.loadContent(result.content, item.path, result.modified_time);
      }
    }
  } catch {
    // 文件已删除，移除记录
    settingsStore.removeRecentFile(item.path);
  }
}

// 删除单条历史
function removeRecentItem(path: string) {
  settingsStore.removeRecentFile(path);
}

// 清空历史
function clearRecentFiles() {
  settingsStore.clearRecentFiles();
  dropdownVisible.value = false;
}

// 将 saveFile 暴露到 window，供 Editor 调用（无路径文件 Ctrl+S 触发另存为）
onMounted(() => {
  (window as any).__markEditorSaveFile = saveFile;
});

onUnmounted(() => {
  delete (window as any).__markEditorSaveFile;
});

function handleKeydown(event: KeyboardEvent) {
  // Ctrl+O: 打开
  if (event.ctrlKey && event.key === 'o') {
    event.preventDefault();
    openItem();
  }

  // Ctrl+N: 新建文件
  if (event.ctrlKey && event.key === 'n') {
    event.preventDefault();
    newFile();
  }

  // Ctrl+S: 保存
  if (event.ctrlKey && event.key === 's') {
    event.preventDefault();
    saveFile();
  }
}

// 打开文件
async function openFile() {
  dropdownVisible.value = false;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    multiple: false,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  if (selected) {
    const selectedPath = selected as string;
    settingsStore.addRecentFile(selectedPath, false);
    const parentPath = getParentPath(selectedPath);
    if (parentPath) {
      await fileTreeStore.openFolder(parentPath);
    }
    const fileName = selectedPath.split(/[\\/]/).pop() || 'untitled.md';
    const result = await fileTreeStore.readFileContentWithMtime(selectedPath);
    const existingTab = tabsStore.tabs.find(t => t.filePath === selectedPath);
    if (existingTab) {
      tabsStore.activeTabId = existingTab.id;
      documentStore.loadContent(result.content, selectedPath, result.modified_time);
    } else {
      tabsStore.openTab(selectedPath, fileName, result.content, result.modified_time);
      documentStore.loadContent(result.content, selectedPath, result.modified_time);
    }
  }
}

// 打开文件夹
async function openFolder() {
  dropdownVisible.value = false;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    directory: true,
    multiple: false,
  });
  if (selected) {
    const selectedPath = selected as string;
    settingsStore.addRecentFile(selectedPath, true);
    await fileTreeStore.openFolder(selectedPath);
  }
}

// 兼容旧调用（废弃）
async function openItem() {
  await openFile();
}

async function checkIsDirectory(path: string): Promise<boolean> {
  try {
    const { stat } = await import('@tauri-apps/plugin-fs');
    const info = await stat(path);
    return info.isDirectory;
  } catch {
    return false;
  }
}

function getParentPath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '');
  const lastSep = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  return normalized.substring(0, lastSep);
}

async function newFile() {
  // 如果有未保存的更改，提示用户
  if (documentStore.isDirty) {
    const { confirm } = await import('@tauri-apps/plugin-dialog');
    const confirmed = await confirm('当前文件有未保存的更改，是否新建文件？', {
      title: '未保存的更改',
      kind: 'warning',
    });
    if (!confirmed) return;
  }

  // 如果当前有打开的文件夹，在文件夹下创建新文件
  if (fileTreeStore.currentFolder) {
    const baseName = 'untitled.md';
    let fileName = baseName;
    let counter = 1;
    // 检查是否已存在
    const entries = fileTreeStore.currentFolder.entries;
    while (entries.some(e => e.name === fileName)) {
      fileName = `untitled${counter}.md`;
      counter++;
    }
    const filePath = `${fileTreeStore.currentFolder.path}\\${fileName}`;
    await fileTreeStore.writeFileContent(filePath, '');
    await fileTreeStore.openFolder(fileTreeStore.currentFolder.path);
    // 打开新文件到标签页
    const result = await fileTreeStore.readFileContentWithMtime(filePath);
    tabsStore.openTab(filePath, fileName, result.content, result.modified_time);
    documentStore.loadContent(result.content, filePath, result.modified_time);
  } else {
    // 在内存中创建新文件
    const id = tabsStore.createTab(null, 'untitled.md', '');
    documentStore.loadContent('', null, null);
  }
}

async function newFolder() {
  if (!fileTreeStore.currentFolder) return;

  const baseName = 'untitled';
  let folderName = baseName;
  let counter = 1;
  // 检查是否已存在
  const entries = fileTreeStore.currentFolder.entries;
  while (entries.some(e => e.name === folderName)) {
    folderName = `${baseName}${counter}`;
    counter++;
  }

  const newName = window.prompt('请输入文件夹名称：', folderName);
  if (!newName) return;

  // 检查是否已存在同名
  if (entries.some(e => e.name === newName)) {
    const { message } = await import('@tauri-apps/plugin-dialog');
    await message('已存在同名文件夹！', { title: '提示', kind: 'error' });
    return;
  }

  const folderPath = `${fileTreeStore.currentFolder.path}\\${newName}`;
  await fileTreeStore.createDirectory(folderPath);
}

async function deleteCurrentFile() {
  if (!documentStore.filePath) return;
  const { confirm } = await import('@tauri-apps/plugin-dialog');
  const confirmed = await confirm(`确定要删除文件 "${documentStore.filePath.split(/[\\/]/).pop()}" 吗？`, {
    title: '确认删除',
    kind: 'warning',
  });
  if (!confirmed) return;
  const filePath = documentStore.filePath;
  // 先关闭标签页
  tabsStore.closeByPath(filePath);
  await fileTreeStore.deleteFile(filePath);
  // 切换到活动标签
  if (tabsStore.activeTab) {
    documentStore.loadContent(
      tabsStore.activeTab.content,
      tabsStore.activeTab.filePath,
      tabsStore.activeTab.lastSaved
    );
  } else {
    documentStore.newDocument();
  }
}

async function saveFile() {
  // 弹出另存为对话框
  const { save } = await import('@tauri-apps/plugin-dialog');
  // 使用当前文件名作为默认名（如果有的话）
  const currentFileName = documentStore.filePath
    ? documentStore.filePath.split(/[\\/]/).pop()
    : 'untitled.md';
  const path = await save({
    filters: [{ name: 'Markdown', extensions: ['md'] }],
    defaultPath: currentFileName,
  });
  if (path) {
    const newName = path.split(/[\\/]/).pop() || 'untitled.md';
    await documentStore.saveFileAs(path);

    // 如果是从新文件保存，更新当前标签路径
    if (!tabsStore.activeTab?.filePath) {
      if (tabsStore.activeTabId) {
        tabsStore.updatePath(tabsStore.activeTabId, path, newName);
        tabsStore.updateLastSaved(tabsStore.activeTabId, Date.now());
      }
    } else {
      // 更新当前标签
      if (tabsStore.activeTabId) {
        tabsStore.updatePath(tabsStore.activeTabId, path, newName);
        tabsStore.updateLastSaved(tabsStore.activeTabId, Date.now());
      }
    }

    // 更新文件树到该目录
    const parentPath = getParentPath(path);
    if (parentPath) {
      await fileTreeStore.openFolder(parentPath);
    }
  }
}

function toggleTheme() {
  const newTheme = isDark.value ? 'light' : 'dark';
  settingsStore.setTheme(newTheme);
}

function undo() {
  documentStore.undo();
  // 同步更新 tabsStore
  if (tabsStore.activeTabId) {
    tabsStore.updateContent(tabsStore.activeTabId, documentStore.content);
  }
}

function redo() {
  documentStore.redo();
  // 同步更新 tabsStore
  if (tabsStore.activeTabId) {
    tabsStore.updateContent(tabsStore.activeTabId, documentStore.content);
  }
}
</script>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 12px;
  background: var(--color-bg);
  border-bottom: 1px solid var(--color-border);
  gap: 4px;
  position: relative;
  z-index: 100;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 2px;
}

.toolbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 4px;
  color: var(--color-text);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background-color 0.15s;
}

.toolbar-btn:hover {
  background: var(--color-hover);
}

.toolbar-btn .icon {
  font-size: 16px;
  position: relative;
}

.folder-icon::before {
  content: '+';
  position: absolute;
  top: -4px;
  left: 16px;
  font-size: 14px;
  font-weight: bold;
  color: var(--color-text);
}

.file-icon::before {
  content: '+';
  position: absolute;
  top: -4px;
  left: 16px;
  font-size: 14px;
  font-weight: bold;
  color: var(--color-text);
}

.toolbar-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.toolbar-divider {
  width: 1px;
  height: 20px;
  background: var(--color-border);
  margin: 0 8px;
}

.toolbar-spacer {
  flex: 1;
}

/* 下拉菜单 */
.dropdown-container {
  position: relative;
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 220px;
  max-height: 400px;
  overflow-y: auto;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  padding: 4px 0;
}

.dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--color-text);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  transition: background-color 0.15s;
}

.dropdown-item:hover {
  background: var(--color-hover);
}

.dropdown-item-action {
  font-weight: 500;
}

.dropdown-item-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.dropdown-item-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dropdown-item-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: var(--color-text);
  font-size: 14px;
  cursor: pointer;
  opacity: 0.5;
  border-radius: 3px;
  flex-shrink: 0;
}

.dropdown-item-remove:hover {
  opacity: 1;
  background: var(--color-hover);
}

.dropdown-divider {
  height: 1px;
  background: var(--color-border);
  margin: 4px 0;
}

.dropdown-recent-list {
  max-height: 280px;
  overflow-y: auto;
}

.dropdown-item-clear {
  color: var(--color-text);
  opacity: 0.8;
}

.dropdown-item-clear:hover {
  opacity: 1;
}
</style>
