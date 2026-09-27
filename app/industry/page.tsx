'use client';

import { useState } from 'react';
import { WorkspaceShell } from '@/components/workspace-shell';
import { IndustryComparison } from '@/components/industry-comparison';
import { IndustryResearch } from '@/components/industry-research';
import { BoardFunds } from '@/components/market-signals';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function IndustryPage() {
  const [view, setView] = useState('research');
  return (
    <WorkspaceShell active="industry">
      <div className="mx-auto max-w-7xl space-y-5">
        <header>
          <p className="eyebrow">INDUSTRY RESEARCH</p>
          <h1 className="mt-1 text-3xl font-semibold">行业研究</h1>
        </header>
        <Tabs value={view} onValueChange={(value) => setView(String(value))}>
          <TabsList aria-label="行业研究视图">
            <TabsTrigger value="research" onClick={() => setView('research')}>
              单行业研究
            </TabsTrigger>
            <TabsTrigger value="compare" onClick={() => setView('compare')}>
              双行业比较
            </TabsTrigger>
            <TabsTrigger value="funds" onClick={() => setView('funds')}>
              板块资金
            </TabsTrigger>
          </TabsList>
          <TabsContent value="research" keepMounted>
            <IndustryResearch active={view === 'research'} />
          </TabsContent>
          <TabsContent value="compare" keepMounted>
            <IndustryComparison active={view === 'compare'} />
          </TabsContent>
          <TabsContent value="funds">
            <BoardFunds />
          </TabsContent>
        </Tabs>
      </div>
    </WorkspaceShell>
  );
}
