import { describe, expect, it } from 'vitest';
import { BlockBuilder } from '../src/aozora/blockBuilder';
import { parseAozoraText, parseInline } from '../src/aozora/parseText';
import { fixtureText } from './helpers';

const MIRROR = 'https://example.com/aozora/';

describe('parseAozoraText', () => {
  const book = parseAozoraText(fixtureText('rashomon_sample.txt'), MIRROR);
  const texts = book.blocks.map((b) => b.runs.map((r) => r.text).join(''));

  it('ヘッダーから表題と著者を取り、記号説明ブロックを読み飛ばす', () => {
    expect(book.title).toBe('羅生門');
    expect(book.author).toBe('芥川龍之介');
    expect(texts.join('')).not.toContain('記号について');
  });

  it('見出し注記を見出しにする', () => {
    expect(book.blocks[0]).toMatchObject({ type: 'heading', level: 2 });
    expect(texts[0]).toBe('一');
  });

  it('｜の無いルビは直前の漢字列に掛ける', () => {
    const runs = book.blocks[1].runs;
    expect(runs.find((r) => r.ruby === 'げにん')?.text).toBe('下人');
    expect(runs.find((r) => r.ruby === 'らしょうもん')?.text).toBe('羅生門');
    expect(texts[1]).toBe('ある日の暮方の事である。一人の下人が、羅生門の下で雨やみを待っていた。');
  });

  it('｜でルビの範囲を指定できる', () => {
    expect(book.blocks[2].runs[0]).toEqual({ text: '広い門', ruby: 'もん' });
  });

  it('外字注記を Unicode の文字にする（第3水準の面区点・U+ 指定）', () => {
    expect(texts[3]).toBe('挘と彿の例。');
    expect(book.blocks[3].runs.some((r) => r.gaijiSrc)).toBe(false);
  });

  it('改ページを区切りにし、底本以降を書誌情報にする', () => {
    expect(book.blocks[4].type).toBe('break');
    expect(texts[5]).toBe('下人の行方は、誰も知らない。');
    expect(book.blocks).toHaveLength(6);
    expect(book.bibliography).toBe('底本：「芥川龍之介全集1」ちくま文庫、筑摩書房\n入力：テスト');
  });
});

describe('parseInline', () => {
  const runsOf = (line: string) => {
    const b = new BlockBuilder();
    parseInline(line, b);
    b.lineBreak();
    return b.finish()[0].runs;
  };

  it('カタカナ語のルビは直前のカタカナ列に掛ける', () => {
    expect(runsOf('彼はロンドン《倫敦》へ行った')).toEqual([
      { text: '彼は' },
      { text: 'ロンドン', ruby: '倫敦' },
      { text: 'へ行った' },
    ]);
  });

  it('外字を含む語にもルビを掛ける（『蜘蛛の糸』の「犍陀多」）', () => {
    expect(runsOf('その※［＃「牛へん＋建」、第3水準1-87-71］陀多《かんだた》と云う')).toEqual([
      { text: 'その' },
      { text: '犍陀多', ruby: 'かんだた' },
      { text: 'と云う' },
    ]);
  });

  it('文字にできない外字は下駄記号にする', () => {
    expect(runsOf('あ※［＃「謎の字」、ページ数-行数］い')).toEqual([{ text: 'あ〓い' }]);
  });

  it('々を含む漢字列をひとまとまりとして扱う', () => {
    expect(runsOf('時々《ときどき》')).toEqual([{ text: '時々', ruby: 'ときどき' }]);
  });
});
