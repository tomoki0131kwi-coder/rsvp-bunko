import { describe, expect, it } from 'vitest';
import { Catalog } from '../src/aozora/catalog';
import { parseCatalogCsv, peopleLabel } from '../src/aozora/catalogParse';
import { parseCsv } from '../src/aozora/csv';

const HEADER =
  '作品ID,作品名,作品名読み,ソート用読み,副題,副題読み,原題,初出,分類番号,文字遣い種別,作品著作権フラグ,公開日,最終更新日,図書カードURL,人物ID,姓,名,姓読み,名読み,姓読みソート用,名読みソート用,姓ローマ字,名ローマ字,役割フラグ,生年月日,没年月日,人物著作権フラグ,底本名1,テキストファイルURL,XHTML/HTMLファイルURL';
const row = (cells: Record<string, string>) =>
  HEADER.split(',')
    .map((h) => {
      const v = cells[h] ?? '';
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    })
    .join(',');

const CSV = [
  '﻿' + HEADER,
  row({ 作品ID: '000773', 作品名: 'こころ', 作品名読み: 'こころ', 文字遣い種別: '新字新仮名', 作品著作権フラグ: 'なし', 人物ID: '000148', 姓: '夏目', 名: '漱石', 姓読み: 'なつめ', 名読み: 'そうせき', 役割フラグ: '著者', 'XHTML/HTMLファイルURL': 'https://www.aozora.gr.jp/cards/000148/files/773_14560.html', テキストファイルURL: 'https://www.aozora.gr.jp/cards/000148/files/773_ruby_5968.zip' }),
  row({ 作品ID: '000127', 作品名: '羅生門', 作品名読み: 'らしょうもん', 文字遣い種別: '新字旧仮名', 作品著作権フラグ: 'なし', 人物ID: '000879', 姓: '芥川', 名: '竜之介', 姓読み: 'あくたがわ', 名読み: 'りゅうのすけ', 役割フラグ: '著者' }),
  row({ 作品ID: '043017', 作品名: 'ジキルとハイド', 作品名読み: 'じきるとはいど', 副題: '「カンマ, と\"引用符\"」', 作品著作権フラグ: 'あり', 人物ID: '001', 姓: 'スティーヴンソン', 名: 'ロバート・ルイス', 姓読み: 'すてぃーう゛んそん', 役割フラグ: '著者' }),
  row({ 作品ID: '043017', 作品名: 'ジキルとハイド', 作品名読み: 'じきるとはいど', 人物ID: '002', 姓: '佐々木', 名: '直次郎', 姓読み: 'ささき', 名読み: 'なおじろう', 役割フラグ: '翻訳者' }),
].join('\r\n');

describe('parseCsv', () => {
  it('引用符内のカンマ・改行・"" を扱う', () => {
    expect(parseCsv('a,"b,c","d\n""e"""\r\n1,2,3')).toEqual([
      ['a', 'b,c', 'd\n"e"'],
      ['1', '2', '3'],
    ]);
  });
});

describe('parseCatalogCsv', () => {
  const works = parseCatalogCsv(CSV);

  it('作品ごとにまとめ、人物を束ねる', () => {
    expect(works).toHaveLength(3);
    const jekyll = works.find((w) => w.id === 43017)!;
    expect(jekyll.people.map((p) => p.role)).toEqual(['著者', '翻訳者']);
    expect(jekyll.copyrighted).toBe(true);
    expect(jekyll.subtitle).toBe('「カンマ, と"引用符"」');
    expect(peopleLabel(jekyll)).toBe('スティーヴンソン ロバート・ルイス、佐々木 直次郎（翻訳者）');
  });

  it('作品ファイルの URL を取り出す', () => {
    const kokoro = works.find((w) => w.id === 773)!;
    expect(kokoro.htmlUrl).toBe('https://www.aozora.gr.jp/cards/000148/files/773_14560.html');
    expect(kokoro.textUrl).toMatch(/773_ruby_5968\.zip$/);
    expect(kokoro.kana).toBe('新字新仮名');
  });
});

describe('Catalog.search', () => {
  const catalog = new Catalog();
  catalog.setWorks(parseCatalogCsv(CSV), Date.now());

  it('作品名・読み・作家名（ひらがな・カタカナ問わず）で引ける', () => {
    expect(catalog.search('こころ').works.map((w) => w.id)).toEqual([773]);
    expect(catalog.search('ラショウモン').works.map((w) => w.id)).toEqual([127]);
    expect(catalog.search('なつめ').works.map((w) => w.id)).toEqual([773]);
    expect(catalog.search('芥川 羅生').works.map((w) => w.id)).toEqual([127]);
    expect(catalog.search('佐々木').works.map((w) => w.id)).toEqual([43017]);
    expect(catalog.search('存在しない').total).toBe(0);
  });

  it('作品名と著者名で 1 件を特定できる', () => {
    expect(catalog.find('羅生門', '芥川竜之介')?.id).toBe(127);
    expect(catalog.find('羅生門', '夏目漱石')).toBeUndefined();
  });
});
