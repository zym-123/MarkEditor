import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export interface RecentItem {
  path: string;
  name: string;
  isDirectory: boolean;
  lastOpened: number;
}

const RECENT_FILES_KEY = 'markeditor_recent_files';
const MAX_RECENT_FILES = 10;

function loadRecentFiles(): RecentItem[] {
  try {
    const stored = localStorage.getItem(RECENT_FILES_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // ignore
  }
  return [];
}

function saveRecentFiles(files: RecentItem[]) {
  try {
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(files));
  } catch {
    // ignore
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const theme = ref<'light' | 'dark' | 'system'>('light');
  const fontFamily = ref('Inter, Avenir, Helvetica, Arial, sans-serif');
  const fontSize = ref(16);
  const autoSave = ref(true);
  const autoSaveInterval = ref(30000);
  const recentFiles = ref<RecentItem[]>(loadRecentFiles());
  const gitAuthorName = ref('');
  const gitAuthorEmail = ref('');

  // 监听 recentFiles 变化，自动持久化
  watch(recentFiles, (newFiles) => {
    saveRecentFiles(newFiles);
  }, { deep: true });

  function setTheme(newTheme: 'light' | 'dark' | 'system') {
    theme.value = newTheme;
    applyTheme();
  }

  function applyTheme() {
    const root = document.documentElement;
    if (theme.value === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else if (theme.value === 'light') {
      root.removeAttribute('data-theme');
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (prefersDark) {
        root.setAttribute('data-theme', 'dark');
      } else {
        root.removeAttribute('data-theme');
      }
    }
  }

  function addRecentFile(path: string, isDirectory: boolean) {
    const name = path.split(/[\\/]/).pop() || path;
    const existingIndex = recentFiles.value.findIndex(f => f.path === path);

    if (existingIndex !== -1) {
      // 已存在，移到最前面
      const item = recentFiles.value.splice(existingIndex, 1)[0];
      item.lastOpened = Date.now();
      recentFiles.value.unshift(item);
    } else {
      // 新增
      recentFiles.value.unshift({
        path,
        name,
        isDirectory,
        lastOpened: Date.now(),
      });
      // 超出上限移除最后一条
      if (recentFiles.value.length > 10) {
        recentFiles.value.pop();
      }
    }
  }

  function removeRecentFile(path: string) {
    const index = recentFiles.value.findIndex(f => f.path === path);
    if (index !== -1) {
      recentFiles.value.splice(index, 1);
    }
  }

  function clearRecentFiles() {
    recentFiles.value = [];
  }

  // 初始化主题
  applyTheme();

  return {
    theme,
    fontFamily,
    fontSize,
    autoSave,
    autoSaveInterval,
    recentFiles,
    gitAuthorName,
    gitAuthorEmail,
    setTheme,
    applyTheme,
    addRecentFile,
    removeRecentFile,
    clearRecentFiles,
  };
});
