'use client';

import { Building2, LoaderCircle, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Input } from '@/components/ui/input';
import type { ListingOption } from '@/lib/market-listings';

type CompanySearchFieldProps = {
  value: string;
  onValueChange: (value: string) => void;
  onResearch: (value: string, listing?: ListingOption) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  buttonLabel?: string;
  showButton?: boolean;
};

export function CompanySearchField({
  value,
  onValueChange,
  onResearch,
  placeholder = '输入公司名称或证券代码',
  className = '',
  inputClassName = '',
  buttonLabel = '开始研究',
  showButton = false,
}: CompanySearchFieldProps) {
  const [listings, setListings] = useState<ListingOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [selected, setSelected] = useState<ListingOption | undefined>();
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const requestId = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const inputFocused = useRef(false);
  const suppressQuery = useRef('');

  useEffect(() => {
    if (suppressQuery.current) {
      const shouldSuppress = suppressQuery.current === value;
      suppressQuery.current = '';
      if (shouldSuppress) {
        requestId.current += 1;
        return;
      }
    }
    const query = value.trim();
    const currentRequest = ++requestId.current;
    if (!focused || composing || query.length < 2) {
      return;
    }
    const controller = new AbortController();
    requestController.current = controller;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const timer = window.setTimeout(
      () => {
        if (query.length < 2) {
          setListings([]);
          setOpen(false);
          setLoading(false);
          return;
        }
        setLoading(true);
        setSearchError('');
        timeout = setTimeout(() => {
          timedOut = true;
          controller.abort();
          if (currentRequest !== requestId.current) return;
          setLoading(false);
          setSearchError('搜索响应超时，请稍后重试。');
        }, 10_000);
        void fetch(`/api/listings?query=${encodeURIComponent(query)}`, {
          signal: controller.signal,
          cache: 'no-store',
        })
          .then(async (response) => {
            const payload = (await response.json()) as {
              listings?: ListingOption[];
              error?: string;
            };
            if (
              currentRequest !== requestId.current ||
              controller.signal.aborted
            )
              return;
            const items = response.ok ? payload.listings || [] : [];
            setListings(items);
            setSearchError(
              response.ok
                ? ''
                : payload.error || '证券搜索暂时不可用，请稍后重试。',
            );
            setOpen(inputFocused.current);
            setActiveIndex(items.length ? 0 : -1);
          })
          .catch(() => {
            if (
              currentRequest !== requestId.current ||
              (controller.signal.aborted && !timedOut)
            )
              return;
            setListings([]);
            setSearchError(
              timedOut
                ? '搜索响应超时，请稍后重试。'
                : '证券搜索暂时不可用，请稍后重试。',
            );
            setOpen(inputFocused.current);
          })
          .finally(() => {
            clearTimeout(timeout);
            if (currentRequest === requestId.current) setLoading(false);
          });
      },
      query.length < 2 ? 0 : 260,
    );
    return () => {
      window.clearTimeout(timer);
      clearTimeout(timeout);
      controller.abort();
      if (requestController.current === controller)
        requestController.current = null;
    };
  }, [value, focused, composing]);

  const dismissSuggestions = () => {
    requestId.current += 1;
    requestController.current?.abort();
    setLoading(false);
    setOpen(false);
    setActiveIndex(-1);
  };

  const choose = (listing: ListingOption) => {
    suppressQuery.current = listing.name;
    setSelected(listing);
    onValueChange(listing.name);
    dismissSuggestions();
    onResearch(listing.name, listing);
  };

  const submit = (event: { preventDefault(): void }) => {
    event.preventDefault();
    if (composing) return;
    const query = value.trim();
    if (!query) return;
    const listing =
      selected ||
      listings.find((item) => item.name === query || item.code === query);
    dismissSuggestions();
    onResearch(query, listing);
  };

  return (
    <form onSubmit={submit} className={`relative ${className}`}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onCompositionStart={() => {
          dismissSuggestions();
          setComposing(true);
        }}
        onCompositionEnd={() => {
          setComposing(false);
          setOpen(inputFocused.current && value.trim().length >= 2);
        }}
        onChange={(event) => {
          const nextValue = event.target.value;
          dismissSuggestions();
          setListings([]);
          setSearchError('');
          if (
            selected &&
            nextValue.trim() !== selected.name &&
            nextValue.trim() !== selected.code
          )
            setSelected(undefined);
          onValueChange(nextValue);
          setOpen(!composing && nextValue.trim().length >= 2);
        }}
        onFocus={() => {
          inputFocused.current = true;
          setFocused(true);
          setListings([]);
          setSearchError('');
          if (value.trim().length >= 2) setOpen(true);
        }}
        onBlur={() => {
          inputFocused.current = false;
          setFocused(false);
          dismissSuggestions();
        }}
        onKeyDown={(event) => {
          if (composing || event.nativeEvent.isComposing) return;
          if (!open || !listings.length) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((index) => (index + 1) % listings.length);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex(
              (index) => (index - 1 + listings.length) % listings.length,
            );
          } else if (event.key === 'Enter' && activeIndex >= 0) {
            event.preventDefault();
            choose(listings[activeIndex]);
          } else if (event.key === 'Escape') {
            dismissSuggestions();
          }
        }}
        className={`pl-10 ${showButton ? 'pr-28' : ''} ${inputClassName}`}
        placeholder={placeholder}
        aria-label="搜索上市公司"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {showButton ? (
        <button
          type="submit"
          className="absolute right-2 top-1/2 h-9 -translate-y-1/2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"
        >
          {buttonLabel}
        </button>
      ) : null}
      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
          {loading ? (
            <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" />
              正在查找上市公司，请稍后…
            </div>
          ) : listings.length ? (
            <ul className="max-h-72 overflow-y-auto py-1">
              {listings.map((listing, index) => (
                <li key={listing.id}>
                  <button
                    type="button"
                    aria-current={index === activeIndex ? 'true' : undefined}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(listing)}
                    className={`grid w-full grid-cols-[20px_1fr_auto] items-center gap-2 px-3 py-2.5 text-left text-xs ${index === activeIndex ? 'bg-muted' : 'hover:bg-muted/70'}`}
                  >
                    <Building2 className="size-3.5 text-primary" />
                    <span>
                      <span className="block font-medium">{listing.name}</span>
                      <span className="mt-0.5 block text-[10px] text-muted-foreground">
                        {listing.exchange} · {listing.securityType}
                      </span>
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {listing.code} · {listing.currency}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : value.trim().length >= 2 ? (
            <div className="px-4 py-3 text-xs leading-5 text-muted-foreground">
              {searchError ||
                '未识别到上市公司。请核对名称，或尝试股票简称、证券代码。'}
            </div>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
