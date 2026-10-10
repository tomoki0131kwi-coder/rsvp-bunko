import type { Chunk } from './chunker';
import { chunkDuration, cumulativeDurations, type TimingOptions } from './timing';

/** 再生開始直後の数チャンクはゆっくり出して目を慣らす */
const RAMP = [1.6, 1.35, 1.15];

export type PlayerListener = (p: RsvpPlayer) => void;

/** チャンク列を一定のリズムで送り出す再生器。描画は listener 側が担う。 */
export class RsvpPlayer {
  private _index = 0;
  private _playing = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private rampStep = 0;
  private acc: Float64Array;
  private listeners = new Set<PlayerListener>();

  constructor(
    public readonly chunks: Chunk[],
    private timing: TimingOptions,
    startIndex = 0,
  ) {
    this.acc = cumulativeDurations(chunks, timing);
    this._index = clamp(startIndex, 0, Math.max(0, chunks.length - 1));
  }

  get index(): number {
    return this._index;
  }
  get playing(): boolean {
    return this._playing;
  }
  get current(): Chunk | undefined {
    return this.chunks[this._index];
  }
  get atEnd(): boolean {
    return this._index >= this.chunks.length - 1;
  }
  get progress(): number {
    return this.chunks.length <= 1 ? 1 : this._index / (this.chunks.length - 1);
  }
  get remainingMs(): number {
    return this.acc[this.acc.length - 1] - this.acc[this._index];
  }
  get totalMs(): number {
    return this.acc[this.acc.length - 1];
  }

  subscribe(fn: PlayerListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setTiming(timing: TimingOptions): void {
    this.timing = timing;
    this.acc = cumulativeDurations(this.chunks, timing);
    this.emit();
  }

  play(): void {
    if (this._playing || !this.chunks.length) return;
    if (this.atEnd) this._index = 0;
    this._playing = true;
    this.rampStep = 0;
    this.emit();
    this.schedule();
  }

  pause(): void {
    if (!this._playing) return;
    this._playing = false;
    this.clearTimer();
    this.emit();
  }

  toggle(): void {
    if (this._playing) this.pause();
    else this.play();
  }

  seek(index: number): void {
    this._index = clamp(Math.round(index), 0, Math.max(0, this.chunks.length - 1));
    if (this._playing) {
      this.clearTimer();
      this.rampStep = 0;
      this.schedule();
    }
    this.emit();
  }

  step(delta: number): void {
    this.seek(this._index + delta);
  }

  /** 前後の文頭へ移動する */
  sentence(direction: -1 | 1): void {
    this.seek(this.findSentenceStart(direction));
  }

  findSentenceStart(direction: -1 | 1): number {
    const c = this.chunks;
    let i = this._index;
    if (direction < 0) {
      // 文の途中なら今の文頭へ、文頭にいるなら一つ前の文頭へ
      if (c[i]?.sentenceStart && i > 0) i--;
      while (i > 0 && !c[i].sentenceStart) i--;
      return i;
    }
    i++;
    while (i < c.length - 1 && !c[i].sentenceStart) i++;
    return Math.min(i, c.length - 1);
  }

  /** 見出しの先頭チャンクか */
  isHeadingStart(i: number): boolean {
    const c = this.chunks;
    return !!c[i]?.heading && (i === 0 || c[i - 1].block !== c[i].block);
  }

  /** 前後の見出しへ移動する */
  heading(direction: -1 | 1): void {
    if (direction > 0) {
      for (let i = this._index + 1; i < this.chunks.length; i++) {
        if (this.isHeadingStart(i)) return this.seek(i);
      }
      return;
    }
    // 見出しを読んだ直後（数チャンク以内）なら、さらに一つ前の見出しへ
    let i = this._index;
    while (i > 0 && !this.isHeadingStart(i)) i--;
    if (this._index - i <= 2 && i > 0) {
      i--;
      while (i > 0 && !this.isHeadingStart(i)) i--;
    }
    this.seek(i);
  }

  destroy(): void {
    this.clearTimer();
    this.listeners.clear();
  }

  private schedule(): void {
    const chunk = this.current;
    if (!chunk) return;
    const ramp = RAMP[this.rampStep] ?? 1;
    this.rampStep++;
    const ms = chunkDuration(chunk, this.timing) * ramp;
    this.timer = setTimeout(() => this.advance(), ms);
  }

  private advance(): void {
    this.timer = null;
    if (!this._playing) return;
    if (this.atEnd) {
      this._playing = false;
      this.emit();
      return;
    }
    this._index++;
    this.emit();
    this.schedule();
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this);
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
