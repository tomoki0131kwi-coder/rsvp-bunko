/** 検索用の正規化: 全角半角の統一（NFKC）、カタカナ→ひらがな、空白除去、小文字化 */
export function normalizeForSearch(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s　・･]/g, '')
    .toLowerCase();
}
