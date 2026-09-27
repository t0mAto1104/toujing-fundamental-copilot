import {
  NOTE_COLORS,
  NOTE_HIGHLIGHTS,
  NOTE_SIZES,
  validateNotebookDocument,
  type NotebookDocument,
  type NotebookRun,
} from '@/lib/notebook';

// Native foreColor needs a color value to clear an inherited color. CSS maps
// this sentinel to the theme foreground; it is never part of stored content.
export const NOTE_DEFAULT_COLOR = 'rgba(0, 0, 0, 0)';
type Style = Omit<NotebookRun, 'text'>;

function hexColor(value: string) {
  const rgb = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*1)?\)$/);
  return rgb
    ? `#${rgb
        .slice(1)
        .map((part) => Number(part).toString(16).padStart(2, '0'))
        .join('')}`
    : value.toLowerCase();
}

function nodeStyle(element: HTMLElement, inherited: Style): Style {
  const style = { ...inherited };
  const color = element.style.color || element.getAttribute('color');
  if (color) {
    const normalized = hexColor(color);
    if (NOTE_COLORS.includes(normalized as NonNullable<Style['color']>))
      style.color = normalized as Style['color'];
    else delete style.color;
  }
  if (element.style.backgroundColor) {
    const normalized = hexColor(element.style.backgroundColor);
    if (NOTE_HIGHLIGHTS.includes(normalized as NonNullable<Style['highlight']>))
      style.highlight = normalized as Style['highlight'];
    else delete style.highlight;
  }
  const nativeSize = Number(element.getAttribute('size'));
  const pixelSize = Number.parseFloat(element.style.fontSize);
  if (nativeSize >= 1 && nativeSize <= NOTE_SIZES.length)
    style.size = NOTE_SIZES[nativeSize - 1];
  else if (NOTE_SIZES.includes(pixelSize as NonNullable<Style['size']>))
    style.size = pixelSize as Style['size'];
  if (element.tagName === 'B' || element.tagName === 'STRONG')
    style.bold = true;
  if (element.tagName === 'I' || element.tagName === 'EM') style.italic = true;
  if (element.style.fontWeight)
    style.bold =
      element.style.fontWeight === 'bold' ||
      Number(element.style.fontWeight) >= 600;
  if (element.style.fontStyle)
    style.italic = element.style.fontStyle === 'italic';
  if (!style.bold) delete style.bold;
  if (!style.italic) delete style.italic;
  // 16px is the editor's default; omit it for a stable empty/default round trip.
  if (style.size === 16) delete style.size;
  return style;
}

export function readNotebookEditor(root: HTMLElement): NotebookDocument {
  const runs: NotebookRun[] = [];
  const append = (text: string, style: Style) => {
    if (!text) return;
    const previous = runs.at(-1);
    if (
      previous &&
      previous.size === style.size &&
      previous.color === style.color &&
      previous.highlight === style.highlight &&
      previous.bold === style.bold &&
      previous.italic === style.italic
    )
      previous.text += text;
    else runs.push({ text, ...style });
  };
  const walk = (parent: Node, inherited: Style) => {
    const children = Array.from(parent.childNodes);
    children.forEach((child, index) => {
      if (child.nodeType === 3) {
        append(child.textContent || '', inherited);
        return;
      }
      if (child.nodeType !== 1) return;
      const element = child as HTMLElement;
      if (
        ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'IMG', 'SVG', 'MATH'].includes(
          element.tagName,
        )
      )
        return;
      const style = nodeStyle(element, inherited);
      if (element.tagName === 'BR') {
        // A lone BR is the browser's caret placeholder for an empty line.
        if (children.length > 1 && index < children.length - 1)
          append('\n', style);
        return;
      }
      const block = ['DIV', 'P', 'LI'].includes(element.tagName);
      if (block && index > 0) append('\n', style);
      walk(element, style);
      const next = children[index + 1] as HTMLElement | undefined;
      if (block && next && !['DIV', 'P', 'LI'].includes(next.nodeName))
        append('\n', style);
    });
  };
  walk(root, {});
  return validateNotebookDocument({ version: 1, runs });
}

export function renderNotebookEditor(
  root: HTMLElement,
  value: NotebookDocument,
) {
  const fragment = root.ownerDocument.createDocumentFragment();
  for (const run of validateNotebookDocument(value).runs) {
    // Native font commands use this element; matching it retains their undo behavior.
    // oxlint-disable-next-line typescript/no-deprecated
    const font = root.ownerDocument.createElement('font');
    font.setAttribute('size', String(NOTE_SIZES.indexOf(run.size || 16) + 1));
    font.setAttribute('color', run.color || NOTE_DEFAULT_COLOR);
    if (run.highlight) font.style.backgroundColor = run.highlight;
    if (run.bold) font.style.fontWeight = '700';
    if (run.italic) font.style.fontStyle = 'italic';
    font.textContent = run.text;
    fragment.append(font);
  }
  root.replaceChildren(fragment);
}

export function notebookSelection(root: HTMLElement): Range | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  return root.contains(range.startContainer) &&
    root.contains(range.endContainer)
    ? range.cloneRange()
    : null;
}

export function restoreNotebookSelection(
  root: HTMLElement,
  range: Range | null,
) {
  root.focus({ preventScroll: true });
  const selection = root.ownerDocument.getSelection();
  if (!selection) return;
  const next =
    range &&
    root.contains(range.startContainer) &&
    root.contains(range.endContainer)
      ? range
      : root.ownerDocument.createRange();
  if (next !== range) {
    next.selectNodeContents(root);
    next.collapse(false);
  }
  selection.removeAllRanges();
  selection.addRange(next);
}
