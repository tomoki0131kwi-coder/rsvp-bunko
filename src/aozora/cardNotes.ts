/**
 * 青空文庫の図書カードにある「作品について」「人物について」（解説）。
 *
 * 図書カードのデータは「青空文庫収録ファイルの取り扱い規準」の「図書カードや書架情報について」により、
 * クリエイティブ・コモンズ 表示 4.0 国際 ライセンス（CC BY 4.0）で提供されている。
 * https://www.aozora.gr.jp/guide/kijyunn.html
 *
 * 図書カードの表の書式（2026年10月時点）:
 *   <table summary="作品データ"> … <tr><td class="header">作品について：</td><td>…</td></tr>
 *   <table summary="作家データ"> … 作家名（../../index_pages/person1670.html へのリンク）… 人物について：…
 */

export interface NoteLink {
  label: string;
  href: string;
}

/** 解説 1 件。HTML をテキストに変換し、リンク（Wikipedia の項目など）は別に持つ */
export interface CardNote {
  text: string;
  links: NoteLink[];
}

export interface ParsedCard {
  /** 作品について（無ければ undefined） */
  work?: CardNote;
  /** 作家データに載っている人物ごとの「人物について」 */
  persons: { id: number; note?: CardNote }[];
}

/** アプリと一緒に配信する解説データ（public/card-notes.json） */
export interface CardNotesFile {
  version: 1;
  /** 取得した日時（ISO 8601） */
  updatedAt: string;
  /** 作品 ID → 作品について。取得済みで解説の無い作品は 0 */
  works: Record<string, CardNote | 0>;
  /** 人物 ID → 人物について。取得済みで解説の無い人物は 0 */
  persons: Record<string, CardNote | 0>;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, e: string) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : whole;
    }
    return ENTITIES[e.toLowerCase()] ?? whole;
  });
}

/** 表のセル（HTML）を解説にする。中身が無ければ undefined */
export function cellToNote(html: string): CardNote | undefined {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<div id="link">[\s\S]*?<\/div>/gi, '');
  const links: NoteLink[] = [];
  for (const m of cleaned.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = decodeEntities(m[2].replace(/<[^>]+>/g, '')).trim();
    // Wikipedia のロゴ画像だけのリンクなど、文字の無いリンクは除く
    if (label) links.push({ label, href: decodeEntities(m[1]) });
  }
  const text = decodeEntities(
    cleaned
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text && !links.length) return undefined;
  return { text, links };
}

function tables(html: string, summary: string): string[] {
  return [...html.matchAll(new RegExp(`<table[^>]*summary="${summary}"[^>]*>([\\s\\S]*?)</table>`, 'g'))].map((m) => m[1]);
}

function field(table: string, label: string): string | undefined {
  const m = new RegExp(`<td class="header">${label}[：:]?</td>\\s*<td[^>]*>([\\s\\S]*?)</td>\\s*</tr>`).exec(table);
  return m?.[1];
}

/** 図書カードの HTML から「作品について」「人物について」を取り出す */
export function parseCardHtml(html: string): ParsedCard {
  const workTable = tables(html, '作品データ')[0] ?? '';
  const aboutWork = field(workTable, '作品について');
  const persons: ParsedCard['persons'] = [];
  for (const t of tables(html, '作家データ')) {
    const name = field(t, '作家名') ?? '';
    const id = Number(/person(\d+)\.html/.exec(name)?.[1]);
    if (!id) continue;
    const about = field(t, '人物について');
    persons.push({ id, note: about ? cellToNote(about) : undefined });
  }
  return { work: aboutWork ? cellToNote(aboutWork) : undefined, persons };
}
