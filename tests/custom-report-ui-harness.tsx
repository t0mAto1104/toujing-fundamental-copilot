// Test-only components and synthetic session. Never imported by the app.
import { createRoot } from 'react-dom/client';
import '../app/globals.css';
import Builder from '../app/report-builder-demo/page';
import Research from '../app/company/[slug]/research-client';
import { WorkspaceSessionProvider } from '../components/workspace-session';
import { WorkspaceNav } from '../components/workspace-nav';

createRoot(document.getElementById('custom-report-fixture')!).render(
  <WorkspaceSessionProvider
    user={{
      id: 'custom-report-qa',
      name: '离线验收用户',
      allowedAIModels: ['gpt-5.6-sol', 'gpt-6-astra'],
      preferredResearchModel: 'gpt-5.6-sol',
    }}
  >
    {location.pathname === '/' ? (
      <WorkspaceNav active="market" />
    ) : location.pathname === '/report-builder' ? (
      <Builder />
    ) : (
      <Research />
    )}
  </WorkspaceSessionProvider>,
);
