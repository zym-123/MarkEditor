<template>
  <div class="status-bar">
    <div class="status-left">
      <span class="status-item">
        {{ wordCount }} 字
      </span>
      <span v-if="documentStore.isDirty" class="status-item dirty">
        ● 未保存
      </span>
    </div>
    <div class="status-right">
      <span class="status-item">
        {{ cursorPosition }} / {{ charCount }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useDocumentStore } from '../../stores/document';
import { useEditorStore } from '../../stores/editor';

const documentStore = useDocumentStore();
const editorStore = useEditorStore();

const charCount = computed(() => documentStore.content.length);

// 中文字符没有空格分隔，按空白分割会导致词数计算错误
// 改为直接返回字符数，更直观
const wordCount = computed(() => {
  return charCount.value;
});

const cursorPosition = computed(() => editorStore.cursorPosition);
</script>

<style scoped>
.status-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 24px;
  padding: 0 12px;
  background: var(--color-bg);
  border-top: 1px solid var(--color-border);
  font-size: 12px;
  color: var(--color-text);
  opacity: 0.7;
}

.status-left,
.status-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.status-item.dirty {
  color: #e6a23c;
}
</style>
