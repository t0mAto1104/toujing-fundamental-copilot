import { BookOpenText } from 'lucide-react';
import type { Metadata } from 'next';
import { IndustryReports } from '@/components/industry-reports';
import { WorkspaceShell } from '@/components/workspace-shell';

export const metadata: Metadata = {
  title: '行业研报｜透镜',
  description:
    '浏览券商行业研报，按行业、标题或机构检索，查看原始来源及可用 PDF。',
  alternates: { canonical: '/industry-reports' },
};

export default function IndustryReportsPage() {
  return (
    <WorkspaceShell active="industry-reports">
      <div className="min-w-0 space-y-5">
        <header>
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
            <BookOpenText className="size-6 text-primary" aria-hidden="true" />
            行业研报
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            券商原始研报 · 按行业、标题或机构检索 · 查看来源及可用 PDF
          </p>
        </header>
        <IndustryReports fullPage />
      </div>
    </WorkspaceShell>
  );
}
