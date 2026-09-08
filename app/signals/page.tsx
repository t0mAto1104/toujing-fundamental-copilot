'use client';

import { WalletCards } from 'lucide-react';
import { WorkspaceShell } from '@/components/workspace-shell';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DragonBoard, Northbound, Unlocks } from '@/components/market-signals';

export default function SignalsPage() {
  return (
    <WorkspaceShell active="signals">
      <div className="space-y-5">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <WalletCards className="size-6 text-primary" />
          资金与事件
        </h1>
        <Tabs defaultValue="dragon">
          <TabsList aria-label="资金与事件栏目">
            <TabsTrigger value="dragon">全市场龙虎榜</TabsTrigger>
            <TabsTrigger value="northbound">沪深港通</TabsTrigger>
            <TabsTrigger value="unlocks">解禁日历</TabsTrigger>
          </TabsList>
          <TabsContent value="dragon">
            <DragonBoard />
          </TabsContent>
          <TabsContent value="northbound">
            <Northbound />
          </TabsContent>
          <TabsContent value="unlocks">
            <Unlocks />
          </TabsContent>
        </Tabs>
      </div>
    </WorkspaceShell>
  );
}
