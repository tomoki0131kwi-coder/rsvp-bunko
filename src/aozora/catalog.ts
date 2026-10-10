import type { CatalogWork } from '../types';
import { normalizeForSearch } from '../util/kana';
import { decodeWorks, type CatalogFile } from './catalogFormat';

/** デプロイ時に scripts/build-catalog.ts が作り、アプリと一緒に配信する図書目録 */
export const CATALOG_URL = './catalog.json';

interface Indexed {
  work: CatalogWork;
  title: string;
  titleYomi: string;
  people: string;
}

export class Catalog {
  private indexed: Indexed[] = [];
  private byIdMap = new Map<number, CatalogWork>();
  /** 図書目録を作った日時 */
  generatedAt = '';
  /** 本文ミラーの更新日時 */
  mirrorUpdatedAt = '';

  get size(): number {
    return this.indexed.length;
  }

  get loaded(): boolean {
    return this.indexed.length > 0;
  }

  get withText(): number {
    return this.indexed.filter((it) => it.work.mirrorPath).length;
  }

  setWorks(works: CatalogWork[]): void {
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

  async load(signal?: AbortSignal): Promise<void> {
    const res = await fetch(CATALOG_URL, { signal, cache: 'no-cache' });
    if (res.status === 404) {
      throw new Error('図書目録（catalog.json）がありません。開発環境では npm run catalog で作成してください。');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const file = (await res.json()) as CatalogFile;
    this.generatedAt = file.generatedAt;
    this.mirrorUpdatedAt = file.mirror?.updatedAt ?? '';
    this.setWorks(decodeWorks(file.works));
  }

  /**
   * 作品名・読み・著者名（読み）で検索する。空白区切りで AND 検索。
   * 並び順: 作品名の前方一致 → 作品名の部分一致 → 著者一致。同順位なら本文のある作品 → 作品名の読み順。
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
    hits.sort(
      (a, b) =>
        b.score - a.score ||
        Number(!!b.work.mirrorPath) - Number(!!a.work.mirrorPath) ||
        a.work.titleYomi.localeCompare(b.work.titleYomi, 'ja'),
    );
    return { works: hits.slice(0, limit).map((h) => h.work), total: hits.length };
  }

  /** 作品名と著者名で 1 件探す（おすすめ一覧用）。本文のある版を優先する。 */
  find(title: string, author: string): CatalogWork | undefined {
    const t = normalizeForSearch(title);
    const a = normalizeForSearch(author);
    const hits = this.indexed.filter(
      (it) => it.title.startsWith(t) && it.people.includes(a) && normalizeForSearch(it.work.title) === t,
    );
    return (hits.find((it) => it.work.mirrorPath) ?? hits[0])?.work;
  }
}
