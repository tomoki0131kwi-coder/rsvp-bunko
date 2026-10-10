/**
 * アプリとしてのインストール（ホーム画面への追加）。
 *
 * Android の Chrome では、メニューの「ホーム画面に追加」は同じオリジン（tomoki0131kwi-coder.github.io）に
 * 別のアプリがインストールされていると「このアプリはすでにインストールされています」となり、追加できない。
 * 一方、beforeinstallprompt から出すインストール確認は開始 URL（この場合 /rsvp-bunko/）を扱えるアプリが
 * あるかで判定されるので、同じオリジンの別アプリとは衝突しない。そのため画面内にインストールボタンを置く。
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallState = 'unavailable' | 'available' | 'installed';

let deferred: BeforeInstallPromptEvent | null = null;
let justInstalled = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((fn) => fn());

/** できるだけ早く呼ぶ（イベントはページ読み込み後すぐに届くことがある） */
export function initInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    // ブラウザ既定の案内（ミニ情報バー）は出さず、画面内のボタンから出す
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    justInstalled = true;
    emit();
  });
}

/** インストールしたアプリとして（ブラウザのタブではなく単独の画面で）開かれているか */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

export function installState(): InstallState {
  if (justInstalled) return 'installed';
  return deferred ? 'available' : 'unavailable';
}

/** インストール確認を出す。確認は 1 つのイベントにつき 1 回しか出せない */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = deferred;
  if (!e) return 'unavailable';
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  emit();
  return outcome;
}

export function onInstallChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
