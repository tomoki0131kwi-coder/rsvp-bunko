import { describe, expect, it } from 'vitest';
import { FACET_BY_KEY, eraOfDate, estimateChars, genreLabel, kanaRow, ndcCodes } from '../src/aozora/facets';
import type { CatalogWork } from '../src/types';

const work = (patch: Partial<CatalogWork>): CatalogWork => ({
  id: 1,
  title: 'テスト',
  titleYomi: 'てすと',
  subtitle: '',
  kana: '新字新仮名',
  people: [{ id: 1, name: '作家', yomi: 'さっか', role: '著者' }],
  cardUrl: '',
  htmlUrl: '',
  textUrl: '',
  ndc: '',
  copyrighted: false,
  published: '2000-01-01',
  ...patch,
});
const values = (key: keyof typeof FACET_BY_KEY, w: CatalogWork) => FACET_BY_KEY[key].valuesOf(w);

describe('ジャンル（NDC）', () => {
  it('分類番号から番号を取り出す', () => {
    expect(ndcCodes('NDC 913')).toEqual(['913']);
    expect(ndcCodes('NDC K913 914')).toEqual(['K913', '914']);
    expect(ndcCodes('')).toEqual([]);
  });

  it('文学は第2次区分（91 日本文学など）、それ以外は第1次区分で分ける', () => {
    expect(values('field', work({ ndc: 'NDC 913' }))).toEqual(['91']);
    expect(values('field', work({ ndc: 'NDC 933' }))).toEqual(['93']);
    expect(values('field', work({ ndc: 'NDC 210' }))).toEqual(['2']);
    expect(values('field', work({ ndc: 'NDC 913 210' }))).toEqual(['91', '2']);
    expect(values('field', work({ ndc: '' }))).toEqual(['none']);
  });

  it('文学の第3桁を形式として扱う（919 は漢詩文、99x は言語区分なので形式なし）', () => {
    expect(values('form', work({ ndc: 'NDC 913' }))).toEqual(['3']);
    expect(values('form', work({ ndc: 'NDC 951' }))).toEqual(['1']);
    expect(values('form', work({ ndc: 'NDC 919' }))).toEqual(['kanshi']);
    expect(values('form', work({ ndc: 'NDC 991' }))).toEqual(['none']);
    expect(values('form', work({ ndc: 'NDC 910 914' }))).toEqual(['4']);
    expect(values('form', work({ ndc: 'NDC 210' }))).toEqual(['none']);
  });

  it('K の付く分類番号を児童書とする', () => {
    expect(values('audience', work({ ndc: 'NDC K913' }))).toEqual(['kids']);
    expect(values('audience', work({ ndc: 'NDC 913' }))).toEqual(['general']);
  });

  it('一覧用の短いジャンル表記', () => {
    expect(genreLabel(work({ ndc: 'NDC K913' }))).toBe('日本文学・小説・物語・児童書');
    expect(genreLabel(work({ ndc: 'NDC 210' }))).toBe('歴史・地理');
  });
});

describe('長さ', () => {
  it('本文のバイト数から文字数を見積もる', () => {
    // こころ（773_ruby_5968.txt）: 374,152 バイト、本文 160,241 字
    expect(estimateChars(374152)! / 160241).toBeGreaterThan(0.95);
    expect(estimateChars(374152)! / 160241).toBeLessThan(1.1);
    expect(estimateChars(undefined)).toBeUndefined();
  });

  it('見積もった文字数で括る', () => {
    expect(values('length', work({ textSize: 5000 }))).toEqual(['s1']);
    expect(values('length', work({ textSize: 374152 }))).toEqual(['s5']);
    expect(values('length', work({}))).toEqual(['unknown']);
  });
});

describe('作家の生まれた時代', () => {
  it('改元日を境に分ける', () => {
    expect(eraOfDate('1867-02-09')).toBe('edo'); // 夏目漱石
    expect(eraOfDate('1868-01-25')).toBe('meiji');
    expect(eraOfDate('1912-07-29')).toBe('meiji');
    expect(eraOfDate('1912-07-30')).toBe('taisho');
    expect(eraOfDate('1926-12-25')).toBe('showa');
    expect(eraOfDate('1909')).toBe('meiji');
    expect(eraOfDate('')).toBe('unknown');
  });

  it('著者の生年で括る（翻訳者は使わない）', () => {
    const w = work({
      people: [
        { id: 2, name: '訳者', yomi: 'やくしゃ', role: '翻訳者', born: '1950-01-01' },
        { id: 3, name: '原作者', yomi: 'げんさくしゃ', role: '著者', born: '1850-01-01' },
      ],
    });
    expect(values('era', w)).toEqual(['edo']);
  });
});

describe('作品名の頭文字', () => {
  it('読みの先頭の文字の行', () => {
    expect(kanaRow('こころ')).toBe('か');
    expect(kanaRow('ぎんがてつどうのよる')).toBe('か');
    expect(kanaRow('ヴィヨンのつま')).toBe('あ');
    expect(kanaRow('ABC')).toBe('other');
  });
});

describe('一覧の表記', async () => {
  const { formatChars, formatReadingTime } = await import('../src/ui/workList');
  it('文字数の目安', () => {
    expect(formatChars(9980)).toBe('約1.0万字');
    expect(formatChars(8200)).toBe('約8千字');
    expect(formatChars(160241)).toBe('約16万字');
    expect(formatChars(430)).toBe('約400字');
  });
  it('読了時間の目安', () => {
    expect(formatReadingTime(200, 600)).toBe('1分未満');
    expect(formatReadingTime(9000, 600)).toBe('約15分');
    expect(formatReadingTime(160241, 600)).toBe('約4時間27分');
  });
});
