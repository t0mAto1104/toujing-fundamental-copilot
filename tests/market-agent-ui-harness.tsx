// Offline browser QA only; never imported by application code.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../app/globals.css';
import { MarketAgentChat } from '../components/market-agent-chat';
import { WorkspaceSessionProvider } from '../components/workspace-session';
function Harness() {
  const [account, setAccount] = useState('A');
  const [visible, setVisible] = useState(true);
  return (
    <WorkspaceSessionProvider user={{ id: account, name: account }}>
      <button onClick={() => setAccount(account === 'A' ? 'B' : 'A')}>
        切换账户
      </button>
      <button onClick={() => setVisible(!visible)}>切换挂载</button>
      <a href="/agent-qa/other">测试页面跳转</a>
      {visible ? <MarketAgentChat /> : null}
    </WorkspaceSessionProvider>
  );
}
createRoot(document.getElementById('agent-fixture')!).render(<Harness />);
