import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chunkBlocks } from '../src/rsvp/chunker';
import { RsvpPlayer } from '../src/rsvp/player';
import { chunkDuration } from '../src/rsvp/timing';
import type { Block } from '../src/types';

const blocks: Block[] = [
  { type: 'heading', level: 2, runs: [{ text: '一' }] },
  { type: 'para', runs: [{ text: '私はその人を常に先生と呼んでいた。だからここでもただ先生と書くだけで本名は打ち明けない。' }] },
  { type: 'heading', level: 2, runs: [{ text: '二' }] },
  { type: 'para', runs: [{ text: '私が先生と知り合いになったのは鎌倉である。' }] },
];
const timing = { cpm: 600, pauseScale: 1 };

describe('chunkDuration', () => {
  const chunks = chunkBlocks(blocks, { targetChars: 1, hardMax: 14 });
  it('文字数に比例し、句点や見出しで間を足す', () => {
    const plain = chunks.find((c) => c.text === 'その')!;
    expect(chunkDuration(plain, timing)).toBe(200); // 2 文字 × 100ms
    const end = chunks.find((c) => c.text === '呼んでいた。')!;
    expect(chunkDuration(end, timing)).toBe(500 + 300);
    expect(chunkDuration(end, { ...timing, pauseScale: 0 })).toBe(500);
    expect(chunkDuration(chunks[0], timing)).toBeGreaterThan(chunkDuration({ ...chunks[0], heading: false }, timing));
  });
});

describe('RsvpPlayer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = (start = 0) => new RsvpPlayer(chunkBlocks(blocks, { targetChars: 1, hardMax: 14 }), timing, start);

  it('再生すると表示時間ごとに進み、最後で止まる', () => {
    const p = make();
    const seen: number[] = [];
    p.subscribe(() => seen.push(p.index));
    p.play();
    vi.advanceTimersByTime(chunkDuration(p.chunks[0], timing) * 1.6 + 1);
    expect(p.index).toBe(1);
    vi.runAllTimers();
    expect(p.playing).toBe(false);
    expect(p.atEnd).toBe(true);
    expect(new Set(seen).size).toBe(p.chunks.length);
  });

  it('一時停止中は進まない', () => {
    const p = make();
    p.play();
    p.pause();
    vi.advanceTimersByTime(10_000);
    expect(p.index).toBe(0);
  });

  it('文頭・見出しへ移動できる', () => {
    const p = make();
    const idx = (t: string) => p.chunks.findIndex((c) => c.text === t);
    p.seek(idx('先生と'));
    p.sentence(-1);
    expect(p.current?.text).toBe('私は');
    p.sentence(1);
    expect(p.current?.text).toBe('だから');
    p.heading(1);
    expect(p.current?.text).toBe('二');
    p.seek(idx('鎌倉である。'));
    p.heading(-1);
    expect(p.current?.text).toBe('二');
    p.heading(-1);
    expect(p.current?.text).toBe('一');
  });

  it('残り時間は現在位置以降の表示時間の合計', () => {
    const p = make();
    const total = p.chunks.reduce((n, c) => n + chunkDuration(c, timing), 0);
    expect(p.remainingMs).toBeCloseTo(total);
    p.seek(p.chunks.length - 1);
    expect(p.remainingMs).toBeCloseTo(chunkDuration(p.chunks[p.chunks.length - 1], timing));
  });
});
