import { unzipSync } from 'fflate';
import type { Book, CatalogWork } from '../types';
import { peopleLabel } from './catalogParse';
import { decodeBytes } from './decode';
import { parseAozoraHtml, type ParsedBook } from './parseHtml';
import { parseAozoraText } from './parseText';

/**
 * 青空文庫本体（www.aozora.gr.jp）は CORS ヘッダーを返さないため、ブラウザから直接は取得できない。
 * 青空文庫が GitHub で公開しているリポジトリ（aozorabunko/aozorabunko）をミラーとして使う。
 * raw.githubusercontent.com は Access-Control-Allow-Origin: * を返すので、静的サイトから取得できる。
 */
export const DEFAULT_MIRROR = 'https://raw.githubusercontent.com/aozorabunko/aozorabunko/master/';

export const CATALOG_PATH = 'index_pages/list_person_all_extended_utf8.zip';

const AOZORA_HOSTS = new Set(['www.aozora.gr.jp', 'aozora.gr.jp']);

let mirrorBase = DEFAULT_MIRROR;

export function setMirrorBase(base: string): void {
  mirrorBase = (base.trim() || DEFAULT_MIRROR).replace(/\/?$/, '/');
}

export function getMirrorBase(): string {
  return mirrorBase;
}

/** 青空文庫サイトの URL をミラーの URL に置き換える。それ以外の URL はそのまま返す。 */
export function toMirrorUrl(url: string, base = mirrorBase): string {
  try {
    const u = new URL(url);
    if (AOZORA_HOSTS.has(u.hostname)) return base + u.pathname.replace(/^\/+/, '');
    return u.href;
  } catch {
    // サイトルート相対パス（cards/000148/files/773_14560.html など）
    return base + url.replace(/^\/+/, '');
  }
}

export class FetchError extends Error {}

export async function fetchBytes(url: string, signal?: AbortSignal): Promise<{ bytes: Uint8Array; url: string }> {
  const candidates = [...new Set([toMirrorUrl(url), url])];
  let firstError: unknown;
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate, { signal });
      if (!res.ok) throw new FetchError(`HTTP ${res.status}: ${candidate}`);
      return { bytes: new Uint8Array(await res.arrayBuffer()), url: candidate };
    } catch (e) {
      if (signal?.aborted) throw e;
      firstError ??= e;
    }
  }
  throw new FetchError(
    `作品ファイルを取得できませんでした（${firstError instanceof Error ? firstError.message : String(firstError)}）。` +
      'ネットワーク接続を確認するか、青空文庫からダウンロードしたファイルを「ファイルを開く」で読み込んでください。',
  );
}

/** ZIP の中から本文ファイル（.txt を優先、なければ .html）を取り出す */
export function extractFromZip(bytes: Uint8Array): { name: string; bytes: Uint8Array } {
  const files = unzipSync(bytes);
  const names = Object.keys(files).filter((n) => !n.startsWith('__MACOSX') && !n.endsWith('/'));
  const pick = names.find((n) => /\.txt$/i.test(n)) ?? names.find((n) => /\.x?html?$/i.test(n));
  if (!pick) throw new Error('ZIP の中に本文ファイル（.txt / .html）が見つかりませんでした');
  return { name: pick, bytes: files[pick] };
}

/** バイト列とファイル名（拡張子）から本文を解析する */
export function parseBytes(name: string, bytes: Uint8Array, baseUrl?: string): ParsedBook {
  if (/\.zip$/i.test(name) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    const inner = extractFromZip(bytes);
    return parseBytes(inner.name, inner.bytes, baseUrl);
  }
  const text = decodeBytes(bytes);
  if (/\.x?html?$/i.test(name) || /^\s*(<\?xml|<!DOCTYPE|<html)/i.test(text)) {
    return parseAozoraHtml(text, baseUrl);
  }
  return parseAozoraText(text, mirrorBase);
}

export async function loadCatalogWork(work: CatalogWork, signal?: AbortSignal): Promise<Book> {
  const errors: string[] = [];
  for (const url of [work.htmlUrl, work.textUrl].filter(Boolean)) {
    try {
      const { bytes, url: fetched } = await fetchBytes(url, signal);
      const parsed = parseBytes(url, bytes, fetched);
      if (!parsed.blocks.length) throw new Error('本文が空でした');
      return {
        ...parsed,
        title: work.title || parsed.title,
        subtitle: work.subtitle || parsed.subtitle,
        author: peopleLabel(work) || parsed.author,
        key: `aozora:${work.id}`,
        source: { kind: 'catalog', workId: work.id, url },
      };
    } catch (e) {
      if (signal?.aborted) throw e;
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  throw new Error(errors.join('\n') || 'この作品には読み込めるファイルがありません');
}

/** 図書カードまたは作品ファイルの URL から読み込む */
export async function loadFromUrl(url: string, signal?: AbortSignal): Promise<Book> {
  const { bytes, url: fetched } = await fetchBytes(url, signal);
  const path = new URL(url, location.href).pathname;
  if (/card\d+\.html$/.test(path)) {
    // 図書カード: XHTML 版、なければテキスト版へのリンクを探す
    const html = decodeBytes(bytes);
    const links = [...html.matchAll(/href="([^"]*files\/[^"]+\.(?:html|zip))"/g)].map((m) => m[1]);
    const target = links.find((l) => l.endsWith('.html')) ?? links.find((l) => l.endsWith('.zip'));
    if (!target) throw new Error('図書カードに作品ファイルへのリンクが見つかりませんでした');
    const original = new URL(target, url).href;
    const book = await loadFromUrl(original, signal);
    return { ...book, key: `url:${original}`, source: { kind: 'url', url: original } };
  }
  const parsed = parseBytes(path, bytes, fetched);
  return { ...parsed, key: `url:${url}`, source: { kind: 'url', url } };
}

export async function loadFromFile(file: File): Promise<Book> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = parseBytes(file.name, bytes);
  return {
    ...parsed,
    key: `file:${file.name}:${file.size}`,
    source: { kind: 'file', fileName: file.name },
  };
}
