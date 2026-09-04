/** Local, occurrence-level session search with a stable navigation cursor. */
import { untrack } from "svelte";
import type { Message } from "../api/types.js";
import { buildSessionIndex, type Match, type SessionIndex } from "../search/session-index.js";
import { messages } from "./messages.svelte.js";
import { ui } from "./ui.svelte.js";

export type SearchCursor = Pick<Match, "ordinal" | "blockKey" | "occurrence">;

export interface SearchMessageSource {
  sessionId: string | null;
  messages: Message[];
  loading: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  ensureOrdinalLoaded(ordinal: number): Promise<void>;
}

export interface SearchView {
  selectedOrdinal: number | null;
  sortNewestFirst: boolean;
  selectOrdinal(ordinal: number): void;
  setFollowLatest(follow: boolean): void;
}

const EMPTY_MATCHES: Match[] = [];

function sameCursor(a: SearchCursor, b: SearchCursor): boolean {
  return a.ordinal === b.ordinal && a.blockKey === b.blockKey && a.occurrence === b.occurrence;
}

export class InSessionSearchStore {
  isOpen = $state(false);
  query = $state("");
  debouncedQuery = $state("");
  current: SearchCursor | null = $state.raw(null);
  currentSeq = $state(0);
  revealSeq = $state(0);
  anchorOrdinal: number | null = $state(null);
  focusRequest = $state(0);
  resultsOpen = $state(false);

  private source: SearchMessageSource = messages;
  private view: SearchView = ui;
  private disposeEffects: () => void;
  private previousSessionId: string | null;
  private historyRequest: { sessionId: string; promise: Promise<void> } | null = null;

  isActive = $derived(this.isOpen && this.debouncedQuery.trim() !== "");
  index: SessionIndex | null = $derived.by(() => {
    // The session is part of the dependency graph even when its message array
    // is temporarily shared with the previous session during a load transition.
    if (!this.source.sessionId || !this.isActive) return null;
    return buildSessionIndex(this.source.messages, this.debouncedQuery);
  });
  matches: Match[] = $derived(this.index?.matches ?? EMPTY_MATCHES);
  total = $derived(this.index?.total ?? 0);
  loadingHistory = $derived(
    this.isOpen && (this.source.loading || this.source.hasOlder || this.source.loadingOlder),
  );
  resolvedCurrent: Match | null = $derived.by(() => {
    if (!this.matches.length) return null;
    if (this.current) {
      const exact = this.matches.find((match) => sameCursor(match, this.current!));
      if (exact) return exact;
    }
    const anchor = this.current?.ordinal ?? this.anchorOrdinal;
    return (anchor === null
      ? this.matches[0]
      : this.matches.find((match) => match.ordinal >= anchor)) ?? null;
  });
  currentIndex = $derived.by(() => {
    const current = this.resolvedCurrent;
    if (!current) return -1;
    const index = this.matches.indexOf(current);
    return this.view.sortNewestFirst ? this.total - 1 - index : index;
  });

  constructor(source: SearchMessageSource = messages, view: SearchView = ui) {
    this.source = source;
    this.view = view;
    this.previousSessionId = source.sessionId;
    this.disposeEffects = $effect.root(() => {
      $effect(() => {
        const sessionId = this.source.sessionId;
        untrack(() => {
          if (sessionId === this.previousSessionId) return;
          this.previousSessionId = sessionId;
          this.current = null;
          this.anchorOrdinal = null;
          this.currentSeq++;
          this.revealSeq++;
          if (!sessionId) this.close();
        });
      });

      $effect(() => {
        const query = this.query;
        const open = this.isOpen;
        const sessionId = this.source.sessionId;
        if (!open || !sessionId || !query.trim()) {
          untrack(() => this.applyQuery(""));
          return;
        }
        if (query === untrack(() => this.debouncedQuery)) return;
        const timer = setTimeout(() => {
          if (this.isOpen && this.source.sessionId === sessionId && this.query === query) {
            this.applyQuery(query);
          }
        }, 150);
        return () => clearTimeout(timer);
      });

      $effect(() => {
        const open = this.isOpen;
        const sessionId = this.source.sessionId;
        const hasOlder = this.source.hasOlder;
        const loading = this.source.loading;
        if (open && sessionId && hasOlder && !loading) {
          untrack(() => this.requestHistory());
        }
      });
    });
  }

  private applyQuery(query: string): void {
    if (query === this.debouncedQuery) return;
    this.debouncedQuery = query;
    this.current = null;
    this.currentSeq++;
    this.revealSeq++;
    this.selectCurrent();
  }

  private selectCurrent(): void {
    const match = this.resolvedCurrent;
    if (!match) return;
    this.view.selectOrdinal(match.ordinal);
    this.view.setFollowLatest(false);
  }

  private requestHistory(): void {
    const sessionId = this.source.sessionId;
    if (!sessionId || !this.isOpen || !this.source.hasOlder || this.source.loading) return;
    if (this.historyRequest?.sessionId === sessionId) return;
    const promise = this.source.ensureOrdinalLoaded(0);
    this.historyRequest = { sessionId, promise };
    void promise.catch((error: unknown) => {
      console.warn("Could not load session history for search", error);
    }).finally(() => {
      if (this.historyRequest?.promise === promise) this.historyRequest = null;
    });
  }

  countForBlock(key: string | undefined): number {
    return key ? this.index?.byBlock.get(key) ?? 0 : 0;
  }

  countForOrdinal(ordinal: number): number {
    return this.index?.byOrdinal.get(ordinal) ?? 0;
  }

  isCurrentBlock(key: string | undefined): boolean {
    return !!key && this.resolvedCurrent?.blockKey === key;
  }

  currentOccurrence(key: string | undefined): number {
    return this.isCurrentBlock(key) ? this.resolvedCurrent!.occurrence : -1;
  }

  open(): void {
    if (!this.isOpen) {
      this.anchorOrdinal = this.view.selectedOrdinal;
      this.current = null;
      this.currentSeq++;
      this.revealSeq++;
      this.isOpen = true;
    }
    this.focusRequest++;
    this.requestHistory();
  }

  /** Closing hides search without erasing the last query. */
  close(): void {
    this.isOpen = false;
    this.debouncedQuery = "";
    this.current = null;
    this.resultsOpen = false;
    this.currentSeq++;
    this.revealSeq++;
  }

  clearQuery(): void {
    this.query = "";
    this.applyQuery("");
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  goTo(cursor: SearchCursor): void {
    const match = this.matches.find((candidate) => sameCursor(candidate, cursor));
    if (!match) return;
    this.current = {
      ordinal: match.ordinal,
      blockKey: match.blockKey,
      occurrence: match.occurrence,
    };
    this.currentSeq++;
    this.revealSeq++;
    this.selectCurrent();
  }

  private step(delta: number): void {
    if (!this.matches.length) return;
    const direction = this.view.sortNewestFirst ? -delta : delta;
    const current = this.resolvedCurrent ? this.matches.indexOf(this.resolvedCurrent) : -1;
    const next = current < 0
      ? direction > 0 ? 0 : this.total - 1
      : (current + direction + this.total) % this.total;
    this.goTo(this.matches[next]!);
  }

  next(): void { this.step(1); }
  prev(): void { this.step(-1); }

  // Compatibility names for callers migrating in the subsequent UI commits.
  get currentMatchIndex(): number { return this.currentIndex; }
  get currentOrdinal(): number | null { return this.resolvedCurrent?.ordinal ?? null; }
  get loading(): boolean {
    return this.loadingHistory || (this.isOpen && !!this.query.trim() && this.query !== this.debouncedQuery);
  }

  /** Release effects for isolated store instances and embedded session views. */
  destroy(): void {
    this.disposeEffects();
    this.close();
  }
}

export const inSessionSearch = new InSessionSearchStore();
