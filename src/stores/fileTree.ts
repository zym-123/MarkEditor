import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export interface FolderContents {
  path: string;
  name: string;
  entries: FileEntry[];
}

export const useFileTreeStore = defineStore('fileTree', () => {
  const currentFolder = ref<FolderContents | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // 定时刷新
  let refreshInterval: number | null = null;

  function startAutoRefresh() {
    stopAutoRefresh();
    refreshInterval = window.setInterval(async () => {
      if (currentFolder.value) {
        const result = await invoke<FolderContents>('read_directory', { path: currentFolder.value.path });
        currentFolder.value = result;
      }
    }, 3000); // 每 3 秒刷新一次
  }

  function stopAutoRefresh() {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  }

  async function openFolder(path: string) {
    isLoading.value = true;
    error.value = null;
    try {
      const result = await invoke<FolderContents>('read_directory', { path });
      currentFolder.value = result;
      startAutoRefresh();
    } catch (e) {
      error.value = e as string;
      console.error('Failed to open folder:', e);
    } finally {
      isLoading.value = false;
    }
  }

  async function readFileContent(path: string): Promise<string> {
    return await invoke<string>('read_file', { path });
  }

  async function readFileContentWithMtime(path: string): Promise<{ content: string; modified_time: number }> {
    return await invoke<{ content: string; modified_time: number }>('read_file_with_mtime', { path });
  }

  async function writeFileContent(path: string, content: string): Promise<void> {
    await invoke('write_file', { path, content });
  }

  async function deleteFile(path: string): Promise<void> {
    await invoke('delete_file', { path });
    // 删除后刷新文件列表
    if (currentFolder.value) {
      await openFolder(currentFolder.value.path);
    }
  }

  async function renameFile(oldPath: string, newName: string): Promise<string | null> {
    const oldPathBuf = oldPath.replace(/[\\/]$/, '');
    const lastSep = Math.max(oldPathBuf.lastIndexOf('/'), oldPathBuf.lastIndexOf('\\'));
    const dir = oldPathBuf.substring(0, lastSep + 1);
    const newPath = dir + newName;
    await invoke('rename_file', { oldPath: oldPath, newPath: newPath });
    // 刷新文件列表
    if (currentFolder.value) {
      await openFolder(currentFolder.value.path);
    }
    return newPath;
  }

  async function createDirectory(path: string): Promise<void> {
    await invoke('create_directory', { path });
    // 刷新文件列表
    if (currentFolder.value) {
      await openFolder(currentFolder.value.path);
    }
  }

  async function deleteDirectory(path: string): Promise<void> {
    await invoke('delete_directory', { path });
    // 删除后刷新文件列表
    if (currentFolder.value) {
      await openFolder(currentFolder.value.path);
    }
  }

  function clearFolder() {
    currentFolder.value = null;
    stopAutoRefresh();
  }

  return {
    currentFolder,
    isLoading,
    error,
    openFolder,
    readFileContent,
    readFileContentWithMtime,
    writeFileContent,
    deleteFile,
    renameFile,
    createDirectory,
    deleteDirectory,
    clearFolder,
    startAutoRefresh,
    stopAutoRefresh,
  };
});

// Tauri invoke helper
async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}
