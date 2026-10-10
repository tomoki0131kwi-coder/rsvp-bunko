/// <reference lib="webworker" />
import { unzipSync } from 'fflate';
import { parseCatalogCsv } from './catalogParse';

/** 図書目録 ZIP（数 MB）の取得・展開・CSV 解析は重いので Worker で行う */
self.onmessage = async (e: MessageEvent<{ url: string }>) => {
  try {
    const res = await fetch(e.data.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const name = Object.keys(files).find((n) => /\.csv$/i.test(n));
    if (!name) throw new Error('ZIP に CSV が含まれていません');
    const works = parseCatalogCsv(new TextDecoder('utf-8').decode(files[name]));
    self.postMessage({ ok: true, works });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
