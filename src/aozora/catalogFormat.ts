import type { CatalogWork } from '../types';
import { indexMirrorPaths, pickMirrorPath } from './mirror';

/**
 * アプリに同梱する図書目録（catalog.json）の形式。
 * 1 万件を超えるので、キー名を繰り返さないよう作品は配列で持つ。
 */
export interface CatalogFile {
  version: 1;
  /** 生成日時（ISO 8601） */
  generatedAt: string;
  /** 図書目録 CSV の取得元 */
  source: string;
  /** 本文ミラーのベース URL と、そのファイル一覧を取った時点のコミット日時 */
  mirror: { base: string; updatedAt: string };
  works: CompactWork[];
}

type CompactPerson = [id: number, name: string, yomi: string, role: string];
export type CompactWork = [
  id: number,
  title: string,
  titleYomi: string,
  subtitle: string,
  kana: string,
  copyrighted: 0 | 1,
  published: string,
  people: CompactPerson[],
  cardPath: string,
  textPath: string,
  mirrorPath: string,
];

const SITE_PREFIX = /^https?:\/\/(www\.)?aozora\.gr\.jp\//;
const SITE = 'https://www.aozora.gr.jp/';
const toPath = (url: string) => url.replace(SITE_PREFIX, '');
const toUrl = (path: string) => (!path || /^https?:/.test(path) ? path : SITE + path);

/** 図書目録とミラーのファイル一覧を突き合わせ、各作品に本文のパスを付ける */
export function attachMirrorPaths(works: CatalogWork[], mirrorPaths: Iterable<string>): CatalogWork[] {
  const index = indexMirrorPaths(mirrorPaths);
  return works.map((w) => {
    const mirrorPath = pickMirrorPath(index.get(w.id), w.textUrl);
    return mirrorPath ? { ...w, mirrorPath } : { ...w };
  });
}

export function encodeWorks(works: CatalogWork[]): CompactWork[] {
  return works.map((w) => [
    w.id,
    w.title,
    w.titleYomi,
    w.subtitle,
    w.kana,
    w.copyrighted ? 1 : 0,
    w.published,
    w.people.map((p): CompactPerson => [p.id, p.name, p.yomi, p.role]),
    toPath(w.cardUrl),
    toPath(w.textUrl),
    w.mirrorPath ?? '',
  ]);
}

export function decodeWorks(rows: CompactWork[]): CatalogWork[] {
  return rows.map((r) => {
    const w: CatalogWork = {
      id: r[0],
      title: r[1],
      titleYomi: r[2],
      subtitle: r[3],
      kana: r[4],
      copyrighted: r[5] === 1,
      published: r[6],
      people: r[7].map(([id, name, yomi, role]) => ({ id, name, yomi, role })),
      cardUrl: toUrl(r[8]),
      htmlUrl: '',
      textUrl: toUrl(r[9]),
    };
    if (r[10]) w.mirrorPath = r[10];
    return w;
  });
}
