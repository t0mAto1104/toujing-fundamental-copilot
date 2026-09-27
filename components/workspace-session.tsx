'use client';

import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AIModelId } from '@/lib/ai-models';

export type SessionUser = {
  id?: string;
  name?: string;
  email?: string;
  isAdmin?: boolean;
  allowedAIModels?: AIModelId[];
  modelPolicyUnavailable?: boolean;
  preferredChatModel?: AIModelId;
  preferredResearchModel?: AIModelId;
} | null;

type ModelPreferences = {
  preferredChatModel?: AIModelId;
  preferredResearchModel?: AIModelId;
};
const WorkspaceSessionContext = createContext<{
  user: SessionUser;
  savingModels: boolean;
  saveModels: (change: ModelPreferences) => Promise<void>;
}>({
  user: null,
  savingModels: false,
  saveModels: async () => {
    throw new Error('请先登录。');
  },
});

export function WorkspaceSessionProvider({
  user,
  children,
}: {
  user: SessionUser;
  children: ReactNode;
}) {
  const [saved, setSaved] = useState<{
    id: string;
    models: ModelPreferences;
  } | null>(null);
  const [savingModels, setSavingModels] = useState(false);
  const saving = useRef(false);
  const current =
    user && saved && saved.id === user.id ? { ...user, ...saved.models } : user;
  const saveModels = async (change: ModelPreferences) => {
    if (!user?.id) throw new Error('请先登录。');
    if (saving.current) throw new Error('正在保存，请稍后。');
    const id = user.id;
    saving.current = true;
    setSavingModels(true);
    try {
      const response = await fetch('/api/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(change),
        signal: AbortSignal.timeout(10000),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || '模型设置保存失败。');
      setSaved((previous) => ({
        id,
        models: { ...(previous?.id === id ? previous.models : {}), ...change },
      }));
    } finally {
      saving.current = false;
      setSavingModels(false);
    }
  };
  return (
    <WorkspaceSessionContext.Provider
      value={{ user: current, saveModels, savingModels }}
    >
      {children}
    </WorkspaceSessionContext.Provider>
  );
}

export function useWorkspaceSession() {
  return useContext(WorkspaceSessionContext);
}
