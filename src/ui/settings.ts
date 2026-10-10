import { DEFAULT_TEXT_MIRROR } from '../aozora/mirror';
import { DEFAULT_SETTINGS, type Settings, type Theme } from '../util/storage';
import { ICONS, h, icon } from './dom';

export const CPM_MIN = 200;
export const CPM_MAX = 2000;
export const CPM_STEP = 50;

const CHUNK_OPTIONS: [number, string][] = [
  [1, '1 文節ずつ'],
  [6, '6 文字まで'],
  [8, '8 文字まで（標準）'],
  [10, '10 文字まで'],
  [13, '13 文字まで'],
  [16, '16 文字まで'],
];

const THEMES: [Theme, string][] = [
  ['auto', '端末の設定に合わせる'],
  ['light', 'ライト'],
  ['sepia', 'セピア'],
  ['dark', 'ダーク'],
];

/** 設定ダイアログ。変更のたびに onChange を呼ぶ。 */
export function openSettingsDialog(current: Settings, onChange: (s: Settings) => void): void {
  let s = { ...current };
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    s = { ...s, [k]: v };
    onChange(s);
  };

  const cpmOut = h('output', {}, `${s.cpm} 字/分`);
  const pauseOut = h('output', {}, pauseLabel(s.pauseScale));
  const fontOut = h('output', {}, `${s.fontSize}px`);

  const range = (min: number, max: number, step: number, value: number, oninput: (v: number) => void) =>
    h('input', {
      type: 'range',
      min,
      max,
      step,
      value,
      oninput: (e: Event) => oninput(Number((e.target as HTMLInputElement).value)),
    });
  const check = (label: string, value: boolean, onchange: (v: boolean) => void, hint?: string) =>
    h(
      'label',
      { class: 'check' },
      h('input', { type: 'checkbox', checked: value, onchange: (e: Event) => onchange((e.target as HTMLInputElement).checked) }),
      h('span', {}, label, hint ? h('small', { class: 'muted' }, hint) : null),
    );
  const select = <T extends string | number>(options: [T, string][], value: T, onchange: (v: T) => void) =>
    h(
      'select',
      {
        onchange: (e: Event) => {
          const raw = (e.target as HTMLSelectElement).value;
          const found = options.find(([v]) => String(v) === raw);
          if (found) onchange(found[0]);
        },
      },
      options.map(([v, label]) => h('option', { value: String(v), selected: v === value }, label)),
    );

  const mirrorInput = h('input', {
    type: 'url',
    class: 'text-input',
    placeholder: DEFAULT_TEXT_MIRROR,
    value: s.mirror,
    onchange: (e: Event) => set('mirror', (e.target as HTMLInputElement).value.trim()),
  });

  const dialog = h(
    'dialog',
    { class: 'sheet', 'aria-label': '設定' },
    h(
      'div',
      { class: 'sheet-head' },
      h('h2', {}, '設定'),
      h('button', { class: 'icon-button', type: 'button', 'aria-label': '閉じる', onclick: () => dialog.close() }, icon(ICONS.close)),
    ),
    h(
      'div',
      { class: 'sheet-body' },
      h(
        'div',
        { class: 'field' },
        h('div', { class: 'field-label' }, '速さ', cpmOut),
        range(CPM_MIN, CPM_MAX, CPM_STEP, s.cpm, (v) => {
          cpmOut.textContent = `${v} 字/分`;
          set('cpm', v);
        }),
        h('small', { class: 'muted' }, '1 分あたりの文字数。慣れないうちは 400〜600 字/分から始めるのがおすすめです。'),
      ),
      h(
        'div',
        { class: 'field' },
        h('div', { class: 'field-label' }, '一度に表示する量'),
        select(CHUNK_OPTIONS, s.targetChars, (v) => set('targetChars', v)),
        h('small', { class: 'muted' }, '文節（意味のまとまり）を、指定した文字数に収まる範囲でまとめて表示します。'),
      ),
      h(
        'div',
        { class: 'field' },
        h('div', { class: 'field-label' }, '句読点・段落での間', pauseOut),
        range(0, 2, 0.25, s.pauseScale, (v) => {
          pauseOut.textContent = pauseLabel(v);
          set('pauseScale', v);
        }),
      ),
      h(
        'div',
        { class: 'field' },
        h('div', { class: 'field-label' }, '文字の大きさ', fontOut),
        range(24, 96, 2, s.fontSize, (v) => {
          fontOut.textContent = `${v}px`;
          set('fontSize', v);
        }),
      ),
      h(
        'div',
        { class: 'field' },
        h('div', { class: 'field-label' }, 'テーマ'),
        select(THEMES, s.theme, (v) => set('theme', v)),
      ),
      h(
        'div',
        { class: 'field checks' },
        check('ルビ（ふりがな）を表示', s.showRuby, (v) => set('showRuby', v)),
        check('縦書きで表示', s.vertical, (v) => set('vertical', v)),
        check('一時停止中に前後の文章を表示', s.showContext, (v) => set('showContext', v)),
        check('再開するときに文の頭へ戻る', s.rewindOnResume, (v) => set('rewindOnResume', v), '途中で止めたときに文脈をつかみ直せます'),
      ),
      h(
        'details',
        { class: 'field' },
        h('summary', {}, '詳細設定'),
        h('div', { class: 'field-label' }, '本文の取得元（ミラー）'),
        mirrorInput,
        h(
          'small',
          { class: 'muted' },
          'aozorahack/aozorabunko_text と同じ構成（cards/人物ID/files/ZIP名/ZIP名.txt）で、CORS を許可している URL を指定します。空欄なら aozorabunko_text（GitHub）を使います。',
        ),
        h(
          'button',
          {
            class: 'button subtle',
            type: 'button',
            onclick: () => {
              onChange({ ...DEFAULT_SETTINGS });
              dialog.close();
            },
          },
          'すべての設定を初期値に戻す',
        ),
      ),
    ),
  );
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();
}

function pauseLabel(v: number): string {
  if (v === 0) return 'なし';
  if (v < 1) return '短め';
  if (v === 1) return '標準';
  return '長め';
}
