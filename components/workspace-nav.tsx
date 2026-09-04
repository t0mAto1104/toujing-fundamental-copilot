'use client';

/* oxlint-disable next/no-html-link-for-pages -- SIWC requires top-level anchors for reserved auth routes. */

import {
  BookOpen,
  Bot,
  ChevronDown,
  Compass,
  FileChartColumn,
  Landmark,
  LineChart,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  Settings2,
  ShieldCheck,
  Sun,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

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
import {
  AI_MODELS,
  DEFAULT_AI_MODEL,
  DEFAULT_RESEARCH_MODEL,
  defaultResearchModel,
  getPreferredAIModel,
  getPreferredResearchModel,
  setPreferredAIModel,
  setPreferredResearchModel,
  type AIModelId,
} from '@/lib/ai-models';

const navItems = [
  { href: '/', icon: Compass, label: '市场总览', key: 'market' },
  { href: '/research', icon: Bot, label: 'AI 研究助手', key: 'research' },
  { href: '/industry', icon: LineChart, label: '行业比较', key: 'industry' },
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
  const { user } = useWorkspaceSession();
  const [accountOpen, setAccountOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>('system');
  const [model, setModel] = useState<AIModelId>(DEFAULT_AI_MODEL);
  const [researchModel, setResearchModel] = useState<AIModelId>(
    DEFAULT_RESEARCH_MODEL,
  );
  const allowedModels = useMemo(
    () =>
      AI_MODELS.filter(
        (option) =>
          !user?.allowedAIModels || user.allowedAIModels.includes(option.id),
      ),
    [user],
  );

  useEffect(() => {
    const storedTheme = window.localStorage.getItem('lens-theme');
    const initialTheme =
      storedTheme === 'light' || storedTheme === 'dark'
        ? storedTheme
        : 'system';
    applyTheme(initialTheme);
    const syncPreferences = window.setTimeout(() => {
      setTheme(initialTheme);
      const preferred = getPreferredAIModel();
      const permitted = allowedModels.some((option) => option.id === preferred)
        ? preferred
        : allowedModels[0]?.id || DEFAULT_AI_MODEL;
      setModel(permitted);
      if (permitted !== preferred) setPreferredAIModel(permitted);
      const researchPreferred = getPreferredResearchModel();
      const researchPermitted =
        researchPreferred &&
        allowedModels.some((option) => option.id === researchPreferred)
          ? researchPreferred
          : defaultResearchModel(allowedModels.map((option) => option.id));
      setResearchModel(researchPermitted);
      // Do not persist an inferred default or overwrite a different user's preference.
    }, 0);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const syncSystemTheme = () => {
      if ((window.localStorage.getItem('lens-theme') || 'system') === 'system')
        applyTheme('system');
    };
    media.addEventListener('change', syncSystemTheme);
    return () => {
      window.clearTimeout(syncPreferences);
      media.removeEventListener('change', syncSystemTheme);
    };
  }, [allowedModels]);

  const chooseTheme = (nextTheme: Theme) => {
    setTheme(nextTheme);
    window.localStorage.setItem('lens-theme', nextTheme);
    applyTheme(nextTheme);
  };

  const chooseModel = (nextModel: AIModelId) => {
    setModel(nextModel);
    setPreferredAIModel(nextModel);
  };

  return (
    <>
      <nav className="space-y-1.5 text-sm" aria-label="产品导航">
        {navItems
          .filter((item) => item.key !== 'admin' || user?.isAdmin)
          .map((item) => {
            const Icon = item.icon;
            const selected = item.key === active;
            return (
              <a
                key={item.key}
                href={item.href}
                aria-current={selected ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${selected ? 'border-primary/20 bg-primary/10 font-medium text-primary' : 'border-transparent text-muted-foreground hover:border-border hover:bg-card hover:text-foreground'}`}
              >
                <Icon className="size-4" />
                {item.label}
              </a>
            );
          })}
      </nav>

      <div className="mt-auto space-y-2 border-t border-border pt-3">
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
                  className="mt-2 flex w-full items-center gap-2 border border-border px-2.5 py-2 text-[10px] font-medium hover:bg-muted"
                >
                  <UsersRound className="size-3.5" />
                  <span className="flex-1 text-left">登录其他用户</span>
                  <span className="text-[8px] text-muted-foreground">
                    先退出当前账户
                  </span>
                </a>
                <a
                  href="/signout-with-chatgpt?return_to=%2F"
                  target="_top"
                  className="mt-1 flex w-full items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <LogOut className="size-3.5" />
                  退出登录
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
              <label
                htmlFor="ai-model-choice"
                className="mt-2 block text-[10px] font-medium"
              >
                市场 Chat / 普通问答模型
              </label>
              <NativeSelect
                id="ai-model-choice"
                size="sm"
                value={model}
                onChange={(event) =>
                  chooseModel(event.target.value as AIModelId)
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
                htmlFor="research-model-choice"
                className="mt-2 block text-[10px] font-medium"
              >
                深度研究模型
              </label>
              <NativeSelect
                id="research-model-choice"
                size="sm"
                value={researchModel}
                onChange={(event) => {
                  const next = event.target.value as AIModelId;
                  setResearchModel(next);
                  setPreferredResearchModel(next);
                }}
                className="mt-1 w-full"
              >
                {allowedModels.map((option) => (
                  <NativeSelectOption key={option.id} value={option.id}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <p className="mt-1.5 text-[9px] leading-4 text-muted-foreground">
                深度研究默认
                Sol，费用高于普通问答；仅手动发起时运行。受管理员允许模型范围约束。
              </p>
              <p className="mt-1.5 text-[9px] leading-4 text-muted-foreground">
                {user?.allowedAIModels
                  ? `管理员允许 ${allowedModels.length} 个模型；服务端会强制校验。`
                  : '登录后由管理员策略决定可选模型。'}
              </p>
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

        <div className="rounded-xl border border-border bg-card/70 p-3">
          <div className="flex items-center gap-2 text-xs font-medium">
            <BookOpen className="size-3.5" />
            研究原则
          </div>
          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
            基于政策、行业、资金、财报与宏观数据，不使用技术指标。
          </p>
        </div>
        <p className="px-1 text-[9px] leading-4 text-muted-foreground">
          仅供信息参考，不构成投资建议
        </p>
      </div>
    </>
  );
}
