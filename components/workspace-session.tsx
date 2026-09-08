'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { AIModelId } from '@/lib/ai-models';

export type SessionUser = {
  name?: string;
  email?: string;
  isAdmin?: boolean;
  allowedAIModels?: AIModelId[];
  modelPolicyUnavailable?: boolean;
} | null;

const WorkspaceSessionContext = createContext<{ user: SessionUser }>({
  user: null,
});

export function WorkspaceSessionProvider({
  user,
  children,
}: {
  user: SessionUser;
  children: ReactNode;
}) {
  return (
    <WorkspaceSessionContext.Provider value={{ user }}>
      {children}
    </WorkspaceSessionContext.Provider>
  );
}

export function useWorkspaceSession() {
  return useContext(WorkspaceSessionContext);
}
