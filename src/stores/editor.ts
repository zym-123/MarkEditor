import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useEditorStore = defineStore('editor', () => {
  const isFocused = ref(false);
  const cursorPosition = ref(0);
  const selectionStart = ref(0);
  const selectionEnd = ref(0);

  function focus() {
    isFocused.value = true;
  }

  function blur() {
    isFocused.value = false;
  }

  function toggleFocus() {
    isFocused.value = !isFocused.value;
  }

  function setCursorPosition(pos: number) {
    cursorPosition.value = pos;
  }

  function setSelection(start: number, end: number) {
    selectionStart.value = start;
    selectionEnd.value = end;
    cursorPosition.value = end;
  }

  return {
    isFocused,
    cursorPosition,
    selectionStart,
    selectionEnd,
    focus,
    blur,
    toggleFocus,
    setCursorPosition,
    setSelection,
  };
});
