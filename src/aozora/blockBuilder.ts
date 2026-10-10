import type { Block, Run } from '../types';

const EDGE_SPACE = /^[\s　]+|[\s　]+$/g;

/** 行単位で Run を組み立て、Block 列にまとめる。HTML/テキスト両方のパーサーで共用する。 */
export class BlockBuilder {
  readonly blocks: Block[] = [];
  private runs: Run[] = [];
  /** 直前にブロック要素（見出し等）を閉じたばかりか。直後の改行は行末とみなして無視する。 */
  private justClosedBlock = false;

  get hasContent(): boolean {
    return this.runs.some((r) => r.text.length > 0 || r.gaijiSrc);
  }

  text(text: string, em = false): void {
    if (!text) return;
    this.justClosedBlock = false;
    const last = this.runs[this.runs.length - 1];
    if (last && !last.ruby && !last.gaijiSrc && !!last.em === em) {
      last.text += text;
    } else {
      this.runs.push(em ? { text, em } : { text });
    }
  }

  ruby(base: string, ruby: string, em = false): void {
    if (!base) return;
    if (!ruby) return this.text(base, em);
    this.justClosedBlock = false;
    this.runs.push(em ? { text: base, ruby, em } : { text: base, ruby });
  }

  gaiji(text: string, src: string | undefined, alt: string): void {
    this.justClosedBlock = false;
    if (src) this.runs.push({ text, gaijiSrc: src, gaijiAlt: alt });
    else this.text(text);
  }

  /** 改行。内容が無ければ空行（場面転換）として扱う。 */
  lineBreak(): void {
    if (!this.hasContent) {
      this.runs = [];
      if (this.justClosedBlock) {
        this.justClosedBlock = false;
        return;
      }
      this.pushBreak();
      return;
    }
    this.flush('para');
  }

  /** ブロック要素の境界。内容があれば行を閉じるが、空行は作らない。 */
  blockBoundary(): void {
    if (this.hasContent) this.flush('para');
    else this.runs = [];
  }

  heading(level: number, fill: () => void): void {
    this.blockBoundary();
    fill();
    if (this.hasContent) this.flush('heading', level);
    else this.runs = [];
    this.justClosedBlock = true;
  }

  markBlockClosed(): void {
    this.justClosedBlock = true;
  }

  pageBreak(): void {
    this.blockBoundary();
    this.pushBreak();
  }

  finish(): Block[] {
    this.blockBoundary();
    while (this.blocks.length && this.blocks[this.blocks.length - 1].type === 'break') this.blocks.pop();
    while (this.blocks.length && this.blocks[0].type === 'break') this.blocks.shift();
    return this.blocks;
  }

  private pushBreak(): void {
    const last = this.blocks[this.blocks.length - 1];
    if (last && last.type !== 'break') this.blocks.push({ type: 'break', runs: [] });
  }

  private flush(type: 'para' | 'heading', level?: number): void {
    const runs = trimRuns(this.runs);
    this.runs = [];
    if (!runs.length) return;
    const block: Block = { type, runs };
    if (level) block.level = level;
    this.blocks.push(block);
  }
}

/** 行頭の全角スペース（字下げ）と行末の空白を取り除く */
function trimRuns(runs: Run[]): Run[] {
  const out = runs.map((r) => ({ ...r }));
  while (out.length && !out[0].ruby && !out[0].gaijiSrc) {
    out[0].text = out[0].text.replace(/^[\s　]+/, '');
    if (out[0].text) break;
    out.shift();
  }
  while (out.length) {
    const last = out[out.length - 1];
    if (last.ruby || last.gaijiSrc) break;
    last.text = last.text.replace(/[\s　]+$/, '');
    if (last.text) break;
    out.pop();
  }
  return out;
}

export function normalizeSpace(s: string): string {
  return s.replace(EDGE_SPACE, '');
}
