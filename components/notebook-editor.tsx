'use client';

// Native editing commands preserve the browser's composition and undo history.
/* oxlint-disable typescript/no-deprecated */
// A textarea cannot expose rich text; contenteditable needs the textbox role.
/* oxlint-disable jsx-a11y/prefer-tag-over-role */
import {
  Palette,
  Bold,
  Eraser,
  Highlighter,
  Italic,
  RotateCcw,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import {
  NOTE_COLORS,
  NOTE_HIGHLIGHTS,
  NOTE_MAX_TEXT,
  NOTE_SIZES,
  type NotebookDocument,
} from '@/lib/notebook';
import {
  NOTE_DEFAULT_COLOR,
  notebookSelection,
  readNotebookEditor,
  renderNotebookEditor,
  restoreNotebookSelection,
} from '@/lib/notebook-editor-dom';
import './notebook-editor.css';

type Props = {
  value: NotebookDocument;
  onChange: (document: NotebookDocument) => void;
  disabled?: boolean;
};
const COLOR_NAMES = ['墨黑', '白色', '红色', '橙色', '绿色', '蓝色', '紫色'];
const HIGHLIGHT_NAMES = ['黄色', '绿色', '蓝色', '粉色'];

export function NotebookEditor({ value, onChange, disabled = false }: Props) {
  const editor = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const savedSelection = useRef<Range | null>(null);
  const composing = useRef(false);
  const accepted = useRef(value);
  const serialized = useRef('');
  const [error, setError] = useState('');
  const [palette, setPalette] = useState<'color' | 'highlight' | null>(null);
  const [size, setSize] = useState('3');
  const [bold, setBold] = useState(false);
  const [italic, setItalic] = useState(false);
  const errorId = useId();

  useEffect(() => {
    const next = JSON.stringify(value);
    if (editor.current && next !== serialized.current) {
      renderNotebookEditor(editor.current, value);
      accepted.current = value;
      serialized.current = next;
      savedSelection.current = null;
      setError('');
    }
  }, [value]);

  useEffect(() => {
    const capture = () => {
      if (!editor.current) return;
      const range = notebookSelection(editor.current);
      if (!range) return;
      savedSelection.current = range;
      setBold(document.queryCommandState('bold'));
      setItalic(document.queryCommandState('italic'));
      const next = document.queryCommandValue('fontSize');
      if (/^[1-7]$/.test(next)) setSize(next);
    };
    const outside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setPalette(null);
    };
    document.addEventListener('selectionchange', capture);
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('selectionchange', capture);
      document.removeEventListener('pointerdown', outside);
    };
  }, []);

  useEffect(() => {
    if (!palette) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setPalette(null);
      if (editor.current)
        restoreNotebookSelection(editor.current, savedSelection.current);
    };
    document.addEventListener('keydown', escape, true);
    return () => document.removeEventListener('keydown', escape, true);
  }, [palette]);

  const publish = () => {
    const root = editor.current;
    if (!root || composing.current) return;
    try {
      const next = readNotebookEditor(root);
      const text = JSON.stringify(next);
      setError('');
      if (text !== serialized.current) {
        accepted.current = next;
        serialized.current = text;
        onChange(next);
      }
      savedSelection.current = notebookSelection(root);
    } catch (failure) {
      renderNotebookEditor(root, accepted.current);
      restoreNotebookSelection(root, null);
      savedSelection.current = notebookSelection(root);
      setError(
        `${failure instanceof Error ? failure.message : '笔记内容过大。'}本次修改未加入笔记。`,
      );
    }
  };

  const insertFits = (text: string) => {
    const length = accepted.current.runs.reduce(
      (total, run) => total + run.text.length,
      0,
    );
    const selection = editor.current ? notebookSelection(editor.current) : null;
    // Range.toString() omits paragraph breaks. Validate replacements after the
    // native edit so replacing a multiline selection is not falsely rejected.
    if (
      text.length <= NOTE_MAX_TEXT &&
      ((selection && !selection.collapsed) ||
        length + text.length <= NOTE_MAX_TEXT)
    )
      return true;
    setError('笔记最多支持 16,000 个字符。本次输入未加入笔记。');
    return false;
  };

  const format = (command: string, argument?: string) => {
    if (!editor.current || disabled || composing.current) return;
    restoreNotebookSelection(editor.current, savedSelection.current);
    // ponytail: native commands keep IME and undo together without an editor
    // dependency. Only fixed commands and allowlisted palette values reach here.
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand(command, false, argument);
    savedSelection.current = notebookSelection(editor.current);
    setBold(document.queryCommandState('bold'));
    setItalic(document.queryCommandState('italic'));
    setPalette(null);
    publish();
  };

  return (
    <div className="notebook-editor" ref={wrapper}>
      <div className="notebook-toolbar" role="toolbar" aria-label="笔记格式">
        <select
          value={size}
          disabled={disabled}
          aria-label="字号"
          title="字号"
          onChange={(event) => {
            setSize(event.target.value);
            format('fontSize', event.target.value);
          }}
        >
          {NOTE_SIZES.map((item, index) => (
            <option key={item} value={index + 1}>
              {item}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="加粗"
          title="加粗（⌘/Ctrl B）"
          aria-pressed={bold}
          disabled={disabled}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => format('bold')}
        >
          <Bold aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="斜体"
          title="斜体（⌘/Ctrl I）"
          aria-pressed={italic}
          disabled={disabled}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => format('italic')}
        >
          <Italic aria-hidden="true" />
        </button>
        <span className="notebook-toolbar-divider" aria-hidden="true" />
        {(['color', 'highlight'] as const).map((kind) => (
          <div className="notebook-palette-anchor" key={kind}>
            <button
              type="button"
              aria-label={kind === 'color' ? '字体颜色' : '高亮颜色'}
              title={kind === 'color' ? '字体颜色' : '高亮颜色'}
              aria-expanded={palette === kind}
              disabled={disabled}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => setPalette(palette === kind ? null : kind)}
            >
              {kind === 'color' ? (
                <Palette aria-hidden="true" />
              ) : (
                <Highlighter aria-hidden="true" />
              )}
            </button>
            {palette === kind && (
              <fieldset
                className="notebook-palette"
                aria-label={kind === 'color' ? '选择字体颜色' : '选择高亮颜色'}
              >
                <button
                  type="button"
                  aria-label={kind === 'color' ? '默认字体颜色' : '清除高亮'}
                  title={kind === 'color' ? '默认字体颜色' : '清除高亮'}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() =>
                    format(
                      kind === 'color' ? 'foreColor' : 'hiliteColor',
                      kind === 'color' ? NOTE_DEFAULT_COLOR : 'transparent',
                    )
                  }
                >
                  {kind === 'color' ? (
                    <RotateCcw aria-hidden="true" />
                  ) : (
                    <Eraser aria-hidden="true" />
                  )}
                </button>
                {(kind === 'color' ? NOTE_COLORS : NOTE_HIGHLIGHTS).map(
                  (color, index) => (
                    <button
                      type="button"
                      key={color}
                      className="notebook-swatch"
                      aria-label={`${(kind === 'color' ? COLOR_NAMES : HIGHLIGHT_NAMES)[index]}${kind === 'color' ? '字体' : '高亮'}`}
                      title={`${(kind === 'color' ? COLOR_NAMES : HIGHLIGHT_NAMES)[index]}${kind === 'color' ? '字体' : '高亮'}`}
                      style={{ '--swatch-color': color } as React.CSSProperties}
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() =>
                        format(
                          kind === 'color' ? 'foreColor' : 'hiliteColor',
                          color,
                        )
                      }
                    />
                  ),
                )}
              </fieldset>
            )}
          </div>
        ))}
      </div>
      <div
        ref={editor}
        className="notebook-canvas"
        role="textbox"
        aria-label="笔记内容"
        tabIndex={disabled ? -1 : 0}
        aria-multiline="true"
        aria-disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        contentEditable={!disabled}
        suppressContentEditableWarning
        spellCheck={false}
        onPointerDown={() => setPalette(null)}
        onInput={publish}
        onBeforeInput={(event) => {
          const input = event.nativeEvent as InputEvent;
          if (!composing.current && input.data && !insertFits(input.data))
            event.preventDefault();
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          publish();
        }}
        onPaste={(event) => {
          event.preventDefault();
          if (disabled || composing.current) return;
          const text = event.clipboardData
            .getData('text/plain')
            .replace(/\r\n?/g, '\n');
          if (text && insertFits(text)) {
            document.execCommand('insertText', false, text);
            publish();
          }
        }}
        onDrop={(event) => event.preventDefault()}
      />
      {error && (
        <div id={errorId} className="notebook-editor-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
