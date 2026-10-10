import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MIRROR, parseBytes, toMirrorUrl } from '../src/aozora/sources';
import { fixture } from './helpers';

describe('toMirrorUrl', () => {
  it('青空文庫の URL をミラーに置き換える', () => {
    expect(toMirrorUrl('https://www.aozora.gr.jp/cards/000148/files/773_14560.html')).toBe(
      `${DEFAULT_MIRROR}cards/000148/files/773_14560.html`,
    );
    expect(toMirrorUrl('cards/000879/files/127_15260.html', 'https://m.example/')).toBe('https://m.example/cards/000879/files/127_15260.html');
  });

  it('ほかのサイトの URL はそのまま', () => {
    expect(toMirrorUrl('https://example.com/a.html')).toBe('https://example.com/a.html');
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
