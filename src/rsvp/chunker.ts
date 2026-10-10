import { Parser, jaModel } from 'budoux';
import type { Block, Run } from '../types';

/** RSVP で一度に表示する単位 */
export interface Chunk {
  runs: Run[];
  text: string;
  /** 句読点・括弧を除いた文字数（表示時間の基準） */
  chars: number;
  /** 元の Block の番号 */
  block: number;
  /** 本文先頭からの文字位置（読書位置の保存に使う） */
  offset: number;
  heading: boolean;
  /** 見出しの階層 */
  level?: number;
  /** 文の先頭（文頭へ戻る操作の目印） */
  sentenceStart: boolean;
  /** 句点・感嘆符などで終わる */
  endsSentence: boolean;
  /** 読点で終わる */
  endsClause: boolean;
  /** 段落（行）の末尾 */
  endsBlock: boolean;
  /** 直後に空行・改ページがある */
  beforeBreak: boolean;
}

export interface ChunkOptions {
  /** 文節をまとめて表示する目安の最大文字数。1 以下なら文節ごと。 */
  targetChars: number;
  /** 1 文節がこれより長いときは分割する */
  hardMax: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { targetChars: 8, hardMax: 14 };

let parser: Parser | null = null;
function getParser(): Parser {
  return (parser ??= new Parser(jaModel));
}

const CLOSERS = '」』）〕］｝〉》】〙〗”’)]}';
const OPENERS = '「『（〔［｛〈《【〘〖“‘([{';
const SENTENCE_END = /[。！？!?．…‥]+[」』）〕］｝〉》】”’)\]]*$/u;
const CLAUSE_END = /[、，,；;：:―─]+[」』）〕］｝〉》】”’)\]]*$/u;
const PUNCT_ONLY = new RegExp(`^[、。，．,.！？!?…‥・：；―─〜～ー${escapeClass(CLOSERS)}]+$`, 'u');
const OPEN_ONLY = new RegExp(`^[${escapeClass(OPENERS)}]+$`, 'u');
const NON_COUNTED = new RegExp(`[\\s\\u3000、。，．,.！？!?…‥・：；―─${escapeClass(CLOSERS + OPENERS)}]`, 'gu');

function escapeClass(s: string): string {
  return s.replace(/[\\\]\[^-]/g, '\\$&');
}

export function countChars(text: string): number {
  return Array.from(text.replace(NON_COUNTED, '')).length;
}

export function chunkBlocks(blocks: Block[], opts: ChunkOptions = DEFAULT_CHUNK_OPTIONS): Chunk[] {
  const chunks: Chunk[] = [];
  let atSentenceStart = true;
  let blockOffset = 0;
  blocks.forEach((block, bi) => {
    const blockLength = block.runs.reduce((n, r) => n + r.text.length, 0);
    let offset = blockOffset;
    blockOffset += blockLength;
    if (block.type === 'break') {
      const last = chunks[chunks.length - 1];
      if (last) last.beforeBreak = true;
      return;
    }
    const pieces = chunkBlock(block, opts);
    pieces.forEach((runs, pi) => {
      const text = runs.map((r) => r.text).join('');
      const isHeading = block.type === 'heading';
      const endsSentence = SENTENCE_END.test(text);
      const endsBlock = pi === pieces.length - 1;
      const chunk: Chunk = {
        runs,
        text,
        chars: countChars(text),
        block: bi,
        offset,
        heading: isHeading,
        sentenceStart: atSentenceStart || pi === 0,
        endsSentence,
        endsClause: !endsSentence && CLAUSE_END.test(text),
        endsBlock,
        beforeBreak: false,
      };
      if (isHeading) chunk.level = block.level;
      offset += text.length;
      chunks.push(chunk);
      atSentenceStart = endsSentence || endsBlock;
    });
  });
  return chunks;
}

/** 1 つの Block を表示単位（Run 列）に分ける */
export function chunkBlock(block: Block, opts: ChunkOptions): Run[][] {
  const runs = block.runs;
  const plain = runs.map((r) => r.text).join('');
  if (!plain) return [];

  // ルビ・外字の内側では区切らない
  const protectedRanges: [number, number][] = [];
  let pos = 0;
  for (const r of runs) {
    if ((r.ruby || r.gaijiSrc) && r.text.length > 1) protectedRanges.push([pos, pos + r.text.length]);
    pos += r.text.length;
  }
  const allowed = (p: number) => !protectedRanges.some(([a, b]) => a < p && p < b) && !isSurrogateSplit(plain, p);

  const boundaries = new Set(getParser().parseBoundaries(plain).filter(allowed));
  // 句点の直後（閉じ括弧を含む）では必ず区切る
  for (const m of plain.matchAll(/[。！？!?]+[」』）〕］”’)]*(?=.)/gu)) {
    const p = (m.index ?? 0) + m[0].length;
    if (allowed(p)) boundaries.add(p);
  }

  const cuts = [0, ...[...boundaries].filter((p) => p > 0 && p < plain.length).sort((a, b) => a - b), plain.length];
  let phrases: [number, number][] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i];
    const b = cuts[i + 1];
    if (b - a > opts.hardMax) phrases.push(...splitLong(a, b, opts.hardMax, allowed));
    else phrases.push([a, b]);
  }
  phrases = attachPunctuation(phrases, plain);

  const merged: [number, number][] = [];
  for (const ph of phrases) {
    const last = merged[merged.length - 1];
    if (
      last &&
      opts.targetChars > 1 &&
      !SENTENCE_END.test(plain.slice(last[0], last[1])) &&
      countChars(plain.slice(last[0], ph[1])) <= opts.targetChars
    ) {
      last[1] = ph[1];
    } else {
      merged.push([ph[0], ph[1]]);
    }
  }
  return merged.map(([a, b]) => sliceRuns(runs, a, b));
}

/** 句読点・閉じ括弧だけの断片は前に、開き括弧だけの断片は次にくっつける */
function attachPunctuation(phrases: [number, number][], plain: string): [number, number][] {
  const out: [number, number][] = [];
  let carry: number | null = null;
  for (const [a0, b] of phrases) {
    const a: number = carry ?? a0;
    carry = null;
    const t = plain.slice(a0, b);
    if (out.length && PUNCT_ONLY.test(t)) {
      out[out.length - 1][1] = b;
    } else if (OPEN_ONLY.test(t)) {
      carry = a;
    } else {
      out.push([a, b]);
    }
  }
  if (carry !== null) {
    if (out.length) out[out.length - 1][1] = plain.length;
    else out.push([carry, plain.length]);
  }
  return out;
}

function splitLong(a: number, b: number, max: number, allowed: (p: number) => boolean): [number, number][] {
  const n = Math.ceil((b - a) / max);
  const size = Math.ceil((b - a) / n);
  const out: [number, number][] = [];
  let start = a;
  while (b - start > max) {
    let p = start + size;
    // 区切れない位置（ルビの内側など）なら後ろへずらす
    while (p < b && !allowed(p)) p++;
    if (p >= b) break;
    out.push([start, p]);
    start = p;
  }
  out.push([start, b]);
  return out;
}

function isSurrogateSplit(s: string, p: number): boolean {
  const c = s.charCodeAt(p);
  return c >= 0xdc00 && c <= 0xdfff;
}

/** 文字位置 [a, b) に当たる Run を切り出す（ルビ付き Run は分割しない前提） */
export function sliceRuns(runs: Run[], a: number, b: number): Run[] {
  const out: Run[] = [];
  let pos = 0;
  for (const r of runs) {
    const s = pos;
    const e = pos + r.text.length;
    pos = e;
    if (e <= a || s >= b) continue;
    if (s >= a && e <= b) {
      out.push(r);
    } else if (r.ruby || r.gaijiSrc) {
      // 保護範囲が切られることは無いはずだが、念のため丸ごと含める
      out.push(r);
    } else {
      out.push({ ...r, text: r.text.slice(Math.max(a, s) - s, Math.min(b, e) - s) });
    }
  }
  return out;
}

/** 文字位置を含むチャンクの番号 */
export function chunkIndexAtOffset(chunks: Chunk[], offset: number): number {
  let lo = 0;
  let hi = chunks.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (chunks[mid].offset <= offset) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}
