'use client';

/* oxlint-disable next/no-html-link-for-pages -- SIWC requires top-level anchors for reserved auth routes. */

import {
  BookOpen,
  BookOpenText,
  ChartCandlestick,
  ChevronDown,
  Compass,
  FileChartColumn,
  Globe2,
  Landmark,
  LineChart,
  LogIn,
  Monitor,
  MessagesSquare,
  Moon,
  Settings2,
  ShieldCheck,
  Sun,
  UserRound,
  WalletCards,
} from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { useWorkspaceSession } from '@/components/workspace-session';
import { AIConnectionSettings } from '@/components/ai-connection-settings';
import { SITE_VERSION } from '@/lib/site-version';
import {
  AI_MODELS,
  DEFAULT_AI_MODEL,
  DEFAULT_RESEARCH_MODEL,
  type AIModelId,
} from '@/lib/ai-models';

const navItems = [
  { href: '/', icon: Compass, label: '市场总览', key: 'market' },
  { href: '/quotes', icon: ChartCandlestick, label: '行情数据', key: 'quotes' },
  { href: '/global', icon: Globe2, label: '全球市场', key: 'global' },
  { href: '/signals', icon: WalletCards, label: '资金与事件', key: 'signals' },
  {
    href: '/sentiment',
    icon: MessagesSquare,
    label: '舆情互动',
    key: 'sentiment',
  },
  {
    href: '/report-builder',
    icon: BookOpen,
    label: 'AI自定义研报',
    key: 'research',
  },
  { href: '/industry', icon: LineChart, label: '行业研究', key: 'industry' },
  {
    href: '/industry-reports',
    icon: BookOpenText,
    label: '行业研报',
    key: 'industry-reports',
  },
  { href: '/macro', icon: Landmark, label: '宏观政策', key: 'macro' },
  {
    href: '/reports',
    icon: FileChartColumn,
    label: '我的报告',
    key: 'reports',
  },
  { href: '/admin', icon: ShieldCheck, label: '后台管理', key: 'admin' },
] as const;

type Theme = 'light' | 'dark' | 'system';

const themeOptions = [
  { value: 'light' as const, label: '日光', icon: Sun },
  { value: 'dark' as const, label: '黑夜', icon: Moon },
  { value: 'system' as const, label: '系统', icon: Monitor },
];

export type WorkspaceSection = (typeof navItems)[number]['key'];

function applyTheme(theme: Theme) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle(
    'dark',
    theme === 'dark' || (theme === 'system' && prefersDark),
  );
  document.documentElement.style.colorScheme =
    theme === 'system' ? 'light dark' : theme;
}

export function WorkspaceNav({ active }: { active: WorkspaceSection }) {
  const modelChoiceId = useId();
  const researchModelChoiceId = useId();
  const { user, saveModels, savingModels } = useWorkspaceSession();
  const [accountOpen, setAccountOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>('system');
  const [modelMessage, setModelMessage] = useState('');
  const model = user?.preferredChatModel || DEFAULT_AI_MODEL;
  const researchModel = user?.preferredResearchModel || DEFAULT_RESEARCH_MODEL;
  const allowedModels = useMemo(
    () =>
      AI_MODELS.filter(
        (option) =>
          !user?.allowedAIModels || user.allowedAIModels.includes(option.id),
      ),
    [user],
  );

  useEffect(() => {
    const syncPreferences = () => {
      const storedTheme = window.localStorage.getItem('lens-theme');
      const initialTheme =
        storedTheme === 'light' || storedTheme === 'dark'
          ? storedTheme
          : 'system';
      applyTheme(initialTheme);
      setTheme(initialTheme);
    };
    const initialSync = window.setTimeout(syncPreferences, 0);
    // Re-read settings changed in the mobile drawer when returning to desktop.
    const desktop = window.matchMedia('(min-width: 1024px)');
    desktop.addEventListener('change', syncPreferences);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const syncSystemTheme = () => {
      if ((window.localStorage.getItem('lens-theme') || 'system') === 'system')
        applyTheme('system');
    };
    media.addEventListener('change', syncSystemTheme);
    return () => {
      window.clearTimeout(initialSync);
      desktop.removeEventListener('change', syncPreferences);
      media.removeEventListener('change', syncSystemTheme);
    };
  }, []);

  const chooseTheme = (nextTheme: Theme) => {
    setTheme(nextTheme);
    window.localStorage.setItem('lens-theme', nextTheme);
    applyTheme(nextTheme);
  };

  const chooseModel = async (
    field: 'preferredChatModel' | 'preferredResearchModel',
    nextModel: AIModelId,
  ) => {
    setModelMessage('');
    try {
      await saveModels({ [field]: nextModel });
      setModelMessage('已保存');
    } catch (error) {
      setModelMessage(
        error instanceof Error ? error.message : '保存失败，请重试。',
      );
    }
  };

  return (
    <>
      <nav className="workspace-nav space-y-1.5 text-sm" aria-label="产品导航">
        {navItems
          .filter((item) => item.key !== 'admin' || user?.isAdmin)
          .map((item) => {
            const Icon = item.icon;
            const selected = item.key === active;
            return (
              <div key={item.key}>
                {item.key === 'market' ||
                item.key === 'research' ||
                item.key === 'admin' ? (
                  <p className="nav-group-label hidden" aria-hidden="true">
                    {item.key === 'market'
                      ? '市场观察'
                      : item.key === 'research'
                        ? '研究与洞察'
                        : '管理'}
                  </p>
                ) : null}
                <a
                  href={item.href}
                  aria-current={selected ? 'page' : undefined}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${selected ? 'border-primary/20 bg-primary/10 font-medium text-primary' : 'border-transparent text-muted-foreground hover:border-border hover:bg-card hover:text-foreground'}`}
                >
                  <Icon className="size-4" />
                  {item.label}
                </a>
              </div>
            );
          })}
      </nav>

      <div className="workspace-settings mt-auto space-y-2 border-t border-border pt-3">
        <Collapsible
          open={accountOpen}
          onOpenChange={setAccountOpen}
          className="overflow-hidden rounded-xl border border-border bg-card"
        >
          <CollapsibleTrigger className="flex w-full items-center gap-2.5 p-2.5 text-left hover:bg-muted/60">
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
              <UserRound className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">
                {user ? user.name || '已登录用户' : '账户与个性设置'}
              </span>
              <span className="block truncate text-[9px] text-muted-foreground">
                {user?.email || '登录、用户管理与模型选择'}
              </span>
            </span>
            <ChevronDown
              className={`size-3.5 text-muted-foreground transition-transform ${accountOpen ? 'rotate-180' : ''}`}
            />
          </CollapsibleTrigger>

          <CollapsibleContent className="border-t border-border p-2.5">
            {user ? (
              <div>
                <p className="text-[9px] font-semibold tracking-[0.12em] text-muted-foreground">
                  用户管理
                </p>
                <div className="mt-2 flex items-center gap-2 border-l-2 border-primary/40 bg-muted/50 px-2.5 py-2">
                  <UserRound className="size-3.5 text-primary" />
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-medium">
                      {user.name || '当前用户'}
                    </p>
                    <p className="truncate text-[9px] text-muted-foreground">
                      {user.email}
                    </p>
                  </div>
                </div>
                <a
                  href="/signout-with-chatgpt?return_to=%2F"
                  target="_top"
                  className="mt-2 flex min-h-11 w-full items-center justify-center whitespace-nowrap border border-border px-2.5 py-2 text-sm font-medium hover:bg-muted"
                >
                  退出当前账户
                </a>
              </div>
            ) : (
              <div>
                <p className="text-[10px] leading-4 text-muted-foreground">
                  登录后可识别当前用户并保存个性化研究体验。
                </p>
                <a
                  href="/signin-with-chatgpt?return_to=%2F"
                  target="_top"
                  className="mt-2 flex w-full items-center justify-center gap-1.5 bg-primary px-3 py-2 text-[10px] font-medium text-primary-foreground hover:opacity-90"
                >
                  <LogIn className="size-3.5" />
                  使用 ChatGPT 账户登录
                </a>
              </div>
            )}

            <div className="mt-3 border-t border-border pt-3">
              <div className="flex items-center gap-1.5 text-[9px] font-semibold tracking-[0.12em] text-muted-foreground">
                <Settings2 className="size-3" />
                个性设置
              </div>
              {user ? <AIConnectionSettings key={user.email} /> : null}
              <label
                htmlFor={modelChoiceId}
                className="mt-2 block text-[10px] font-medium"
              >
                市场 Chat / 普通问答模型
              </label>
              <NativeSelect
                id={modelChoiceId}
                size="sm"
                value={model}
                disabled={!user || user.modelPolicyUnavailable || savingModels}
                onChange={(event) =>
                  void chooseModel(
                    'preferredChatModel',
                    event.target.value as AIModelId,
                  )
                }
                className="mt-1 w-full"
              >
                {allowedModels.map((option) => (
                  <NativeSelectOption key={option.id} value={option.id}>
                    {option.label} · {option.description}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <label
                htmlFor={researchModelChoiceId}
                className="mt-2 block text-[10px] font-medium"
              >
                深度研究模型
              </label>
              <NativeSelect
                id={researchModelChoiceId}
                size="sm"
                value={researchModel}
                disabled={!user || user.modelPolicyUnavailable || savingModels}
                onChange={(event) =>
                  void chooseModel(
                    'preferredResearchModel',
                    event.target.value as AIModelId,
                  )
                }
                className="mt-1 w-full"
              >
                {allowedModels.map((option) => (
                  <NativeSelectOption key={option.id} value={option.id}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {savingModels || modelMessage || user?.modelPolicyUnavailable ? (
                <output className="mt-1.5 text-xs leading-4 text-muted-foreground">
                  {savingModels
                    ? '正在保存…'
                    : user?.modelPolicyUnavailable
                      ? '模型设置暂时无法加载，请刷新后重试。'
                      : modelMessage}
                </output>
              ) : null}
              <fieldset
                className="mt-2 grid grid-cols-3 gap-px border border-border"
                aria-label="网页背景风格"
              >
                {themeOptions.map((option) => {
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => chooseTheme(option.value)}
                      aria-label={`${option.label}模式`}
                      title={`${option.label}模式`}
                      aria-pressed={theme === option.value}
                      className={`grid h-8 place-items-center transition-colors ${theme === option.value ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                    >
                      <Icon className="size-3.5" />
                    </button>
                  );
                })}
              </fieldset>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <details className="workspace-principles rounded-xl border border-border bg-card/70 p-3">
          <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <BookOpen className="size-3.5" />
            研究原则
          </summary>
          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
            基于政策、行业、资金、财报与宏观数据，不使用技术指标。
          </p>
        </details>
        <p className="px-1 text-[9px] leading-4 text-muted-foreground">
          仅供信息参考，不构成投资建议
        </p>
        <p
          className="px-1 text-xs text-muted-foreground"
          aria-label={`当前版本 ${SITE_VERSION}`}
        >
          {SITE_VERSION}
        </p>
      </div>
    </>
  );
}
