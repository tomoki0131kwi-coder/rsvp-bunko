import { estimateChars, genreLabel } from '../aozora/facets';
import type { CatalogWork } from '../types';
import { h } from './dom';

export interface WorkListContext {
  openWork: (id: number) => void;
  openPerson: (id: number) => void;
  /** 読了時間の目安に使う速さ（字/分） */
  cpm: number;
}

/** 文字数の目安を「約1.2万字」のように表す */
export function formatChars(chars: number): string {
  if (chars >= 9500) return `約${(chars / 10000).toFixed(chars >= 99500 ? 0 : 1)}万字`;
  if (chars >= 950) return `約${Math.round(chars / 1000)}千字`;
  return `約${Math.max(100, Math.round(chars / 100) * 100)}字`;
}

/** 読了時間の目安（例: 約5分、約1時間20分） */
export function formatReadingTime(chars: number, cpm: number): string {
  const min = Math.round(chars / cpm);
  if (min < 1) return '1分未満';
  if (min < 60) return `約${min}分`;
  return `約${Math.floor(min / 60)}時間${min % 60 ? `${min % 60}分` : ''}`;
}

/**
 * 作品 1 件のカード。カード全体（作品名）で作品を開き、作家名のボタンでその作家の作品一覧へ移る。
 * ボタンを入れ子にできないので、作品名ボタンの ::after をカード全体に広げている。
 */
export function workItem(w: CatalogWork, ctx: WorkListContext): HTMLLIElement {
  const chars = estimateChars(w.textSize);
  const genre = genreLabel(w);
  const people = w.people.map((p, i) => [
    i > 0 ? '、' : null,
    h(
      'button',
      { class: 'person-link', type: 'button', title: `${p.name} の作品一覧`, onclick: () => ctx.openPerson(p.id) },
      p.name,
      p.role && p.role !== '著者' ? `（${p.role}）` : null,
    ),
  ]);
  return h(
    'li',
    { class: 'work' },
    h(
      'button',
      { class: 'work-open', type: 'button', onclick: () => ctx.openWork(w.id) },
      h('span', { class: 'work-title' }, w.title, w.subtitle ? h('small', {}, '　', w.subtitle) : null),
    ),
    h('span', { class: 'work-meta' }, people),
    h(
      'span',
      { class: 'work-tags' },
      genre ? h('span', { class: 'badge' }, genre) : null,
      chars
        ? h(
            'span',
            { class: 'badge', title: `本文の大きさからの見積もり。${ctx.cpm} 字/分で読んだときの目安` },
            `${formatChars(chars)}・${formatReadingTime(chars, ctx.cpm)}`,
          )
        : null,
      w.kana ? h('span', { class: 'badge' }, w.kana) : null,
      w.copyrighted ? h('span', { class: 'badge badge-warn', title: '著作権存続中（青空文庫が許諾を得て公開）' }, '著作権あり') : null,
      w.mirrorPath
        ? null
        : h('span', { class: 'badge badge-warn', title: '本文ミラーに未収録。ファイルを開いて読むことはできます' }, '本文ミラー未収録'),
    ),
  );
}
