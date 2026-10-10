import { chunkBlocks, chunkIndexAtOffset, type Chunk } from '../rsvp/chunker';
import { RsvpPlayer } from '../rsvp/player';
import { formatDuration } from '../rsvp/timing';
import type { CardNote, NoteLink } from '../aozora/cardNotes';
import { loadCardNotes } from '../aozora/notes';
import type { Book, CatalogWork, Run } from '../types';
import { getRecent, saveRecent, type Settings } from '../util/storage';
import { ICONS, clear, h, icon } from './dom';
import { CPM_MAX, CPM_MIN, CPM_STEP } from './settings';

export interface ReaderContext {
  settings: () => Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  openSettings: () => void;
  goHome: () => void;
  /** 図書目録の作品（作品情報で作家の解説を出すのに使う） */
  getWork?: (id: number) => Promise<CatalogWork | undefined>;
}

export interface ReaderHandle {
  applySettings: (prev: Settings, next: Settings) => void;
  destroy: () => void;
}

interface HeadingEntry {
  index: number;
  text: string;
  level: number;
}

export function renderReader(root: HTMLElement, book: Book, ctx: ReaderContext): ReaderHandle {
  clear(root);
  let settings = ctx.settings();
  let chunks: Chunk[] = [];
  let player: RsvpPlayer;
  let headings: HeadingEntry[] = [];
  let blockRanges = new Map<number, [number, number]>();
  let unsubscribe = () => {};
  let lastSavedAt = 0;
  let contextKey = '';
  let wakeLock: { release: () => Promise<void> } | null = null;

  // ---- DOM ----
  const word = h('div', { class: 'word', 'aria-live': 'off' });
  const hint = h('div', { class: 'stage-hint' });
  const stage = h(
    'div',
    { class: 'stage', tabindex: 0, role: 'button', 'aria-label': '再生 / 一時停止' },
    h('div', { class: 'guide guide-a', 'aria-hidden': 'true' }),
    word,
    h('div', { class: 'guide guide-b', 'aria-hidden': 'true' }),
    hint,
  );
  const contextPanel = h('div', { class: 'context', 'aria-label': '前後の文章' });
  const seek = h('input', { type: 'range', class: 'seek', min: 0, value: 0, step: 1, 'aria-label': '読書位置' });
  const progressText = h('span', { class: 'progress-text' });
  const chapterText = h('span', { class: 'chapter-text' });
  const playButton = h('button', { class: 'play-button', type: 'button', 'aria-label': '再生' }, icon(ICONS.play));
  const speedValue = h('button', { class: 'speed-value', type: 'button', title: '速さの設定' });

  const ctrl = (d: string, label: string, onclick: () => void, extra = '') =>
    h('button', { class: `icon-button ${extra}`, type: 'button', 'aria-label': label, title: label, onclick }, icon(d));

  const tocButton = ctrl(ICONS.toc, '目次', () => openToc());

  root.append(
    h(
      'div',
      { class: 'reader' },
      h(
        'header',
        { class: 'reader-bar' },
        ctrl(ICONS.back, 'ホームに戻る', () => ctx.goHome()),
        h('div', { class: 'reader-title' }, h('strong', {}, book.title), h('span', {}, book.author)),
        tocButton,
        ctrl(ICONS.info, '作品情報', () => openInfo()),
        ctrl(ICONS.settings, '設定', () => ctx.openSettings()),
      ),
      stage,
      contextPanel,
      h(
        'div',
        { class: 'dock' },
        h('div', { class: 'progress' }, seek, h('div', { class: 'progress-meta' }, chapterText, progressText)),
        h(
          'div',
          { class: 'controls' },
          ctrl(ICONS.chapterBack, '前の見出し', () => player.heading(-1), 'hide-narrow'),
          ctrl(ICONS.sentenceBack, '前の文', () => player.sentence(-1)),
          ctrl(ICONS.stepBack, '一つ戻る', () => player.step(-1)),
          playButton,
          ctrl(ICONS.stepFwd, '一つ進む', () => player.step(1)),
          ctrl(ICONS.sentenceFwd, '次の文', () => player.sentence(1)),
          ctrl(ICONS.chapterFwd, '次の見出し', () => player.heading(1), 'hide-narrow'),
        ),
        h(
          'div',
          { class: 'speed' },
          ctrl(ICONS.minus, '遅くする', () => changeSpeed(-CPM_STEP)),
          speedValue,
          ctrl(ICONS.plus, '速くする', () => changeSpeed(CPM_STEP)),
        ),
      ),
    ),
  );

  // ---- 組み立て ----
  function build(startOffset: number) {
    unsubscribe();
    player?.destroy();
    chunks = chunkBlocks(book.blocks, {
      targetChars: settings.targetChars,
      hardMax: Math.max(14, settings.targetChars + 4),
    });
    blockRanges = new Map();
    chunks.forEach((c, i) => {
      const r = blockRanges.get(c.block);
      if (r) r[1] = i;
      else blockRanges.set(c.block, [i, i]);
    });
    player = new RsvpPlayer(chunks, timing(), chunkIndexAtOffset(chunks, startOffset));
    headings = [];
    chunks.forEach((c, i) => {
      if (player.isHeadingStart(i)) {
        const block = book.blocks[c.block];
        headings.push({ index: i, text: block.runs.map((r) => r.text).join(''), level: c.level ?? 2 });
      }
    });
    tocButton.hidden = headings.length === 0;
    seek.max = String(Math.max(0, chunks.length - 1));
    contextKey = '';
    unsubscribe = player.subscribe(update);
    update();
  }

  const timing = () => ({ cpm: settings.cpm, pauseScale: settings.pauseScale });

  // ---- 描画 ----
  function update() {
    const c = player.current;
    renderChunk(c);
    const playing = player.playing;
    stage.classList.toggle('playing', playing);
    root.classList.toggle('is-playing', playing);
    playButton.replaceChildren(icon(playing ? ICONS.pause : ICONS.play));
    playButton.setAttribute('aria-label', playing ? '一時停止' : '再生');
    if (document.activeElement !== seek) seek.value = String(player.index);
    const pct = Math.floor(player.progress * 100);
    progressText.textContent = `${pct}% ・ 残り ${formatDuration(player.remainingMs)}`;
    chapterText.textContent = currentHeading()?.text ?? '';
    speedValue.textContent = `${settings.cpm} 字/分`;

    if (!playing && player.atEnd && player.index > 0) hint.textContent = '読了しました。おつかれさまでした。';
    else if (!playing && player.index === 0) hint.textContent = 'タップまたはスペースキーで再生';
    else hint.textContent = '';

    renderContext();
    if (!playing || Date.now() - lastSavedAt > 5000) saveProgress();
    syncWakeLock(playing);
  }

  function renderChunk(c: Chunk | undefined) {
    clear(word);
    word.classList.toggle('heading', !!c?.heading);
    if (!c) return;
    for (const r of c.runs) word.append(renderRun(r, settings.showRuby));
    fitWord();
  }

  function fitWord() {
    word.style.fontSize = `${settings.fontSize}px`;
    const vertical = settings.vertical;
    const avail = (vertical ? stage.clientHeight : stage.clientWidth) * 0.9;
    const need = vertical ? word.scrollHeight : word.scrollWidth;
    if (avail > 0 && need > avail) {
      word.style.fontSize = `${Math.max(14, Math.floor((settings.fontSize * avail) / need))}px`;
    }
  }

  function renderContext() {
    const show = settings.showContext && !player.playing && chunks.length > 0;
    contextPanel.hidden = !show;
    if (!show) return;
    const cur = player.current!;
    const key = `${cur.block}:${player.index}`;
    if (key === contextKey) return;
    contextKey = key;
    clear(contextPanel);
    // 現在の段落と、その前後の段落を表示
    const blocks = [...blockRanges.keys()];
    const pos = blocks.indexOf(cur.block);
    for (const b of blocks.slice(Math.max(0, pos - 1), pos + 2)) {
      const [s, e] = blockRanges.get(b)!;
      const p = h('p', { class: chunks[s].heading ? 'ctx-heading' : '' });
      for (let i = s; i <= e; i++) {
        const span = h(
          'span',
          { class: i === player.index ? 'ctx-chunk current' : 'ctx-chunk', onclick: () => player.seek(i) },
          chunks[i].runs.map((r) => renderRun(r, settings.showRuby)),
        );
        p.append(span);
      }
      contextPanel.append(p);
    }
    contextPanel.querySelector('.current')?.scrollIntoView?.({ block: 'nearest' });
  }

  function currentHeading(): HeadingEntry | undefined {
    let found: HeadingEntry | undefined;
    for (const hd of headings) {
      if (hd.index > player.index) break;
      found = hd;
    }
    return found;
  }

  function saveProgress() {
    lastSavedAt = Date.now();
    const c = player.current;
    saveRecent({
      key: book.key,
      title: book.title,
      author: book.author,
      source: book.source,
      progress: player.progress,
      charOffset: c?.offset ?? 0,
      updatedAt: lastSavedAt,
    });
  }

  // ---- 操作 ----
  function togglePlay() {
    if (!player.playing && settings.rewindOnResume && player.index > 0 && !player.current?.sentenceStart) {
      player.seek(player.findSentenceStart(-1));
    }
    player.toggle();
  }

  function changeSpeed(delta: number) {
    const cpm = Math.min(CPM_MAX, Math.max(CPM_MIN, settings.cpm + delta));
    ctx.updateSettings({ cpm });
  }

  async function syncWakeLock(playing: boolean) {
    // 再生中は画面を消さない（対応ブラウザのみ）
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    try {
      if (playing && !wakeLock && nav.wakeLock && document.visibilityState === 'visible') {
        wakeLock = { release: async () => {} };
        wakeLock = await nav.wakeLock.request('screen');
      } else if (!playing && wakeLock) {
        const lock = wakeLock;
        wakeLock = null;
        await lock.release();
      }
    } catch {
      wakeLock = null;
    }
  }

  function openToc() {
    const list = h(
      'ol',
      { class: 'toc-list' },
      headings.map((hd) =>
        h(
          'li',
          { class: `toc-level-${hd.level}` },
          h(
            'button',
            {
              type: 'button',
              class: hd === currentHeading() ? 'current' : '',
              onclick: () => {
                player.seek(hd.index);
                dialog.close();
              },
            },
            hd.text,
          ),
        ),
      ),
    );
    const dialog = sheet('目次', list);
    dialog.querySelector('.current')?.scrollIntoView?.({ block: 'center' });
  }

  function openInfo() {
    const total = chunks.reduce((n, c) => n + c.chars, 0);
    const notesSlot = h('div', { class: 'notes' });
    const body = h(
      'div',
      { class: 'info' },
      h('h3', {}, book.title, book.subtitle ? h('small', {}, '　', book.subtitle) : null),
      h('p', {}, book.author),
      h(
        'dl',
        {},
        h('dt', {}, '文字数'),
        h('dd', {}, `約 ${total.toLocaleString()} 字（句読点を除く）`),
        h('dt', {}, '読了までの目安'),
        h('dd', {}, `${formatDuration(player.totalMs)}（${settings.cpm} 字/分）`),
        book.source.url ? h('dt', {}, '出典') : null,
        book.source.url ? h('dd', {}, h('a', { href: book.source.url, target: '_blank', rel: 'noopener' }, book.source.url)) : null,
        book.source.workId
          ? h('dt', {}, '図書カード')
          : null,
        book.source.workId
          ? h(
              'dd',
              {},
              h(
                'a',
                { href: `https://www.aozora.gr.jp/cards/${cardDir(book)}/card${book.source.workId}.html`, target: '_blank', rel: 'noopener' },
                '青空文庫で見る',
              ),
            )
          : null,
      ),
      notesSlot,
      book.bibliography ? h('h4', {}, '底本・入力者など') : null,
      book.bibliography ? h('pre', { class: 'bib' }, book.bibliography) : null,
    );
    sheet('作品情報', body);
    void fillNotes(notesSlot);
  }

  /** 図書カードの「作品について」「人物について」を作品情報に足す */
  async function fillNotes(slot: HTMLElement) {
    const workId = book.source.workId;
    if (!workId) return;
    slot.append(h('p', { class: 'muted small' }, '解説を読み込んでいます…'));
    const [notes, work] = await Promise.all([loadCardNotes(), ctx.getWork?.(workId)]);
    clear(slot);
    if (!notes) return;
    const workNote = notes.works[workId];
    const people = (work?.people ?? []).map((p) => ({ person: p, note: notes.persons[p.id] })).filter((x) => x.note);
    if (workNote === undefined && !people.length) {
      slot.append(h('p', { class: 'muted small' }, 'この作品の図書カードの解説は、まだ取り込んでいません（少しずつ取り込んでいます）。'));
      return;
    }
    if (workNote) slot.append(h('h4', {}, '作品について'), renderNote(workNote));
    for (const { person, note } of people) {
      if (!note) continue;
      slot.append(h('h4', {}, `${person.name}について`), renderNote(note));
    }
    if (!workNote && !people.length) {
      slot.append(h('p', { class: 'muted small' }, '青空文庫の図書カードに、この作品の解説はありません。'));
      return;
    }
    const cardUrl = work?.cardUrl ?? `https://www.aozora.gr.jp/cards/${cardDir(book)}/card${workId}.html`;
    slot.append(
      h(
        'p',
        { class: 'note-credit' },
        '出典：',
        h('a', { href: cardUrl, target: '_blank', rel: 'noopener' }, '青空文庫 図書カード'),
        '（',
        h('a', { href: 'https://creativecommons.org/licenses/by/4.0/deed.ja', target: '_blank', rel: 'noopener' }, 'CC BY 4.0'),
        '）。表示のため HTML をテキストに変換しています。',
      ),
    );
  }

  // ---- イベント ----
  stage.addEventListener('click', togglePlay);
  stage.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      togglePlay();
    }
  });
  playButton.addEventListener('click', togglePlay);
  speedValue.addEventListener('click', () => ctx.openSettings());
  let wasPlaying = false;
  seek.addEventListener('pointerdown', () => {
    wasPlaying = player.playing;
    player.pause();
  });
  seek.addEventListener('input', () => player.seek(Number(seek.value)));
  seek.addEventListener('change', () => {
    player.seek(Number(seek.value));
    if (wasPlaying) player.play();
    wasPlaying = false;
  });

  const onKey = (e: KeyboardEvent) => {
    if (document.querySelector('dialog[open]')) return;
    const t = e.target as HTMLElement;
    if (t.matches('input, select, textarea') && t !== seek) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const back = settings.vertical ? 'ArrowRight' : 'ArrowLeft';
    const fwd = settings.vertical ? 'ArrowLeft' : 'ArrowRight';
    switch (e.key) {
      case ' ':
      case 'k':
        togglePlay();
        break;
      case back:
      case 'j':
        e.shiftKey ? player.sentence(-1) : player.step(-1);
        break;
      case fwd:
      case 'l':
        e.shiftKey ? player.sentence(1) : player.step(1);
        break;
      case 'ArrowUp':
        changeSpeed(CPM_STEP);
        break;
      case 'ArrowDown':
        changeSpeed(-CPM_STEP);
        break;
      case 'PageUp':
      case '[':
        player.heading(-1);
        break;
      case 'PageDown':
      case ']':
        player.heading(1);
        break;
      case 'Home':
        player.seek(0);
        break;
      case 'Escape':
        if (player.playing) player.pause();
        else ctx.goHome();
        break;
      default:
        return;
    }
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      player.pause();
      saveProgress();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  const onResize = () => fitWord();
  window.addEventListener('resize', onResize);
  const onPageHide = () => saveProgress();
  window.addEventListener('pagehide', onPageHide);

  applyLayout();
  build(getRecent(book.key)?.charOffset ?? 0);

  function applyLayout() {
    stage.classList.toggle('vertical', settings.vertical);
  }

  return {
    applySettings(prev, next) {
      settings = next;
      applyLayout();
      if (prev.targetChars !== next.targetChars) {
        const wasOn = player.playing;
        build(player.current?.offset ?? 0);
        if (wasOn) player.play();
        return;
      }
      if (prev.cpm !== next.cpm || prev.pauseScale !== next.pauseScale) player.setTiming(timing());
      contextKey = '';
      update();
    },
    destroy() {
      saveProgress();
      unsubscribe();
      player.destroy();
      void syncWakeLock(false);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pagehide', onPageHide);
    },
  };
}

function renderNote(note: CardNote): HTMLElement {
  return h(
    'div',
    { class: 'note' },
    note.text ? note.text.split('\n').map((line) => h('p', {}, line)) : null,
    note.links.length
      ? h(
          'ul',
          { class: 'note-links' },
          note.links.map((l) => h('li', {}, h('a', { href: l.href, target: '_blank', rel: 'noopener noreferrer' }, linkLabel(l)))),
        )
      : null,
  );
}

/** Wikipedia へのリンクはそれと分かるようにする */
function linkLabel(l: NoteLink): string {
  return /wikipedia\.org/.test(l.href) ? `Wikipedia「${l.label}」` : l.label;
}

function renderRun(r: Run, showRuby: boolean): Node {
  let node: Node;
  if (r.gaijiSrc) {
    const img = h('img', { class: 'gaiji', src: r.gaijiSrc, alt: r.gaijiAlt ?? r.text, title: r.gaijiAlt ?? '' });
    // 画像が取れなければ代替文字にする
    img.addEventListener('error', () => img.replaceWith(document.createTextNode(r.text)), { once: true });
    node = img;
  } else if (r.ruby && showRuby) {
    node = h('ruby', {}, r.text, h('rp', {}, '（'), h('rt', {}, r.ruby), h('rp', {}, '）'));
  } else {
    node = document.createTextNode(r.text);
  }
  return r.em ? h('em', {}, node) : node;
}

function sheet(title: string, body: Node): HTMLDialogElement {
  const dialog = h(
    'dialog',
    { class: 'sheet', 'aria-label': title },
    h(
      'div',
      { class: 'sheet-head' },
      h('h2', {}, title),
      h('button', { class: 'icon-button', type: 'button', 'aria-label': '閉じる', onclick: () => dialog.close() }, icon(ICONS.close)),
    ),
    h('div', { class: 'sheet-body' }, body),
  );
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

/** 図書カード URL 用の人物ディレクトリ（作品ファイル URL の cards/NNNNNN/ 部分） */
function cardDir(book: Book): string {
  return /cards\/(\d+)\//.exec(book.source.url ?? '')?.[1] ?? '';
}
