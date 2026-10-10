import { browseHash } from '../aozora/browseQuery';
import type { Catalog } from '../aozora/catalog';
import { FACET_BY_KEY, type FacetKey } from '../aozora/facets';
import type { CatalogWork } from '../types';
import { loadRecent, removeRecent, type RecentEntry } from '../util/storage';
import { ICONS, clear, h, icon } from './dom';
import { installState, isStandalone, onInstallChange, promptInstall } from './install';
import { formatReadingTime, workItem as sharedWorkItem } from './workList';

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
  /** #/browse?… などへ移る */
  navigate: (hash: string) => void;
  openPerson: (id: number) => void;
  /** 読了時間の目安に使う速さ（字/分） */
  cpm: () => number;
}

/** ホームの「さがす」に並べる、よく使う括りの組み合わせ */
const GENRE_SHORTCUTS: { label: string; facets: Partial<Record<FacetKey, string>> }[] = [
  { label: '日本の小説・物語', facets: { field: '91', form: '3' } },
  { label: '詩歌', facets: { form: '1' } },
  { label: '評論・エッセイ・随筆', facets: { form: '4' } },
  { label: '戯曲', facets: { form: '2' } },
  { label: '日記・書簡・紀行', facets: { form: '5' } },
  { label: '児童書', facets: { audience: 'kids' } },
  { label: '英米文学', facets: { field: '93' } },
  { label: 'フランス文学', facets: { field: '95' } },
  { label: 'ドイツ文学', facets: { field: '94' } },
  { label: 'ロシア・ソビエト文学', facets: { field: '98' } },
  { label: '中国文学・東洋文学', facets: { field: '92' } },
  { label: '哲学・宗教', facets: { field: '1' } },
  { label: '歴史・地理', facets: { field: '2' } },
  { label: '社会科学', facets: { field: '3' } },
  { label: '自然科学', facets: { field: '4' } },
  { label: '芸術・スポーツ', facets: { field: '7' } },
];

/** 長さの括りの上限（字）。読了時間の目安を出すのに使う */
const LENGTH_MAX: Record<string, number> = { s1: 3000, s2: 10000, s3: 30000, s4: 100000 };

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
  const discoverSection = h('section', { class: 'section discover' });
  const installSection = h('section', { class: 'install-card', hidden: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(update, 120);
  });

  const workItem = (w: CatalogWork) =>
    sharedWorkItem(w, { openWork: ctx.openWork, openPerson: ctx.openPerson, cpm: ctx.cpm() });

  function update() {
    lastQuery = input.value;
    clear(results);
    const state = ctx.catalogState();
    renderStatus(state);
    const q = input.value.trim();
    picksSection.hidden = !!q;
    recentSection.hidden = !!q;
    discoverSection.hidden = !!q;
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

  /** ジャンル・長さ・時代・作家などの括りから探す入口 */
  function renderDiscover() {
    clear(discoverSection);
    const catalog = ctx.catalog;
    if (!catalog.loaded) return;
    const count = (facets: Partial<Record<FacetKey, string>>) =>
      catalog.browse({ q: '', textOnly: true, sort: 'title', facets }).works.length;
    const chip = (label: string, hash: string, n?: number) =>
      h(
        'a',
        { class: 'chip', href: hash, onclick: (e: Event) => (e.preventDefault(), ctx.navigate(hash)) },
        label,
        n !== undefined ? h('span', { class: 'chip-count' }, n.toLocaleString()) : null,
      );
    const group = (title: string, chips: Node[], extra?: Node) =>
      h('div', { class: 'discover-group' }, h('h3', {}, title), h('div', { class: 'chips' }, chips, extra ?? null));

    const genres = GENRE_SHORTCUTS.map((g) => ({ ...g, n: count(g.facets) }))
      .filter((g) => g.n > 0)
      .map((g) => chip(g.label, browseHash({ facets: g.facets }), g.n));

    const lengths = catalog.hasLength
      ? FACET_BY_KEY.length.options
          .filter((o) => o.value !== 'unknown')
          .map((o) => {
            const max = LENGTH_MAX[o.value];
            const time = max ? `（〜${formatReadingTime(max, ctx.cpm()).replace('約', '')}）` : '';
            return chip(`${o.label}${time}`, browseHash({ facets: { length: o.value } }), count({ length: o.value }));
          })
      : [];

    const eras = FACET_BY_KEY.era.options
      .filter((o) => o.value !== 'unknown')
      .map((o) => chip(`${o.label}生まれ`, browseHash({ facets: { era: o.value } }), count({ era: o.value })));

    const topAuthors = [...catalog.authors()]
      .filter((a) => a.authored > 0)
      .sort((a, b) => b.withText - a.withText)
      .slice(0, 16)
      .map((a) => chip(a.name, browseHash({ person: a.id }), a.withText));

    discoverSection.append(
      h(
        'div',
        { class: 'section-head' },
        h('h2', {}, '作品をさがす'),
        h('a', { class: 'link', href: '#/browse', onclick: (e: Event) => (e.preventDefault(), ctx.navigate('#/browse')) }, 'すべての作品から条件で絞り込む'),
      ),
      group('ジャンル', genres),
      lengths.length ? group(`長さ（${ctx.cpm()} 字/分で読んだときの目安）`, lengths) : '',
      group('作家の生まれた時代', eras),
      group(
        '作家（すぐ読める作品が多い順）',
        topAuthors,
        h('a', { class: 'chip chip-more', href: '#/authors', onclick: (e: Event) => (e.preventDefault(), ctx.navigate('#/authors')) }, '作家一覧（五十音順）'),
      ),
    );
  }

  /** アプリとしてインストールできるときだけ出す案内 */
  function renderInstall() {
    clear(installSection);
    const state = installState();
    installSection.hidden = isStandalone() || state === 'unavailable';
    if (installSection.hidden) return;
    if (state === 'installed') {
      installSection.append(h('p', {}, 'インストールしました。ホーム画面やアプリ一覧の「RSVP文庫」から開けます。'));
      return;
    }
    installSection.append(
      h(
        'div',
        { class: 'install-text' },
        h('strong', {}, 'アプリとしてインストール'),
        h('span', { class: 'muted small' }, 'ホーム画面から、ブラウザの枠のない画面で開けるようになります。'),
      ),
      h('button', { class: 'button primary', type: 'button', onclick: () => void promptInstall() }, 'インストール'),
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
      h('h1', { class: 'brand' }, h('img', { class: 'brand-mark', src: './favicon.svg', alt: '' }), 'RSVP文庫'),
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
      installSection,
      h('div', { class: 'search' }, icon(ICONS.search), input),
      status,
      results,
      recentSection,
      discoverSection,
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
          '。図書目録・図書カードのデータは ',
          h('a', { href: 'https://creativecommons.org/licenses/by/4.0/deed.ja', target: '_blank', rel: 'noopener' }, 'CC BY 4.0'),
          '、本文は ',
          h('a', { href: 'https://github.com/aozorahack/aozorabunko_text', target: '_blank', rel: 'noopener' }, 'aozorabunko_text'),
          ' 経由で取得。文節区切り: ',
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
    renderDiscover();
    renderPicks();
    update();
  });
  const unsubscribeInstall = onInstallChange(renderInstall);
  renderInstall();
  renderRecent();
  renderDiscover();
  renderPicks();
  update();
  if (!lastQuery && matchMedia('(pointer: fine)').matches) input.focus();

  return () => {
    clearTimeout(timer);
    unsubscribe();
    unsubscribeInstall();
    root.removeEventListener('drop', onDrop);
    root.removeEventListener('dragover', onDragOver);
    root.removeEventListener('dragleave', onDragLeave);
  };
}
