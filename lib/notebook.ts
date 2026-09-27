export const NOTE_SIZES = [12, 14, 16, 18, 20, 24, 32] as const;
export const NOTE_COLORS = [
  '#111827',
  '#ffffff',
  '#ef4444',
  '#f59e0b',
  '#22c55e',
  '#3b82f6',
  '#a855f7',
] as const;
export const NOTE_HIGHLIGHTS = [
  '#fef08a',
  '#bbf7d0',
  '#bfdbfe',
  '#fbcfe8',
] as const;
export const NOTE_MAX_TEXT = 16_000;
export const NOTE_MAX_RUNS = 500;
export const NOTE_MAX_BYTES = 60 * 1024;

export type NotebookRun = {
  text: string;
  size?: (typeof NOTE_SIZES)[number];
  color?: (typeof NOTE_COLORS)[number];
  highlight?: (typeof NOTE_HIGHLIGHTS)[number];
  bold?: boolean;
  italic?: boolean;
};
export type NotebookDocument = { version: 1; runs: NotebookRun[] };
export type NotebookSnapshot = {
  document: NotebookDocument;
  revision: number;
  updatedAt: string | null;
};

export function emptyNotebookDocument(): NotebookDocument {
  return { version: 1, runs: [] };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function validateNotebookDocument(value: unknown): NotebookDocument {
  if (
    !record(value) ||
    value.version !== 1 ||
    !Array.isArray(value.runs) ||
    Object.keys(value).some((key) => !['version', 'runs'].includes(key))
  )
    throw new Error('笔记格式无效。');
  if (value.runs.length > NOTE_MAX_RUNS)
    throw new Error('笔记格式过于复杂，请减少分段格式。');
  const runs: NotebookRun[] = [];
  let length = 0;
  for (const input of value.runs) {
    if (
      !record(input) ||
      typeof input.text !== 'string' ||
      Object.keys(input).some(
        (key) =>
          !['text', 'size', 'color', 'highlight', 'bold', 'italic'].includes(
            key,
          ),
      ) ||
      (input.size !== undefined &&
        !NOTE_SIZES.includes(input.size as NotebookRun['size'] & number)) ||
      (input.color !== undefined &&
        !NOTE_COLORS.includes(
          input.color as NonNullable<NotebookRun['color']>,
        )) ||
      (input.highlight !== undefined &&
        !NOTE_HIGHLIGHTS.includes(
          input.highlight as NonNullable<NotebookRun['highlight']>,
        )) ||
      (input.bold !== undefined && typeof input.bold !== 'boolean') ||
      (input.italic !== undefined && typeof input.italic !== 'boolean')
    )
      throw new Error('笔记包含不支持的格式。');
    length += input.text.length;
    if (length > NOTE_MAX_TEXT) throw new Error('笔记最多支持 16,000 个字符。');
    if (!input.text) continue;
    const run: NotebookRun = { text: input.text };
    if (input.size !== undefined) run.size = input.size as NotebookRun['size'];
    if (input.color !== undefined)
      run.color = input.color as NotebookRun['color'];
    if (input.highlight !== undefined)
      run.highlight = input.highlight as NotebookRun['highlight'];
    if (input.bold) run.bold = true;
    if (input.italic) run.italic = true;
    const previous = runs.at(-1);
    if (
      previous &&
      previous.size === run.size &&
      previous.color === run.color &&
      previous.highlight === run.highlight &&
      previous.bold === run.bold &&
      previous.italic === run.italic
    )
      previous.text += run.text;
    else runs.push(run);
  }
  const document: NotebookDocument = { version: 1, runs };
  // Reserve the actual save envelope, including the largest accepted revision,
  // so a document accepted by the editor also fits the bounded API request.
  if (
    new TextEncoder().encode(
      JSON.stringify({ document, revision: Number.MAX_SAFE_INTEGER }),
    ).byteLength > NOTE_MAX_BYTES
  )
    throw new Error('笔记内容和格式合计超过 60 KB，请减少内容或格式。');
  return document;
}

export function notebookPlainText(document: NotebookDocument): string {
  return validateNotebookDocument(document)
    .runs.map((run) => run.text)
    .join('');
}

export function notebookHtml(document: NotebookDocument): string {
  const escape = (text: string) =>
    text.replace(
      /[&<>"']/g,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[character]!,
    );
  const content = validateNotebookDocument(document)
    .runs.map((run) => {
      const styles = [
        run.size && `font-size:${run.size}px`,
        (run.color || run.highlight) && `color:${run.color || '#111827'}`,
        run.highlight && `background-color:${run.highlight}`,
        run.bold && 'font-weight:700',
        run.italic && 'font-style:italic',
      ]
        .filter(Boolean)
        .join(';');
      return `<span${styles ? ` style="${styles}"` : ''}>${escape(run.text)}</span>`;
    })
    .join('');
  return `<div style="white-space:pre-wrap;overflow-wrap:anywhere">${content}</div>`;
}
