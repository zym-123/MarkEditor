<template>
  <div
    class="editor-container"
    tabindex="0"
    @keydown="handleKeydown"
  >
    <!-- 渲染预览层 -->
    <div
      class="editor-preview"
      :class="{ 'is-hidden': isEditing }"
      v-html="renderedHtml"
    />

    <!-- 编辑层 -->
    <textarea
      ref="textareaRef"
      :value="documentStore.content"
      class="editor-textarea"
      :class="{ 'is-active': isEditing }"
      @input="handleTextareaInput"
      @keydown="handleTextareaKeydown"
      @paste="handleTextareaPaste"
    />

    <!-- 空文档提示 -->
    <div
      v-if="isEditing && isEmpty"
      class="placeholder"
    >
      在这里输入内容...
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useDocumentStore } from '../../stores/document';
import { useEditorStore } from '../../stores/editor';
import { useTabsStore } from '../../stores/tabs';
import { parseMarkdown } from '../../composables/useMarkdownParser';

const documentStore = useDocumentStore();
const editorStore = useEditorStore();
const tabsStore = useTabsStore();

const textareaRef = ref<HTMLTextAreaElement | null>(null);
const isEditing = ref(false);

// 定期检测文件外部变更和自动保存
let checkInterval: number | null = null;

function startFileCheck() {
  if (checkInterval) return;
  checkInterval = window.setInterval(async () => {
    // 检测外部文件变更
    if (documentStore.filePath && !documentStore.isDirty) {
      const hasChanged = await documentStore.checkExternalChange();
      if (hasChanged) {
        await documentStore.reloadFile();
        // 同步更新 tabsStore
        if (tabsStore.activeTabId) {
          tabsStore.updateContent(tabsStore.activeTabId, documentStore.content);
          tabsStore.updateLastSaved(tabsStore.activeTabId, documentStore.lastSaved || Date.now());
        }
      }
    }

    // 自动保存：停止编辑超过1秒且有未保存的更改
    if (documentStore.filePath && documentStore.isDirty && documentStore.lastEditTime) {
      const elapsed = Date.now() - documentStore.lastEditTime;
      if (elapsed >= 1000) {
        await documentStore.saveFile();
        // 同步更新 tabsStore
        if (tabsStore.activeTabId) {
          tabsStore.updateLastSaved(tabsStore.activeTabId, documentStore.lastSaved || Date.now());
        }
      }
    }
  }, 1000); // 每 1 秒检测一次
}

function stopFileCheck() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

onMounted(() => {
  startFileCheck();
});

onUnmounted(() => {
  stopFileCheck();
});

const renderedHtml = computed(() => {
  if (!documentStore.content) return '';
  return parseMarkdown(documentStore.content);
});

const isEmpty = computed(() => !documentStore.content.trim());

// 监听 forceEditingOnOpen 变化，用于新建空文件时自动进入编辑模式
watch(
  () => documentStore.forceEditingOnOpen,
  (forceEditing) => {
    if (forceEditing) {
      documentStore.forceEditingOnOpen = false;
      startEditing();
    }
  }
);

// 监听文件路径变化，切换到预览模式
watch(
  () => documentStore.filePath,
  (newPath, oldPath) => {
    // 文件路径变化时，如果是切换到已有文件（非新建），切换到预览模式
    if (newPath !== oldPath && newPath !== null) {
      isEditing.value = false;
    }
  }
);

function scrollToPercent(element: HTMLElement | null, percent: number) {
  if (!element) return;
  const scrollHeight = element.scrollHeight - element.clientHeight;
  if (scrollHeight > 0) {
    element.scrollTop = (percent / 100) * scrollHeight;
  }
}

function getScrollPercent(element: HTMLElement | null): number {
  if (!element) return 0;
  const scrollHeight = element.scrollHeight - element.clientHeight;
  if (scrollHeight <= 0) return 0;
  return (element.scrollTop / scrollHeight) * 100;
}

async function startEditing() {
  const preview = document.querySelector('.editor-preview') as HTMLElement;
  const savedPercent = getScrollPercent(preview);
  isEditing.value = true;
  // 等待 opacity 过渡完成后再 focus
  await new Promise(resolve => setTimeout(resolve, 150));
  nextTick(() => {
    scrollToPercent(textareaRef.value, savedPercent);
    textareaRef.value?.focus();
    // 监听光标位置变化
    document.addEventListener('selectionchange', updateCursorPosition);
    updateCursorPosition();
  });
}

function stopEditing() {
  const savedPercent = getScrollPercent(textareaRef.value);
  isEditing.value = false;
  document.removeEventListener('selectionchange', updateCursorPosition);
  nextTick(() => {
    const preview = document.querySelector('.editor-preview') as HTMLElement;
    scrollToPercent(preview, savedPercent);
  });
}

function handleTextareaPaste() {
  // 在 paste 之前记录历史
  documentStore.pushHistory();
}

function handleTextareaInput(event: Event) {
  const target = event.target as HTMLTextAreaElement;
  documentStore.setContent(target.value);
  // 同步更新 tabsStore
  if (tabsStore.activeTabId) {
    tabsStore.updateContent(tabsStore.activeTabId, target.value);
  }
}

function updateCursorPosition() {
  const textarea = textareaRef.value;
  if (textarea) {
    editorStore.setCursorPosition(textarea.selectionEnd);
  }
}

async function handleTextareaKeydown(event: KeyboardEvent) {
  // Tab 转换为空格
  if (event.key === 'Tab') {
    event.preventDefault();
    const textarea = textareaRef.value;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const spaces = '  ';
      const newValue = documentStore.content.substring(0, start) + spaces + documentStore.content.substring(end);
      documentStore.setContent(newValue);
      nextTick(() => {
        textarea.selectionStart = textarea.selectionEnd = start + spaces.length;
      });
    }
  }

  // Backspace 和 Delete - 保存当前内容到历史，然后让浏览器自然更新
  if (event.key === 'Backspace' || event.key === 'Delete') {
    // 保存当前内容到历史
    documentStore.pushHistory();
  }

  // 对于普通字符输入，在输入之前记录历史（排除特殊键）
  if (
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    event.key.length === 1 &&
    !['Tab', 'Enter', 'Backspace', 'Delete', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)
  ) {
    documentStore.pushHistory();
  }

  // Ctrl+S 保存
  if (event.ctrlKey && event.key === 's') {
    event.preventDefault();
    event.stopPropagation();
    // 如果没有文件路径，走另存为逻辑
    if (!documentStore.filePath) {
      // 调用 Toolbar 暴露的另存为函数
      if ((window as any).__markEditorSaveFile) {
        (window as any).__markEditorSaveFile();
      }
    } else {
      await documentStore.saveFile();
      // 同步更新 tabsStore
      if (tabsStore.activeTabId) {
        tabsStore.updateLastSaved(tabsStore.activeTabId, documentStore.lastSaved || Date.now());
      }
    }
    return;
  }

  // Ctrl+Z 撤销
  if (event.ctrlKey && event.key === 'z' && !event.shiftKey) {
    event.preventDefault();
    event.stopPropagation();
    documentStore.undo();
    // 同步更新 tabsStore
    if (tabsStore.activeTabId) {
      tabsStore.updateContent(tabsStore.activeTabId, documentStore.content);
    }
    // 直接更新 textarea 值
    nextTick(() => {
      if (textareaRef.value) {
        textareaRef.value.value = documentStore.content;
      }
      textareaRef.value?.focus();
    });
    return;
  }

  // Ctrl+Y 或 Ctrl+Shift+Z 重做
  if ((event.ctrlKey && event.key === 'y') ||
      (event.ctrlKey && event.shiftKey && event.key === 'z')) {
    event.preventDefault();
    event.stopPropagation();
    documentStore.redo();
    // 同步更新 tabsStore
    if (tabsStore.activeTabId) {
      tabsStore.updateContent(tabsStore.activeTabId, documentStore.content);
    }
    // 直接更新 textarea 值
    nextTick(() => {
      if (textareaRef.value) {
        textareaRef.value.value = documentStore.content;
      }
      textareaRef.value?.focus();
    });
    return;
  }

  // Esc 退出编辑
  if (event.key === 'Escape') {
    return;
  }
}

function handleKeydown(event: KeyboardEvent) {
  // Ctrl+Z 撤销
  if (event.ctrlKey && event.key === 'z' && !event.shiftKey) {
    event.preventDefault();
    documentStore.undo();
    return;
  }

  // Ctrl+Y 或 Ctrl+Shift+Z 重做
  if ((event.ctrlKey && event.key === 'y') ||
      (event.ctrlKey && event.shiftKey && event.key === 'z')) {
    event.preventDefault();
    documentStore.redo();
    return;
  }

  // Ctrl+E 切换编辑/预览
  if (event.ctrlKey && event.key === 'e') {
    event.preventDefault();
    if (isEditing.value) {
      stopEditing();
    } else {
      // 没有打开文件时不允许编辑
      if (!documentStore.filePath && !documentStore.content) {
        return;
      }
      startEditing();
    }
    return;
  }

  // ESC 切换模式（无论焦点在哪）
  if (event.key === 'Escape') {
    event.preventDefault();
    if (isEditing.value) {
      stopEditing();
    } else {
      // 没有打开文件时不允许编辑
      if (!documentStore.filePath && !documentStore.content) {
        return;
      }
      startEditing();
    }
  }
}
</script>

<style scoped>
.editor-container {
  position: relative;
  flex: 1;
  width: 100%;
  height: 100%;
  overflow: hidden;
  outline: none;
}

.editor-preview {
  padding: var(--editor-padding);
  max-width: var(--editor-max-width);
  margin: 0 auto;
  height: 100%;
  box-sizing: border-box;
  overflow-y: auto;
  cursor: text;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  opacity: 1;
  transition: opacity 0.1s;
}

.editor-preview.is-hidden {
  opacity: 0;
  pointer-events: none;
}

.editor-preview :deep(h1) {
  font-size: 2em;
  font-weight: 700;
  margin: 0.67em 0;
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--color-border);
}

.editor-preview :deep(h2) {
  font-size: 1.5em;
  font-weight: 600;
  margin: 0.83em 0;
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--color-border);
}

.editor-preview :deep(h3) {
  font-size: 1.25em;
  font-weight: 600;
  margin: 1em 0;
}

.editor-preview :deep(p) {
  margin: 1em 0;
  line-height: var(--editor-line-height);
}

.editor-preview :deep(strong) {
  font-weight: 700;
}

.editor-preview :deep(em) {
  font-style: italic;
}

.editor-preview :deep(code) {
  font-family: var(--font-mono);
  background: var(--color-hover);
  padding: 0.2em 0.4em;
  border-radius: 3px;
  font-size: 0.9em;
}

.editor-preview :deep(pre) {
  background: var(--color-hover);
  padding: 1em;
  border-radius: 6px;
  overflow-x: auto;
  margin: 1em 0;
}

.editor-preview :deep(pre code) {
  background: none;
  padding: 0;
}

.editor-preview :deep(a) {
  color: var(--color-accent);
  text-decoration: none;
}

.editor-preview :deep(blockquote) {
  border-left: 4px solid var(--color-accent);
  padding-left: 1em;
  margin: 1em 0;
  opacity: 0.8;
}

.editor-preview :deep(ul),
.editor-preview :deep(ol) {
  padding-left: 2em;
  margin: 1em 0;
}

.editor-preview :deep(li) {
  margin: 0.25em 0;
}

.editor-preview :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
}

.editor-preview :deep(th),
.editor-preview :deep(td) {
  border: 1px solid var(--color-border);
  padding: 0.5em 1em;
  text-align: left;
}

.editor-preview :deep(th) {
  background: var(--color-hover);
  font-weight: 600;
}

.editor-preview :deep(hr) {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 2em 0;
}

.editor-textarea {
  width: 100%;
  height: 100%;
  padding: var(--editor-padding);
  max-width: var(--editor-max-width);
  margin: 0 auto;
  display: block;
  font-family: var(--font-mono);
  font-size: var(--editor-font-size);
  line-height: var(--editor-line-height);
  color: var(--color-text);
  background: var(--color-bg);
  border: none;
  outline: none;
  resize: none;
  white-space: pre-wrap;
  word-wrap: break-word;
  box-sizing: border-box;
  opacity: 0;
  pointer-events: none;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  transition: opacity 0.1s;
  overflow-y: auto;
}

.editor-textarea.is-active {
  opacity: 1;
  pointer-events: auto;
}

.placeholder {
  position: absolute;
  top: var(--editor-padding);
  left: 50%;
  transform: translateX(-50%);
  max-width: var(--editor-max-width);
  width: 100%;
  padding: 0 var(--editor-padding);
  box-sizing: border-box;
  color: var(--color-text);
  opacity: 0.4;
  pointer-events: none;
  font-family: var(--font-mono);
  font-size: var(--editor-font-size);
  line-height: var(--editor-line-height);
  font-style: italic;
  cursor: text;
  white-space: pre-wrap;
}
</style>
