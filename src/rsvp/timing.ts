import type { Chunk } from './chunker';

export interface TimingOptions {
  /** 1 分あたりの文字数 */
  cpm: number;
  /** 句読点・段落末での間の強さ（0 で間を入れない、1 が標準） */
  pauseScale: number;
}

/** 1 文字でも一瞬で消えないよう、最低でもこの文字数ぶんは表示する */
const MIN_CHARS = 2;
const MIN_MS = 120;

/** 区切りごとに追加する間（文字数換算） */
export const PAUSE_CHARS = {
  clause: 1.5,
  sentence: 3,
  block: 2.5,
  heading: 4,
  sceneBreak: 6,
};

export function chunkDuration(chunk: Chunk, opts: TimingOptions): number {
  const msPerChar = 60000 / Math.max(1, opts.cpm);
  let extra = 0;
  if (chunk.heading) extra += PAUSE_CHARS.heading;
  if (chunk.endsSentence) extra += PAUSE_CHARS.sentence;
  else if (chunk.endsClause) extra += PAUSE_CHARS.clause;
  if (chunk.endsBlock && !chunk.heading) extra += PAUSE_CHARS.block;
  if (chunk.beforeBreak) extra += PAUSE_CHARS.sceneBreak;
  const base = Math.max(MIN_MS, msPerChar * Math.max(MIN_CHARS, chunk.chars));
  return base + msPerChar * extra * opts.pauseScale;
}

/** 各位置までの累積表示時間（ms）。末尾要素は全体の所要時間。 */
export function cumulativeDurations(chunks: Chunk[], opts: TimingOptions): Float64Array {
  const acc = new Float64Array(chunks.length + 1);
  for (let i = 0; i < chunks.length; i++) acc[i + 1] = acc[i] + chunkDuration(chunks[i], opts);
  return acc;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}時間${String(m).padStart(2, '0')}分`;
  if (m) return `${m}分${String(s).padStart(2, '0')}秒`;
  return `${s}秒`;
}
