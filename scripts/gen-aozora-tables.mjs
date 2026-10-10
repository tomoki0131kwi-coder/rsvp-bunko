/**
 * 外字・アクセント分解の対応表（src/aozora/jisx0213.json、src/aozora/accents.json）を作る。
 *
 * 元データは、青空文庫の XHTML を作る変換ツール aozorahack/aozora2html（CC0）の
 *   yml/jis2ucs.yml      … JIS X 0213 の面区点 → Unicode（11,233 字）
 *   yml/accent_table.yml … アクセント分解（〔e'〕など）の組み合わせ → 面区点
 * https://github.com/aozorahack/aozora2html
 *
 * 実行: node scripts/gen-aozora-tables.mjs [aozora2html を clone したディレクトリ]
 *       ディレクトリを省略すると、下記のコミットのファイルを GitHub から取得する。
 *
 * jisx0213.json には、ブラウザの TextDecoder('euc-jp')（JIS X 0208）で同じ文字にならないものだけを入れる。
 * 第1・第2水準の大半は実行時に TextDecoder で求める（src/aozora/gaiji.ts）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMIT = '9ca5395fef8d5e96c44a0b0d7f4bba27013e66a4';
const local = process.argv[2];
const read = async (name) =>
  local
    ? readFileSync(join(local, 'yml', name), 'utf8')
    : (await fetch(`https://raw.githubusercontent.com/aozorahack/aozora2html/${COMMIT}/yml/${name}`)).text();

const key = (men, ku, ten) => `${Number(men)}-${Number(ku)}-${Number(ten)}`;

// ---- jis2ucs.yml ----
const jis2ucs = new Map();
for (const line of (await read('jis2ucs.yml')).split('\n')) {
  const m = /^:(\d)-(\d\d)-(\d\d): "(.*)"/.exec(line.trim());
  if (!m) continue;
  const chars = [...m[4].matchAll(/&#x([0-9A-Fa-f]+);/g)].map((h) => String.fromCodePoint(parseInt(h[1], 16))).join('');
  jis2ucs.set(key(m[1], m[2], m[3]), chars);
}

const eucjp = new TextDecoder('euc-jp');
const table = {};
for (const [k, ch] of jis2ucs) {
  const [men, ku, ten] = k.split('-').map(Number);
  if (men === 1 && eucjp.decode(new Uint8Array([0xa0 + ku, 0xa0 + ten])) === ch) continue;
  table[k] = ch;
}

// ---- accent_table.yml（入れ子の対応表を「A`」「AE&」のような文字列に平らにする）----
const accents = {};
const stack = [];
for (const raw of (await read('accent_table.yml')).split('\n')) {
  if (!raw.trim() || raw.startsWith('---')) continue;
  const indent = raw.length - raw.trimStart().length;
  const line = raw.trim();
  if (line.startsWith('- ')) {
    const code = /^- (\d)-(\d\d)\/\d-(\d\d)-(\d\d)$/.exec(line);
    if (code) {
      const ch = jis2ucs.get(key(code[1], code[3], code[4]));
      if (!ch) throw new Error(`jis2ucs に無い面区点: ${line}`);
      accents[stack.join('')] = ch;
    }
    continue;
  }
  const m = /^"?(.+?)"?:$/.exec(line);
  if (!m) throw new Error(`読めない行: ${raw}`);
  stack.length = indent / 2;
  stack.push(m[1]);
}

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'aozora');
writeFileSync(join(dir, 'jisx0213.json'), JSON.stringify(table));
writeFileSync(join(dir, 'accents.json'), JSON.stringify(accents));
console.log(`jis2ucs: ${jis2ucs.size} 字 → jisx0213.json に ${Object.keys(table).length} 字`);
console.log(`アクセント分解: ${Object.keys(accents).length} 通り → accents.json`);
