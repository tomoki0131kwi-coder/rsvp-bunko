/**
 * 青空文庫形式のテキストを一括で解析し、表示上の問題になりそうな箇所を数える。
 *
 *   npx tsx scripts/scan-texts.ts <テキストのあるディレクトリ> [レポートの出力先.json]
 *
 * ディレクトリは aozorahack/aozorabunko_text の clone（cards/ 以下）などを想定。
 * 数えるもの:
 *   - 外字注記（※［＃…］）のうち、文字にできず「〓」になったもの・画像になったもの
 *   - 原文にもともと書かれている「〓」（青空文庫では判読できない字・伏せ字などに使う）
 *   - 解析後の本文に残った注記記号（［＃ 《 》 ｜ ※［）
 *   - アクセント分解（〔…〕の中に e' などを書く欧文の表記）
 *   - BMP 外の文字（端末のフォントによっては表示できないことがある）
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { decodeBytes } from '../src/aozora/decode';
import { parseGaijiNote } from '../src/aozora/gaiji';
import { parseAozoraText } from '../src/aozora/parseText';

const root = process.argv[2];
const out = process.argv[3];
if (!root) {
  console.error('使い方: npx tsx scripts/scan-texts.ts <ディレクトリ> [レポート.json]');
  process.exit(1);
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (name.endsWith('.txt')) yield p;
  }
}

const inc = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
const top = (m: Map<string, number>, n: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);

const totals = {
  files: 0,
  failed: 0,
  gaijiNotes: 0,
  gaijiResolved: 0,
  gaijiGeta: 0,
  gaijiImage: 0,
  literalGeta: 0,
  leftoverNotation: 0,
  accentNotation: 0,
  accentLeft: 0,
  nonBmpChars: 0,
};
const filesWith = { gaijiGeta: 0, literalGeta: 0, leftoverNotation: 0, accentNotation: 0, accentLeft: 0, nonBmpChars: 0 };
const imageNotes = new Map<string, number>();
const unresolved = new Map<string, number>();
const nonBmp = new Map<string, number>();
const leftoverSamples: { file: string; title: string; sample: string }[] = [];
const accentSamples: { file: string; title: string; sample: string }[] = [];
const getaFiles: { file: string; title: string; notes: number; literal: number }[] = [];
const failures: { file: string; error: string }[] = [];

const started = Date.now();
for (const path of walk(root)) {
  totals.files++;
  const file = relative(root, path);
  try {
    const text = decodeBytes(new Uint8Array(readFileSync(path)));
    const book = parseAozoraText(text, 'https://www.aozora.gr.jp/');
    // 本文部分（末尾の「底本：」以降を除く）
    const body = text.split(/\r?\n底本[：:]/)[0];

    let notesGeta = 0;
    let bracketNotes = 0;
    for (const m of body.matchAll(/※［＃([^］]*)］/g)) {
      totals.gaijiNotes++;
      const info = parseGaijiNote(m[1]);
      if (info.char === '《' || info.char === '》') bracketNotes++;
      if (info.char) totals.gaijiResolved++;
      else {
        if (info.jis) inc(imageNotes, m[1]);
        notesGeta++;
        inc(unresolved, info.desc);
      }
    }
    totals.gaijiGeta += notesGeta;
    const literal = (body.replace(/※［＃[^］]*］/g, '').match(/〓/g) ?? []).length;
    totals.literalGeta += literal;
    if (notesGeta) filesWith.gaijiGeta++;
    if (literal) filesWith.literalGeta++;
    if (notesGeta || literal) getaFiles.push({ file, title: book.title, notes: notesGeta, literal });

    const accents = body.match(/〔[^〔〕\n]*[A-Za-z][`'^~:&,_/@][^〔〕\n]*〕/g) ?? [];
    totals.accentNotation += accents.length;
    if (accents.length) {
      filesWith.accentNotation++;
      if (accentSamples.length < 30) accentSamples.push({ file, title: book.title, sample: accents[0] ?? "" });
    }

    const plain = book.blocks.map((b) => b.runs.map((r) => r.text).join('')).join('\n');
    for (const b of book.blocks) for (const r of b.runs) if (r.gaijiSrc) totals.gaijiImage++;
    // 外字注記から正しく変換された《》は除いて数える
    const brackets = (plain.match(/《|》/g) ?? []).length;
    const left = [...(plain.match(/［＃|｜|※［/g) ?? []), ...Array(Math.max(0, brackets - bracketNotes)).fill('《》')];
    totals.leftoverNotation += left.length;
    const accentLeft = plain.match(/〔[^〔〕\n]*[A-Za-z][`'^~:&,_/@][^〔〕\n]*〕/g) ?? [];
    totals.accentLeft += accentLeft.length;
    if (accentLeft.length) filesWith.accentLeft++;
    if (left.length) {
      filesWith.leftoverNotation++;
      if (leftoverSamples.length < 50) {
        const i = plain.search(/［＃|《|》|｜|※［/);
        leftoverSamples.push({ file, title: book.title, sample: plain.slice(Math.max(0, i - 15), i + 25) });
      }
    }
    let n = 0;
    for (const ch of plain) {
      if (ch.codePointAt(0)! > 0xffff) {
        n++;
        inc(nonBmp, ch);
      }
    }
    totals.nonBmpChars += n;
    if (n) filesWith.nonBmpChars++;
  } catch (e) {
    totals.failed++;
    failures.push({ file, error: e instanceof Error ? e.message : String(e) });
  }
  if (totals.files % 2000 === 0) console.error(`${totals.files} ファイル…（${((Date.now() - started) / 1000).toFixed(0)} 秒）`);
}

const report = {
  totals,
  filesWith,
  topUnresolvedGaiji: top(unresolved, 40),
  imageNotes: top(imageNotes, 20),
  topNonBmpChars: top(nonBmp, 40).map(([ch, count]) => [ch, `U+${ch.codePointAt(0)!.toString(16).toUpperCase()}`, count]),
  leftoverSamples,
  accentSamples,
  mostGetaFiles: getaFiles.sort((a, b) => b.notes + b.literal - (a.notes + a.literal)).slice(0, 30),
  failures: failures.slice(0, 50),
};
if (out) writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ totals, filesWith, seconds: Math.round((Date.now() - started) / 1000) }, null, 2));
