import { useDocumentStore } from '../stores/document';
import { useEditorStore } from '../stores/editor';

export function useShortcuts() {
  const documentStore = useDocumentStore();
  const editorStore = useEditorStore();

  function handleKeydown(event: KeyboardEvent) {
    // Ctrl+S: 保存
    if (event.ctrlKey && event.key === 's') {
      event.preventDefault();
      documentStore.saveFile();
      return;
    }

    // Ctrl+Z: 撤销
    if (event.ctrlKey && event.key === 'z' && !event.shiftKey) {
      event.preventDefault();
      documentStore.undo();
      return;
    }

    // Ctrl+Y 或 Ctrl+Shift+Z: 重做
    if ((event.ctrlKey && event.key === 'y') ||
        (event.ctrlKey && event.shiftKey && event.key === 'z')) {
      event.preventDefault();
      documentStore.redo();
      return;
    }

    // Esc: 退出聚焦模式
    if (event.key === 'Escape') {
      editorStore.blur();
    }
  }

  return {
    handleKeydown,
  };
}
