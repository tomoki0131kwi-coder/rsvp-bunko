import type { Run } from '../types';
import { BlockBuilder } from './blockBuilder';
import { GETA, decodeAccents, gaijiImagePath, parseGaijiNote } from './gaiji';
import type { ParsedBook } from './parseHtml';

/**
 * 青空文庫形式のテキスト（ルビ付き .txt）を解析する。
 * 書式は青空文庫「テキスト入力ルール」「注記一覧」に従う:
 *   - 冒頭に表題・著者名、空行のあと「【テキスト中に現れる記号について】」の説明ブロック（--- で囲む）
 *   - ルビは《》、ルビの掛かる範囲の始まりは｜。｜が無いときは直前の同じ字種の連なりに掛かる
 *   - 注記は［＃…］、外字は ※［＃…］
 *   - 末尾の「底本：」以降は書誌情報
 *
 * @param gaijiBase 外字画像を解決するサイトルート URL（例: ミラーのベース URL）
 */
export function parseAozoraText(text: string, gaijiBase?: string): ParsedBook {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  // 書誌情報（末尾の「底本：」以降）
  let end = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^底本[：:]/.test(lines[i])) {
      end = i;
      break;
    }
  }
  // 書誌情報の行にも外字注記（例: 底本：「※［＃始め二重山括弧、1-1-52］復録…」）があるので、本文と同じく文字にする
  const bibliography =
    lines
      .slice(end)
      .map((l) => plainText(l, gaijiBase).trim())
      .filter(Boolean)
      .join('\n') || undefined;

  // ヘッダー（最初の空行まで）
  let i = 0;
  const header: string[] = [];
  while (i < end && lines[i].trim() !== '') header.push(lines[i++].trim());
  while (i < end && lines[i].trim() === '') i++;
  // 記号説明ブロック
  if (i < end && /^-{10,}/.test(lines[i])) {
    const close = lines.findIndex((l, j) => j > i && /^-{10,}/.test(l));
    if (close > 0 && close < end) i = close + 1;
  }

  const plain = (s: string) => plainText(s, gaijiBase).trim();
  const title = plain(header[0] ?? '') || '無題';
  const author = header.length > 1 ? plain(header[header.length - 1]) : '';
  const subtitle = header.length > 2 ? header.slice(1, -1).map(plain).join('　') : undefined;

  const builder = new BlockBuilder();
  for (; i < end; i++) {
    const line = lines[i];
    if (/［＃改(ページ|丁|段|見開き)］/.test(line) && stripNotation(line).trim() === '') {
      builder.pageBreak();
      continue;
    }
    const heading = detectHeading(line);
    if (heading) {
      builder.heading(heading.level, () => parseInline(heading.text, builder, gaijiBase));
      continue;
    }
    parseInline(line, builder, gaijiBase);
    builder.lineBreak();
  }

  return { title, subtitle: subtitle || undefined, author, blocks: builder.finish(), bibliography };
}

const LEVELS: Record<string, number> = { 大: 1, 中: 2, 小: 3 };

function detectHeading(line: string): { level: number; text: string } | null {
  // 例: ［＃３字下げ］一［＃「一」は中見出し］
  const m = /［＃「([^」]+)」は(大|中|小)見出し］/.exec(line);
  if (m) {
    return { level: LEVELS[m[2]], text: line.replace(/［＃「[^」]+」は(大|中|小)見出し］/, '') };
  }
  // 例: ［＃中見出し］第一章［＃中見出し終わり］
  const m2 = /［＃(大|中|小)見出し］(.*?)［＃(大|中|小)見出し終わり］/.exec(line);
  if (m2) return { level: LEVELS[m2[1]], text: m2[2] };
  // 例: ［＃５字下げ］第一章［＃「第一章」は同行中見出し］ などの変種
  const m3 = /［＃「([^」]+)」は同行(大|中|小)見出し］/.exec(line);
  if (m3) return { level: LEVELS[m3[2]], text: m3[1] };
  return null;
}

interface Atom {
  ch: string;
  gaijiSrc?: string;
  gaijiAlt?: string;
}

const TOKEN = /※［＃([^］]*)］|［＃[^］]*］|《([^》]*)》|｜|[^※［《｜]+|./gu;

export function parseInline(line: string, b: BlockBuilder, gaijiBase?: string): void {
  const out: Run[] = [];
  let buf: Atom[] = [];
  let marked = false;

  const commit = (atoms: Atom[]) => {
    for (const a of atoms) {
      if (a.gaijiSrc) out.push({ text: a.ch, gaijiSrc: a.gaijiSrc, gaijiAlt: a.gaijiAlt });
      else {
        const last = out[out.length - 1];
        if (last && !last.ruby && !last.gaijiSrc) last.text += a.ch;
        else out.push({ text: a.ch });
      }
    }
  };

  for (const m of decodeAccents(line).matchAll(TOKEN)) {
    const tok = m[0];
    if (m[1] !== undefined) {
      const info = parseGaijiNote(m[1]);
      if (info.char) buf.push({ ch: info.char });
      else if (info.jis && gaijiBase) {
        buf.push({ ch: GETA, gaijiSrc: joinUrl(gaijiBase, gaijiImagePath(info.jis)), gaijiAlt: info.desc });
      } else buf.push({ ch: GETA, gaijiAlt: info.desc });
    } else if (tok.startsWith('［＃')) {
      // その他の注記（字下げ・傍点など）は読み上げ対象外
    } else if (m[2] !== undefined) {
      let base: Atom[];
      if (marked) {
        base = buf;
        buf = [];
      } else {
        const k = trailingSameClass(buf);
        base = buf.slice(k);
        commit(buf.slice(0, k));
        buf = [];
      }
      marked = false;
      if (base.length) out.push({ text: base.map((a) => a.ch).join(''), ruby: m[2] });
      else if (m[2]) commit(Array.from(`《${m[2]}》`, (ch) => ({ ch })));
    } else if (tok === '｜') {
      commit(buf);
      buf = [];
      marked = true;
    } else {
      for (const ch of tok) buf.push({ ch });
    }
  }
  commit(buf);

  for (const r of out) {
    if (r.ruby) b.ruby(r.text, r.ruby);
    else if (r.gaijiSrc) b.gaiji(r.text, r.gaijiSrc, r.gaijiAlt ?? '');
    else b.text(r.text);
  }
}

type CharClass = 'kanji' | 'hira' | 'kata' | 'alpha' | 'other';

const KANJI = /[\p{Script=Han}々〆〇ヶ仝〻]/u;

function charClass(a: Atom): CharClass {
  if (a.gaijiSrc || a.ch === GETA) return 'kanji';
  const c = a.ch;
  if (KANJI.test(c)) return 'kanji';
  if (/[ぁ-ゟ]/.test(c)) return 'hira';
  if (/[゠-ヿㇰ-ㇿｦ-ﾟ]/.test(c)) return 'kata';
  if (/[A-Za-z0-9Ａ-Ｚａ-ｚ０-９À-ɏ]/.test(c)) return 'alpha';
  return 'other';
}

/** 末尾から同じ字種が続く範囲の開始位置 */
function trailingSameClass(atoms: Atom[]): number {
  if (!atoms.length) return 0;
  const cls = charClass(atoms[atoms.length - 1]);
  if (cls === 'other') return atoms.length - 1;
  let k = atoms.length - 1;
  while (k > 0 && charClass(atoms[k - 1]) === cls) k--;
  return k;
}

/** 1 行を、ルビ・注記を除いた文字列にする（外字は文字に置き換える） */
function plainText(line: string, gaijiBase?: string): string {
  const b = new BlockBuilder();
  parseInline(line, b, gaijiBase);
  b.lineBreak();
  return b.finish()[0]?.runs.map((r) => r.text).join('') ?? '';
}

function stripNotation(s: string): string {
  return s
    .replace(/※［＃[^］]*］/g, GETA)
    .replace(/［＃[^］]*］/g, '')
    .replace(/《[^》]*》/g, '')
    .replace(/｜/g, '')
    .trim();
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/?$/, '/') + path;
}
