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
 *   MIRROR_LIST   ミラーのファイル一覧（1 行 1 パス）のパス（指定時は clone しない）
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

function loadMirrorList(): { paths: string[]; updatedAt: string } {
  if (process.env.MIRROR_LIST) {
    return { paths: readFileSync(process.env.MIRROR_LIST, 'utf8').split('\n'), updatedAt: '' };
  }
  const dir = mkdtempSync(join(tmpdir(), 'aozora-mirror-'));
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 64 << 20 });
    git('clone', '--quiet', '--depth', '1', '--filter=blob:none', '--no-checkout', MIRROR_REPO, '.');
    return { paths: git('ls-tree', '-r', '--name-only', 'HEAD').split('\n'), updatedAt: git('log', '-1', '--format=%cI').trim() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const { text, source } = await loadCsv();
const parsed = parseCatalogCsv(text);
const mirror = loadMirrorList();
const works = attachMirrorPaths(parsed, mirror.paths);
const withText = works.filter((w) => w.mirrorPath).length;

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
