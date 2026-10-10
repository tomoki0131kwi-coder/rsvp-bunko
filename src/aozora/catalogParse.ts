import type { CatalogWork } from '../types';
import { parseCsv } from './csv';

/**
 * 青空文庫「公開中　作家別作品一覧拡充版：全て」（list_person_all_extended_utf8.csv）を作品単位にまとめる。
 * この CSV は「作品 × 人物（著者・翻訳者など）」で 1 行なので、作品 ID で束ねる。
 * 列は名前で引くので、列順が変わっても動く。
 */
export function parseCatalogCsv(text: string): CatalogWork[] {
  const rows = parseCsv(text);
  const header = rows[0] ?? [];
  const col = (...names: string[]) => {
    for (const name of names) {
      const i = header.findIndex((h) => h.trim() === name);
      if (i >= 0) return i;
    }
    return -1;
  };
  const C = {
    id: col('作品ID'),
    title: col('作品名'),
    titleYomi: col('作品名読み'),
    subtitle: col('副題'),
    kana: col('文字遣い種別'),
    copyright: col('作品著作権フラグ'),
    published: col('公開日'),
    personId: col('人物ID'),
    sei: col('姓'),
    mei: col('名'),
    seiYomi: col('姓読み'),
    meiYomi: col('名読み'),
    role: col('役割フラグ'),
    cardUrl: col('図書カードURL'),
    textUrl: col('テキストファイルURL'),
    htmlUrl: col('XHTML/HTMLファイルURL'),
  };
  if (C.htmlUrl < 0) C.htmlUrl = header.findIndex((h) => /XHTML|HTML/.test(h) && /URL/.test(h));
  if (C.textUrl < 0) C.textUrl = header.findIndex((h) => /テキスト/.test(h) && /URL/.test(h));
  if (C.id < 0 || C.title < 0) throw new Error('図書目録 CSV の形式を認識できませんでした');

  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  const byId = new Map<number, CatalogWork>();
  for (let k = 1; k < rows.length; k++) {
    const r = rows[k];
    const id = Number(get(r, C.id));
    if (!Number.isFinite(id) || id <= 0) continue;
    let w = byId.get(id);
    if (!w) {
      w = {
        id,
        title: get(r, C.title),
        titleYomi: get(r, C.titleYomi),
        subtitle: get(r, C.subtitle),
        kana: get(r, C.kana),
        people: [],
        cardUrl: get(r, C.cardUrl),
        htmlUrl: get(r, C.htmlUrl),
        textUrl: get(r, C.textUrl),
        copyrighted: get(r, C.copyright) === 'あり',
        published: get(r, C.published),
      };
      byId.set(id, w);
    }
    const pid = Number(get(r, C.personId));
    if (pid && !w.people.some((p) => p.id === pid)) {
      w.people.push({
        id: pid,
        name: [get(r, C.sei), get(r, C.mei)].filter(Boolean).join(' '),
        yomi: [get(r, C.seiYomi), get(r, C.meiYomi)].filter(Boolean).join(' '),
        role: get(r, C.role),
      });
    }
    if (!w.htmlUrl) w.htmlUrl = get(r, C.htmlUrl);
    if (!w.textUrl) w.textUrl = get(r, C.textUrl);
  }
  // 著者を先頭に
  const order = (role: string) => (role === '著者' ? 0 : 1);
  for (const w of byId.values()) w.people.sort((a, b) => order(a.role) - order(b.role));
  return [...byId.values()];
}

/** 表示用の著者表記（翻訳者などは役割付き） */
export function peopleLabel(w: CatalogWork): string {
  return w.people
    .map((p) => (p.role && p.role !== '著者' ? `${p.name}（${p.role}）` : p.name))
    .join('、');
}
