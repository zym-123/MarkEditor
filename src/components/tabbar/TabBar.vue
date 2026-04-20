<template>
  <div class="tabbar" v-if="tabsStore.tabs.length > 0">
    <div class="tabs-container">
      <div
        v-for="tab in tabsStore.tabs"
        :key="tab.id"
        class="tab"
        :class="{ 'is-active': tab.id === tabsStore.activeTabId }"
        :title="tab.filePath || '新文件'"
        @click="selectTab(tab.id)"
        @mousedown="handleTabMousedown(tab.id, $event)"
        @contextmenu.prevent="showContextMenu($event, tab)"
      >
        <span class="tab-icon">{{ tab.filePath ? '📄' : '📝' }}</span>
        <span class="tab-name">{{ tab.name }}</span>
        <button
          class="tab-close"
          @click.stop="closeTab(tab.id)"
          title="关闭"
        >
          ×
        </button>
      </div>
    </div>

    <!-- Context Menu -->
    <div
      v-if="contextMenu.visible"
      class="tab-context-menu"
      :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }"
    >
      <div class="context-menu-item" @click="closeTab(contextMenu.tabId!)">
        关闭
      </div>
      <div class="context-menu-item" @click="closeOtherTabs">
        关闭其他
      </div>
      <div class="context-menu-divider"></div>
      <div class="context-menu-item" @click="openInExplorer">
        打开文件所在目录
      </div>
    </div>
    <div v-if="contextMenu.visible" class="context-menu-overlay" @click="hideContextMenu"></div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useTabsStore, type Tab } from '../../stores/tabs';
import { useDocumentStore } from '../../stores/document';
import { invoke } from '@tauri-apps/api/core';

const tabsStore = useTabsStore();
const documentStore = useDocumentStore();

interface TabContextMenu {
  visible: boolean;
  x: number;
  y: number;
  tabId: string | null;
}

const contextMenu = ref<TabContextMenu>({
  visible: false,
  x: 0,
  y: 0,
  tabId: null,
});

function selectTab(id: string) {
  const tab = tabsStore.tabs.find(t => t.id === id);
  if (!tab) return;

  tabsStore.activeTabId = id;

  // 加载该标签的内容到编辑器
  documentStore.loadContent(tab.content, tab.filePath, tab.lastSaved);

  hideContextMenu();
}

async function closeTab(id: string) {
  const tab = tabsStore.tabs.find(t => t.id === id);
  if (!tab) return;

  // 自动保存
  if (tab.filePath && documentStore.filePath === tab.filePath) {
    await documentStore.saveFile();
    tabsStore.updateLastSaved(id, documentStore.lastSaved || Date.now());
  }

  const wasActive = tab.id === tabsStore.activeTabId;
  tabsStore.closeTab(id);

  // 如果关闭的是活动标签且还有标签，打开新活动标签的内容
  if (wasActive && tabsStore.activeTab) {
    documentStore.loadContent(
      tabsStore.activeTab.content,
      tabsStore.activeTab.filePath,
      tabsStore.activeTab.lastSaved
    );
  } else if (!tabsStore.activeTab) {
    // 没有标签了，清空编辑器
    documentStore.newDocument();
  }

  hideContextMenu();
}

function closeOtherTabs() {
  if (!contextMenu.value.tabId) return;
  const keepId = contextMenu.value.tabId;
  const tabsToClose = tabsStore.tabs.filter(t => t.id !== keepId);
  tabsToClose.forEach(t => closeTab(t.id));
}

function showContextMenu(event: MouseEvent, tab: Tab) {
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    tabId: tab.id,
  };
}

function hideContextMenu() {
  contextMenu.value.visible = false;
  contextMenu.value.tabId = null;
}

async function openInExplorer() {
  if (!contextMenu.value.tabId) return;
  const tab = tabsStore.tabs.find(t => t.id === contextMenu.value.tabId);
  if (!tab?.filePath) return;

  try {
    await invoke('show_in_explorer', { path: tab.filePath });
  } catch (e) {
    console.error('Failed to open explorer:', e);
  }

  hideContextMenu();
}

// 滚轮关闭标签页
function handleTabMousedown(id: string, event: MouseEvent) {
  if (event.button === 1) { // 滚轮按下
    event.preventDefault();
    closeTab(id);
  }
}
</script>

<style scoped>
.tabbar {
  display: flex;
  align-items: center;
  height: 36px;
  background: var(--color-bg);
  border-bottom: 1px solid var(--color-border);
  padding: 0 8px;
  overflow: hidden;
}

.tabs-container {
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  flex: 1;
  scrollbar-width: thin;
}

.tabs-container::-webkit-scrollbar {
  height: 4px;
}

.tabs-container::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 2px;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: transparent;
  border: none;
  border-radius: 4px 4px 0 0;
  color: var(--color-text);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  min-width: 100px;
  max-width: 200px;
  transition: background-color 0.15s;
}

.tab:hover {
  background: var(--color-hover);
}

.tab.is-active {
  background: var(--color-accent);
  color: white;
}

.tab.is-active .tab-close {
  color: white;
}

.tab.is-active .tab-close:hover {
  background: rgba(255, 255, 255, 0.2);
}

.tab-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.tab-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--color-text);
  font-size: 14px;
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0.6;
  transition: all 0.15s;
}

.tab-close:hover {
  opacity: 1;
  background: var(--color-hover);
}

/* Context Menu */
.tab-context-menu {
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

.context-menu-divider {
  height: 1px;
  background: var(--color-border);
  margin: 4px 0;
}

.context-menu-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 999;
}
</style>
