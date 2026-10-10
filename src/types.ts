/** 本文中の連続した文字列。ルビや外字画像を持つことがある。 */
export interface Run {
  text: string;
  /** ルビ（ふりがな）。text 全体に掛かる。 */
  ruby?: string;
  /** 外字画像の URL。表示時に text の代わりに画像を出す。 */
  gaijiSrc?: string;
  /** 外字の説明（青空文庫の注記）。 */
  gaijiAlt?: string;
  /** 傍点などの強調 */
  em?: boolean;
}

export type BlockType = 'heading' | 'para' | 'break';

/** 本文を構成する一行（段落）または見出し。 */
export interface Block {
  type: BlockType;
  /** 見出しの階層（1=大見出し, 2=中見出し, 3=小見出し） */
  level?: number;
  runs: Run[];
}

export interface BookSource {
  kind: 'catalog' | 'url' | 'file';
  workId?: number;
  url?: string;
  fileName?: string;
}

export interface Book {
  /** 進捗の保存などに使う一意キー */
  key: string;
  title: string;
  subtitle?: string;
  author: string;
  blocks: Block[];
  /** 底本・入力者などの書誌情報（青空文庫ファイル末尾） */
  bibliography?: string;
  source: BookSource;
}

/** 図書目録の 1 作品 */
export interface CatalogPerson {
  id: number;
  name: string;
  yomi: string;
  role: string;
}

export interface CatalogWork {
  id: number;
  title: string;
  titleYomi: string;
  subtitle: string;
  /** 文字遣い種別（新字新仮名 など） */
  kana: string;
  people: CatalogPerson[];
  htmlUrl: string;
  textUrl: string;
  /** 作品著作権フラグが「あり」 */
  copyrighted: boolean;
  published: string;
}
