import { describe, expect, it } from 'vitest';
import { browseHash, defaultFilter, filterFromParams, filterToParams } from '../src/aozora/browseQuery';
import { Catalog } from '../src/aozora/catalog';
import type { CatalogWork } from '../src/types';

let nextId = 1;
const work = (title: string, yomi: string, ndc: string, patch: Partial<CatalogWork> = {}): CatalogWork => ({
  id: nextId++,
  title,
  titleYomi: yomi,
  subtitle: '',
  kana: '新字新仮名',
  people: [{ id: 148, name: '夏目 漱石', yomi: 'なつめ そうせき', role: '著者', born: '1867-02-09' }],
  cardUrl: '',
  htmlUrl: '',
  textUrl: '',
  ndc,
  mirrorPath: 'x',
  textSize: 20000,
  copyrighted: false,
  published: '2000-01-01',
  ...patch,
});

const miyazawa = { id: 81, name: '宮沢 賢治', yomi: 'みやざわ けんじ', role: '著者', born: '1896-08-27' };
const works = [
  work('こころ', 'こころ', 'NDC 913', { textSize: 374152, published: '1999-07-31' }),
  work('夢十夜', 'ゆめじゅうや', 'NDC 913', { textSize: 30000 }),
  work('草枕', 'くさまくら', 'NDC 913', { mirrorPath: undefined }),
  work('銀河鉄道の夜', 'ぎんがてつどうのよる', 'NDC K913', { people: [miyazawa], published: '2005-01-01' }),
  work('春と修羅', 'はるとしゅら', 'NDC 911', { people: [miyazawa], textSize: 3000 }),
  work('現代日本の開化', 'げんだいにっぽんのかいか', 'NDC 914'),
];
const catalog = new Catalog();
catalog.setWorks(works);
const titles = (r: { works: CatalogWork[] }) => r.works.map((w) => w.title);

describe('Catalog.browse', () => {
  it('既定では本文のある作品を作品名順に並べる', () => {
    expect(titles(catalog.browse(defaultFilter()))).toEqual(['銀河鉄道の夜', '現代日本の開化', 'こころ', '春と修羅', '夢十夜']);
  });

  it('括りを組み合わせて絞り込む', () => {
    expect(titles(catalog.browse({ ...defaultFilter(), facets: { field: '91', form: '3' } }))).toEqual(['銀河鉄道の夜', 'こころ', '夢十夜']);
    expect(titles(catalog.browse({ ...defaultFilter(), facets: { form: '3', audience: 'kids' } }))).toEqual(['銀河鉄道の夜']);
    expect(titles(catalog.browse({ ...defaultFilter(), person: 81 }))).toEqual(['銀河鉄道の夜', '春と修羅']);
    expect(titles(catalog.browse({ ...defaultFilter(), textOnly: false, facets: { form: '3' }, person: 148 }))).toEqual(['草枕', 'こころ', '夢十夜']);
  });

  it('各括りの件数は、その括り以外の条件を満たす作品で数える', () => {
    const { counts } = catalog.browse({ ...defaultFilter(), facets: { form: '3' } });
    // 形式の件数は形式の条件を外して数える
    expect(counts.form.get('3')).toBe(3);
    expect(counts.form.get('1')).toBe(1);
    expect(counts.form.get('4')).toBe(1);
    // ほかの括りの件数は形式=小説の中で数える
    expect(counts.audience.get('kids')).toBe(1);
    expect(counts.audience.get('general')).toBe(2);
    expect(counts.era.get('edo')).toBe(2);
    expect(counts.era.get('meiji')).toBe(1);
  });

  it('長さ・公開日で並べ替える', () => {
    expect(titles(catalog.browse({ ...defaultFilter(), sort: 'short' }))[0]).toBe('春と修羅');
    expect(titles(catalog.browse({ ...defaultFilter(), sort: 'long' }))[0]).toBe('こころ');
    expect(titles(catalog.browse({ ...defaultFilter(), sort: 'new' }))[0]).toBe('銀河鉄道の夜');
  });

  it('キーワードと括りを組み合わせる', () => {
    expect(titles(catalog.browse({ ...defaultFilter(), q: 'みやざわ', facets: { form: '1' } }))).toEqual(['春と修羅']);
  });
});

describe('Catalog.authors', () => {
  it('人物ごとに作品数を数え、読み順に並べる', () => {
    const authors = catalog.authors();
    expect(authors.map((a) => a.name)).toEqual(['夏目 漱石', '宮沢 賢治']);
    expect(authors[0]).toMatchObject({ authored: 4, withText: 3, row: 'な' });
    expect(authors[1]).toMatchObject({ authored: 2, row: 'ま' });
  });
});

describe('絞り込み条件と URL', () => {
  it('URL のクエリとの間で相互に変換できる', () => {
    const f = { ...defaultFilter(), q: '夏目', person: 148, textOnly: false, sort: 'long' as const, facets: { field: '91', form: '3' } };
    expect(filterFromParams(filterToParams(f))).toEqual(f);
  });

  it('知らない値は無視する', () => {
    const f = filterFromParams(new URLSearchParams('field=999&sort=bogus&person=abc'));
    expect(f).toEqual(defaultFilter());
  });

  it('ホームの入口から使う URL', () => {
    expect(browseHash({ facets: { form: '1' } })).toBe('#/browse?form=1');
    expect(browseHash({ person: 81 })).toBe('#/browse?person=81');
    expect(browseHash()).toBe('#/browse');
  });
});
