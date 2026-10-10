import { describe, expect, it } from 'vitest';
import { cellToNote, parseCardHtml } from '../src/aozora/cardNotes';
import { fixtureText } from './helpers';

describe('parseCardHtml', () => {
  it('実際の図書カードから「作品について」「人物について」を取り出す（Wikipedia へのリンクだけの例）', () => {
    const card = parseCardHtml(fixtureText('card56303_excerpt.html'));
    expect(card.work).toEqual({
      text: '「銭形平次 捕物控」',
      links: [{ label: '銭形平次 捕物控', href: 'http://ja.wikipedia.org/wiki/%e9%8a%ad%e5%bd%a2%e5%b9%b3%e6%ac%a1_%e6%8d%95%e7%89%a9%e6%8e%a7' }],
    });
    expect(card.persons).toEqual([
      {
        id: 1670,
        note: { text: '「野村胡堂」', links: [{ label: '野村胡堂', href: 'http://ja.wikipedia.org/wiki/%e9%87%8e%e6%9d%91%e8%83%a1%e5%a0%82' }] },
      },
    ]);
  });

  it('解説の無いカード・複数の人物（著者と翻訳者）', () => {
    const html = `
      <table summary="作品データ"><tr><td class="header">分類：</td><td>NDC 933</td></tr></table>
      <table summary="作家データ"><tr><td class="header">作家名：</td><td><a href="../../index_pages/person1.html">原作者</a></td></tr>
      <tr><td class="header">人物について：</td><td>イギリスの作家。<br>代表作に「某」。</td></tr></table>
      <table summary="作家データ"><tr><td class="header">作家名：</td><td><a href="../../index_pages/person2.html">訳者</a></td></tr></table>`;
    const card = parseCardHtml(html);
    expect(card.work).toBeUndefined();
    expect(card.persons).toEqual([
      { id: 1, note: { text: 'イギリスの作家。\n代表作に「某」。', links: [] } },
      { id: 2, note: undefined },
    ]);
  });
});

describe('cellToNote', () => {
  it('文字参照を戻し、script や空のセルを除く', () => {
    expect(cellToNote('A &amp; B&#x3042;<script>x()</script>')).toEqual({ text: 'A & Bあ', links: [] });
    expect(cellToNote('<div id="link"></div><script src="x.js"></script>')).toBeUndefined();
  });
});
