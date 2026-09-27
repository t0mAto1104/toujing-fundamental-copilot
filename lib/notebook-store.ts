import {
  emptyNotebookDocument,
  validateNotebookDocument,
  type NotebookDocument,
  type NotebookSnapshot,
} from '@/lib/notebook';

type NotebookRow = {
  document_json: string;
  revision: number;
  updated_at: string;
};

export class NotebookConflictError extends Error {
  readonly current: NotebookSnapshot;
  constructor(current: NotebookSnapshot) {
    super('笔记已在其他页面更新，请先读取最新内容。');
    this.name = 'NotebookConflictError';
    this.current = current;
  }
}

function snapshot(row: NotebookRow | null): NotebookSnapshot {
  return row
    ? {
        document: validateNotebookDocument(JSON.parse(row.document_json)),
        revision: row.revision,
        updatedAt: row.updated_at,
      }
    : { document: emptyNotebookDocument(), revision: 0, updatedAt: null };
}

export async function readNotebook(
  database: D1Database,
  userId: string,
): Promise<NotebookSnapshot> {
  if (!userId) throw new Error('笔记需要登录后使用。');
  const row = await database
    .prepare(
      'SELECT document_json, revision, updated_at FROM user_notebooks WHERE user_id = ?',
    )
    .bind(userId)
    .first<NotebookRow>();
  return snapshot(row);
}

export async function saveNotebook(
  database: D1Database,
  userId: string,
  document: NotebookDocument,
  revision: number,
): Promise<NotebookSnapshot> {
  if (
    !userId ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    revision >= Number.MAX_SAFE_INTEGER
  )
    throw new Error('笔记保存版本无效。');
  const json = JSON.stringify(validateNotebookDocument(document));
  const now = new Date().toISOString();
  // Each write is one atomic compare-and-swap. A missing note may only be
  // created at revision zero; an old page cannot create it at a later revision.
  const row =
    revision === 0
      ? await database
          .prepare(`INSERT INTO user_notebooks (user_id, document_json, revision, updated_at)
        VALUES (?, ?, 1, ?) ON CONFLICT(user_id) DO NOTHING
        RETURNING document_json, revision, updated_at`)
          .bind(userId, json, now)
          .first<NotebookRow>()
      : await database
          .prepare(`UPDATE user_notebooks
        SET document_json = ?, revision = revision + 1, updated_at = ?
        WHERE user_id = ? AND revision = ?
        RETURNING document_json, revision, updated_at`)
          .bind(json, now, userId, revision)
          .first<NotebookRow>();
  if (!row)
    throw new NotebookConflictError(await readNotebook(database, userId));
  return snapshot(row);
}

export function discardNotebook(
  database: D1Database,
  userId: string,
  revision: number,
) {
  // Retain only an empty document and its revision so delayed autosaves cannot
  // resurrect discarded content. No former content is kept in this row.
  return saveNotebook(database, userId, emptyNotebookDocument(), revision);
}
