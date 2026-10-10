import type { CardNotesFile } from './cardNotes';

/** デプロイ時に scripts/card-notes.ts が作り、アプリと一緒に配信する図書カードの解説 */
export const CARD_NOTES_URL = './card-notes.json';

let loading: Promise<CardNotesFile | null> | null = null;

/** 解説データを読み込む（作品情報を開いたときに初めて読む）。無ければ null */
export function loadCardNotes(): Promise<CardNotesFile | null> {
  loading ??= fetch(CARD_NOTES_URL, { cache: 'no-cache' })
    .then((res) => (res.ok ? (res.json() as Promise<CardNotesFile>) : null))
    .catch(() => null)
    .then((data) => {
      if (!data) loading = null; // 次に開いたときに取り直す
      return data;
    });
  return loading;
}
