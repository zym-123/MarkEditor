export interface DocumentState {
  content: string;
  filePath: string | null;
  isDirty: boolean;
  lastSaved: number | null;
}

export interface EditorState {
  isFocused: boolean;
  cursorPosition: number;
  selectionStart: number;
  selectionEnd: number;
}

export interface SettingsState {
  theme: 'light' | 'dark' | 'system';
  fontFamily: string;
  fontSize: number;
  autoSave: boolean;
  autoSaveInterval: number;
}

export type BlockType = 'paragraph' | 'heading' | 'code' | 'quote' | 'list' | 'list-item' | 'hr' | 'table';

export interface Block {
  id: string;
  type: BlockType;
  raw: string;
  html: string;
  mode: 'render' | 'edit';
  startLine: number;
  endLine: number;
  headingLevel?: number; // h1-h6
  listType?: 'ul' | 'ol';
  listItems?: string[];
}
