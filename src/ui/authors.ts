import type { AuthorEntry, Catalog } from '../aozora/catalog';
import { normalizeDate } from '../aozora/facets';
import { normalizeForSearch } from '../util/kana';
import { ICONS, append, clear, h, icon } from './dom';
import type { CatalogState } from './home';

export interface AuthorsContext {
  catalog: Catalog;
  catalogState: () => CatalogState;
  retryCatalog: () => void;
  onCatalogChange: (fn: () => void) => () => void;
  goHome: () => void;
  openBrowse: () => void;
  openPerson: (id: number) => void;
}

const ROW_LABELS: [string, string][] = [
  ['あ', 'あ'], ['か', 'か'], ['さ', 'さ'], ['た', 'た'], ['な', 'な'],
  ['は', 'は'], ['ま', 'ま'], ['や', 'や'], ['ら', 'ら'], ['わ', 'わ'], ['other', '他'],
];

let lastQuery = '';
let lastIncludeOthers = false;

/** 作家一覧（五十音順）。作家を選ぶとその作家の作品一覧へ移る */
export function renderAuthors(root: HTMLElement, ctx: AuthorsContext): () => void {
  clear(root);
  const input = h('input', {
    type: 'search',
    class: 'search-input',
    placeholder: '作家名で絞り込む（例: なつめ、宮沢）',
    'aria-label': '作家名',
    autocomplete: 'off',
    value: lastQuery,
  });
  const includeOthers = h('input', { type: 'checkbox', checked: lastIncludeOthers });
  const jump = h('nav', { class: 'jump', 'aria-label': '五十音で移動' });
  const body = h('div', { class: 'authors' });
  const summary = h('p', { class: 'result-summary' });

  let timer: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(render, 120);
  });
  includeOthers.addEventListener('change', render);

  function lifeYears(a: AuthorEntry): string {
    const b = normalizeDate(a.born)?.slice(0, 4);
    const d = normalizeDate(a.died)?.slice(0, 4);
    return b || d ? `${b ?? '?'}〜${d ?? ''}` : '';
  }

  function render() {
    lastQuery = input.value;
    lastIncludeOthers = includeOthers.checked;
    clear(jump);
    clear(body);
    if (!ctx.catalog.loaded) {
      const state = ctx.catalogState();
      clear(summary);
      append(summary, [
        state.status === 'error'
          ? h('span', { class: 'error-text' }, `図書目録を読み込めませんでした: ${state.message} `)
          : h('span', {}, h('span', { class: 'spinner', 'aria-hidden': 'true' }), '図書目録を読み込んでいます…'),
        state.status === 'error' ? h('button', { class: 'link', type: 'button', onclick: ctx.retryCatalog }, '再試行') : null,
      ]);
      return;
    }
    const q = normalizeForSearch(input.value);
    const authors = ctx.catalog
      .authors()
      .filter((a) => includeOthers.checked || a.authored > 0)
      .filter((a) => !q || normalizeForSearch(a.name + a.yomi).includes(q));
    summary.textContent = `${authors.length.toLocaleString()} 人`;

    for (const [row, label] of ROW_LABELS) {
      const group = authors.filter((a) => a.row === row);
      if (!group.length) {
        jump.append(h('span', { class: 'jump-item disabled' }, label));
        continue;
      }
      const id = `row-${row}`;
      jump.append(
        h(
          'a',
          {
            class: 'jump-item',
            href: `#${id}`,
            onclick: (e: Event) => {
              e.preventDefault();
              document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            },
          },
          label,
        ),
      );
      body.append(
        h(
          'section',
          { class: 'author-section', id },
          h('h2', {}, row === 'other' ? 'その他' : `${label}行`),
          h(
            'ul',
            { class: 'author-list' },
            group.map((a) =>
              h(
                'li',
                {},
                h(
                  'button',
                  { class: 'author', type: 'button', onclick: () => ctx.openPerson(a.id) },
                  h('span', { class: 'author-name' }, a.name),
                  h(
                    'span',
                    { class: 'author-meta' },
                    lifeYears(a),
                    h('span', { class: 'badge' }, `${(a.authored + a.other).toLocaleString()}作品`),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    }
  }

  root.append(
    h(
      'header',
      { class: 'topbar' },
      h('button', { class: 'icon-button', type: 'button', 'aria-label': 'ホームに戻る', onclick: ctx.goHome }, icon(ICONS.back)),
      h('h1', { class: 'page-title' }, '作家一覧'),
      h('button', { class: 'button subtle', type: 'button', onclick: ctx.openBrowse }, '作品をさがす'),
    ),
    h(
      'main',
      { class: 'home' },
      h('div', { class: 'search' }, icon(ICONS.search), input),
      h('div', { class: 'browse-options' }, h('label', { class: 'check inline' }, includeOthers, h('span', {}, '翻訳者・編者なども含める'))),
      jump,
      summary,
      body,
    ),
  );

  const unsubscribe = ctx.onCatalogChange(render);
  render();
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}
