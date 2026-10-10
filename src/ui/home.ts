import { peopleLabel } from '../aozora/catalogParse';
import type { Catalog } from '../aozora/catalog';
import type { CatalogWork } from '../types';
import { loadRecent, removeRecent, type RecentEntry } from '../util/storage';
import { ICONS, clear, h, icon } from './dom';

export interface HomeContext {
  catalog: Catalog;
  catalogState: () => CatalogState;
  refreshCatalog: () => void;
  openWork: (id: number) => void;
  openRecent: (entry: RecentEntry) => void;
  openFile: (file: File) => void;
  openUrl: (url: string) => void;
  openSettings: () => void;
  onCatalogChange: (fn: () => void) => () => void;
}

export type CatalogState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready' }
  | { status: 'error'; message: string };

/** 図書目録から作品名・著者名で引く「はじめての一冊」 */
const PICKS: [string, string][] = [
  ['走れメロス', '太宰治'],
  ['羅生門', '芥川竜之介'],
  ['蜘蛛の糸', '芥川竜之介'],
  ['銀河鉄道の夜', '宮沢賢治'],
  ['注文の多い料理店', '宮沢賢治'],
  ['檸檬', '梶井基次郎'],
  ['山月記', '中島敦'],
  ['高瀬舟', '森鴎外'],
  ['坊っちゃん', '夏目漱石'],
  ['こころ', '夏目漱石'],
  ['人間失格', '太宰治'],
  ['桜の森の満開の下', '坂口安吾'],
];

let lastQuery = '';

export function renderHome(root: HTMLElement, ctx: HomeContext): () => void {
  clear(root);
  const results = h('div', { class: 'results', 'aria-live': 'polite' });
  const status = h('p', { class: 'catalog-status' });
  const input = h('input', {
    type: 'search',
    class: 'search-input',
    placeholder: '作品名・作家名で検索（例: 銀河鉄道、なつめそうせき）',
    'aria-label': '作品を検索',
    autocomplete: 'off',
    enterkeyhint: 'search',
    value: lastQuery,
  });
  const recentSection = h('section', { class: 'section' });
  const picksSection = h('section', { class: 'section' });

  let timer: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(update, 120);
  });

  const workItem = (w: CatalogWork) =>
    h(
      'li',
      {},
      h(
        'button',
        { class: 'work', type: 'button', onclick: () => ctx.openWork(w.id) },
        h('span', { class: 'work-title' }, w.title, w.subtitle ? h('small', {}, '　', w.subtitle) : null),
        h(
          'span',
          { class: 'work-meta' },
          peopleLabel(w),
          w.kana ? h('span', { class: 'badge' }, w.kana) : null,
          w.copyrighted ? h('span', { class: 'badge badge-warn', title: '著作権存続中（青空文庫が許諾を得て公開）' }, '著作権あり') : null,
          w.mirrorPath
            ? null
            : h('span', { class: 'badge badge-warn', title: '本文ミラーに未収録。ファイルを開いて読むことはできます' }, '本文ミラー未収録'),
        ),
      ),
    );

  function update() {
    lastQuery = input.value;
    clear(results);
    const state = ctx.catalogState();
    renderStatus(state);
    const q = input.value.trim();
    picksSection.hidden = !!q;
    recentSection.hidden = !!q;
    if (!q) return;
    if (!ctx.catalog.loaded) {
      results.append(h('p', { class: 'muted' }, '図書目録を読み込み中です…'));
      return;
    }
    const { works, total } = ctx.catalog.search(q);
    if (!total) {
      results.append(h('p', { class: 'muted' }, `「${q}」に一致する作品は見つかりませんでした。`));
      return;
    }
    results.append(
      h('p', { class: 'muted' }, total > works.length ? `${total.toLocaleString()} 件中 ${works.length} 件を表示` : `${total.toLocaleString()} 件`),
      h('ul', { class: 'work-list' }, works.map(workItem)),
    );
  }

  function renderStatus(state: CatalogState) {
    clear(status);
    if (state.status === 'loading') {
      status.append(h('span', { class: 'spinner', 'aria-hidden': 'true' }), '図書目録を読み込んでいます…');
    } else if (state.status === 'error') {
      status.append(
        h('span', { class: 'error-text' }, `図書目録を読み込めませんでした: ${state.message}`),
        ' ',
        h('button', { class: 'link', type: 'button', onclick: ctx.refreshCatalog }, '再試行'),
      );
    } else if (ctx.catalog.loaded) {
      const date = (iso: string) => (iso ? new Date(iso).toLocaleDateString('ja-JP') : '不明');
      status.append(
        `収録 ${ctx.catalog.size.toLocaleString()} 作品・うち本文あり ${ctx.catalog.withText.toLocaleString()} 作品`,
        h(
          'span',
          { class: 'small' },
          `（目録: ${date(ctx.catalog.generatedAt)} 時点／本文ミラー: ${date(ctx.catalog.mirrorUpdatedAt)} 時点）`,
        ),
      );
    }
  }

  function renderRecent() {
    clear(recentSection);
    const recent = loadRecent();
    if (!recent.length) return;
    recentSection.append(
      h('h2', {}, '続きを読む'),
      h(
        'ul',
        { class: 'work-list' },
        recent.map((r) =>
          h(
            'li',
            { class: 'recent-item' },
            h(
              'button',
              { class: 'work', type: 'button', onclick: () => ctx.openRecent(r) },
              h('span', { class: 'work-title' }, r.title),
              h('span', { class: 'work-meta' }, r.author, h('span', { class: 'badge' }, `${Math.floor(r.progress * 100)}%`)),
              h('span', { class: 'meter', 'aria-hidden': 'true' }, h('span', { style: `width:${(r.progress * 100).toFixed(1)}%` })),
            ),
            h(
              'button',
              {
                class: 'icon-button subtle',
                type: 'button',
                title: '履歴から削除',
                'aria-label': `${r.title} を履歴から削除`,
                onclick: () => {
                  removeRecent(r.key);
                  renderRecent();
                },
              },
              icon(ICONS.trash),
            ),
          ),
        ),
      ),
    );
  }

  function renderPicks() {
    clear(picksSection);
    if (!ctx.catalog.loaded) return;
    const works = PICKS.map(([t, a]) => ctx.catalog.find(t, a)).filter((w): w is CatalogWork => !!w);
    if (!works.length) return;
    picksSection.append(h('h2', {}, 'はじめての一冊に'), h('ul', { class: 'work-list grid' }, works.map(workItem)));
  }

  const fileInput = h('input', {
    type: 'file',
    accept: '.zip,.txt,.html,.htm,.xhtml',
    class: 'visually-hidden',
    onchange: () => {
      const f = fileInput.files?.[0];
      if (f) ctx.openFile(f);
    },
  });
  const urlInput = h('input', {
    type: 'url',
    class: 'text-input',
    placeholder: 'https://www.aozora.gr.jp/cards/…',
    'aria-label': '青空文庫の URL',
  });

  root.append(
    h(
      'header',
      { class: 'topbar' },
      h('h1', { class: 'brand' }, h('span', { class: 'brand-mark' }, '速'), 'RSVP文庫'),
      h('button', { class: 'icon-button', type: 'button', 'aria-label': '設定', onclick: ctx.openSettings }, icon(ICONS.settings)),
    ),
    h(
      'main',
      { class: 'home' },
      h(
        'section',
        { class: 'intro' },
        h('p', {}, '青空文庫の作品を、文節ごとに画面の中央へ次々と表示して読む「高速逐次提示（RSVP）」リーダーです。視線を動かさずに読めます。'),
      ),
      h('div', { class: 'search' }, icon(ICONS.search), input),
      status,
      results,
      recentSection,
      picksSection,
      h(
        'section',
        { class: 'section other-sources' },
        h('h2', {}, 'ほかの方法で開く'),
        h(
          'div',
          { class: 'source-row' },
          h('label', { class: 'button' }, icon(ICONS.file), 'ファイルを開く', fileInput),
          h('span', { class: 'muted small' }, '青空文庫の ZIP・テキスト・XHTML ファイルに対応。ここにドロップしても開けます。'),
        ),
        h(
          'form',
          {
            class: 'source-row',
            onsubmit: (e: Event) => {
              e.preventDefault();
              if (urlInput.value.trim()) ctx.openUrl(urlInput.value.trim());
            },
          },
          urlInput,
          h('button', { class: 'button', type: 'submit' }, 'URL から開く'),
        ),
      ),
      h(
        'footer',
        { class: 'footer' },
        h(
          'p',
          {},
          '作品データ: ',
          h('a', { href: 'https://www.aozora.gr.jp/', target: '_blank', rel: 'noopener' }, '青空文庫'),
          '（本文は ',
          h('a', { href: 'https://github.com/aozorahack/aozorabunko_text', target: '_blank', rel: 'noopener' }, 'aozorabunko_text'),
          ' 経由で取得）。文節区切り: ',
          h('a', { href: 'https://github.com/google/budoux', target: '_blank', rel: 'noopener' }, 'BudouX'),
          '。',
          h('a', { href: './THIRD_PARTY_LICENSES.txt', target: '_blank', rel: 'noopener' }, 'ライセンス表記'),
        ),
      ),
    ),
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    root.classList.remove('dragging');
    const f = e.dataTransfer?.files?.[0];
    if (f) ctx.openFile(f);
  };
  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    root.classList.add('dragging');
  };
  const onDragLeave = () => root.classList.remove('dragging');
  root.addEventListener('drop', onDrop);
  root.addEventListener('dragover', onDragOver);
  root.addEventListener('dragleave', onDragLeave);

  const unsubscribe = ctx.onCatalogChange(() => {
    renderPicks();
    update();
  });
  renderRecent();
  renderPicks();
  update();
  if (!lastQuery && matchMedia('(pointer: fine)').matches) input.focus();

  return () => {
    clearTimeout(timer);
    unsubscribe();
    root.removeEventListener('drop', onDrop);
    root.removeEventListener('dragover', onDragOver);
    root.removeEventListener('dragleave', onDragLeave);
  };
}
