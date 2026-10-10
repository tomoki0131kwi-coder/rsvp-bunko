import type { Book, BookSource } from '../types';
import { idbDelete, idbGet, idbSet } from './idb';

export type Theme = 'auto' | 'light' | 'dark' | 'sepia';

export interface Settings {
  cpm: number;
  targetChars: number;
  pauseScale: number;
  fontSize: number;
  showRuby: boolean;
  vertical: boolean;
  showContext: boolean;
  rewindOnResume: boolean;
  theme: Theme;
  mirror: string;
}

export const DEFAULT_SETTINGS: Settings = {
  cpm: 600,
  targetChars: 8,
  pauseScale: 1,
  fontSize: 44,
  showRuby: true,
  vertical: false,
  showContext: true,
  rewindOnResume: false,
  theme: 'auto',
  mirror: '',
};

const SETTINGS_KEY = 'rsvp-bunko:settings';
const RECENT_KEY = 'rsvp-bunko:recent';
const MAX_RECENT = 20;

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* 保存領域が使えない環境では既定値で動かす */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export interface RecentEntry {
  key: string;
  title: string;
  author: string;
  source: BookSource;
  /** 読了位置（0〜1） */
  progress: number;
  /** チャンク番号ではなく本文中の文字位置で保存する（表示単位の設定を変えてもずれないように） */
  charOffset: number;
  updatedAt: number;
}

export function loadRecent(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (raw) return JSON.parse(raw) as RecentEntry[];
  } catch {
    /* ignore */
  }
  return [];
}

export function getRecent(key: string): RecentEntry | undefined {
  return loadRecent().find((r) => r.key === key);
}

export function saveRecent(entry: RecentEntry): void {
  const list = [entry, ...loadRecent().filter((r) => r.key !== entry.key)];
  const dropped = list.splice(MAX_RECENT);
  for (const d of dropped) void idbDelete(bookCacheKey(d.key));
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function removeRecent(key: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(loadRecent().filter((r) => r.key !== key)));
  } catch {
    /* ignore */
  }
  void idbDelete(bookCacheKey(key));
}

const bookCacheKey = (key: string) => `book:${key}`;

/** 読みかけの本は本文ごと保存し、オフラインでも続きを読めるようにする */
export function cacheBook(book: Book): Promise<void> {
  return idbSet(bookCacheKey(book.key), book);
}

export function getCachedBook(key: string): Promise<Book | undefined> {
  return idbGet<Book>(bookCacheKey(key));
}
