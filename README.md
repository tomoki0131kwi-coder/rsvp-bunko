# RSVP文庫

青空文庫の作品を **RSVP（Rapid Serial Visual Presentation／高速逐次提示）** で読む Web アプリです。
文章を文節ごとに画面の中央へ次々と表示するので、視線を動かさずに読めます。

サーバーは不要で、ビルドすると静的ファイルだけになります（GitHub Pages などにそのまま置けます）。

## できること

- **作品検索**: 青空文庫の図書目録（公開中の全作品）を作品名・読み・作家名で検索。ひらがな・カタカナどちらでも引けます
- **RSVP 表示**
  - 文節区切りには Google の [BudouX](https://github.com/google/budoux) を使用。指定した文字数（既定 8 文字）まで文節をまとめて表示
  - ルビ（ふりがな）表示、傍点、外字画像に対応
  - 句読点・段落末・見出し・場面転換で自動的に間を置く（強さは調整可）
  - 横書き／縦書きの切り替え
- **操作**: 再生・一時停止、1 つ戻る／進む、前後の文頭へ、前後の見出しへ、シークバー、目次
- **一時停止中は前後の文章を表示**。文節をクリックするとそこへ移動
- **読書位置の保存**: 「続きを読む」から再開。本文も端末（IndexedDB）に保存するので、一度開いた作品はオフラインでも読めます
- **ファイル・URL から開く**: 青空文庫の ZIP／ルビ付きテキスト／XHTML ファイルや、図書カードの URL
- ライト／セピア／ダークテーマ、スマートフォン対応、再生中のスリープ防止（Screen Wake Lock 対応ブラウザ）

### キーボード操作

| キー | 動作 |
| --- | --- |
| `Space` / `K` | 再生・一時停止 |
| `←` `→`（縦書きでは逆）／ `J` `L` | 1 つ戻る／進む |
| `Shift` + `←` `→` | 前の文頭／次の文頭 |
| `↑` `↓` | 速くする／遅くする（50 字/分刻み） |
| `[` `]` ／ `PageUp` `PageDown` | 前の見出し／次の見出し |
| `Home` | 先頭へ |
| `Esc` | 一時停止（停止中ならホームへ） |

## 開発

```bash
npm install
npm run dev       # 開発サーバー
npm test          # 単体テスト（Vitest）
npm run build     # dist/ に静的ファイルを出力
npm run preview   # ビルド結果の確認
```

### GitHub Pages への公開

`.github/workflows/deploy.yml` が `main` ブランチへの push でテスト・ビルドし、GitHub Pages に公開します。
初回はリポジトリの **Settings → Pages → Build and deployment → Source** を「GitHub Actions」にしてください。
出力は相対パス（`base: './'`）なので、`https://<ユーザー名>.github.io/rsvp-bunko/` のようなサブパスでも動きます。

## 仕組み

### 作品データの取得元

青空文庫のサイト（`www.aozora.gr.jp`）は CORS ヘッダーを返さないため、ブラウザから直接ファイルを取得できません。
そこで、青空文庫が GitHub で公開しているリポジトリ [aozorabunko/aozorabunko](https://github.com/aozorabunko/aozorabunko) を
`raw.githubusercontent.com` 経由で取得しています（同ホストは `Access-Control-Allow-Origin: *` を返します）。

- 図書目録: `index_pages/list_person_all_extended_utf8.zip`（「公開中　作家別作品一覧拡充版：全て」CSV）。初回に取得して IndexedDB に保存し、7 日ごとに更新
- 本文: 目録の「XHTML/HTMLファイルURL」を優先し、取れなければ「テキストファイルURL」（ZIP）を使用

取得元は設定画面の「詳細設定」で、同じディレクトリ構成のミラーに変更できます。

### 本文の解析（`src/aozora/`）

- `decode.ts` — 文字コード判定（XML 宣言・meta の charset、無ければ UTF-8 として読めるかで判定）。青空文庫のファイルは主に Shift_JIS
- `parseHtml.ts` — XHTML 版。`div.main_text` 内の `<br />` を行区切りとし、ルビ（`ruby`/`rb`/`rt`）、見出し（`o-midashi`/`naka-midashi`/`ko-midashi`）、注記（`span.notes`、除去）、外字（`img.gaiji`）、傍点（`em.sesame_dot`）を扱う
- `parseText.ts` — ルビ付きテキスト版。`《》` のルビ、`｜` によるルビ範囲指定、`［＃…］` の注記、`※［＃…］` の外字、見出し注記、`［＃改ページ］`、冒頭の記号説明ブロック、末尾の「底本：」以降の書誌情報を扱う

### 表示単位と表示時間（`src/rsvp/`）

- `chunker.ts` — BudouX で文節境界を求め、ルビ・外字の内側では区切らないよう調整。句読点や閉じ括弧だけの断片は前に、開き括弧は後ろにくっつけ、文をまたがない範囲で目安の文字数まで文節をまとめる
- `timing.ts` — 表示時間 = 1 文字あたりの時間（60000 ÷ 字/分）×（句読点・括弧を除いた文字数、最低 2 文字）＋ 区切りに応じた間（読点 1.5 字分、句点 3 字分、段落末 2.5 字分、見出し 4 字分、場面転換 6 字分）× 間の強さ
- `player.ts` — 上記の時間で表示を送る再生器。再生開始直後の 3 つは少しゆっくり表示（1.6 倍・1.35 倍・1.15 倍）

読書位置はチャンク番号ではなく本文中の文字位置で保存するので、表示単位の設定を変えても位置がずれません。

## 参照した資料

- 青空文庫「[収録ファイルの取り扱い規準](https://www.aozora.gr.jp/guide/kijyunn.html)」— 作品ファイルの利用条件。本アプリは作品を再配布せず、利用者のブラウザが都度取得して表示します。作品情報画面には各ファイル末尾の底本・入力者・校正者の情報をそのまま表示します
- 青空文庫「[注記一覧](https://www.aozora.gr.jp/annotation/)」「[テキスト入力ルール](https://www.aozora.gr.jp/aozora-manual/index-input.html)」— テキスト版の書式
- [aozorabunko/aozorabunko](https://github.com/aozorabunko/aozorabunko) — 青空文庫の GitHub 公開リポジトリ
- [BudouX](https://github.com/google/budoux)（Apache License 2.0）、[fflate](https://github.com/101arrowz/fflate)（MIT License）— 同梱ライブラリ。ライセンス文は `public/THIRD_PARTY_LICENSES.txt`

## 既知の制約

- 挿絵は表示しません。外字は Unicode で表せるもの（注記に `U+XXXX` があるもの）は文字に、それ以外は青空文庫の外字画像で表示し、画像が取れなければ「〓」になります
- 漢文の返り点は省略します。字下げ・字詰め・割り注などのレイアウト注記は反映しません
- 作品データの取得は GitHub の公開リポジトリの可用性に依存します。取得できない場合は、青空文庫からダウンロードしたファイルを「ファイルを開く」で読み込んでください
