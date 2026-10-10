import { describe, expect, it } from 'vitest';
import { indexMirrorPaths, pickMirrorPath, zipUrlToMirrorPath } from '../src/aozora/mirror';

describe('zipUrlToMirrorPath', () => {
  it('ZIP の URL をミラー上のテキストのパスにする', () => {
    expect(zipUrlToMirrorPath('https://www.aozora.gr.jp/cards/000148/files/773_ruby_5968.zip')).toBe(
      'cards/000148/files/773_ruby_5968/773_ruby_5968.txt',
    );
    expect(zipUrlToMirrorPath('https://www.aozora.gr.jp/cards/000148/files/773_14560.html')).toBeUndefined();
  });
});

describe('pickMirrorPath', () => {
  // aozorabunko_text の実際のファイル一覧から抜粋（旧版の 946_ruby と新版の 946_ruby_4400 が併存する例を含む）
  const index = indexMirrorPaths([
    'cards/000148/files/773_ruby_5968/773_ruby_5968.txt',
    'cards/000182/files/946_ruby/946_ruby.txt',
    'cards/000182/files/946_ruby_4400/946_ruby_4400.txt',
    'cards/000096/files/914_txt/914_txt.txt',
    'cards/000025/files/kantou_syogo/kantou_syogo.txt',
    'README.md',
  ]);

  it('ファイル名先頭の作品 ID でまとめ、ID の無いファイルは無視する', () => {
    expect([...index.keys()].sort((a, b) => a - b)).toEqual([773, 914, 946]);
  });

  it('図書目録の ZIP と同じ版を選ぶ', () => {
    expect(pickMirrorPath(index.get(946), 'https://www.aozora.gr.jp/cards/000182/files/946_ruby.zip')).toBe(
      'cards/000182/files/946_ruby/946_ruby.txt',
    );
  });

  it('同じ版が無ければ版番号の大きいものを選ぶ', () => {
    expect(pickMirrorPath(index.get(946), 'https://www.aozora.gr.jp/cards/000182/files/946_ruby_99999.zip')).toBe(
      'cards/000182/files/946_ruby_4400/946_ruby_4400.txt',
    );
    expect(pickMirrorPath(index.get(1), '')).toBeUndefined();
  });
});
