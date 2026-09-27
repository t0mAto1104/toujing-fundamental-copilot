import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { NotebookEditor } from '@/components/notebook-editor';
import { emptyNotebookDocument, type NotebookDocument } from '@/lib/notebook';

declare global {
  interface Window {
    notebookTest: {
      value: NotebookDocument;
      load: (value: NotebookDocument) => void;
    };
  }
}

function Harness() {
  const [value, setValue] = useState(emptyNotebookDocument());
  useEffect(() => {
    window.notebookTest = { value, load: setValue };
  }, [value]);
  return (
    <main
      style={{
        display: 'flex',
        height: '360px',
        width: 'min(100%, 500px)',
        border: '1px solid #777',
      }}
    >
      <NotebookEditor value={value} onChange={setValue} />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
