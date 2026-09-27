'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { KeyRound } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Connection = {
  billingSource: 'site' | 'personal';
  configured: boolean;
  storageReady: boolean;
  lastFour: string | null;
  updatedAt: string | null;
};

export function AIConnectionSettings() {
  const [open, setOpen] = useState(false);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [consent, setConsent] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const keyInput = useRef<HTMLInputElement>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const fieldId = useId();
  const hintId = useId();
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setConnection(null);
    setMessage('');
    setFailed(false);
    setConsent(false);
    setConfirmDelete(false);
    void fetch('/api/ai-connection', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json()) as Connection & { error?: string };
        if (!response.ok) throw new Error(data.error || '连接设置暂不可用。');
        setConnection(data);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setFailed(true);
          setMessage(
            error instanceof Error ? error.message : '连接设置暂不可用。',
          );
        }
      });
    return () => {
      controller.abort();
      if (keyInput.current) keyInput.current.value = '';
    };
  }, [open]);

  async function mutate(remove: boolean) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    setMessage('');
    // Only transient form memory. Never localStorage, sessionStorage or a URL.
    const body = remove
      ? { confirmed: true }
      : { apiKey: keyInput.current?.value.trim(), confirmed: consent };
    if (keyInput.current) keyInput.current.value = '';
    try {
      const response = await fetch('/api/ai-connection', {
        method: remove ? 'DELETE' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || '操作失败，请重试。');
      setConsent(false);
      setConfirmDelete(false);
      setMessage(
        remove
          ? '已删除本站保存的密钥。需要撤销密钥时，请前往 OpenAI 控制台；已发出的请求可能仍计费。'
          : '已加密保存。未调用模型、不消耗 Token；有效性、余额和模型权限在实际使用时由 OpenAI 验证。',
      );
      const refresh = await fetch('/api/ai-connection', { cache: 'no-store' });
      if (refresh.ok) setConnection((await refresh.json()) as Connection);
      else setConnection(null);
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : '操作失败，请重试。');
    } finally {
      delete (body as { apiKey?: string }).apiKey;
      setBusy(false);
      requestAnimationFrame(() => feedback.current?.focus());
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next && keyInput.current) keyInput.current.value = '';
        setOpen(next);
      }}
    >
      <DialogTrigger className="mt-3 flex min-h-11 w-full items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">
        <KeyRound className="size-4" aria-hidden="true" />
        AI 连接
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] max-w-[calc(100vw_-_2rem)] overflow-y-auto border border-border sm:max-w-lg">
        <DialogTitle>AI 连接与费用</DialogTitle>
        <DialogDescription>
          仅支持 OpenAI 官方 API。登录 ChatGPT 不会为本站提供 API 额度。
        </DialogDescription>
        {!connection && !message ? <p role="status">正在读取配置…</p> : null}
        {connection?.billingSource === 'site' ? (
          <p className="text-sm leading-6">
            管理员使用站点 API Key。
            {connection.configured
              ? '已配置，仅检查配置状态，未验证余额。'
              : '站点密钥尚未配置。'}
            费用由站点 API 项目承担。
          </p>
        ) : connection ? (
          <>
            <p className="text-sm leading-6">
              {connection.configured
                ? `已保存个人 Key · •••• ${connection.lastFour || '****'}`
                : '尚未配置个人 API Key'}
              。所有 AI 研究、追问和市场对话使用你的 API 额度，不会自动改用站点
              Key。
            </p>
            {!connection.storageReady ? (
              <p role="alert" className="text-sm leading-6 text-destructive">
                站点尚未启用安全密钥存储，请联系管理员。当前无法保存或使用个人
                Key。
              </p>
            ) : null}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void mutate(false);
              }}
              className="space-y-3"
            >
              <label htmlFor={fieldId} className="block text-sm font-medium">
                {connection.configured
                  ? '替换个人 OpenAI API Key'
                  : '个人 OpenAI API Key'}
              </label>
              <Input
                ref={keyInput}
                id={fieldId}
                type="password"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={512}
                minLength={23}
                required
                pattern="sk-[A-Za-z0-9_-]{20,509}"
                aria-describedby={hintId}
                disabled={busy || !connection.storageReady}
                placeholder="sk-…"
                className="min-h-11 text-base sm:text-sm"
              />
              <p
                id={hintId}
                className="text-sm leading-6 text-muted-foreground"
              >
                密钥由本站服务端加密保存，管理页面无法查看原文。研究内容仍会经本站服务器发送至
                OpenAI；本功能不代表数据只留在本机。
              </p>
              <label className="flex min-h-11 items-start gap-2 text-sm leading-6">
                <input
                  type="checkbox"
                  required
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  disabled={busy || !connection.storageReady}
                  className="mt-1.5 size-4 shrink-0 accent-primary"
                />
                我同意由本站使用此 Key 发起我主动请求的 AI 调用，并自行承担
                OpenAI API 费用。
              </label>
              <Button
                type="submit"
                disabled={busy || !consent || !connection.storageReady}
                className="min-h-11"
              >
                {busy
                  ? '处理中…'
                  : connection.configured
                    ? '替换并加密保存'
                    : '加密保存'}
              </Button>
            </form>
            <p className="text-sm leading-6 text-muted-foreground">
              保存不会发送测试请求。可选模型仍受管理员限制及个人 API
              项目权限约束。
            </p>
            {connection.configured ? (
              <div className="border-t border-border pt-3">
                {confirmDelete ? (
                  <div className="space-y-2">
                    <p className="text-sm">
                      删除后无法继续发起 AI 调用，历史报告仍可查看。是否确认？
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        disabled={busy}
                        onClick={() => void mutate(true)}
                        className="min-h-11"
                      >
                        确认删除密钥
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => setConfirmDelete(false)}
                        className="min-h-11"
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setConfirmDelete(true)}
                    className="min-h-11"
                  >
                    删除保存的密钥
                  </Button>
                )}
              </div>
            ) : null}
          </>
        ) : null}
        {message ? (
          <p
            ref={feedback}
            tabIndex={-1}
            role={failed ? 'alert' : 'status'}
            className={`text-sm leading-6 ${failed ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {message}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
