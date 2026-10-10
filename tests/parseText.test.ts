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

  it('外字注記を画像または Unicode 文字にする', () => {
    const runs = book.blocks[3].runs;
    expect(runs[0]).toMatchObject({ text: '〓', gaijiSrc: `${MIRROR}gaiji/1-84/1-84-77.png` });
    expect(texts[3]).toBe('〓と彿の例。');
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

  it('々を含む漢字列をひとまとまりとして扱う', () => {
    expect(runsOf('時々《ときどき》')).toEqual([{ text: '時々', ruby: 'ときどき' }]);
  });
});
