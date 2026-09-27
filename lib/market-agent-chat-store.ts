import { boundedMarketHistory } from '@/lib/market-agent-history';
import { safeMarketSources } from '@/lib/market-agent-safety';

export type ChatMessage = {
  id: string;
  role: 'agent' | 'user';
  text: string;
  keyPoints?: string[];
  sources?: Array<{ title: string; url: string }>;
  localOnly?: boolean;
  researchSuggested?: boolean;
};
type Snapshot = {
  messages: ChatMessage[];
  draft: string;
  loading: boolean;
  storageWarning: string;
};
const welcome: ChatMessage = {
  id: 'welcome',
  role: 'agent',
  text: '我会基于政策、行业、资金、财报和宏观数据回答，并提供来源。',
  localOnly: true,
};
export const EMPTY_CHAT: Snapshot = {
  messages: [welcome],
  draft: '',
  loading: false,
  storageWarning: '',
};
export const chatStorageKey = (userId: string) =>
  `lens-market-chat-v1:${encodeURIComponent(userId)}`;
const storageWarning = '本机存储不可用，刷新后记录可能丢失。';
const id = () => crypto.randomUUID();

function readMessage(value: unknown): ChatMessage | null {
  const item = value as Partial<ChatMessage> | null;
  if (
    !item ||
    !['agent', 'user'].includes(item.role || '') ||
    typeof item.text !== 'string' ||
    item.text.length > 4000 ||
    typeof item.id !== 'string'
  )
    return null;
  return {
    id: item.id,
    role: item.role!,
    text: item.text,
    keyPoints: Array.isArray(item.keyPoints)
      ? item.keyPoints
          .filter((x) => typeof x === 'string')
          .slice(0, 3)
          .map((x) => x.slice(0, 300))
      : [],
    sources: safeMarketSources(Array.isArray(item.sources) ? item.sources : []),
    localOnly: item.localOnly === true,
    researchSuggested: item.researchSuggested === true,
  };
}

// Account-keyed browser history, not a server-side transcript or a cross-device
// sync. The request belongs to this store, not the mounted chat component.
export function createMarketChatStore(
  userId: string | null,
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  send: typeof fetch = fetch,
) {
  let snapshot: Snapshot = {
    ...EMPTY_CHAT,
    messages: [...EMPTY_CHAT.messages],
  };
  let controller: AbortController | null = null;
  const listeners = new Set<() => void>();
  const key = userId ? chatStorageKey(userId) : null;
  let resetId = 'initial';
  let interrupted = false;
  if (key) {
    try {
      const raw = storage?.getItem(key);
      if (raw) {
        const data = JSON.parse(raw);
        if (data.version !== 1 || !Array.isArray(data.messages))
          throw new Error('invalid history');
        resetId = typeof data.resetId === 'string' ? data.resetId : 'initial';
        const messages = data.messages
          .map(readMessage)
          .filter((x: ChatMessage | null): x is ChatMessage => Boolean(x));
        if (data.pending) {
          interrupted = true;
          messages.push({
            id: id(),
            role: 'agent',
            text: '上次请求因页面刷新或整页跳转中断，未自动重发。你可以手动重新提问。',
            localOnly: true,
          });
        }
        snapshot = {
          ...snapshot,
          messages: messages.length ? messages : [welcome],
          draft: typeof data.draft === 'string' ? data.draft.slice(0, 800) : '',
        };
      }
      if (!storage) snapshot.storageWarning = storageWarning;
    } catch {
      snapshot.storageWarning = storageWarning;
    }
  }
  const syncDisk = () => {
    if (!key || !storage) return;
    const raw = storage.getItem(key);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.version !== 1 || !Array.isArray(data.messages))
      throw new Error('invalid history');
    const diskMessages: ChatMessage[] = data.messages
      .map(readMessage)
      .filter(Boolean);
    const diskReset =
      typeof data.resetId === 'string' ? data.resetId : 'initial';
    if (diskReset !== resetId) {
      resetId = diskReset;
      snapshot = {
        ...snapshot,
        messages: diskMessages.length ? diskMessages : [welcome],
      };
    } else {
      const merged = new Map(
        diskMessages.map((message) => [message.id, message]),
      );
      for (const message of snapshot.messages) merged.set(message.id, message);
      snapshot = { ...snapshot, messages: [...merged.values()] };
    }
  };
  const notify = (next: Partial<Snapshot>, replace = false) => {
    const beforeReset = resetId;
    let canPersist = true;
    try {
      if (!replace) syncDisk();
    } catch {
      canPersist = false;
      snapshot = { ...snapshot, storageWarning };
    }
    if (!replace && next.messages) {
      // A clear in another tab invalidates stale snapshots and late answers.
      const merged = new Map(
        snapshot.messages.map((message) => [message.id, message]),
      );
      if (beforeReset === resetId)
        for (const message of next.messages) merged.set(message.id, message);
      next = { ...next, messages: [...merged.values()] };
    }
    if (replace) resetId = id();
    snapshot = { ...snapshot, ...next };
    if (key && storage && canPersist) {
      try {
        storage.setItem(
          key,
          JSON.stringify({
            version: 1,
            resetId,
            messages: snapshot.messages,
            draft: snapshot.draft,
            pending: snapshot.loading,
          }),
        );
      } catch {
        snapshot = { ...snapshot, storageWarning };
      }
    }
    for (const listener of listeners) listener();
  };
  // Consume the interruption marker once; never retry a paid request on reload.
  if (interrupted && key && storage) notify({});
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setDraft(draft: string) {
      notify({ draft: draft.slice(0, 800) });
    },
    refresh() {
      try {
        syncDisk();
      } catch {
        snapshot = { ...snapshot, storageWarning };
      }
      for (const listener of listeners) listener();
    },
    clear() {
      if (controller) return;
      notify({ messages: [welcome], draft: '', storageWarning: '' }, true);
    },
    async ask(text: string) {
      text = text.trim();
      if (!text || text.length > 800 || controller) return;
      if (!userId) {
        notify({
          messages: [
            ...snapshot.messages,
            {
              id: id(),
              role: 'agent',
              text: '请先登录后再向市场 Agent 提问。',
              localOnly: true,
            },
          ],
        });
        return;
      }
      try {
        syncDisk();
      } catch {
        snapshot = { ...snapshot, storageWarning };
      }
      const requestResetId = resetId;
      const history = boundedMarketHistory(
        snapshot.messages.filter((message) => !message.localOnly),
      );
      controller = new AbortController();
      const active = controller;
      const timeout = setTimeout(() => active.abort(), 50_000);
      notify({
        draft: '',
        loading: true,
        messages: [...snapshot.messages, { id: id(), role: 'user', text }],
      });
      try {
        const response = await send('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: active.signal,
          body: JSON.stringify({ question: text, history }),
        });
        const payload = (await response.json()) as {
          answer?: string;
          keyPoints?: string[];
          sources?: Array<{ url: string }>;
          error?: string;
          code?: string;
          researchSuggested?: boolean;
        };
        try {
          syncDisk();
        } catch {
          snapshot = { ...snapshot, storageWarning };
        }
        if (requestResetId !== resetId) return;
        if (!response.ok || typeof payload.answer !== 'string')
          throw new Error(payload.error || '研究暂时没有完成。');
        const answer: ChatMessage = {
          id: id(),
          role: 'agent',
          text: payload.answer.slice(0, 4000),
          keyPoints: Array.isArray(payload.keyPoints)
            ? payload.keyPoints.filter((x) => typeof x === 'string').slice(0, 3)
            : [],
          sources: safeMarketSources(
            Array.isArray(payload.sources) ? payload.sources : [],
          ),
          researchSuggested: payload.researchSuggested === true,
          localOnly: Boolean(payload.code),
        };
        notify({ messages: [...snapshot.messages, answer] });
      } catch (error) {
        notify({
          messages: [
            ...snapshot.messages,
            {
              id: id(),
              role: 'agent',
              text: active.signal.aborted
                ? '请求已停止，未自动重试。请缩小问题范围，或使用 AI自定义研报进行深入研究。'
                : error instanceof Error
                  ? error.message
                  : 'Agent 暂时不可用，请稍后重试。',
              localOnly: true,
            },
          ],
        });
      } finally {
        clearTimeout(timeout);
        controller = null;
        notify({ loading: false });
      }
    },
  };
}

const stores = new Map<
  string | null,
  ReturnType<typeof createMarketChatStore>
>();
export function getMarketChatStore(userId: string | null) {
  let existing = stores.get(userId);
  if (!existing) {
    let storage: Storage | undefined;
    try {
      storage = window.localStorage;
    } catch {}
    existing = createMarketChatStore(userId, storage);
    stores.set(userId, existing);
    if (userId && typeof window !== 'undefined') {
      window.addEventListener('storage', (event) => {
        if (event.key === chatStorageKey(userId)) existing?.refresh();
      });
    }
  }
  return existing;
}
