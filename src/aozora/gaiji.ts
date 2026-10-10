import ACCENTS from './accents.json';
import JISX0213 from './jisx0213.json';

/**
 * 外字注記（例: ※［＃「てへん＋劣」、第3水準1-84-77］、※［＃「にんべん＋發」、U+5F7F、19-下-5］）の解釈。
 * 参考: 青空文庫「注記一覧」https://www.aozora.gr.jp/annotation/ の外字の項
 */
export interface GaijiInfo {
  /** Unicode で表せる場合の文字 */
  char?: string;
  /** JIS X 0213 の面区点（"1-84-77" 形式） */
  jis?: string;
  /** 「」内の字形説明 */
  desc: string;
}

/** 外字を画像にも Unicode にもできないときの代替文字（下駄記号） */
export const GETA = '〓';

export function parseGaijiNote(note: string): GaijiInfo {
  const desc = /「([^」]*)」/.exec(note)?.[1] ?? note;
  const info: GaijiInfo = { desc };
  const u = /U\+([0-9A-Fa-f]{4,6})/.exec(note);
  if (u) {
    const cp = parseInt(u[1], 16);
    if (cp > 0 && cp <= 0x10ffff) info.char = String.fromCodePoint(cp);
  }
  // 面区点は「第3水準1-87-71」または「、1-8-78」のように区切りの直後に書かれる。
  // 底本のページ・行（例: 24-1-3、201-1-5）の一部を面区点と取り違えないよう、前後の区切りまで確かめる
  const jis =
    /第[34]水準\s*([12])-(\d{1,2})-(\d{1,2})(?!\d)/.exec(note) ??
    /(?:^|[、，,\s（(])([12])-(\d{1,2})-(\d{1,2})(?=$|[、，,\s）)])/.exec(note);
  if (jis) {
    info.jis = `${Number(jis[1])}-${Number(jis[2])}-${Number(jis[3])}`;
    // 面区点は Unicode に変換できる（scripts/gen-aozora-tables.mjs で作った対応表など）
    info.char ??= jisToUnicode(info.jis);
  }
  return info;
}

let eucjp: TextDecoder | null | undefined;

/**
 * JIS X 0213 の面区点（"1-87-71"）を Unicode の文字にする。変換できなければ undefined。
 * 対応表（aozora2html の jis2ucs.yml から作成）に無い第1面の文字は JIS X 0208 の文字なので、
 * TextDecoder('euc-jp') で求める（例: 始め二重山括弧 1-1-52 → 《）。
 */
export function jisToUnicode(jis: string): string | undefined {
  const hit = (JISX0213 as Record<string, string>)[jis];
  if (hit) return hit;
  const [men, ku, ten] = jis.split('-').map(Number);
  if (men !== 1 || !(ku >= 1 && ku <= 94 && ten >= 1 && ten <= 94)) return undefined;
  if (eucjp === undefined) {
    try {
      eucjp = new TextDecoder('euc-jp', { fatal: true });
    } catch {
      eucjp = null;
    }
  }
  if (!eucjp) return undefined;
  try {
    return eucjp.decode(new Uint8Array([0xa0 + ku, 0xa0 + ten]));
  } catch {
    return undefined;
  }
}

/**
 * アクセント分解（〔…〕の中の「e'」「a:」「AE&」などの書き方）を、アクセント付きの文字にする。
 * aozora2html の規則にならい、〔〕の中で一つでも置き換えたら〔〕は取り除き、一つも無ければそのまま残す。
 * 青空文庫「アクセント分解」の表（aozora2html の yml/accent_table.yml）による。
 */
export function decodeAccents(line: string): string {
  if (!line.includes('〔')) return line;
  const table = ACCENTS as Record<string, string>;
  return line.replace(/〔([^〔〕]*)〕/g, (whole, inner: string) => {
    let out = '';
    let replaced = false;
    const chars = Array.from(inner);
    for (let i = 0; i < chars.length; i++) {
      const three = chars.slice(i, i + 3).join('');
      const two = chars.slice(i, i + 2).join('');
      if (chars.length - i >= 3 && table[three]) {
        out += table[three];
        i += 2;
        replaced = true;
      } else if (chars.length - i >= 2 && table[two]) {
        out += table[two];
        i += 1;
        replaced = true;
      } else {
        out += chars[i];
      }
    }
    return replaced ? out : whole;
  });
}

/**
 * 面区点から青空文庫サイト上の外字画像パス（サイトルート相対）を作る。
 * XHTML 版の img 要素の src（例: ../../../gaiji/1-84/1-84-77.png）の形式に合わせている。
 */
export function gaijiImagePath(jis: string): string {
  const [men, ku, ten] = jis.split('-').map((n) => n.padStart(2, '0'));
  const m = String(Number(men));
  return `gaiji/${m}-${ku}/${m}-${ku}-${ten}.png`;
}
