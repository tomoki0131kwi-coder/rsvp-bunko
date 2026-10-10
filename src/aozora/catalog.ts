import type { CatalogWork } from '../types';
import { idbGet, idbSet } from '../util/idb';
import { normalizeForSearch } from '../util/kana';
import { CATALOG_PATH, getMirrorBase } from './sources';

const CACHE_KEY = 'catalog:v1';
/** 図書目録の再取得間隔 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface CachedCatalog {
  fetchedAt: number;
  works: CatalogWork[];
}

interface Indexed {
  work: CatalogWork;
  title: string;
  titleYomi: string;
  people: string;
}

export class Catalog {
  private indexed: Indexed[] = [];
  private byIdMap = new Map<number, CatalogWork>();
  fetchedAt = 0;

  get size(): number {
    return this.indexed.length;
  }

  get loaded(): boolean {
    return this.indexed.length > 0;
  }

  get stale(): boolean {
    return Date.now() - this.fetchedAt > MAX_AGE_MS;
  }

  setWorks(works: CatalogWork[], fetchedAt: number): void {
    this.fetchedAt = fetchedAt;
    this.byIdMap = new Map(works.map((w) => [w.id, w]));
    this.indexed = works.map((work) => ({
      work,
      title: normalizeForSearch(work.title + work.subtitle),
      titleYomi: normalizeForSearch(work.titleYomi),
      people: normalizeForSearch(work.people.map((p) => p.name + p.yomi).join('|')),
    }));
  }

  byId(id: number): CatalogWork | undefined {
    return this.byIdMap.get(id);
  }

  /** IndexedDB のキャッシュから読む。無ければ false。 */
  async loadCached(): Promise<boolean> {
    const cached = await idbGet<CachedCatalog>(CACHE_KEY);
    if (!cached?.works?.length) return false;
    this.setWorks(cached.works, cached.fetchedAt);
    return true;
  }

  /** ミラーから最新の図書目録を取得する */
  async fetchLatest(): Promise<void> {
    const url = getMirrorBase() + CATALOG_PATH;
    const works = await new Promise<CatalogWork[]>((resolve, reject) => {
      const worker = new Worker(new URL('./catalog.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<{ ok: boolean; works?: CatalogWork[]; error?: string }>) => {
        worker.terminate();
        if (e.data.ok && e.data.works) resolve(e.data.works);
        else reject(new Error(e.data.error ?? '図書目録の読み込みに失敗しました'));
      };
      worker.onerror = (e) => {
        worker.terminate();
        reject(new Error(e.message || '図書目録の読み込みに失敗しました'));
      };
      worker.postMessage({ url });
    });
    const fetchedAt = Date.now();
    this.setWorks(works, fetchedAt);
    await idbSet(CACHE_KEY, { fetchedAt, works } satisfies CachedCatalog);
  }

  /**
   * 作品名・読み・著者名（読み）で検索する。空白区切りで AND 検索。
   * 並び順: 作品名の前方一致 → 作品名の部分一致 → 著者一致、同順位は作品名の読み順。
   */
  search(query: string, limit = 100): { works: CatalogWork[]; total: number } {
    const terms = query.split(/[\s　]+/).map(normalizeForSearch).filter(Boolean);
    if (!terms.length) return { works: [], total: 0 };
    const hits: { work: CatalogWork; score: number }[] = [];
    for (const it of this.indexed) {
      let score = 0;
      let ok = true;
      for (const t of terms) {
        if (it.title.startsWith(t) || it.titleYomi.startsWith(t)) score += 3;
        else if (it.title.includes(t) || it.titleYomi.includes(t)) score += 2;
        else if (it.people.includes(t)) score += 1;
        else {
          ok = false;
          break;
        }
      }
      if (ok) hits.push({ work: it.work, score });
    }
    hits.sort((a, b) => b.score - a.score || a.work.titleYomi.localeCompare(b.work.titleYomi, 'ja'));
    return { works: hits.slice(0, limit).map((h) => h.work), total: hits.length };
  }

  /** 作品名と著者名で 1 件探す（おすすめ一覧用） */
  find(title: string, author: string): CatalogWork | undefined {
    const t = normalizeForSearch(title);
    const a = normalizeForSearch(author);
    return this.indexed.find((it) => it.title.startsWith(t) && it.people.includes(a) && normalizeForSearch(it.work.title) === t)?.work;
  }
}
