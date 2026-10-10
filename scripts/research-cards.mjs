// 一時的な調査用（GitHub Actions で実行）。
// 1. 青空文庫「収録ファイルの取り扱い規準」の本文から、図書カード・データに関する段落を出力する
// 2. 無作為に選んだ図書カードで「作品について」「人物について」が書かれている割合と例を出力する
import { unzipSync } from 'fflate';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { 'User-Agent': 'rsvp-bunko research (https://github.com/tomoki0131kwi-coder/rsvp-bunko)' };

async function getText(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const head = new TextDecoder('ascii').decode(bytes.subarray(0, 2048));
  const cs = /charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase() ?? 'utf-8';
  return new TextDecoder(/jis/.test(cs) ? 'shift_jis' : cs === 'euc-jp' ? 'euc-jp' : 'utf-8').decode(bytes);
}
const strip = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d|tr|dt|dd)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n');

// ---- 1. 取り扱い規準 ----
console.log('===== 取り扱い規準 https://www.aozora.gr.jp/guide/kijyunn.html =====');
const kijun = strip(await getText('https://www.aozora.gr.jp/guide/kijyunn.html'));
console.log(kijun.slice(0, 12000));
console.log('===== 規準の全文の長さ:', kijun.length, '=====');

// ---- 2. 図書カードの「作品について」「人物について」 ----
const zip = new Uint8Array(await (await fetch('https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip', { headers: UA })).arrayBuffer());
const csvName = Object.keys(unzipSync(zip)).find((n) => n.endsWith('.csv'));
const csv = new TextDecoder().decode(unzipSync(zip)[csvName]);
const cards = [...new Set([...csv.matchAll(/https:\/\/www\.aozora\.gr\.jp\/cards\/\d+\/card\d+\.html/g)].map((m) => m[0]))];
let seed = 20261010;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const sample = [...cards].sort(() => rnd() - 0.5).slice(0, 300);
console.log(`===== 図書カード ${cards.length} 件から ${sample.length} 件を調査 =====`);

const field = (html, label) => {
  const re = new RegExp(`${label}[：:]?\\s*<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`);
  const m = re.exec(html);
  return m ? strip(m[1]).trim() : null;
};
let work = 0;
let person = 0;
const examples = [];
for (const [i, url] of sample.entries()) {
  try {
    const html = await getText(url);
    if (i === 0) {
      console.log('----- 1 件目の図書カードの表の部分（構造の確認用） -----');
      const t = html.indexOf('作品データ');
      console.log(html.slice(Math.max(0, t - 200), t + 3000));
    }
    const w = field(html, '作品について');
    const p = field(html, '人物について');
    if (w) work++;
    if (p) person++;
    if ((w || p) && examples.length < 8) examples.push({ url, work: w?.slice(0, 200), person: p?.slice(0, 200) });
  } catch (e) {
    console.log('失敗:', url, e.message);
  }
  await sleep(1000);
}
console.log(`===== 結果: 作品について ${work}/${sample.length}、人物について ${person}/${sample.length} =====`);
console.log(JSON.stringify(examples, null, 2));
