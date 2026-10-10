/**
 * 図書カードの「作品について」「人物について」を集め、public/card-notes.json を作る。
 * デプロイ時に、npm run catalog（public/catalog.json の作成）の後で実行する。
 *
 * 青空文庫のサーバーへの負担を抑えるため、取得済みの分は前回公開した card-notes.json から引き継ぎ、
 * まだ取得していない図書カードだけを、1 件ずつ間隔をあけて、決めた時間の範囲で取得する。
 * 初回は数日に分けて全件を取り終え、その後は新しく公開された作品の分だけを取る。
 * 人物の解説を早くそろえるため、まだ解説を取っていない人物の作品から先に取る。
 *
 * 環境変数:
 *   NOTES_PREVIOUS          前回の card-notes.json の URL またはパス（無ければ空から始める）
 *   NOTES_BUDGET_SECONDS    取得に使う時間の上限（既定 2400 秒）
 *   NOTES_INTERVAL_MS       図書カードを取得する間隔（既定 1000 ミリ秒）
 *   NOTES_MAX               今回取得する図書カードの上限件数（既定は無制限。CI での動作確認用）
 *
 * 図書カードのデータは CC BY 4.0（青空文庫収録ファイルの取り扱い規準「図書カードや書架情報について」）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeWorks, type CatalogFile } from '../src/aozora/catalogFormat';
import { parseCardHtml, type CardNotesFile } from '../src/aozora/cardNotes';
import { decodeBytes } from '../src/aozora/decode';

const PUBLIC = resolve(import.meta.dirname, '../public');
const BUDGET_MS = Number(process.env.NOTES_BUDGET_SECONDS ?? 2400) * 1000;
const INTERVAL_MS = Number(process.env.NOTES_INTERVAL_MS ?? 1000);
const MAX = process.env.NOTES_MAX ? Number(process.env.NOTES_MAX) : Infinity;
const USER_AGENT = 'rsvp-bunko (+https://github.com/tomoki0131kwi-coder/rsvp-bunko)';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadPrevious(): Promise<CardNotesFile> {
  const empty: CardNotesFile = { version: 1, updatedAt: '', works: {}, persons: {} };
  const src = process.env.NOTES_PREVIOUS;
  if (!src) return empty;
  try {
    let text: string;
    if (/^https?:/.test(src)) {
      const res = await fetch(src, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
    } else {
      if (!existsSync(src)) throw new Error('ファイルがありません');
      text = readFileSync(src, 'utf8');
    }
    const prev = JSON.parse(text) as CardNotesFile;
    if (prev.version !== 1) throw new Error(`形式が違います（version ${prev.version}）`);
    return prev;
  } catch (e) {
    console.warn(`前回の解説データを読めませんでした（${e instanceof Error ? e.message : e}）。空から始めます。`);
    return empty;
  }
}

const catalog = JSON.parse(readFileSync(resolve(PUBLIC, 'catalog.json'), 'utf8')) as CatalogFile;
const works = decodeWorks(catalog.works).filter((w) => w.cardUrl);
const prev = await loadPrevious();

// 図書目録から消えた作品は落とす
const ids = new Set(works.map((w) => String(w.id)));
const notes: CardNotesFile = {
  version: 1,
  updatedAt: prev.updatedAt,
  works: Object.fromEntries(Object.entries(prev.works).filter(([id]) => ids.has(id))),
  persons: { ...prev.persons },
};

// 取得する順番: 解説を取っていない人物の作品（人物ごとに 1 件）→ 残りを公開日の新しい順
const pending = works.filter((w) => !(String(w.id) in notes.works));
pending.sort((a, b) => b.published.localeCompare(a.published) || b.id - a.id);
const first: typeof pending = [];
const seen = new Set<number>();
for (const w of pending) {
  const missing = w.people.filter((p) => !(String(p.id) in notes.persons) && !seen.has(p.id));
  if (missing.length) {
    first.push(w);
    missing.forEach((p) => seen.add(p.id));
  }
}
const firstIds = new Set(first.map((w) => w.id));
const queue = [...first, ...pending.filter((w) => !firstIds.has(w.id))];

console.log(`図書カード: 全 ${works.length} 件、取得済み ${works.length - pending.length} 件、未取得 ${pending.length} 件`);

const started = Date.now();
let fetched = 0;
let failures = 0;
for (const w of queue) {
  if (fetched >= MAX || Date.now() - started > BUDGET_MS) break;
  if (failures >= 10) {
    console.warn('取得の失敗が続いたので中断します。');
    break;
  }
  try {
    const res = await fetch(w.cardUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (res.status === 404) {
      notes.works[w.id] = 0;
    } else if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    } else {
      const card = parseCardHtml(decodeBytes(new Uint8Array(await res.arrayBuffer())));
      notes.works[w.id] = card.work ?? 0;
      for (const p of card.persons) {
        if (p.note) notes.persons[p.id] = p.note;
        else if (!(String(p.id) in notes.persons)) notes.persons[p.id] = 0;
      }
    }
    fetched++;
    failures = 0;
  } catch (e) {
    failures++;
    console.warn(`取得できませんでした: ${w.cardUrl}（${e instanceof Error ? e.message : e}）`);
  }
  await sleep(INTERVAL_MS);
}

if (fetched) notes.updatedAt = new Date().toISOString();
const values = (r: Record<string, unknown>) => Object.values(r);
const remaining = works.filter((w) => !(String(w.id) in notes.works)).length;
console.log(`今回取得: ${fetched} 件（${Math.round((Date.now() - started) / 1000)} 秒）、未取得の残り: ${remaining} 件`);
console.log(
  `解説あり: 作品について ${values(notes.works).filter(Boolean).length} 件 / 取得済み ${values(notes.works).length} 件、` +
    `人物について ${values(notes.persons).filter(Boolean).length} 人 / ${values(notes.persons).length} 人`,
);
writeFileSync(resolve(PUBLIC, 'card-notes.json'), JSON.stringify(notes));
