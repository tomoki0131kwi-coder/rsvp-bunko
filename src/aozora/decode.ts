/**
 * 青空文庫のファイルは多くが Shift_JIS（実質 Windows-31J）。新しいものには UTF-8 もある。
 * 先頭付近の charset 宣言と BOM を見て、適切な TextDecoder で文字列に戻す。
 */
export function sniffCharset(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  const head = new TextDecoder('ascii').decode(bytes.subarray(0, 2048));
  const m = /(?:encoding|charset)\s*=\s*["']?([\w-]+)/i.exec(head);
  if (m) {
    const name = m[1].toLowerCase();
    if (name === 'utf-8' || name === 'utf8') return 'utf-8';
    if (name.includes('jis') || name.includes('sjis') || name === 'windows-31j' || name === 'cp932') {
      return 'shift_jis';
    }
    if (name === 'euc-jp') return 'euc-jp';
  }
  // 宣言がない（青空文庫形式のテキストなど）ときは UTF-8 として厳密に読めるか試す
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return 'utf-8';
  } catch {
    return 'shift_jis';
  }
}

export function decodeBytes(bytes: Uint8Array, charset = sniffCharset(bytes)): string {
  return new TextDecoder(charset).decode(bytes).replace(/^﻿/, '');
}
