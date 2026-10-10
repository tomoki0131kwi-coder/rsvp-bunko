import { describe, expect, it } from 'vitest';
import { decodeBytes, sniffCharset } from '../src/aozora/decode';
import { fixture, fixtureText } from './helpers';

describe('decode', () => {
  it('XML 宣言の Shift_JIS を検出してデコードする', () => {
    const bytes = fixture('kokoro_sample.sjis.html');
    expect(sniffCharset(bytes)).toBe('shift_jis');
    expect(decodeBytes(bytes)).toBe(fixtureText('kokoro_sample.html'));
  });

  it('宣言の無いテキストは UTF-8 として読めなければ Shift_JIS とみなす', () => {
    expect(sniffCharset(fixture('rashomon_sample.sjis.txt'))).toBe('shift_jis');
    expect(sniffCharset(fixture('rashomon_sample.txt'))).toBe('utf-8');
    expect(decodeBytes(fixture('rashomon_sample.sjis.txt'))).toBe(fixtureText('rashomon_sample.txt'));
  });
});
