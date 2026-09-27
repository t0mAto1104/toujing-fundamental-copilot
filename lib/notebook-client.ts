import {
  emptyNotebookDocument,
  validateNotebookDocument,
  type NotebookDocument,
  type NotebookSnapshot,
} from '@/lib/notebook';

export type NotebookClientState = NotebookSnapshot & {
  ready: boolean;
  dirty: boolean;
  saving: boolean;
  error: string;
  conflict: NotebookSnapshot | null;
};
type Draft = {
  document: NotebookDocument;
  revision: number;
  sent?: NotebookDocument;
};
const same = (a: NotebookDocument, b: NotebookDocument) =>
  JSON.stringify(a) === JSON.stringify(b);
function snapshot(value: unknown): NotebookSnapshot {
  const row = value as NotebookSnapshot;
  if (
    !row ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 0 ||
    (row.updatedAt !== null && typeof row.updatedAt !== 'string')
  )
    throw Error('笔记响应无效，请重试。');
  return {
    document: validateNotebookDocument(row.document),
    revision: row.revision,
    updatedAt: row.updatedAt,
  };
}

// One serialized writer per mounted account. D1 is authoritative; sessionStorage
// is only an unsent-draft safety net across the app's full-page navigations.
export class NotebookClient {
  private state: NotebookClientState = {
    document: emptyNotebookDocument(),
    revision: 0,
    updatedAt: null,
    ready: false,
    dirty: false,
    saving: false,
    error: '',
    conflict: null,
  };
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<boolean>;
  private loading?: Promise<void>;
  private sent?: NotebookDocument;
  private deleting = false;
  private disposed = false;
  private key: string;

  constructor(
    private owner: string,
    private storage?: Storage,
    private transport: typeof fetch = fetch,
  ) {
    this.key = `lens-notebook-draft:v1:${owner}`;
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(change: Partial<NotebookClientState>) {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }
  private backup() {
    if (this.disposed) return;
    try {
      if (!this.state.dirty) this.storage?.removeItem(this.key);
      else
        this.storage?.setItem(
          this.key,
          JSON.stringify({
            document: this.state.document,
            revision: this.state.revision,
            sent: this.sent,
          } satisfies Draft),
        );
    } catch {
      /* Failed cloud saves remain dirty and visible, even if storage is blocked. */
    }
  }
  private schedule() {
    clearTimeout(this.timer);
    if (!this.disposed)
      this.timer = setTimeout(() => {
        void this.flush();
      }, 800);
  }
  private request(method: 'GET' | 'PUT' | 'DELETE', body?: unknown) {
    const transport = this.transport;
    return transport('/api/notebook', {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Notebook-Owner': this.owner,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      // Bounded API payloads fit the browser's keepalive body limit.
      keepalive: method !== 'GET',
      signal: AbortSignal.timeout(10_000),
    });
  }
  private failure(status: number) {
    return status === 401 || status === 403
      ? '登录状态已变化，请重新登录；未保存内容仍可导出。'
      : '保存暂不可用，内容已保留，请重试或导出。';
  }
  load = () => {
    if (this.disposed || this.state.ready) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = this.loadOnce().finally(() => {
      this.loading = undefined;
    });
    return this.loading;
  };
  private async loadOnce() {
    let draft: Draft | undefined;
    try {
      const raw = this.storage?.getItem(this.key);
      if (raw) {
        const parsed = JSON.parse(raw) as Draft;
        if (Number.isSafeInteger(parsed.revision) && parsed.revision >= 0) {
          draft = {
            document: validateNotebookDocument(parsed.document),
            revision: parsed.revision,
            sent: parsed.sent && validateNotebookDocument(parsed.sent),
          };
          this.update({ document: draft.document, dirty: true });
        }
      }
    } catch {
      /* Untrusted or obsolete browser draft is never sent to the server. */
    }
    try {
      const response = await this.request('GET');
      if (!response.ok) throw Error(this.failure(response.status));
      const remote = snapshot(await response.json());
      if (this.disposed) return;
      if (draft && !same(draft.document, remote.document)) {
        const ownPendingWrite =
          draft.sent &&
          remote.revision === draft.revision + 1 &&
          same(draft.sent, remote.document);
        const conflict = remote.revision !== draft.revision && !ownPendingWrite;
        this.sent = ownPendingWrite ? undefined : draft.sent;
        this.update({
          ...remote,
          document: draft.document,
          ready: true,
          dirty: true,
          error: '',
          revision: conflict ? draft.revision : remote.revision,
          conflict: conflict ? remote : null,
        });
        if (!this.state.conflict) this.schedule();
      } else
        this.update({
          ...remote,
          ready: true,
          dirty: false,
          error: '',
          conflict: null,
        });
      this.backup();
    } catch (error) {
      if (!this.disposed)
        this.update({
          error:
            error instanceof Error ? error.message : '笔记暂不可用，请重试。',
        });
    }
  }
  edit = (value: NotebookDocument) => {
    if (!this.state.ready || this.deleting || this.disposed) return;
    this.update({
      document: validateNotebookDocument(value),
      dirty: true,
      error: '',
    });
    this.backup();
    if (!this.state.conflict) this.schedule();
  };
  flush = (): Promise<boolean> => {
    clearTimeout(this.timer);
    if (this.pending) return this.pending;
    if (
      this.disposed ||
      this.deleting ||
      !this.state.ready ||
      this.state.conflict
    )
      return Promise.resolve(false);
    this.pending = this.saveLoop().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  };
  private async saveLoop() {
    while (
      this.state.dirty &&
      !this.disposed &&
      !this.deleting &&
      !this.state.conflict
    ) {
      const document = this.state.document;
      this.sent = document;
      this.update({ saving: true, error: '' });
      this.backup();
      try {
        const response = await this.request('PUT', {
          document,
          revision: this.state.revision,
        });
        if (this.disposed) return false;
        if (response.status === 409) {
          const remote = snapshot(
            ((await response.json()) as { current: unknown }).current,
          );
          if (this.disposed) return false;
          // A lost response to our identical write is an acknowledgement, not a conflict.
          if (same(remote.document, document)) {
            this.update({
              revision: remote.revision,
              updatedAt: remote.updatedAt,
              saving: false,
              dirty: !same(document, this.state.document),
            });
            this.sent = undefined;
            this.backup();
            continue;
          }
          this.update({ saving: false, conflict: remote });
          this.backup();
          return false;
        }
        if (!response.ok) throw Error(this.failure(response.status));
        const remote = snapshot(await response.json());
        if (this.disposed) return false;
        this.update({
          revision: remote.revision,
          updatedAt: remote.updatedAt,
          saving: false,
          dirty: !same(document, this.state.document),
        });
        this.sent = undefined;
        this.backup();
      } catch (error) {
        if (this.disposed) return false;
        this.update({
          saving: false,
          error: error instanceof Error ? error.message : '保存失败，请重试。',
        });
        this.backup();
        return false;
      }
    }
    return !this.state.dirty;
  }
  useRemote = () => {
    if (this.disposed || !this.state.conflict) return;
    this.update({
      ...this.state.conflict,
      dirty: false,
      conflict: null,
      error: '',
    });
    this.sent = undefined;
    this.backup();
  };
  keepLocal = () => {
    if (this.disposed || !this.state.conflict) return;
    this.update({
      revision: this.state.conflict.revision,
      dirty: true,
      conflict: null,
      error: '',
    });
    this.backup();
    return this.flush();
  };
  discard = async () => {
    if (
      this.disposed ||
      this.deleting ||
      !this.state.ready ||
      this.state.conflict
    )
      return false;
    this.deleting = true;
    clearTimeout(this.timer);
    try {
      await this.pending;
      if (this.disposed || this.state.conflict) return false;
      const response = await this.request('DELETE', {
        revision: this.state.revision,
      });
      if (this.disposed) return false;
      if (response.status === 409) {
        const current = snapshot(
          ((await response.json()) as { current: unknown }).current,
        );
        if (this.disposed) return false;
        this.update({ conflict: current, saving: false });
        return false;
      }
      if (!response.ok) throw Error(this.failure(response.status));
      const remote = snapshot(await response.json());
      if (this.disposed) return false;
      this.sent = undefined;
      this.update({
        ...remote,
        dirty: false,
        error: '',
        conflict: null,
        saving: false,
      });
      this.backup();
      return true;
    } catch (error) {
      if (this.disposed) return false;
      this.update({
        error:
          error instanceof Error ? error.message : '删除失败，笔记仍保留。',
      });
      return false;
    } finally {
      this.deleting = false;
    }
  };
  dispose = () => {
    this.disposed = true;
    clearTimeout(this.timer);
    this.listeners.clear();
  };
}
