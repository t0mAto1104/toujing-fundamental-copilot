// Browser-only component fixture. Never imported by the application.
import { createRoot } from 'react-dom/client';
import '../app/globals.css';
import { WorkspaceNav } from '../components/workspace-nav';
import { WorkspaceSessionProvider } from '../components/workspace-session';
createRoot(document.getElementById('byok-fixture')!).render(
  <WorkspaceSessionProvider
    user={{
      id: 'byok-ui',
      name: 'BYOK 测试用户',
      email: 'byok-local-ui-qa-20260922@qa.invalid',
      allowedAIModels: ['gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-6-astra'],
      preferredChatModel: 'gpt-5.6-luna',
      preferredResearchModel: 'gpt-5.6-sol',
    }}
  >
    <div className="workspace-settings w-[220px] p-4">
      <WorkspaceNav active="reports" />
    </div>
  </WorkspaceSessionProvider>,
);
