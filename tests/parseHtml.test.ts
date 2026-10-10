import { describe, expect, it } from 'vitest';
import { parseAozoraHtml } from '../src/aozora/parseHtml';
import { fixtureText } from './helpers';

const BASE = 'https://raw.githubusercontent.com/aozorabunko/aozorabunko/master/cards/000148/files/773_14560.html';

describe('parseAozoraHtml', () => {
  const book = parseAozoraHtml(fixtureText('kokoro_sample.html'), BASE);

  it('表題と著者を取り出す', () => {
    expect(book.title).toBe('こころ');
    expect(book.author).toBe('夏目漱石');
  });

  it('見出しを階層つきで取り出し、見出し直後の改行を空行にしない', () => {
    expect(book.blocks[0]).toMatchObject({ type: 'heading', level: 1, runs: [{ text: '上　先生と私' }] });
    expect(book.blocks[1]).toMatchObject({ type: 'heading', level: 2, runs: [{ text: '一' }] });
    expect(book.blocks[2].type).toBe('para');
  });

  it('ルビを Run に分け、行頭の字下げを除く', () => {
    const p = book.blocks[2];
    expect(p.runs[0]).toEqual({ text: '私', ruby: 'わたくし' });
    expect(p.runs[1].text.startsWith('はその人を常に先生と呼んでいた。')).toBe(true);
  });

  it('注記を除き、傍点を強調として残す', () => {
    const p = book.blocks[3];
    const text = p.runs.map((r) => r.text).join('');
    expect(text).toBe('私が先生と知り合いになったのは鎌倉である。その時私はまだ若々しい書生であった。');
    expect(p.runs.find((r) => r.text === '鎌倉')?.ruby).toBe('かまくら');
    expect(p.runs.find((r) => r.em)?.text).toBe('その時');
  });

  it('空行を場面転換として残す', () => {
    expect(book.blocks[4].type).toBe('break');
  });

  it('第3・第4水準の外字は Unicode の文字にする', () => {
    // alt="※(「てへん＋劣」、第3水準1-84-77)" → 挘（U+6318）
    const text = book.blocks[5].runs.map((r) => r.text).join('');
    expect(text).toBe('外字の例挘です。');
    expect(book.blocks[5].runs.some((r) => r.gaijiSrc)).toBe(false);
  });

  it('文字にできない外字は画像の URL を作品ファイル基準で解決する', () => {
    const html = '<div class="main_text">あ<img src="../../../gaiji/other/x.png" alt="※(「謎の字」、ページ数-行数)" class="gaiji" />い<br /></div>';
    const b = parseAozoraHtml(html, BASE);
    const gaiji = b.blocks[0].runs.find((r) => r.gaijiSrc);
    expect(gaiji?.gaijiSrc).toBe('https://raw.githubusercontent.com/aozorabunko/aozorabunko/master/gaiji/other/x.png');
    expect(gaiji?.gaijiAlt).toBe('謎の字');
  });

  it('ルビの掛かる語に外字が含まれていても文字にする', () => {
    const html =
      '<div class="main_text"><ruby><rb><img src="../../../gaiji/1-87/1-87-71.png" alt="※(「牛へん＋建」、第3水準1-87-71)" class="gaiji" />陀多</rb><rp>（</rp><rt>かんだた</rt><rp>）</rp></ruby><br /></div>';
    expect(parseAozoraHtml(html, BASE).blocks[0].runs).toEqual([{ text: '犍陀多', ruby: 'かんだた' }]);
  });

  it('ブロック要素内の行も段落として扱う', () => {
    expect(book.blocks[6]).toMatchObject({ type: 'para', runs: [{ text: '字下げされた行。' }] });
    expect(book.blocks).toHaveLength(7);
  });

  it('書誌情報を本文と分けて取り出す', () => {
    expect(book.bibliography).toBe('底本：「こころ」新潮文庫、新潮社\n入力：テスト');
  });
});
