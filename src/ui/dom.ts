type Attrs = Record<string, string | number | boolean | EventListener | undefined | null>;
type Child = Node | string | number | null | undefined | false;

/** 小さな DOM 生成ヘルパー。on〜 属性はイベントリスナーとして登録する。 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (k in el && typeof v !== 'string') {
      (el as unknown as Record<string, unknown>)[k] = v;
    } else {
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Element, children: (Child | Child[])[]): void {
  for (const c of children) {
    if (Array.isArray(c)) append(el, c);
    else if (c === null || c === undefined || c === false) continue;
    else el.append(c instanceof Node ? c : String(c));
  }
}

/** アイコン（線画 SVG）。path の d 属性を受け取る。 */
export function icon(d: string, label?: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', label ? 'false' : 'true');
  if (label) svg.setAttribute('aria-label', label);
  for (const part of d.split('|')) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', part);
    svg.append(p);
  }
  return svg;
}

export const ICONS = {
  back: 'M15 5l-7 7 7 7',
  settings:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z|M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  toc: 'M8 6h13|M8 12h13|M8 18h13|M3 6h.01|M3 12h.01|M3 18h.01',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z|M12 16v-4|M12 8h.01',
  play: 'M7 4.5v15l12-7.5z',
  pause: 'M7 4h3.5v16H7z|M13.5 4H17v16h-3.5z',
  stepBack: 'M15 6l-6 6 6 6',
  stepFwd: 'M9 6l6 6-6 6',
  sentenceBack: 'M18 6l-6 6 6 6|M11 6l-6 6 6 6',
  sentenceFwd: 'M6 6l6 6-6 6|M13 6l6 6-6 6',
  chapterBack: 'M6 5v14|M18 6l-7 6 7 6',
  chapterFwd: 'M18 5v14|M6 6l7 6-7 6',
  minus: 'M5 12h14',
  plus: 'M12 5v14|M5 12h14',
  close: 'M6 6l12 12|M18 6L6 18',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z|M14 3v5h5',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z|M20 20l-4-4',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7|M20 4v7h-7',
  trash: 'M4 7h16|M10 11v6|M14 11v6|M6 7l1 13h10l1-13|M9 7V4h6v3',
};

export function clear(el: Element): void {
  while (el.firstChild) el.firstChild.remove();
}
