import { defineStore } from 'pinia';
import { ref } from 'vue';

const MAX_HISTORY_SIZE = 100;

export const useDocumentStore = defineStore('document', () => {
  const content = ref('');
  const filePath = ref<string | null>(null);
  const isDirty = ref(false);
  const lastSaved = ref<number | null>(null);

  // 正在加载内容时禁止标记脏状态
  const isLoadingContent = ref(false);

  // 下次打开文件时是否强制进入编辑模式（用于空文件）
  const forceEditingOnOpen = ref(false);

  // 最后编辑时间（用于自动保存）
  const lastEditTime = ref<number | null>(null);

  // 撤销/重做历史
  const undoStack = ref<string[]>([]);
  const redoStack = ref<string[]>([]);

  // 是否正在处理历史变化（避免无限循环）- 使用 ref 以便 watch 能检测到
  const isRecording = ref(true);

  function pushHistory() {
    if (!isRecording.value) return;
    const current = content.value;
    const last = undoStack.value[undoStack.value.length - 1];
    if (last === current) return;

    undoStack.value.push(current);
    if (undoStack.value.length > MAX_HISTORY_SIZE) {
      undoStack.value.shift();
    }
    redoStack.value = [];
  }

  function undo() {
    if (undoStack.value.length === 0) return;
    const previous = undoStack.value.pop()!;
    redoStack.value.push(content.value);
    isRecording.value = false;
    content.value = previous;
    isDirty.value = true;
    lastEditTime.value = Date.now();
    isRecording.value = true;
  }

  function redo() {
    if (redoStack.value.length === 0) return;
    const next = redoStack.value.pop()!;
    undoStack.value.push(content.value);
    isRecording.value = false;
    setContent(next);
    isRecording.value = true;
  }

  function canUndo(): boolean {
    return undoStack.value.length > 0;
  }

  function canRedo(): boolean {
    return redoStack.value.length > 0;
  }

  function clearHistory() {
    undoStack.value = [];
    redoStack.value = [];
  }

  function setContent(newContent: string) {
    content.value = newContent;
    // 加载内容时不标记脏状态，不更新编辑时间
    if (isLoadingContent.value) return;
    isDirty.value = true;
    lastEditTime.value = Date.now();
  }

  function loadContent(newContent: string, path: string | null = null, modifiedTime: number | null = null) {
    isLoadingContent.value = true;
    filePath.value = path;
    isDirty.value = false;
    lastSaved.value = modifiedTime || Date.now();
    lastEditTime.value = null;
    forceEditingOnOpen.value = !newContent.trim();
    clearHistory();
    content.value = newContent;
    isLoadingContent.value = false;
  }

  function newDocument() {
    content.value = '';
    filePath.value = null;
    isDirty.value = false;
    lastSaved.value = null;
    lastEditTime.value = null;
    clearHistory();
  }

  async function saveFile(): Promise<boolean> {
    if (filePath.value) {
      // 已有文件路径，直接保存
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('write_file', { path: filePath.value, content: content.value });
      isDirty.value = false;
      lastSaved.value = Date.now();
      lastEditTime.value = null;
      return true;
    } else {
      // 新文件，需要用户选择路径
      return false;
    }
  }

  async function saveFileAs(path: string): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('write_file', { path, content: content.value });
    filePath.value = path;
    isDirty.value = false;
    lastSaved.value = Date.now();
    lastEditTime.value = null;
  }

  // 检测文件是否被外部修改
  async function checkExternalChange(): Promise<boolean> {
    if (!filePath.value) return false;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const modifiedTime = await invoke<number>('get_file_modified_time', { path: filePath.value });
      const lastSavedTime = lastSaved.value || 0;
      // 如果文件修改时间晚于 lastSaved，说明被外部修改了
      return modifiedTime > lastSavedTime;
    } catch {
      return false;
    }
  }

  // 重新加载文件内容
  async function reloadFile(): Promise<string | null> {
    if (!filePath.value) return null;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<{ content: string; modified_time: number }>('read_file_with_mtime', { path: filePath.value });
      isLoadingContent.value = true;
      content.value = result.content;
      lastSaved.value = result.modified_time;
      isDirty.value = false;
      isLoadingContent.value = false;
      return result.content;
    } catch {
      return null;
    }
  }

  return {
    content,
    filePath,
    isDirty,
    lastSaved,
    lastEditTime,
    forceEditingOnOpen,
    isLoadingContent,
    setContent,
    loadContent,
    newDocument,
    saveFile,
    saveFileAs,
    checkExternalChange,
    reloadFile,
    pushHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    isRecording,
  };
});
