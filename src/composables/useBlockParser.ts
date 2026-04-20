import { marked } from 'marked';
import type { Block, BlockType } from '../types';

let blockIdCounter = 0;

function generateId(): string {
  return `block-${++blockIdCounter}`;
}

function detectBlockType(line: string, prevBlock: Block | null): BlockType {
  const trimmed = line.trim();

  // 空行不算独立块
  if (!trimmed) {
    return prevBlock?.type || 'paragraph';
  }

  // 标题 (# ## ### 等)
  if (/^#{1,6}\s/.test(trimmed)) {
    return 'heading';
  }

  // 代码块 (```)
  if (trimmed.startsWith('```')) {
    return 'code';
  }

  // 引用 (> )
  if (trimmed.startsWith('> ')) {
    return 'quote';
  }

  // 列表 (- * 1. 2.)
  if (/^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
    return 'list-item';
  }

  // 水平线
  if (/^([-*_]){3,}$/.test(trimmed)) {
    return 'hr';
  }

  // 表格 (| col1 | col2 |)
  if (/^\|.*\|$/.test(trimmed) && prevBlock?.type === 'table') {
    return 'table';
  }

  return 'paragraph';
}

function parseBlockType(lines: string[]): BlockType {
  const firstLine = lines[0]?.trim() || '';

  if (/^#{1,6}\s/.test(firstLine)) return 'heading';
  if (firstLine.startsWith('```')) return 'code';
  if (firstLine.startsWith('> ')) return 'quote';
  if (/^[-*+]\s/.test(firstLine) || /^\d+\.\s/.test(firstLine)) return 'list';
  if (/^([-*_]){3,}$/.test(firstLine)) return 'hr';
  if (/^\|.*\|$/.test(firstLine)) return 'table';

  return 'paragraph';
}

function getHeadingLevel(line: string): number {
  const match = line.match(/^(#{1,6})\s/);
  return match ? match[1].length : 1;
}

export function parseBlocks(content: string): Block[] {
  const lines = content.split('\n');
  const blocks: Block[] = [];
  let currentBlockLines: string[] = [];
  let currentBlockType: BlockType = 'paragraph';
  let blockStartLine = 0;

  function flushBlock() {
    if (currentBlockLines.length === 0) return;

    const raw = currentBlockLines.join('\n');
    const type = parseBlockType(currentBlockLines);

    // 解析 HTML
    let html = '';
    if (type === 'list') {
      // 列表特殊处理：将多项合并为一个列表
      const listContent = currentBlockLines.map(l => l.replace(/^[-*+]\s/, '').replace(/^\d+\.\s/, '')).join('\n');
      html = marked.parse(listContent, { async: false }) as string;
    } else {
      html = marked.parse(raw, { async: false }) as string;
    }

    const block: Block = {
      id: generateId(),
      type,
      raw,
      html,
      mode: 'render',
      startLine: blockStartLine,
      endLine: blockStartLine + currentBlockLines.length - 1,
    };

    if (type === 'heading') {
      block.headingLevel = getHeadingLevel(currentBlockLines[0]);
    }

    blocks.push(block);
    currentBlockLines = [];
    currentBlockType = 'paragraph';
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const detectedType = detectBlockType(line, blocks[blocks.length - 1]);

    // 标题独占一行
    if (detectedType === 'heading') {
      flushBlock();
      currentBlockLines = [line];
      blockStartLine = i;
      flushBlock();
      continue;
    }

    // 代码块配对
    if (detectedType === 'code') {
      if (currentBlockType === 'code') {
        currentBlockLines.push(line);
        flushBlock();
      } else {
        flushBlock();
        currentBlockLines = [line];
        blockStartLine = i;
        currentBlockType = 'code';
      }
      continue;
    }

    // 列表项可以多行
    if (detectedType === 'list-item') {
      if (currentBlockType !== 'list-item' && currentBlockType !== 'list') {
        flushBlock();
        blockStartLine = i;
      }
      currentBlockLines.push(line);
      currentBlockType = 'list-item';
      continue;
    }

    // 引用块可以多行
    if (detectedType === 'quote') {
      if (currentBlockType !== 'quote') {
        flushBlock();
        blockStartLine = i;
      }
      currentBlockLines.push(line);
      currentBlockType = 'quote';
      continue;
    }

    // 水平线独占一行
    if (detectedType === 'hr') {
      flushBlock();
      currentBlockLines = [line];
      blockStartLine = i;
      flushBlock();
      continue;
    }

    // 表格行
    if (detectedType === 'table') {
      if (currentBlockType !== 'table') {
        flushBlock();
        blockStartLine = i;
      }
      currentBlockLines.push(line);
      currentBlockType = 'table';
      continue;
    }

    // 普通段落
    if (currentBlockType === 'paragraph' || currentBlockType === 'code' || currentBlockType === 'quote') {
      currentBlockLines.push(line);
    } else {
      flushBlock();
      currentBlockLines = [line];
      blockStartLine = i;
      currentBlockType = 'paragraph';
    }
  }

  flushBlock();

  return blocks;
}

export function blocksToMarkdown(blocks: Block[]): string {
  return blocks.map(b => b.raw).join('\n');
}

export function updateBlockContent(blocks: Block[], blockId: string, newRaw: string): Block[] {
  return blocks.map(b => {
    if (b.id === blockId) {
      return {
        ...b,
        raw: newRaw,
        html: marked.parse(newRaw, { async: false }) as string,
      };
    }
    return b;
  });
}

export function createBlock(raw: string, startLine: number): Block {
  const type = parseBlockType([raw]);
  return {
    id: generateId(),
    type,
    raw,
    html: marked.parse(raw, { async: false }) as string,
    mode: 'edit',
    startLine,
    endLine: startLine,
    headingLevel: type === 'heading' ? getHeadingLevel(raw) : undefined,
  };
}
