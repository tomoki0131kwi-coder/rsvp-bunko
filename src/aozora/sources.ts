import { unzipSync } from 'fflate';
import type { Book, CatalogWork } from '../types';
import { peopleLabel } from './catalogParse';
import { decodeBytes } from './decode';
import { AOZORA_SITE, DEFAULT_TEXT_MIRROR, zipUrlToMirrorPath } from './mirror';
import { parseAozoraHtml, type ParsedBook } from './parseHtml';
import { parseAozoraText } from './parseText';

/**
 * 本文の解析処理の版。解析結果が変わる修正をしたら上げる。
 * 端末に保存した本文がこれより古ければ、取り直せるものは取り直す。
 * 2: 第3・第4水準の外字を Unicode の文字にする（以前は画像・下駄記号）
 * 3: 第1・第2水準の番号の外字（《》〔〕など）とアクセント分解（〔e'〕など）を文字にする
 */
export const PARSER_VERSION = 3;

let mirrorBase = DEFAULT_TEXT_MIRROR;

/** 本文ミラーのベース URL を設定する（空なら既定のミラー） */
export function setMirrorBase(base: string): void {
  mirrorBase = (base.trim() || DEFAULT_TEXT_MIRROR).replace(/\/?$/, '/');
}

export function getMirrorBase(): string {
  return mirrorBase;
}

/** 読み込めなかった理由と、利用者が次に取れる行動（図書カードを開くなど）を持つエラー */
export class LoadError extends Error {
  constructor(
    message: string,
    public readonly link?: { href: string; label: string },
  ) {
    super(message);
  }
}

const OFFLINE_HINT = '青空文庫からダウンロードしたファイルを「ファイルを開く」で読み込むこともできます。';

export async function fetchBytes(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new LoadError(`作品ファイルを取得できませんでした（ネットワークエラー: ${url}）。${OFFLINE_HINT}`);
  }
  if (!res.ok) throw new LoadError(`作品ファイルを取得できませんでした（HTTP ${res.status}: ${url}）。${OFFLINE_HINT}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** ZIP の中から本文ファイル（.txt を優先、なければ .html）を取り出す */
export function extractFromZip(bytes: Uint8Array): { name: string; bytes: Uint8Array } {
  const files = unzipSync(bytes);
  const names = Object.keys(files).filter((n) => !n.startsWith('__MACOSX') && !n.endsWith('/'));
  const pick = names.find((n) => /\.txt$/i.test(n)) ?? names.find((n) => /\.x?html?$/i.test(n));
  if (!pick) throw new Error('ZIP の中に本文ファイル（.txt / .html）が見つかりませんでした');
  return { name: pick, bytes: files[pick] };
}

/**
 * バイト列とファイル名（拡張子）から本文を解析する。
 * 外字画像は <img> で読むだけなので CORS は不要。青空文庫のサイトから直接表示する。
 */
export function parseBytes(name: string, bytes: Uint8Array, baseUrl?: string): ParsedBook {
  if (/\.zip$/i.test(name) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    const inner = extractFromZip(bytes);
    return parseBytes(inner.name, inner.bytes, baseUrl);
  }
  const text = decodeBytes(bytes);
  if (/\.x?html?$/i.test(name) || /^\s*(<\?xml|<!DOCTYPE|<html)/i.test(text)) {
    return parseAozoraHtml(text, baseUrl);
  }
  return parseAozoraText(text, AOZORA_SITE);
}

export async function loadCatalogWork(work: CatalogWork, signal?: AbortSignal): Promise<Book> {
  if (!work.mirrorPath) {
    throw new LoadError(
      `『${work.title}』の本文は、このアプリが使っている本文ミラーに収録されていません（ミラーより新しく公開された作品など）。` +
        `図書カードからテキストファイル（ZIP）をダウンロードし、ホームの「ファイルを開く」で読み込んでください。`,
      work.cardUrl ? { href: work.cardUrl, label: '青空文庫の図書カードを開く' } : undefined,
    );
  }
  const url = mirrorBase + work.mirrorPath;
  const parsed = parseBytes(work.mirrorPath, await fetchBytes(url, signal));
  if (!parsed.blocks.length) throw new LoadError('本文が空でした');
  return {
    ...parsed,
    title: work.title || parsed.title,
    subtitle: work.subtitle || parsed.subtitle,
    author: peopleLabel(work) || parsed.author,
    key: `aozora:${work.id}`,
    source: { kind: 'catalog', workId: work.id, url: work.cardUrl || url },
    parserVersion: PARSER_VERSION,
  };
}

/** 青空文庫の URL から作品 ID を取り出す（図書カード: card773.html、作品ファイル: 773_ruby_5968.zip など） */
export function workIdFromAozoraUrl(url: string): number | undefined {
  const card = /cards\/\d+\/card(\d+)\.html/.exec(url);
  if (card) return Number(card[1]);
  const file = /cards\/\d+\/files\/(\d+)_[^/]+\.(?:html?|zip|txt)$/.exec(url);
  return file ? Number(file[1]) : undefined;
}

/**
 * URL から読み込む。青空文庫のサイトはブラウザから直接取れないので、
 * 図書カードや作品ファイルの URL は図書目録・本文ミラーに置き換えて取得する。
 */
export async function loadFromUrl(
  url: string,
  lookup: (id: number) => CatalogWork | undefined,
  signal?: AbortSignal,
): Promise<Book> {
  const isAozora = /^https?:\/\/(www\.)?aozora\.gr\.jp\//.test(url);
  if (isAozora) {
    const id = workIdFromAozoraUrl(url);
    const work = id !== undefined ? lookup(id) : undefined;
    if (work) return loadCatalogWork(work, signal);
    const mirrorPath = zipUrlToMirrorPath(url);
    if (mirrorPath) {
      const parsed = parseBytes(mirrorPath, await fetchBytes(mirrorBase + mirrorPath, signal));
      return { ...parsed, key: `url:${url}`, source: { kind: 'url', url }, parserVersion: PARSER_VERSION };
    }
    throw new LoadError(
      'この URL の作品は図書目録に見つかりませんでした。青空文庫の図書カードまたは作品ファイル（ZIP）の URL を指定してください。',
    );
  }
  const path = new URL(url, location.href).pathname;
  const parsed = parseBytes(path, await fetchBytes(url, signal), url);
  return { ...parsed, key: `url:${url}`, source: { kind: 'url', url }, parserVersion: PARSER_VERSION };
}

export async function loadFromFile(file: File): Promise<Book> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = parseBytes(file.name, bytes);
  return {
    ...parsed,
    key: `file:${file.name}:${file.size}`,
    source: { kind: 'file', fileName: file.name },
    parserVersion: PARSER_VERSION,
  };
}
