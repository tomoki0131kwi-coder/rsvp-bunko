import type { BrowseFilter, SortKey } from './catalog';
import { FACETS, type FacetKey } from './facets';

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'relevance', label: '一致度順' },
  { value: 'title', label: '作品名順' },
  { value: 'author', label: '作家名順' },
  { value: 'short', label: '短い順' },
  { value: 'long', label: '長い順' },
  { value: 'new', label: '公開が新しい順' },
];

export function defaultFilter(): BrowseFilter {
  return { q: '', textOnly: true, sort: 'relevance', facets: {} };
}

/** URL のクエリ（#/browse?field=91&form=3 など）から絞り込み条件を作る */
export function filterFromParams(params: URLSearchParams): BrowseFilter {
  const f = defaultFilter();
  f.q = params.get('q') ?? '';
  const person = Number(params.get('person'));
  if (Number.isInteger(person) && person > 0) f.person = person;
  if (params.get('all') === '1') f.textOnly = false;
  const sort = params.get('sort');
  if (SORT_OPTIONS.some((o) => o.value === sort)) f.sort = sort as SortKey;
  for (const facet of FACETS) {
    const v = params.get(facet.key);
    if (v && facet.options.some((o) => o.value === v)) f.facets[facet.key] = v;
  }
  return f;
}

export function filterToParams(f: BrowseFilter): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.person !== undefined) p.set('person', String(f.person));
  for (const facet of FACETS) {
    const v = f.facets[facet.key];
    if (v) p.set(facet.key, v);
  }
  if (!f.textOnly) p.set('all', '1');
  if (f.sort !== 'relevance') p.set('sort', f.sort);
  return p;
}

export function browseHash(patch: { person?: number; q?: string; facets?: Partial<Record<FacetKey, string>> } = {}): string {
  const f = { ...defaultFilter(), ...patch, facets: patch.facets ?? {} };
  const qs = filterToParams(f).toString();
  return qs ? `#/browse?${qs}` : '#/browse';
}
