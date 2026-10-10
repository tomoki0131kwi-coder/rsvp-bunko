import type { CatalogWork } from '../types';
import { normalizeForSearch } from '../util/kana';
import { decodeWorks, type CatalogFile } from './catalogFormat';
import { FACETS, kanaRow, mainPerson, type FacetKey } from './facets';

/** デプロイ時に scripts/build-catalog.ts が作り、アプリと一緒に配信する図書目録 */
export const CATALOG_URL = './catalog.json';

interface Indexed {
  work: CatalogWork;
  title: string;
  titleYomi: string;
  people: string;
  /** 並べ替え用の代表人物の読み */
  authorYomi: string;
  facets: Record<FacetKey, string[]>;
}

export type SortKey = 'relevance' | 'title' | 'author' | 'short' | 'long' | 'new';

export interface BrowseFilter {
  /** 作品名・作家名のキーワード（空白区切りで AND） */
  q: string;
  /** 人物 ID（著者・翻訳者など、いずれかの役割で関わった作品） */
  person?: number;
  /** 本文ミラーにある作品だけ */
  textOnly: boolean;
  sort: SortKey;
  facets: Partial<Record<FacetKey, string>>;
}

export interface BrowseResult {
  works: CatalogWork[];
  /** 各括りの値ごとの件数（その括り以外の条件をすべて満たす作品を数える） */
  counts: Record<FacetKey, Map<string, number>>;
}

export interface AuthorEntry {
  id: number;
  name: string;
  yomi: string;
  born?: string;
  died?: string;
  /** 著者として関わった作品数 */
  authored: number;
  /** 翻訳・編集など著者以外の役割で関わった作品数 */
  other: number;
  /** 本文ミラーにある作品数（役割を問わない） */
  withText: number;
  /** 読みの頭文字の行（あ・か・さ…） */
  row: string;
}

export class Catalog {
  private indexed: Indexed[] = [];
  private byIdMap = new Map<number, CatalogWork>();
  private authorsCache: AuthorEntry[] | null = null;
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

  /** 長さ（本文の大きさ）の情報があるか。無い目録では長さで絞り込めない */
  get hasLength(): boolean {
    return this.indexed.some((it) => it.work.textSize);
  }

  setWorks(works: CatalogWork[]): void {
    this.byIdMap = new Map(works.map((w) => [w.id, w]));
    this.authorsCache = null;
    this.indexed = works.map((work) => ({
      work,
      title: normalizeForSearch(work.title + work.subtitle),
      titleYomi: normalizeForSearch(work.titleYomi),
      people: normalizeForSearch(work.people.map((p) => p.name + p.yomi).join('|')),
      authorYomi: normalizeForSearch(mainPerson(work)?.yomi ?? ''),
      facets: Object.fromEntries(FACETS.map((f) => [f.key, f.valuesOf(work)])) as Record<FacetKey, string[]>,
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
    if (!normalizeForSearch(query)) return { works: [], total: 0 };
    const { works } = this.browse({ q: query, textOnly: false, sort: 'relevance', facets: {} });
    return { works: works.slice(0, limit), total: works.length };
  }

  /** 括りとキーワードで絞り込み、並べ替える */
  browse(filter: BrowseFilter): BrowseResult {
    const terms = filter.q.split(/[\s　]+/).map(normalizeForSearch).filter(Boolean);
    const active = FACETS.filter((f) => filter.facets[f.key]);
    const counts = Object.fromEntries(FACETS.map((f) => [f.key, new Map<string, number>()])) as BrowseResult['counts'];
    const hits: { it: Indexed; score: number }[] = [];

    for (const it of this.indexed) {
      if (filter.textOnly && !it.work.mirrorPath) continue;
      if (filter.person !== undefined && !it.work.people.some((p) => p.id === filter.person)) continue;
      const score = terms.length ? scoreTerms(it, terms) : 0;
      if (score === null) continue;

      // 外れた括りの数。0 なら一覧に入る。1 ならその括りの件数だけに数える
      let missed = 0;
      let missedKey: FacetKey | null = null;
      for (const f of active) {
        if (!it.facets[f.key].includes(filter.facets[f.key]!)) {
          missed++;
          missedKey = f.key;
          if (missed > 1) break;
        }
      }
      if (missed > 1) continue;
      for (const f of FACETS) {
        if (missed === 1 && f.key !== missedKey) continue;
        const m = counts[f.key];
        for (const v of it.facets[f.key]) m.set(v, (m.get(v) ?? 0) + 1);
      }
      if (missed === 0) hits.push({ it, score });
    }

    const byTitle = (a: Indexed, b: Indexed) => a.titleYomi.localeCompare(b.titleYomi, 'ja');
    const byText = (a: Indexed, b: Indexed) => Number(!!b.work.mirrorPath) - Number(!!a.work.mirrorPath);
    const size = (it: Indexed) => it.work.textSize ?? 0;
    const cmp: Record<SortKey, (a: { it: Indexed; score: number }, b: { it: Indexed; score: number }) => number> = {
      relevance: (a, b) => b.score - a.score || byText(a.it, b.it) || byTitle(a.it, b.it),
      title: (a, b) => byTitle(a.it, b.it),
      author: (a, b) => a.it.authorYomi.localeCompare(b.it.authorYomi, 'ja') || byTitle(a.it, b.it),
      // 長さ不明の作品は末尾へ
      short: (a, b) => (size(a.it) || Infinity) - (size(b.it) || Infinity) || byTitle(a.it, b.it),
      long: (a, b) => size(b.it) - size(a.it) || byTitle(a.it, b.it),
      new: (a, b) => b.it.work.published.localeCompare(a.it.work.published) || byTitle(a.it, b.it),
    };
    const sort = filter.sort === 'relevance' && !terms.length ? 'title' : filter.sort;
    hits.sort(cmp[sort]);
    return { works: hits.map((h) => h.it.work), counts };
  }

  /** 作品に関わった人物の一覧（読み順） */
  authors(): AuthorEntry[] {
    if (this.authorsCache) return this.authorsCache;
    const map = new Map<number, AuthorEntry>();
    for (const { work } of this.indexed) {
      for (const p of work.people) {
        let a = map.get(p.id);
        if (!a) {
          a = { id: p.id, name: p.name, yomi: p.yomi, born: p.born, died: p.died, authored: 0, other: 0, withText: 0, row: kanaRow(p.yomi || p.name) };
          map.set(p.id, a);
        }
        if (p.role === '著者') a.authored++;
        else a.other++;
        if (work.mirrorPath) a.withText++;
      }
    }
    this.authorsCache = [...map.values()].sort(
      (a, b) => normalizeForSearch(a.yomi).localeCompare(normalizeForSearch(b.yomi), 'ja') || a.id - b.id,
    );
    return this.authorsCache;
  }

  person(id: number): AuthorEntry | undefined {
    return this.authors().find((a) => a.id === id);
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

/** キーワードとの一致度。どれか一語でも一致しなければ null */
function scoreTerms(it: Indexed, terms: string[]): number | null {
  let score = 0;
  for (const t of terms) {
    if (it.title.startsWith(t) || it.titleYomi.startsWith(t)) score += 3;
    else if (it.title.includes(t) || it.titleYomi.includes(t)) score += 2;
    else if (it.people.includes(t)) score += 1;
    else return null;
  }
  return score;
}
