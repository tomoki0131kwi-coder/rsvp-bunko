import './styles.css';
import { Catalog } from './aozora/catalog';
import { LoadError, loadCatalogWork, loadFromFile, loadFromUrl, setMirrorBase } from './aozora/sources';
import type { Book } from './types';
import { h } from './ui/dom';
import { renderHome, type CatalogState } from './ui/home';
import { renderReader, type ReaderHandle } from './ui/reader';
import { openSettingsDialog } from './ui/settings';
import { cacheBook, getCachedBook, loadSettings, saveSettings, type RecentEntry, type Settings } from './util/storage';

const app = document.getElementById('app')!;
let settings: Settings = loadSettings();
const catalog = new Catalog();
let catalogState: CatalogState = { status: 'idle' };
const catalogListeners = new Set<() => void>();

let cleanup: (() => void) | null = null;
let reader: ReaderHandle | null = null;
/** ルート遷移時に再取得しないよう、直前に開いた本を持っておく */
let currentBook: Book | null = null;
let loadAbort: AbortController | null = null;

applySettings(settings, settings);

// ---- 設定 ----
function applySettings(prev: Settings, next: Settings) {
  settings = next;
  saveSettings(next);
  document.documentElement.dataset.theme = next.theme === 'auto' ? '' : next.theme;
  if (next.theme === 'auto') delete document.documentElement.dataset.theme;
  setMirrorBase(next.mirror);
  reader?.applySettings(prev, next);
}

function updateSettings(patch: Partial<Settings>) {
  applySettings(settings, { ...settings, ...patch });
}

function openSettings() {
  openSettingsDialog(settings, (s) => applySettings(settings, s));
}

// ---- 図書目録 ----
function setCatalogState(s: CatalogState) {
  catalogState = s;
  for (const fn of catalogListeners) fn();
}

let catalogPromise: Promise<void> | null = null;
/** 図書目録を読み込む。読み込み中・読み込み済みなら同じ Promise を返す。 */
function ensureCatalog(): Promise<void> {
  catalogPromise ??= (async () => {
    setCatalogState({ status: 'loading' });
    try {
      await catalog.load();
      setCatalogState({ status: 'ready' });
    } catch (e) {
      catalogPromise = null;
      setCatalogState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  })();
  return catalogPromise;
}

// ---- 画面遷移 ----
function teardown() {
  loadAbort?.abort();
  loadAbort = null;
  cleanup?.();
  cleanup = null;
  reader = null;
  document.querySelectorAll('dialog').forEach((d) => d.remove());
}

function showHome() {
  teardown();
  document.title = 'RSVP文庫 — 青空文庫を高速逐次提示で読む';
  void ensureCatalog();
  cleanup = renderHome(app, {
    catalog,
    catalogState: () => catalogState,
    refreshCatalog: () => void ensureCatalog(),
    openWork: (id) => navigate(`#/work/${id}`),
    openRecent: (r) => openRecent(r),
    openFile: (f) => void openFile(f),
    openUrl: (u) => void openUrl(u),
    openSettings,
    onCatalogChange: (fn) => {
      catalogListeners.add(fn);
      return () => catalogListeners.delete(fn);
    },
  });
}

function showReader(book: Book) {
  teardown();
  currentBook = book;
  document.title = `${book.title}（${book.author}）— RSVP文庫`;
  void cacheBook(book);
  reader = renderReader(app, book, {
    settings: () => settings,
    updateSettings,
    openSettings,
    goHome: () => navigate('#/'),
  });
  const handle = reader;
  cleanup = () => handle.destroy();
}

function showLoading(message: string, onCancel?: () => void) {
  teardown();
  app.replaceChildren(
    h(
      'div',
      { class: 'loading-screen' },
      h('span', { class: 'spinner large', 'aria-hidden': 'true' }),
      h('p', {}, message),
      onCancel ? h('button', { class: 'button subtle', type: 'button', onclick: onCancel }, 'キャンセル') : null,
    ),
  );
}

function showError(error: unknown) {
  teardown();
  const message = error instanceof Error ? error.message : String(error);
  const link = error instanceof LoadError ? error.link : undefined;
  app.replaceChildren(
    h(
      'div',
      { class: 'loading-screen' },
      h('p', { class: 'error-text' }, '作品を開けませんでした'),
      h('p', { class: 'error-detail' }, message),
      link ? h('a', { class: 'button', href: link.href, target: '_blank', rel: 'noopener' }, link.label) : null,
      h('button', { class: 'button', type: 'button', onclick: () => navigate('#/') }, 'ホームに戻る'),
    ),
  );
}

function navigate(hash: string) {
  if (location.hash === hash) void route();
  else location.hash = hash;
}

async function withLoading(message: string, load: (signal: AbortSignal) => Promise<Book>): Promise<Book | null> {
  const ctrl = new AbortController();
  showLoading(message, () => {
    ctrl.abort();
    navigate('#/');
  });
  loadAbort = ctrl;
  try {
    const book = await load(ctrl.signal);
    if (ctrl.signal.aborted) return null;
    loadAbort = null;
    return book;
  } catch (e) {
    if (ctrl.signal.aborted) return null;
    showError(e);
    return null;
  }
}

async function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [kind, ...rest] = hash.split('/');
  const arg = decodeURIComponent(rest.join('/'));

  if (kind === 'work' && /^\d+$/.test(arg)) {
    const key = `aozora:${arg}`;
    if (currentBook?.key === key) return showReader(currentBook);
    const book = await withLoading('作品を読み込んでいます…', async (signal) => {
      const cached = await getCachedBook(key);
      if (cached) return cached;
      await ensureCatalog();
      const work = catalog.byId(Number(arg));
      if (!work) throw new Error(`作品 ID ${arg} が図書目録に見つかりませんでした。`);
      return loadCatalogWork(work, signal);
    });
    if (book) showReader(book);
    return;
  }

  if (kind === 'book' && arg) {
    if (currentBook?.key === arg) return showReader(currentBook);
    const book = await withLoading('作品を読み込んでいます…', async () => {
      const cached = await getCachedBook(arg);
      if (cached) return cached;
      if (arg.startsWith('url:')) {
        await ensureCatalog();
        return loadFromUrl(arg.slice(4), (id) => catalog.byId(id));
      }
      throw new Error('この本の本文は端末に保存されていません。もう一度ファイルを開いてください。');
    });
    if (book) showReader(book);
    return;
  }

  showHome();
}

function bookHash(book: Book): string {
  return book.source.kind === 'catalog' && book.source.workId ? `#/work/${book.source.workId}` : `#/book/${encodeURIComponent(book.key)}`;
}

function openRecent(r: RecentEntry) {
  if (r.source.kind === 'catalog' && r.source.workId) navigate(`#/work/${r.source.workId}`);
  else navigate(`#/book/${encodeURIComponent(r.key)}`);
}

async function openFile(file: File) {
  const book = await withLoading(`「${file.name}」を読み込んでいます…`, () => loadFromFile(file));
  if (!book) return;
  if (!book.blocks.length) return showError(new Error('本文を読み取れませんでした。青空文庫形式のファイルか確認してください。'));
  currentBook = book;
  await cacheBook(book);
  navigate(bookHash(book));
}

async function openUrl(url: string) {
  const book = await withLoading('作品を読み込んでいます…', async (signal) => {
    await ensureCatalog();
    return loadFromUrl(url, (id) => catalog.byId(id), signal);
  });
  if (!book) return;
  currentBook = book;
  await cacheBook(book);
  navigate(bookHash(book));
}

window.addEventListener('hashchange', () => void route());
void route();
