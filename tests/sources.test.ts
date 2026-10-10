import { zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TEXT_MIRROR } from '../src/aozora/mirror';
import { LoadError, loadCatalogWork, loadFromUrl, parseBytes, workIdFromAozoraUrl } from '../src/aozora/sources';
import type { CatalogWork } from '../src/types';
import { fixture } from './helpers';

const rashomon: CatalogWork = {
  id: 127,
  title: '羅生門',
  titleYomi: 'らしょうもん',
  subtitle: '',
  kana: '新字旧仮名',
  people: [{ id: 879, name: '芥川 竜之介', yomi: 'あくたがわ りゅうのすけ', role: '著者' }],
  cardUrl: 'https://www.aozora.gr.jp/cards/000879/card127.html',
  ndc: 'NDC 913',
  htmlUrl: '',
  textUrl: 'https://www.aozora.gr.jp/cards/000879/files/127_ruby_150.zip',
  mirrorPath: 'cards/000879/files/127_ruby_150/127_ruby_150.txt',
  copyrighted: false,
  published: '1997-11-04',
};

function mockFetch(files: Record<string, Uint8Array>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url);
    const body = files[url];
    return body ? new Response(new Uint8Array(body)) : new Response('not found', { status: 404 });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('workIdFromAozoraUrl', () => {
  it('図書カード・作品ファイルの URL から作品 ID を取り出す', () => {
    expect(workIdFromAozoraUrl('https://www.aozora.gr.jp/cards/000148/card773.html')).toBe(773);
    expect(workIdFromAozoraUrl('https://www.aozora.gr.jp/cards/000148/files/773_14560.html')).toBe(773);
    expect(workIdFromAozoraUrl('https://www.aozora.gr.jp/cards/000148/files/773_ruby_5968.zip')).toBe(773);
    expect(workIdFromAozoraUrl('https://www.aozora.gr.jp/index.html')).toBeUndefined();
  });
});

describe('loadCatalogWork', () => {
  it('本文ミラーからテキストを取得して解析する（実際の青空文庫ファイル）', async () => {
    const calls = mockFetch({ [DEFAULT_TEXT_MIRROR + rashomon.mirrorPath]: fixture('127_ruby_150.txt') });
    const book = await loadCatalogWork(rashomon);
    expect(calls).toEqual([DEFAULT_TEXT_MIRROR + rashomon.mirrorPath]);
    expect(book).toMatchObject({ key: 'aozora:127', title: '羅生門', author: '芥川 竜之介' });
    const first = book.blocks[0].runs.map((r) => r.text).join('');
    expect(first).toBe('ある日の暮方の事である。一人の下人が、羅生門の下で雨やみを待っていた。');
    expect(book.blocks[0].runs.find((r) => r.ruby === 'げにん')?.text).toBe('下人');
    const last = book.blocks.filter((b) => b.type === 'para').pop()!;
    expect(last.runs.map((r) => r.text).join('')).toBe('（大正四年九月）');
    expect(book.bibliography).toMatch(/^底本：「芥川龍之介全集1」ちくま文庫、筑摩書房/);
    expect(book.bibliography).toContain('入力：平山誠、野口英司');
  });

  it('本文ミラーに無い作品は図書カードへの案内付きのエラーにする', async () => {
    const err = await loadCatalogWork({ ...rashomon, mirrorPath: undefined }).catch((e) => e);
    expect(err).toBeInstanceOf(LoadError);
    expect(err.link?.href).toBe(rashomon.cardUrl);
  });
});

describe('loadFromUrl', () => {
  it('青空文庫の図書カード URL は図書目録経由で本文ミラーから読む', async () => {
    const calls = mockFetch({ [DEFAULT_TEXT_MIRROR + rashomon.mirrorPath]: fixture('127_ruby_150.txt') });
    const book = await loadFromUrl('https://www.aozora.gr.jp/cards/000879/card127.html', (id) => (id === 127 ? rashomon : undefined));
    expect(book.title).toBe('羅生門');
    expect(calls.every((u) => !u.includes('aozora.gr.jp'))).toBe(true);
  });

  it('図書目録に無くても ZIP の URL ならミラーのパスに置き換えて読む', async () => {
    const path = 'cards/000879/files/127_ruby_150/127_ruby_150.txt';
    mockFetch({ [DEFAULT_TEXT_MIRROR + path]: fixture('127_ruby_150.txt') });
    const book = await loadFromUrl('https://www.aozora.gr.jp/cards/000879/files/127_ruby_150.zip', () => undefined);
    expect(book.title).toBe('羅生門');
  });
});

describe('parseBytes', () => {
  it('ZIP 内の Shift_JIS テキストを読み込む', () => {
    const zip = zipSync({ 'rashomon.txt': fixture('rashomon_sample.sjis.txt') });
    const book = parseBytes('127_ruby_150.zip', zip);
    expect(book.title).toBe('羅生門');
    expect(book.blocks.length).toBeGreaterThan(3);
  });

  it('Shift_JIS の XHTML を読み込む', () => {
    const book = parseBytes('773_14560.html', fixture('kokoro_sample.sjis.html'));
    expect(book.title).toBe('こころ');
    expect(book.blocks[2].runs[0]).toEqual({ text: '私', ruby: 'わたくし' });
  });
});
