/**
 * 図書目録（public/catalog.json）を作る。GitHub Actions のデプロイ時に実行する。
 *
 * 1. 青空文庫の「公開中　作家別作品一覧拡充版：全て」（CSV、UTF-8、ZIP）を取得する
 *    https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip
 * 2. 本文ミラー（aozorahack/aozorabunko_text）のファイル一覧を取り、各作品に本文のパスを付ける
 *    （ブロブを取らない浅い clone なので、テキスト本体はダウンロードしない）
 *
 * 環境変数:
 *   CATALOG_ZIP   取得済みの CSV ZIP のパス（指定時はダウンロードしない）
 *   CATALOG_URL   CSV ZIP の URL（既定は上記）
 *   MIRROR_LIST   ミラーのファイル一覧（1 行 1 パス。「パス<TAB>バイト数」も可）のパス（指定時は clone も API も使わない）
 *   GITHUB_TOKEN  本文ファイルの大きさを GitHub API（git/trees）で取るときに使う（無くても動くが回数制限が厳しい）
 *   MIN_WORKS     作品数がこれ未満なら失敗にする（既定 5000。CSV の形式変化に気づくため）
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { attachMirrorPaths, encodeWorks, type CatalogFile } from '../src/aozora/catalogFormat';
import { parseCatalogCsv } from '../src/aozora/catalogParse';
import { DEFAULT_TEXT_MIRROR } from '../src/aozora/mirror';

const CATALOG_URL = process.env.CATALOG_URL || 'https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip';
const MIRROR_REPO = 'https://github.com/aozorahack/aozorabunko_text';
const MIN_WORKS = Number(process.env.MIN_WORKS ?? 5000);
const OUT = resolve(import.meta.dirname, '../public/catalog.json');

async function loadCsv(): Promise<{ text: string; source: string }> {
  let zip: Uint8Array;
  let source: string;
  if (process.env.CATALOG_ZIP) {
    zip = new Uint8Array(readFileSync(process.env.CATALOG_ZIP));
    source = process.env.CATALOG_ZIP;
  } else {
    const res = await fetch(CATALOG_URL);
    if (!res.ok) throw new Error(`図書目録の取得に失敗しました: HTTP ${res.status} ${CATALOG_URL}`);
    zip = new Uint8Array(await res.arrayBuffer());
    source = CATALOG_URL;
  }
  const files = unzipSync(zip);
  const name = Object.keys(files).find((n) => /\.csv$/i.test(n));
  if (!name) throw new Error('ZIP に CSV が含まれていません');
  return { text: new TextDecoder('utf-8').decode(files[name]), source };
}

function loadMirrorList(): { paths: string[]; updatedAt: string; tree?: string; sizes?: Map<string, number> } {
  if (process.env.MIRROR_LIST) {
    const rows = readFileSync(process.env.MIRROR_LIST, 'utf8').split('\n').map((l) => l.split('\t'));
    const sizes = new Map(rows.filter((r) => Number(r[1]) > 0).map((r) => [r[0], Number(r[1])]));
    return { paths: rows.map((r) => r[0]), updatedAt: '', sizes: sizes.size ? sizes : undefined };
  }
  const dir = mkdtempSync(join(tmpdir(), 'aozora-mirror-'));
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 64 << 20 });
    git('clone', '--quiet', '--depth', '1', '--filter=blob:none', '--no-checkout', MIRROR_REPO, '.');
    return {
      paths: git('ls-tree', '-r', '--name-only', 'HEAD').split('\n'),
      updatedAt: git('log', '-1', '--format=%cI').trim(),
      tree: git('rev-parse', 'HEAD^{tree}').trim(),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 本文ファイルの大きさ（長さの目安）を GitHub API の git/trees で取る。
 * clone ではブロブを取らないので大きさが分からないため。失敗しても目録は作る（長さで絞り込めなくなるだけ）。
 */
async function loadMirrorSizes(tree: string | undefined): Promise<Map<string, number> | undefined> {
  if (!tree) return undefined;
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'rsvp-bunko-catalog' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    const res = await fetch(`https://api.github.com/repos/aozorahack/aozorabunko_text/git/trees/${tree}?recursive=1`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { truncated: boolean; tree: { path: string; type: string; size?: number }[] };
    if (body.truncated) console.warn('警告: git/trees の結果が途中で切れています。一部の作品は長さが不明になります。');
    return new Map(body.tree.filter((e) => e.type === 'blob' && e.size).map((e) => [e.path, e.size!]));
  } catch (e) {
    console.warn(`警告: 本文ファイルの大きさを取得できませんでした（${e instanceof Error ? e.message : e}）。長さによる絞り込みは使えません。`);
    return undefined;
  }
}

/** CI のログで CSV の中身の形式を確かめられるよう、値の例を出す */
function logSamples(label: string, values: string[]) {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(`${label}: ${top.map(([v, n]) => `${v || '（空）'}×${n}`).join('、')}`);
}

const { text, source } = await loadCsv();
const parsed = parseCatalogCsv(text);
const mirror = loadMirrorList();
const sizes = mirror.sizes ?? (await loadMirrorSizes(mirror.tree));
const works = attachMirrorPaths(parsed, mirror.paths, sizes);
const withText = works.filter((w) => w.mirrorPath).length;
logSamples('分類番号の例', works.map((w) => w.ndc));
logSamples('文字遣い種別の例', works.map((w) => w.kana));
logSamples('生年月日の形式', works.flatMap((w) => w.people.map((p) => (p.born ?? '').replace(/\d/g, '9'))));
console.log(`長さが分かる作品: ${works.filter((w) => w.textSize).length}`);

console.log(`図書目録: ${works.length} 作品（取得元: ${source}）`);
console.log(`本文ミラー: ${withText} 作品に本文あり（ミラー更新: ${mirror.updatedAt || '不明'}）`);
if (works.length < MIN_WORKS) {
  throw new Error(`作品数が少なすぎます（${works.length} < ${MIN_WORKS}）。CSV の形式が変わった可能性があります。`);
}
if (withText === 0) throw new Error('本文ミラーと一致する作品がありません');

const file: CatalogFile = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source,
  mirror: { base: DEFAULT_TEXT_MIRROR, updatedAt: mirror.updatedAt },
  works: encodeWorks(works),
};
writeFileSync(OUT, JSON.stringify(file));
console.log(`書き出し: ${OUT}（${(JSON.stringify(file).length / 1024 / 1024).toFixed(1)} MB）`);
