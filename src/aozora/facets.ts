import type { CatalogPerson, CatalogWork } from '../types';
import { normalizeForSearch } from '../util/kana';

/**
 * 作品を探すための「括り」（ファセット）。
 *
 * ジャンルは図書目録 CSV の「分類番号」（日本十進分類法 NDC。例: "NDC 913"、児童書は "NDC K913"）による。
 * 分類名は NDC 新訂10版の第1次区分（類）・第2次区分（綱）・文学（9類）の形式区分の名称にもとづき、
 * 分かりやすさのために一部「・宗教」などの補足を付けている。
 */

export interface FacetOption {
  value: string;
  label: string;
}

export interface Facet {
  key: FacetKey;
  label: string;
  options: FacetOption[];
  /** 作品が持つ値（複数の分類番号を持つ作品は複数の値を持つ） */
  valuesOf: (w: CatalogWork) => string[];
}

export type FacetKey = 'field' | 'form' | 'audience' | 'length' | 'kana' | 'era' | 'initial';

// ---- ジャンル（NDC） ----

const FIELD_OPTIONS: FacetOption[] = [
  { value: '91', label: '日本文学' },
  { value: '92', label: '中国文学・東洋文学' },
  { value: '93', label: '英米文学' },
  { value: '94', label: 'ドイツ文学' },
  { value: '95', label: 'フランス文学' },
  { value: '96', label: 'スペイン・ポルトガル文学' },
  { value: '97', label: 'イタリア文学' },
  { value: '98', label: 'ロシア・ソビエト文学' },
  { value: '99', label: 'その他の言語の文学' },
  { value: '90', label: '文学（総記）' },
  { value: '0', label: '総記' },
  { value: '1', label: '哲学・宗教' },
  { value: '2', label: '歴史・地理' },
  { value: '3', label: '社会科学' },
  { value: '4', label: '自然科学' },
  { value: '5', label: '技術・工学' },
  { value: '6', label: '産業' },
  { value: '7', label: '芸術・スポーツ' },
  { value: '8', label: '言語' },
  { value: 'none', label: '分類なし' },
];

/** 文学（91〜98）の第3桁は形式区分。919 は日本文学のみ「漢詩文」 */
const FORM_OPTIONS: FacetOption[] = [
  { value: '3', label: '小説・物語' },
  { value: '1', label: '詩歌' },
  { value: '2', label: '戯曲' },
  { value: '4', label: '評論・エッセイ・随筆' },
  { value: '5', label: '日記・書簡・紀行' },
  { value: '6', label: '記録・手記・ルポルタージュ' },
  { value: '7', label: '箴言・アフォリズム' },
  { value: '8', label: '作品集' },
  { value: 'kanshi', label: '漢詩文' },
  { value: 'none', label: 'その他・分類なし' },
];

/** 分類番号の文字列から NDC の番号を取り出す（例: "NDC K913 914" → ["K913", "914"]） */
export function ndcCodes(ndc: string): string[] {
  return ndc.match(/K?\d{3}/g) ?? [];
}

function fieldOf(code: string): string {
  const c = code.replace(/^K/, '');
  return c[0] === '9' ? c.slice(0, 2) : c[0];
}

function formOf(code: string): string {
  const c = code.replace(/^K/, '');
  if (c[0] !== '9') return 'none';
  if (c === '919') return 'kanshi';
  const lang = c[1];
  const form = c[2];
  return lang >= '1' && lang <= '8' && form >= '1' && form <= '8' ? form : 'none';
}

const uniq = (xs: string[]) => [...new Set(xs)];

// ---- 長さ ----

/**
 * 本文ファイルのバイト数から本文のおおよその文字数を見積もる。
 * 実際の青空文庫テキスト（Shift_JIS）で、冒頭・末尾の定型部分を除いた本文の文字数はバイト数のおよそ 0.42〜0.48 倍だった。
 */
export function estimateChars(textSize: number | undefined): number | undefined {
  if (!textSize) return undefined;
  return Math.max(100, Math.round((textSize - 1500) * 0.45));
}

const LENGTH_BUCKETS: { value: string; max: number; label: string }[] = [
  { value: 's1', max: 3000, label: '〜3千字' },
  { value: 's2', max: 10000, label: '3千〜1万字' },
  { value: 's3', max: 30000, label: '1万〜3万字' },
  { value: 's4', max: 100000, label: '3万〜10万字' },
  { value: 's5', max: Infinity, label: '10万字以上' },
];

function lengthOf(w: CatalogWork): string {
  const chars = estimateChars(w.textSize);
  if (chars === undefined) return 'unknown';
  return LENGTH_BUCKETS.find((b) => chars <= b.max)!.value;
}

// ---- 作家の生まれた時代 ----

/** 作品の代表の人物（著者がいれば著者、いなければ先頭の人物） */
export function mainPerson(w: CatalogWork): CatalogPerson | undefined {
  return w.people.find((p) => p.role === '著者') ?? w.people[0];
}

/** "1867-02-09" → "1867-02-09"、"1867" → "1867-01-01"。読めなければ undefined */
export function normalizeDate(s: string | undefined): string | undefined {
  const m = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?/.exec(s ?? '');
  if (!m) return undefined;
  return `${m[1]}-${(m[2] ?? '1').padStart(2, '0')}-${(m[3] ?? '1').padStart(2, '0')}`;
}

/**
 * 改元日（グレゴリオ暦）。明治は改元の詔により慶応4年1月1日（1868-01-25）に遡って適用されたので、その日を境にする。
 */
const ERAS: { value: string; from: string; label: string }[] = [
  { value: 'showa', from: '1926-12-25', label: '昭和以降' },
  { value: 'taisho', from: '1912-07-30', label: '大正' },
  { value: 'meiji', from: '1868-01-25', label: '明治' },
  { value: 'edo', from: '0000-01-01', label: '江戸時代以前' },
];

export function eraOfDate(born: string | undefined): string {
  const d = normalizeDate(born);
  if (!d) return 'unknown';
  return ERAS.find((e) => d >= e.from)!.value;
}

// ---- 作品名の頭文字 ----

const ROWS: [string, string][] = [
  ['あ', 'あいうえおぁぃぅぇぉゔ'],
  ['か', 'かきくけこがぎぐげごゕゖ'],
  ['さ', 'さしすせそざじずぜぞ'],
  ['た', 'たちつてとだぢづでどっ'],
  ['な', 'なにぬねの'],
  ['は', 'はひふへほばびぶべぼぱぴぷぺぽ'],
  ['ま', 'まみむめも'],
  ['や', 'やゆよゃゅょ'],
  ['ら', 'らりるれろ'],
  ['わ', 'わゐゑをんゎ'],
];

/** 読みの先頭の文字が属する五十音の行（あ・か・さ…）。かな以外は 'other' */
export function kanaRow(yomi: string): string {
  const c = normalizeForSearch(yomi).charAt(0);
  return ROWS.find(([, chars]) => chars.includes(c))?.[0] ?? 'other';
}

const INITIAL_OPTIONS: FacetOption[] = [
  ...ROWS.map(([row]) => ({ value: row, label: `${row}行` })),
  { value: 'other', label: '英数字・その他' },
];

// ---- 文字遣い ----

const KANA_OPTIONS: FacetOption[] = ['新字新仮名', '新字旧仮名', '旧字新仮名', '旧字旧仮名', 'その他'].map((v) => ({
  value: v,
  label: v,
}));

export const FACETS: Facet[] = [
  {
    key: 'field',
    label: 'ジャンル',
    options: FIELD_OPTIONS,
    valuesOf: (w) => {
      const codes = ndcCodes(w.ndc);
      return codes.length ? uniq(codes.map(fieldOf)) : ['none'];
    },
  },
  {
    key: 'form',
    label: '形式',
    options: FORM_OPTIONS,
    valuesOf: (w) => {
      const forms = uniq(ndcCodes(w.ndc).map(formOf));
      const real = forms.filter((f) => f !== 'none');
      return real.length ? real : ['none'];
    },
  },
  {
    key: 'audience',
    label: '対象',
    options: [
      { value: 'kids', label: '児童書' },
      { value: 'general', label: '一般' },
    ],
    valuesOf: (w) => (ndcCodes(w.ndc).some((c) => c.startsWith('K')) ? ['kids'] : ['general']),
  },
  {
    key: 'length',
    label: '長さ',
    options: [...LENGTH_BUCKETS.map(({ value, label }) => ({ value, label })), { value: 'unknown', label: '不明' }],
    valuesOf: (w) => [lengthOf(w)],
  },
  {
    key: 'era',
    label: '作家の生まれた時代',
    options: [...[...ERAS].reverse().map(({ value, label }) => ({ value, label })), { value: 'unknown', label: '生年不明' }],
    valuesOf: (w) => [eraOfDate(mainPerson(w)?.born)],
  },
  {
    key: 'kana',
    label: '文字遣い',
    options: KANA_OPTIONS,
    valuesOf: (w) => [KANA_OPTIONS.some((o) => o.value === w.kana) ? w.kana : 'その他'],
  },
  {
    key: 'initial',
    label: '作品名の頭文字',
    options: INITIAL_OPTIONS,
    valuesOf: (w) => [kanaRow(w.titleYomi || w.title)],
  },
];

export const FACET_BY_KEY = Object.fromEntries(FACETS.map((f) => [f.key, f])) as Record<FacetKey, Facet>;

export function optionLabel(key: FacetKey, value: string): string {
  return FACET_BY_KEY[key].options.find((o) => o.value === value)?.label ?? value;
}

/** 作品一覧に添える短いジャンル表記（例: 「日本文学・小説・物語」「児童書」） */
export function genreLabel(w: CatalogWork): string {
  const codes = ndcCodes(w.ndc);
  if (!codes.length) return '';
  const c = codes[0];
  const field = optionLabel('field', fieldOf(c));
  const form = formOf(c);
  const parts = [field];
  if (form !== 'none') parts.push(optionLabel('form', form));
  if (c.startsWith('K')) parts.push('児童書');
  return parts.join('・');
}
