<template>
  <div class="sidebar-wrapper">
    <button
      v-if="isCollapsed"
      class="expand-btn"
      @click="toggleCollapse"
      title="Show sidebar"
    >
      ›
    </button>
    <div class="sidebar" :class="{ 'is-collapsed': isCollapsed }">
      <div class="sidebar-header">
        <span class="folder-name" v-if="fileTreeStore.currentFolder">
          {{ fileTreeStore.currentFolder.name }}
        </span>
        <span class="folder-name" v-else>No folder opened</span>
        <button class="collapse-btn" @click="toggleCollapse" title="Hide sidebar">
          ‹
        </button>
      </div>

      <!-- Tabs - outside scrollable content -->
      <div class="sidebar-tabs" v-show="!isCollapsed">
        <button
          class="sidebar-tab"
          :class="{ 'is-active': activeTab === 'files' }"
          @click="activeTab = 'files'"
        >
          文件
        </button>
        <button
          class="sidebar-tab"
          :class="{ 'is-active': activeTab === 'outline' }"
          @click="activeTab = 'outline'"
        >
          大纲
        </button>
        <button
          class="sidebar-tab"
          :class="{ 'is-active': activeTab === 'git' }"
          @click="activeTab = 'git'"
        >
          Git
        </button>
      </div>

      <div class="sidebar-content" v-show="!isCollapsed">
        <!-- 文件列表 -->
        <div v-if="activeTab === 'files'">
          <div v-if="fileTreeStore.isLoading" class="loading">
            Loading...
          </div>
          <div v-else-if="fileTreeStore.error" class="error">
            {{ fileTreeStore.error }}
          </div>
          <div v-else-if="!fileTreeStore.currentFolder" class="empty">
            Click "Open Folder" to browse files
          </div>
          <div v-else class="file-tree">
          <!-- 返回上级目录 -->
          <div
            v-if="parentPath"
            class="tree-item tree-item-parent"
            @click="goToParent"
          >
            <span class="item-icon">📁</span>
            <span class="item-name">..</span>
          </div>
          <div
            v-for="entry in fileTreeStore.currentFolder.entries"
            :key="entry.path"
            class="tree-item"
            :class="{
              'is-dir': entry.is_dir,
              'is-active': entry.path === documentStore.filePath,
              'is-renaming': entry.path === renamingPath
            }"
            @click="handleClick(entry)"
            @contextmenu.prevent="showContextMenu($event, entry)"
          >
            <span class="item-icon">{{ entry.is_dir ? '📁' : '📄' }}</span>
            <input
              v-if="entry.path === renamingPath"
              ref="renameInputRef"
              v-model="renamingValue"
              class="rename-input"
              @click.stop
              @keydown.enter="confirmRename"
              @keydown.escape="cancelRename"
              @blur="confirmRename"
            />
            <span v-else class="item-name">{{ entry.name }}</span>
          </div>

          <!-- Context Menu -->
          <div
            v-if="contextMenu.visible"
            class="context-menu"
            :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }"
          >
            <div class="context-menu-item" @click.stop="openInExplorer">打开文件所在目录</div>
            <div class="context-menu-item" @click.stop="renameFromContextMenu">重命名</div>
            <div class="context-menu-item context-menu-item-danger" @click.stop="deleteFromContextMenu">删除</div>
          </div>
        </div>
        </div>

        <!-- 大纲 -->
        <div v-if="activeTab === 'outline'" class="outline-panel">
          <div v-if="!documentStore.content" class="empty">
            暂无内容
          </div>
          <div v-else-if="outlineItems.length === 0" class="empty">
            未找到标题
          </div>
          <div v-else class="outline-list">
            <div
              v-for="(item, index) in outlineItems"
              :key="index"
              class="outline-item"
              :class="`outline-level-${item.level}`"
              @click="scrollToOutlineItem(item)"
            >
              {{ item.text }}
            </div>
          </div>
        </div>

        <!-- Git -->
        <div v-if="activeTab === 'git'" class="git-panel">
          <GitTab />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watchEffect, watch } from 'vue';
import { useFileTreeStore, type FileEntry } from '../../stores/fileTree';
import { useDocumentStore } from '../../stores/document';
import { useTabsStore } from '../../stores/tabs';
import GitTab from './GitTab.vue';

const fileTreeStore = useFileTreeStore();
const documentStore = useDocumentStore();
const tabsStore = useTabsStore();
const isCollapsed = ref(false);
const activeTab = ref<'files' | 'outline' | 'git'>('files');

const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  entry: null as FileEntry | null,
});

const renamingPath = ref<string | null>(null);
const renamingValue = ref('');
const renameInputRef = ref<HTMLInputElement | null>(null);

// 监听 renamingPath 变化，自动聚焦输入框
watchEffect(async () => {
  if (renamingPath.value) {
    await nextTick();
    setTimeout(() => {
      const input = document.querySelector('.rename-input') as HTMLInputElement;
      input?.focus();
      input?.select();
    }, 10);
  }
});

// 监听活动标签变化，切换左侧文件目录
watch(() => tabsStore.activeTab, async (tab) => {
  if (tab && tab.filePath) {
    const folderPath = getFolderPath(tab.filePath);
    if (folderPath && folderPath !== fileTreeStore.currentFolder?.path) {
      await fileTreeStore.openFolder(folderPath);
    }
  }
});

// 从文件路径获取目录路径
function getFolderPath(filePath: string): string | null {
  const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (lastSep < 0) return null;
  let folder = filePath.substring(0, lastSep);
  // 如果是裸驱动器根目录（如 "F:"），需要补上反斜杠
  if (folder.length === 2 && folder.charAt(1) === ':') {
    folder += '\\';
  }
  return folder;
}

// 计算当前目录的父目录路径
const parentPath = computed(() => {
  if (!fileTreeStore.currentFolder) return null;
  const currentPath = fileTreeStore.currentFolder.path;
  // 移除末尾的路径分隔符
  const normalizedPath = currentPath.replace(/[\\/]$/, '');
  // 找到最后一个路径分隔符
  const lastSep = Math.max(normalizedPath.lastIndexOf('/'), normalizedPath.lastIndexOf('\\'));
  // 如果没有分隔符（如 "C:"），返回 null
  if (lastSep < 0) return null;
  // 计算父目录路径
  let parent = normalizedPath.substring(0, lastSep);
  // 如果父目录是裸驱动器根目录（如 "F:"），需要补上反斜杠变成 "F:\"
  if (parent.length === 2 && parent.charAt(1) === ':') {
    parent += '\\';
  }
  return parent;
});

// 大纲条目接口
interface OutlineItem {
  level: number;
  text: string;
  line: number;
}

// 提取文档大纲
const outlineItems = computed<OutlineItem[]>(() => {
  const content = documentStore.content;
  if (!content) return [];

  const regex = /^(#{1,6})\s+(.+)$/gm;
  const items: OutlineItem[] = [];
  let match;
  let lastIndex = 0;

  // 计算行号
  const lines = content.split('\n');
  let lineNumber = 0;
  const lineStarts: number[] = [0];

  for (let i = 0; i < lines.length; i++) {
    lineStarts.push(lineStarts[i] + lines[i].length + 1);
  }

  while ((match = regex.exec(content)) !== null) {
    const lineIndex = lineStarts.findIndex(start => start >= match!.index) - 1;
    items.push({
      level: match[1].length,
      text: match[2].trim(),
      line: Math.max(1, lineIndex),
    });
  }

  return items;
});

// 滚动到大纲条目
function scrollToOutlineItem(item: OutlineItem) {
  const content = documentStore.content;
  if (!content) return;

  // 计算该标题在内容中的位置
  const lines = content.split('\n');
  let charOffset = 0;
  for (let i = 0; i < item.line - 1; i++) {
    charOffset += lines[i].length + 1;
  }

  // 找到标题行
  const beforeTitle = content.substring(0, charOffset);
  const titleMatch = content.substring(charOffset).match(/^#{1,6}\s+.+$/m);
  if (!titleMatch) return;

  const titleStart = charOffset + titleMatch.index!;
  const titleEnd = titleStart + titleMatch[0].length;

  // 计算标题在渲染内容中的位置（通过在预览层中添加临时标记）
  const preview = document.querySelector('.editor-preview') as HTMLElement;
  if (!preview) return;

  // 获取预览内容的总高度
  const scrollHeight = preview.scrollHeight - preview.clientHeight;
  if (scrollHeight <= 0) return;

  // 估算标题的大致位置（按字符比例）
  const totalLength = content.length;
  const titlePosition = titleStart / totalLength;
  const targetScroll = titlePosition * scrollHeight;

  preview.scrollTop = targetScroll;
}

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value;
}

async function handleClick(entry: FileEntry) {
  if (entry.is_dir) {
    // 如果是目录，打开它
    await fileTreeStore.openFolder(entry.path);
  } else {
    // 如果是文件，读取内容并打开到标签页
    try {
      const result = await fileTreeStore.readFileContentWithMtime(entry.path);
      tabsStore.openTab(entry.path, entry.name, result.content, result.modified_time);
      documentStore.loadContent(result.content, entry.path, result.modified_time);
    } catch (e) {
      console.error('Failed to read file:', e);
      // 文件可能已被删除，刷新目录
      if (fileTreeStore.currentFolder) {
        await fileTreeStore.openFolder(fileTreeStore.currentFolder.path);
      }
      // 关闭对应的标签页
      tabsStore.closeByPath(entry.path);
      const { message } = await import('@tauri-apps/plugin-dialog');
      await message('该文件已被删除或不存在。', { title: '提示', kind: 'error' });
    }
  }
}

async function goToParent() {
  if (parentPath.value) {
    await fileTreeStore.openFolder(parentPath.value);
  }
}

function showContextMenu(event: MouseEvent, entry: FileEntry) {
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    entry,
  };
  document.addEventListener('click', hideContextMenu);
}

function hideContextMenu() {
  contextMenu.value.visible = false;
  contextMenu.value.entry = null;
  document.removeEventListener('click', hideContextMenu);
}

async function openInExplorer() {
  if (!contextMenu.value.entry) return;
  const entry = contextMenu.value.entry;

  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('show_in_explorer', { path: entry.path });

  hideContextMenu();
}

async function deleteFromContextMenu() {
  if (!contextMenu.value.entry) return;
  const entry = contextMenu.value.entry;

  const { confirm } = await import('@tauri-apps/plugin-dialog');
  const confirmed = await confirm(`确定要删除 "${entry.name}" 吗？${entry.is_dir ? '（目录及其内容将全部删除）' : ''}`, {
    title: '确认删除',
    kind: 'warning',
  });
  if (!confirmed) {
    hideContextMenu();
    return;
  }

  try {
    if (entry.is_dir) {
      await fileTreeStore.deleteDirectory(entry.path);
    } else {
      // 关闭对应的标签页
      tabsStore.closeByPath(entry.path);
      await fileTreeStore.deleteFile(entry.path);
    }
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
  } catch (e) {
    console.error('Failed to delete:', e);
  }
  hideContextMenu();
}

async function renameFromContextMenu() {
  if (!contextMenu.value.entry) return;
  const entry = contextMenu.value.entry;

  // 开始内联重命名
  renamingPath.value = entry.path;
  renamingValue.value = entry.name;
  hideContextMenu();
}

async function confirmRename() {
  if (!renamingPath.value) return;

  const entry = fileTreeStore.currentFolder?.entries.find(e => e.path === renamingPath.value);
  if (!entry) {
    cancelRename();
    return;
  }

  const newName = renamingValue.value.trim();
  if (!newName || newName === entry.name) {
    cancelRename();
    return;
  }

  // 检查是否已存在同名文件
  if (fileTreeStore.currentFolder?.entries.some(e => e.name === newName)) {
    const { message } = await import('@tauri-apps/plugin-dialog');
    await message('已存在同名文件！', { title: '提示', kind: 'error' });
    return;
  }

  try {
    const newPath = await fileTreeStore.renameFile(entry.path, newName);
    // 更新标签页
    const tab = tabsStore.findTabByPath(entry.path);
    if (tab && newPath) {
      tabsStore.updatePath(tab.id, newPath, newName);
    }
    // 更新 documentStore
    if (documentStore.filePath === entry.path && newPath) {
      documentStore.loadContent(documentStore.content, newPath, documentStore.lastSaved || null);
    }
  } catch (e) {
    console.error('Failed to rename file:', e);
  }

  renamingPath.value = null;
  renamingValue.value = '';
}

function cancelRename() {
  renamingPath.value = null;
  renamingValue.value = '';
}
</script>

<style scoped>
.sidebar-wrapper {
  display: flex;
  height: 100%;
}

.expand-btn {
  width: 24px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg);
  border: none;
  border-right: 1px solid var(--color-border);
  color: var(--color-text);
  font-size: 16px;
  cursor: pointer;
  flex-shrink: 0;
}

.expand-btn:hover {
  background: var(--color-hover);
}

.sidebar {
  width: 250px;
  min-width: 250px;
  height: 100%;
  background: var(--color-bg);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  transition: width 0.2s, min-width 0.2s;
  overflow: hidden;
}

.sidebar.is-collapsed {
  width: 0;
  min-width: 0;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border-bottom: 1px solid var(--color-border);
  height: 40px;
  box-sizing: border-box;
  flex-shrink: 0;
}

.folder-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.collapse-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--color-text);
  font-size: 14px;
  background: transparent;
  border: none;
  cursor: pointer;
  flex-shrink: 0;
}

.collapse-btn:hover {
  background: var(--color-hover);
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.loading,
.error,
.empty {
  padding: 16px;
  color: var(--color-text);
  opacity: 0.6;
  font-size: 13px;
}

.error {
  color: #e53935;
}

.file-tree {
  padding: 0 8px;
}

.tree-item {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  color: var(--color-text);
}

.tree-item-parent {
  opacity: 0.6;
}

.tree-item:hover {
  background: var(--color-hover);
}

.tree-item.is-active {
  background: var(--color-accent);
  color: white;
}

.tree-item.is-active:hover {
  background: var(--color-accent);
}

.item-icon {
  margin-right: 8px;
  font-size: 14px;
}

.item-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.rename-input {
  flex: 1;
  padding: 2px 4px;
  font-size: 13px;
  font-family: inherit;
  border: 1px solid var(--color-accent);
  border-radius: 2px;
  outline: none;
  background: var(--color-bg);
  color: var(--color-text);
}

.context-menu {
  position: fixed;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  min-width: 120px;
  padding: 4px 0;
}

.context-menu-item {
  padding: 8px 16px;
  cursor: pointer;
  font-size: 13px;
  color: var(--color-text);
}

.context-menu-item:hover {
  background: var(--color-hover);
}

.context-menu-item-danger {
  color: #e53935;
}

.context-menu-item-danger:hover {
  background: var(--color-hover);
}

/* Tabs */
.sidebar-tabs {
  display: flex;
  border-bottom: 1px solid var(--color-border);
  padding: 0 8px;
  flex-shrink: 0;
}

.sidebar-tab {
  flex: 1;
  padding: 8px 12px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--color-text);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}

.sidebar-tab:hover {
  background: var(--color-hover);
}

.sidebar-tab.is-active {
  border-bottom-color: var(--color-accent);
  color: var(--color-accent);
}

/* Outline */
.outline-panel {
  padding: 8px 0;
}

.git-panel {
  height: 100%;
}

.outline-list {
  padding: 0 8px;
}

.outline-item {
  padding: 4px 8px;
  font-size: 13px;
  color: var(--color-text);
  cursor: pointer;
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.outline-item:hover {
  background: var(--color-hover);
}

.outline-level-1 {
  font-weight: 600;
  font-size: 14px;
}

.outline-level-2 {
  padding-left: 16px;
}

.outline-level-3 {
  padding-left: 24px;
}

.outline-level-4 {
  padding-left: 32px;
}

.outline-level-5 {
  padding-left: 40px;
}

.outline-level-6 {
  padding-left: 48px;
}
</style>
