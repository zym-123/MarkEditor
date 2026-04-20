import { useEditorStore } from '../stores/editor';

export function useEditorFocus() {
  const editorStore = useEditorStore();

  function handleFocus() {
    editorStore.focus();
  }

  function handleBlur() {
    editorStore.blur();
  }

  function handleContainerClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    // 如果点击的是空白区域，退出聚焦模式
    if (target.classList.contains('editor-empty') || target.classList.contains('render-layer')) {
      editorStore.blur();
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      editorStore.blur();
    }
  }

  return {
    isFocused: editorStore.isFocused,
    handleFocus,
    handleBlur,
    handleContainerClick,
    handleKeydown,
  };
}
