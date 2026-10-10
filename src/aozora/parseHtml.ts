import type { Book } from '../types';
import { BlockBuilder, normalizeSpace } from './blockBuilder';
import { GETA, parseGaijiNote } from './gaiji';

export type ParsedBook = Omit<Book, 'key' | 'source'>;

const BLOCK_TAGS = new Set([
  'DIV', 'P', 'BLOCKQUOTE', 'TABLE', 'TR', 'UL', 'OL', 'LI', 'DL', 'DT', 'DD', 'CENTER', 'PRE', 'HR',
]);
const SKIP_TAGS = new Set(['RP', 'RT', 'SCRIPT', 'STYLE', 'NOSCRIPT']);
const EM_TAGS = new Set(['EM', 'STRONG', 'B']);

/**
 * 青空文庫の XHTML ファイルを解析する。
 * 構造は「青空文庫 XHTML 版」の書式（div.main_text 内に本文、行末は <br />、
 * ルビは <ruby><rb>…</rb><rp>（</rp><rt>…</rt><rp>）</rp></ruby>、見出しは h3〜h5 の
 * o-midashi / naka-midashi / ko-midashi、注記は span.notes、外字は img.gaiji）に従う。
 */
export function parseAozoraHtml(html: string, baseUrl?: string): ParsedBook {
  // 解析にはスタイルシートやスクリプトは不要なので、外部リソースへの参照ごと取り除く
  const source = html.replace(/<link\b[^>]*>/gi, '').replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const doc = new DOMParser().parseFromString(source, 'text/html');
  const titleEl = doc.querySelector('.metadata .title, h1.title');
  const authorEls = doc.querySelectorAll('.metadata .author, h2.author, .metadata .translator, h2.translator');
  const subtitleEl = doc.querySelector('.metadata .subtitle, h2.subtitle');
  const docTitle = normalizeSpace(doc.title || '');

  let title = normalizeSpace(titleEl?.textContent ?? '');
  const author = Array.from(authorEls)
    .map((e) => normalizeSpace(e.textContent ?? ''))
    .filter(Boolean)
    .join('　');
  if (!title) title = docTitle.replace(author, '').trim() || docTitle || '無題';

  const main = doc.querySelector('.main_text') ?? doc.body;
  const builder = new BlockBuilder();
  if (main) walk(main, builder, false, baseUrl);

  const bibEl = doc.querySelector('.bibliographical_information');
  const bibliography = bibEl ? blockText(bibEl) : undefined;

  return {
    title,
    subtitle: normalizeSpace(subtitleEl?.textContent ?? '') || undefined,
    author,
    blocks: builder.finish(),
    bibliography,
  };
}

function walk(node: Node, b: BlockBuilder, em: boolean, baseUrl?: string): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      b.text((child.nodeValue ?? '').replace(/[\r\n\t]/g, ''), em);
      continue;
    }
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    const tag = el.tagName.toUpperCase();
    const cls = el.getAttribute('class') ?? '';

    if (SKIP_TAGS.has(tag)) continue;
    if (tag === 'BR') {
      b.lineBreak();
    } else if (tag === 'RUBY') {
      const { base, ruby } = readRuby(el);
      b.ruby(base, ruby, em);
    } else if (tag === 'IMG') {
      handleImage(el, b, baseUrl);
    } else if (tag === 'SPAN' && /\bnotes\b/.test(cls)) {
      // 注記は読み上げ対象外。ただし Unicode 指定の外字注記は文字に置き換える。
      const note = el.textContent ?? '';
      if (note.startsWith('※')) {
        const info = parseGaijiNote(note);
        if (info.char) b.text(info.char, em);
      }
    } else if (tag === 'SPAN' && /\bkaeriten\b/.test(cls)) {
      // 漢文の返り点は RSVP では読みの妨げになるので省く
    } else if (/^H[1-6]$/.test(tag) || /(^|\s)(o|naka|ko)-midashi\b/.test(cls)) {
      b.heading(headingLevel(tag, cls), () => walk(el, b, em, baseUrl));
    } else if (BLOCK_TAGS.has(tag)) {
      b.blockBoundary();
      walk(el, b, em, baseUrl);
      b.blockBoundary();
      b.markBlockClosed();
    } else {
      const emphasized = em || EM_TAGS.has(tag) || /sesame_dot|bouten|boten/.test(cls);
      walk(el, b, emphasized, baseUrl);
    }
  }
}

function readRuby(el: Element): { base: string; ruby: string } {
  let base = '';
  let ruby = '';
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === 3) {
      base += c.nodeValue ?? '';
    } else if (c.nodeType === 1) {
      const t = (c as Element).tagName.toUpperCase();
      if (t === 'RT') ruby += c.textContent ?? '';
      else if (t === 'RP') continue;
      else if (t === 'IMG') base += gaijiTextFromAlt((c as Element).getAttribute('alt') ?? '');
      else base += c.textContent ?? '';
    }
  }
  return { base: base.replace(/[\r\n\t]/g, ''), ruby: ruby.replace(/[\r\n\t]/g, '') };
}

function handleImage(el: Element, b: BlockBuilder, baseUrl?: string): void {
  const alt = el.getAttribute('alt') ?? '';
  const src = el.getAttribute('src') ?? '';
  const isGaiji = /\bgaiji\b/.test(el.getAttribute('class') ?? '') || /gaiji\//.test(src);
  if (!isGaiji) return; // 挿絵は RSVP では扱わない
  const info = parseGaijiNote(alt);
  if (info.char) return b.text(info.char);
  b.gaiji(GETA, resolveUrl(src, baseUrl), info.desc);
}

function gaijiTextFromAlt(alt: string): string {
  return parseGaijiNote(alt).char ?? GETA;
}

function headingLevel(tag: string, cls: string): number {
  if (/(^|\s)o-midashi/.test(cls)) return 1;
  if (/naka-midashi/.test(cls)) return 2;
  if (/ko-midashi/.test(cls)) return 3;
  const n = Number(tag.slice(1));
  return Number.isFinite(n) ? Math.min(3, Math.max(1, n - 2)) : 2;
}

function resolveUrl(src: string, baseUrl?: string): string | undefined {
  if (!src) return undefined;
  try {
    return new URL(src, baseUrl).href;
  } catch {
    return undefined;
  }
}

/** <br> を改行として残しつつテキスト化する */
function blockText(el: Element): string {
  const parts: string[] = [];
  const rec = (n: Node) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === 3) parts.push((c.nodeValue ?? '').replace(/[\r\n\t]/g, ''));
      else if (c.nodeType === 1) {
        const t = (c as Element).tagName.toUpperCase();
        if (t === 'BR') parts.push('\n');
        else if (t === 'RP' || t === 'RT') continue;
        else {
          if (BLOCK_TAGS.has(t)) parts.push('\n');
          rec(c);
        }
      }
    }
  };
  rec(el);
  return parts
    .join('')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}
