import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export interface Tab {
  id: string;
  filePath: string | null;
  name: string;
  content: string;
  lastSaved: number | null;
}

export const useTabsStore = defineStore('tabs', () => {
  const tabs = ref<Tab[]>([]);
  const activeTabId = ref<string | null>(null);

  // 生成唯一 ID
  function generateId(): string {
    return `tab-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  // 创建新标签页
  function createTab(filePath: string | null, name: string, content: string = '', lastSaved: number | null = null): string {
    const id = generateId();
    const tab: Tab = {
      id,
      filePath,
      name,
      content,
      lastSaved,
    };
    tabs.value.push(tab);
    activeTabId.value = id;
    return id;
  }

  // 查找已存在的标签页
  function findTabByPath(filePath: string): Tab | undefined {
    return tabs.value.find(t => t.filePath === filePath);
  }

  // 打开或切换到标签页
  function openTab(filePath: string | null, name: string, content: string, lastSaved: number | null = null): string {
    // 如果文件已打开，切换到该标签
    if (filePath) {
      const existing = findTabByPath(filePath);
      if (existing) {
        activeTabId.value = existing.id;
        return existing.id;
      }
    }

    // 否则创建新标签
    return createTab(filePath, name, content, lastSaved);
  }

  // 关闭标签页
  function closeTab(id: string): boolean {
    const index = tabs.value.findIndex(t => t.id === id);
    if (index === -1) return false;

    tabs.value.splice(index, 1);

    // 如果关闭的是活动标签，切换到其他
    if (activeTabId.value === id) {
      if (tabs.value.length > 0) {
        // 切换到相邻的标签
        const newIndex = Math.min(index, tabs.value.length - 1);
        activeTabId.value = tabs.value[newIndex].id;
      } else {
        activeTabId.value = null;
      }
    }

    return true;
  }

  // 获取活动标签
  const activeTab = computed(() => {
    if (!activeTabId.value) return null;
    return tabs.value.find(t => t.id === activeTabId.value) || null;
  });

  // 更新标签内容
  function updateContent(id: string, content: string) {
    const tab = tabs.value.find(t => t.id === id);
    if (tab) {
      tab.content = content;
    }
  }

  // 更新标签路径（重命名后）
  function updatePath(id: string, newPath: string, newName: string) {
    const tab = tabs.value.find(t => t.id === id);
    if (tab) {
      tab.filePath = newPath;
      tab.name = newName;
    }
  }

  // 更新保存时间
  function updateLastSaved(id: string, lastSaved: number) {
    const tab = tabs.value.find(t => t.id === id);
    if (tab) {
      tab.lastSaved = lastSaved;
    }
  }

  // 关闭所有标签
  function closeAll() {
    tabs.value = [];
    activeTabId.value = null;
  }

  // 关闭文件路径对应的标签
  function closeByPath(filePath: string): boolean {
    const tab = findTabByPath(filePath);
    if (tab) {
      return closeTab(tab.id);
    }
    return false;
  }

  return {
    tabs,
    activeTabId,
    activeTab,
    createTab,
    openTab,
    closeTab,
    closeAll,
    closeByPath,
    findTabByPath,
    updateContent,
    updatePath,
    updateLastSaved,
  };
});
