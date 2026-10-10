/**
 * 本文テキストの取得元。
 *
 * 青空文庫のサイト（www.aozora.gr.jp）は CORS ヘッダーを返さないため、ブラウザから直接は取得できない。
 * aozorahack/aozorabunko_text は、青空文庫の ZIP 内のテキストを展開して
 *   cards/<人物ID>/files/<ZIP名>/<ZIP名>.txt
 * という配置で公開しているリポジトリで、raw.githubusercontent.com 経由なら CORS で取得できる。
 * （README: https://github.com/aozorahack/aozorabunko_text ）
 */
export const DEFAULT_TEXT_MIRROR = 'https://raw.githubusercontent.com/aozorahack/aozorabunko_text/master/';

/** 外字画像など、CORS が不要なリソースは青空文庫のサイトから直接読む */
export const AOZORA_SITE = 'https://www.aozora.gr.jp/';

const MIRROR_PATH = /^cards\/\d+\/files\/([^/]+)\/\1\.txt$/;

/** 青空文庫の ZIP の URL（またはパス）から、ミラー上のテキストのパスを作る */
export function zipUrlToMirrorPath(zipUrl: string): string | undefined {
  const m = /cards\/(\d+)\/files\/([^/]+)\.zip$/i.exec(zipUrl);
  return m ? `cards/${m[1]}/files/${m[2]}/${m[2]}.txt` : undefined;
}

/** ファイル名先頭の作品 ID（例: 773_ruby_5968 → 773） */
function workIdOf(name: string): number | undefined {
  const m = /^(\d+)_/.exec(name);
  return m ? Number(m[1]) : undefined;
}

/** ZIP 名末尾の版番号（例: 773_ruby_5968 → 5968、946_ruby → 0） */
function revisionOf(name: string): number {
  const m = /_(\d+)$/.exec(name);
  return m ? Number(m[1]) : 0;
}

/** ミラーのファイル一覧を作品 ID ごとにまとめる */
export function indexMirrorPaths(paths: Iterable<string>): Map<number, string[]> {
  const byId = new Map<number, string[]>();
  for (const p of paths) {
    const m = MIRROR_PATH.exec(p.trim());
    if (!m) continue;
    const id = workIdOf(m[1]);
    if (id === undefined) continue;
    const list = byId.get(id);
    if (list) list.push(p.trim());
    else byId.set(id, [p.trim()]);
  }
  return byId;
}

/**
 * 作品に使うミラー上のテキストを選ぶ。
 * 図書目録の ZIP と同じ版があればそれを、なければルビ付き → 版番号の大きいものを優先する。
 */
export function pickMirrorPath(candidates: string[] | undefined, textUrl: string): string | undefined {
  if (!candidates?.length) return undefined;
  const exact = zipUrlToMirrorPath(textUrl);
  if (exact && candidates.includes(exact)) return exact;
  const name = (p: string) => MIRROR_PATH.exec(p)?.[1] ?? '';
  return [...candidates].sort((a, b) => {
    const ra = name(a).includes('_ruby') ? 1 : 0;
    const rb = name(b).includes('_ruby') ? 1 : 0;
    return rb - ra || revisionOf(name(b)) - revisionOf(name(a));
  })[0];
}
