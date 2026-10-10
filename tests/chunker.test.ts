import { describe, expect, it } from 'vitest';
import { chunkBlock, chunkBlocks, chunkIndexAtOffset, countChars } from '../src/rsvp/chunker';
import type { Block } from '../src/types';

const para = (...runs: Block['runs']): Block => ({ type: 'para', runs });
const text = (runs: { text: string }[]) => runs.map((r) => r.text).join('');

describe('chunkBlock', () => {
  const block = para({ text: '私', ruby: 'わたくし' }, { text: 'はその人を常に先生と呼んでいた。だからここでもただ先生と書くだけで本名は打ち明けない。' });

  it('文節ごとに区切り、元の文章を欠落なく覆う', () => {
    const chunks = chunkBlock(block, { targetChars: 1, hardMax: 14 });
    expect(chunks.map(text)).toEqual([
      '私は', 'その', '人を', '常に', '先生と', '呼んでいた。', 'だから', 'ここでもただ', '先生と', '書くだけで', '本名は', '打ち明けない。',
    ]);
    expect(chunks[0][0]).toEqual({ text: '私', ruby: 'わたくし' });
  });

  it('目安の文字数まで文節をまとめるが、文をまたがない', () => {
    const chunks = chunkBlock(block, { targetChars: 8, hardMax: 14 }).map(text);
    expect(chunks.join('')).toBe(text(block.runs));
    for (const c of chunks) expect(countChars(c)).toBeLessThanOrEqual(8);
    expect(chunks).toContain('先生と呼んでいた。');
    expect(chunks.some((c) => /。./.test(c))).toBe(false);
  });

  it('ルビの掛かる語の途中では区切らない', () => {
    const b = para({ text: '吾輩は' }, { text: '猫である名前はまだ無い', ruby: 'ねこであるなまえはまだない' });
    const chunks = chunkBlock(b, { targetChars: 1, hardMax: 4 });
    const rubyRun = chunks.flat().filter((r) => r.ruby);
    expect(rubyRun).toHaveLength(1);
    expect(rubyRun[0].text).toBe('猫である名前はまだ無い');
  });

  it('長すぎる文節は分割する', () => {
    const b = para({ text: 'ああああああああああああああああああああああああああ' });
    const chunks = chunkBlock(b, { targetChars: 1, hardMax: 10 });
    for (const c of chunks) expect(text(c).length).toBeLessThanOrEqual(10);
    expect(chunks.map(text).join('')).toBe(text(b.runs));
  });

  it('閉じ括弧や句読点だけの断片を前に付ける', () => {
    const b = para({ text: '「おい、待て」と彼は言った。' });
    const chunks = chunkBlock(b, { targetChars: 1, hardMax: 14 }).map(text);
    expect(chunks.join('')).toBe('「おい、待て」と彼は言った。');
    expect(chunks.some((c) => /^[」、。]/.test(c))).toBe(false);
    expect(chunks.some((c) => /「$/.test(c))).toBe(false);
  });
});

describe('chunkBlocks', () => {
  const blocks: Block[] = [
    { type: 'heading', level: 2, runs: [{ text: '一' }] },
    para({ text: 'ある日の暮方の事である。一人の下人が、羅生門の下で雨やみを待っていた。' }),
    { type: 'break', runs: [] },
    para({ text: '下人の行方は、誰も知らない。' }),
  ];
  const chunks = chunkBlocks(blocks, { targetChars: 8, hardMax: 14 });

  it('見出し・文頭・段落末・場面転換の印を付ける', () => {
    expect(chunks[0]).toMatchObject({ heading: true, level: 2, endsBlock: true, sentenceStart: true });
    const lastOfPara = chunks.filter((c) => c.block === 1).pop()!;
    expect(lastOfPara).toMatchObject({ endsBlock: true, endsSentence: true, beforeBreak: true });
    const second = chunks.find((c) => c.block === 1 && c.text.startsWith('一人'))!;
    expect(second.sentenceStart).toBe(true);
    expect(chunks.find((c) => c.text.endsWith('、'))?.endsClause).toBe(true);
  });

  it('本文中の文字位置からチャンクを引ける', () => {
    for (const [i, c] of chunks.entries()) {
      expect(chunkIndexAtOffset(chunks, c.offset)).toBe(i);
      expect(chunkIndexAtOffset(chunks, c.offset + c.text.length - 1)).toBe(i);
    }
    const firstOfLast = chunks.find((c) => c.block === 3)!;
    expect(firstOfLast.offset).toBe(1 + text(blocks[1].runs).length);
  });
});
