import type { BrowseFilter, Catalog } from '../aozora/catalog';
import { SORT_OPTIONS, filterToParams } from '../aozora/browseQuery';
import { FACETS, type FacetKey } from '../aozora/facets';
import { ICONS, append, clear, h, icon } from './dom';
import type { CatalogState } from './home';
import { workItem, type WorkListContext } from './workList';

export interface BrowseContext extends WorkListContext {
  catalog: Catalog;
  catalogState: () => CatalogState;
  retryCatalog: () => void;
  onCatalogChange: (fn: () => void) => () => void;
  goHome: () => void;
  openAuthors: () => void;
}

const PAGE = 50;

/** 作品をさがす画面。括り（ジャンル・長さなど）とキーワードを組み合わせて絞り込む */
export function renderBrowse(root: HTMLElement, initial: BrowseFilter, ctx: BrowseContext): () => void {
  clear(root);
  let filter: BrowseFilter = structuredClone(initial);
  let shown = PAGE;

  const input = h('input', {
    type: 'search',
    class: 'search-input',
    placeholder: 'この条件の中から作品名・作家名で絞り込む',
    'aria-label': 'キーワード',
    autocomplete: 'off',
    enterkeyhint: 'search',
    value: filter.q,
  });
  const personSlot = h('div', { class: 'chips' });
  const facetGrid = h('div', { class: 'facet-grid' });
  const optionsRow = h('div', { class: 'browse-options' });
  const summary = h('p', { class: 'result-summary', 'aria-live': 'polite' });
  const list = h('ul', { class: 'work-list' });
  const more = h('div', { class: 'more' });

  let timer: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => update({ q: input.value }), 150);
  });

  function update(patch: Partial<BrowseFilter>) {
    filter = { ...filter, ...patch, facets: { ...filter.facets, ...(patch.facets ?? {}) } };
    for (const k of Object.keys(filter.facets) as FacetKey[]) if (!filter.facets[k]) delete filter.facets[k];
    shown = PAGE;
    // 履歴を増やさずに URL だけ書き換える（条件をブックマーク・共有できるように）
    const qs = filterToParams(filter).toString();
    history.replaceState(null, '', qs ? `#/browse?${qs}` : '#/browse');
    render();
  }

  function render() {
    clear(personSlot);
    clear(facetGrid);
    clear(optionsRow);
    clear(list);
    clear(more);
    const catalog = ctx.catalog;
    const state = ctx.catalogState();
    if (!catalog.loaded) {
      clear(summary);
      append(summary, [
        state.status === 'error'
          ? h('span', { class: 'error-text' }, `図書目録を読み込めませんでした: ${state.message} `)
          : h('span', {}, h('span', { class: 'spinner', 'aria-hidden': 'true' }), '図書目録を読み込んでいます…'),
        state.status === 'error' ? h('button', { class: 'link', type: 'button', onclick: ctx.retryCatalog }, '再試行') : null,
      ]);
      return;
    }

    if (filter.person !== undefined) {
      const p = catalog.person(filter.person);
      personSlot.append(
        h(
          'span',
          { class: 'chip active' },
          `作家: ${p?.name ?? filter.person}`,
          h(
            'button',
            { class: 'chip-remove', type: 'button', 'aria-label': '作家の条件を外す', onclick: () => update({ person: undefined }) },
            icon(ICONS.close),
          ),
        ),
      );
    }

    const { works, counts } = catalog.browse(filter);
    for (const facet of FACETS) {
      if (facet.key === 'length' && !catalog.hasLength) continue;
      const selected = filter.facets[facet.key] ?? '';
      const c = counts[facet.key];
      const select = h(
        'select',
        {
          class: selected ? 'active' : '',
          onchange: (e: Event) => update({ facets: { [facet.key]: (e.target as HTMLSelectElement).value } }),
        },
        h('option', { value: '' }, `すべて`),
        facet.options.map((o) => {
          const n = c.get(o.value) ?? 0;
          return h('option', { value: o.value, selected: o.value === selected, disabled: n === 0 && o.value !== selected }, `${o.label}（${n.toLocaleString()}）`);
        }),
      );
      facetGrid.append(h('label', { class: 'facet' }, h('span', { class: 'facet-label' }, facet.label), select));
    }

    append(optionsRow, [
      h(
        'label',
        { class: 'check inline' },
        h('input', { type: 'checkbox', checked: filter.textOnly, onchange: (e: Event) => update({ textOnly: (e.target as HTMLInputElement).checked }) }),
        h('span', {}, 'すぐ読める作品だけ（本文ミラーにある作品）'),
      ),
      h(
        'label',
        { class: 'facet inline' },
        h('span', { class: 'facet-label' }, '並び順'),
        h(
          'select',
          { onchange: (e: Event) => update({ sort: (e.target as HTMLSelectElement).value as BrowseFilter['sort'] }) },
          SORT_OPTIONS.filter((o) => o.value !== 'relevance' || filter.q).map((o) =>
            h('option', { value: o.value, selected: o.value === filter.sort || (o.value === 'title' && filter.sort === 'relevance' && !filter.q) }, o.label),
          ),
        ),
      ),
      Object.keys(filter.facets).length || filter.person !== undefined || filter.q
        ? h(
            'button',
            {
              class: 'link',
              type: 'button',
              onclick: () => {
                input.value = '';
                filter = { ...filter, q: '', person: undefined, facets: {} };
                update({});
              },
            },
            '条件をすべて外す',
          )
        : null,
    ]);

    summary.textContent = works.length ? `${works.length.toLocaleString()} 作品` : '条件に合う作品はありません。条件を減らしてみてください。';
    list.append(...works.slice(0, shown).map((w) => workItem(w, ctx)));
    if (works.length > shown) {
      more.append(
        h(
          'button',
          {
            class: 'button',
            type: 'button',
            onclick: () => {
              shown += PAGE;
              list.append(...works.slice(shown - PAGE, shown).map((w) => workItem(w, ctx)));
              if (works.length <= shown) clear(more);
              else (more.firstChild as HTMLElement).textContent = moreLabel(works.length - shown);
            },
          },
          moreLabel(works.length - shown),
        ),
      );
    }
  }

  const moreLabel = (rest: number) => `さらに表示（残り ${rest.toLocaleString()} 作品）`;

  root.append(
    h(
      'header',
      { class: 'topbar' },
      h('button', { class: 'icon-button', type: 'button', 'aria-label': 'ホームに戻る', onclick: ctx.goHome }, icon(ICONS.back)),
      h('h1', { class: 'page-title' }, '作品をさがす'),
      h('button', { class: 'button subtle', type: 'button', onclick: ctx.openAuthors }, '作家一覧'),
    ),
    h(
      'main',
      { class: 'home browse' },
      h('div', { class: 'search' }, icon(ICONS.search), input),
      personSlot,
      facetGrid,
      optionsRow,
      summary,
      list,
      more,
    ),
  );

  const unsubscribe = ctx.onCatalogChange(render);
  render();
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}
