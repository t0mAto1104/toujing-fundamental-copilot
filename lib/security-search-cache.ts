import { readDataSnapshot, storeDataSnapshot } from '@/lib/data-snapshot-cache';
import { within } from '@/lib/request-deadline';
import type { ListingOption } from '@/lib/market-listings';

const queryKey = (query: string) =>
  `securities:v1:query:${encodeURIComponent(query.trim().toUpperCase())}`;
const identityKey = (id: string) => `securities:v1:id:${id}`;
const equivalent = (a: string, b: string) =>
  a.trim().toUpperCase() === b.trim().toUpperCase();
type VerifiedIdentity = {
  listing: ListingOption;
  listings: ListingOption[];
  query: string;
};

export async function cachedSearch(query: string) {
  const cached = await within(
    readDataSnapshot<ListingOption[]>(queryKey(query)),
    350,
  ).catch(() => null);
  return cached && !cached.stale && Array.isArray(cached.value)
    ? cached.value
    : null;
}

export async function cachedIdentity(query: string, id: string) {
  if (!/^[\d]+\.[A-Za-z\d.-]+$/.test(id)) return null;
  const cached = await within(
    readDataSnapshot<VerifiedIdentity>(identityKey(id)),
    350,
  ).catch(() => null);
  if (!cached || cached.stale) return null;
  const { listing, listings, query: originalQuery } = cached.value;
  // An ID supplied by the browser is not identity evidence. Only reuse a
  // server-verified entry for the original search, exact name or exact code.
  if (
    listing?.id !== id ||
    ![originalQuery, listing.name, listing.code].some((q) =>
      equivalent(query, q),
    )
  )
    return null;
  return { listing, listings };
}

export async function rememberSearch(query: string, listings: ListingOption[]) {
  // Never persist misses or upstream failures. A newly listed/renamed company
  // must not remain hidden by a negative cache entry.
  if (!listings.length) return;
  const source = '东方财富证券搜索';
  const sourceUrl = 'https://searchapi.eastmoney.com/api/suggest/get';
  const writes = [
    storeDataSnapshot(
      queryKey(query),
      'security-search',
      listings,
      5 * 60_000,
      source,
      sourceUrl,
    ),
    ...listings.map((listing) =>
      storeDataSnapshot<VerifiedIdentity>(
        identityKey(listing.id),
        'security-identity',
        { listing, listings, query },
        24 * 60 * 60_000,
        source,
        sourceUrl,
      ),
    ),
  ];
  await within(Promise.allSettled(writes), 500).catch(() => undefined);
}
