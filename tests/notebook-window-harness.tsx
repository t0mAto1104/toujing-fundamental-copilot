import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NotebookProvider } from '@/components/notebook-window';
import { NotebookButton } from '@/components/notebook-button';
import { WorkspaceSessionProvider } from '@/components/workspace-session';
import '@/app/globals.css';

function Harness() {
  const [owner, setOwner] = useState(
    () => sessionStorage.getItem('notebook-qa-owner') || 'qa-a',
  );
  return (
    <WorkspaceSessionProvider
      user={
        owner === 'anonymous'
          ? null
          : { id: owner, name: owner, email: `${owner}@qa.invalid` }
      }
    >
      <NotebookProvider>
        <main
          style={{
            minHeight: '100vh',
            padding: 16,
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <header
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <strong>透镜 · 笔记交互测试</strong>
            <NotebookButton />
            <select
              aria-label="测试账号"
              value={owner}
              onChange={(event) => {
                sessionStorage.setItem('notebook-qa-owner', event.target.value);
                setOwner(event.target.value);
              }}
            >
              <option value="qa-a">账号 A</option>
              <option value="qa-b">账号 B</option>
              <option value="anonymous">未登录</option>
            </select>
          </header>
          <section
            style={{
              marginTop: 32,
              maxWidth: 640,
              padding: 24,
              border: '1px solid var(--border)',
              borderRadius: 12,
              background: 'var(--card)',
            }}
          >
            <h1 style={{ fontSize: 24 }}>研究工作台</h1>
            <p style={{ marginTop: 12 }}>
              记录判断、整理问题，并在不同研究页面之间继续编辑。
            </p>
            <a
              href="/qa-next"
              style={{
                display: 'inline-block',
                marginTop: 16,
                textDecoration: 'underline',
              }}
            >
              进入另一研究页
            </a>
          </section>
        </main>
      </NotebookProvider>
    </WorkspaceSessionProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
