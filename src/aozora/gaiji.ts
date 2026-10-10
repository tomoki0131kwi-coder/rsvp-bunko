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
  const jis = /第[34]水準\s*(\d)-(\d{1,2})-(\d{1,2})/.exec(note) ?? /(\d)-(\d{1,2})-(\d{1,2})/.exec(note);
  if (jis) {
    info.jis = `${Number(jis[1])}-${Number(jis[2])}-${Number(jis[3])}`;
    // 第3・第4水準の文字は Unicode に変換できる（scripts/gen-jisx0213.py で作った対応表）
    info.char ??= jisToUnicode(info.jis);
  }
  return info;
}

/** JIS X 0213 の面区点（"1-87-71"）を Unicode の文字にする。対応表に無ければ undefined */
export function jisToUnicode(jis: string): string | undefined {
  return (JISX0213 as Record<string, string>)[jis];
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
