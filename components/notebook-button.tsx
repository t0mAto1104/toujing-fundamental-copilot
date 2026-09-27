'use client';

import { useContext } from 'react';
import { NotebookPen } from 'lucide-react';
import { NotebookContext } from '@/components/notebook-context';

export function NotebookButton() {
  const notebook = useContext(NotebookContext);
  return (
    <button
      type="button"
      className="notebook-entry"
      onClick={notebook.open}
      aria-label="打开笔记本"
      title="笔记本"
      aria-haspopup="dialog"
      aria-expanded={notebook.active}
      aria-controls="workspace-notebook"
    >
      <NotebookPen className="size-4" aria-hidden="true" />
    </button>
  );
}
