<script lang="ts">
  import { Button, EmptyState } from "@kenn-io/kit-ui";
  import { m } from "../../i18n/index.js";
  import { TrashIcon } from "../../icons.js";
  import { onDestroy, onMount } from "svelte";
  import type { Session } from "../../api/types.js";
  import { SessionsService } from "../../api/generated/index";
  import {
    callGenerated,
    configureGeneratedClient,
    isAbortError,
  } from "../../api/runtime.js";
  import { sessions } from "../../stores/sessions.svelte.js";
  import { formatRelativeTime, truncate } from "../../utils/format.js";
  import { normalizeMessagePreview } from "../../utils/messages.js";
  import { LatestRead } from "../../utils/latest-read.js";
  let trashedSessions: Session[] = $state([]);
  let loading = $state(true);
  let emptying = $state(false);
  let loadError: { detail: string | null } | null = $state(null);
  let emptyError: { detail: string | null } | null = $state(null);
  let pending = $state(new Map<string, "restore" | "delete">());
  let rowErrors = $state(new Map<string, string | null>());
  const trashRead = new LatestRead();

  function errorDetail(error: unknown): string | null {
    return error instanceof Error ? error.message : null;
  }

  function cancelTrashRead() {
    trashRead.cancel();
    loading = false;
  }

  interface TrashResponse {
    sessions: Session[];
  }

  onMount(() => {
    loadTrash();
  });

  async function loadTrash() {
    if (emptying || pending.size > 0) return;
    loadError = null;
    const signal = trashRead.begin();
    loading = true;
    try {
      configureGeneratedClient();
      const res = await callGenerated(
        () => SessionsService.getApiV1Trash(),
        signal,
      ) as unknown as TrashResponse;
      if (!trashRead.isCurrent(signal)) return;
      trashedSessions = res.sessions ?? [];
      emptyError = null;
    } catch (e) {
      if (isAbortError(e) || !trashRead.isCurrent(signal)) return;
      loadError = { detail: errorDetail(e) };
    } finally {
      if (trashRead.finish(signal)) loading = false;
    }
  }

  onDestroy(cancelTrashRead);

  async function changeSession(id: string, action: "restore" | "delete") {
    if (emptying || pending.has(id) || !trashedSessions.some((s) => s.id === id)) return;
    // A read begun before this action must not resurrect the removed row.
    cancelTrashRead();
    pending = new Map(pending).set(id, action);
    const nextErrors = new Map(rowErrors);
    nextErrors.delete(id);
    rowErrors = nextErrors;
    try {
      configureGeneratedClient();
      if (action === "restore") {
        await SessionsService.postApiV1SessionsIdRestore({ id });
      } else {
        await SessionsService.deleteApiV1SessionsIdPermanent({ id });
      }
    } catch (error) {
      rowErrors = new Map(rowErrors).set(id, errorDetail(error));
      return;
    } finally {
      const nextPending = new Map(pending);
      nextPending.delete(id);
      pending = nextPending;
    }
    trashedSessions = trashedSessions.filter((s) => s.id !== id);
    if (trashedSessions.length === 0) {
      loadError = null;
      emptyError = null;
    }
    sessions.clearRecentlyDeleted(id);
    sessions.invalidateFilterCaches();
    // Refreshing the sidebar is separate from the already successful action.
    if (action === "restore") void sessions.load();
  }

  async function restoreSession(id: string) {
    await changeSession(id, "restore");
  }

  async function permanentDelete(id: string) {
    await changeSession(id, "delete");
  }

  async function emptyAll() {
    if (emptying || pending.size > 0 || trashedSessions.length === 0) return;
    cancelTrashRead();
    emptyError = null;
    emptying = true;
    try {
      configureGeneratedClient();
      await SessionsService.deleteApiV1Trash();
      trashedSessions = [];
      rowErrors = new Map();
      loadError = null;
      sessions.clearRecentlyDeleted();
      sessions.invalidateFilterCaches();
    } catch (error) {
      emptyError = { detail: errorDetail(error) };
    } finally {
      emptying = false;
    }
  }

  function displayName(s: Session): string {
    const raw = s.display_name ?? normalizeMessagePreview(s.first_message);
    return raw ? truncate(raw, 70) : s.project;
  }
</script>

<div class="trash-page">
  {#if loadError}
    <div class="trash-error load-error" role="alert">
      <strong>{m.subagent_inline_failed_to_load()}</strong>
      {#if loadError.detail}<span>{loadError.detail}</span>{/if}
      <Button
        size="sm"
        surface="soft"
        label={m.shared_retry()}
        disabled={emptying || pending.size > 0}
        onclick={loadTrash}
      />
    </div>
  {/if}
  {#if emptyError}
    <div class="trash-error empty-error" role="alert">
      <strong>{m.insights_page_error()}</strong>
      <span>{m.trash_empty_trash()}</span>
      {#if emptyError.detail}<span>{emptyError.detail}</span>{/if}
    </div>
  {/if}
  {#if loading}
    <div class="loading-state" class:refreshing={trashedSessions.length > 0} role="status">{m.trash_loading()}</div>
  {/if}
  {#if trashedSessions.length === 0}
    {#if !loading && !loadError}
      <EmptyState title={m.trash_empty()} description={m.trash_empty_desc()}>
        {#snippet icon()}
          <TrashIcon size="40" strokeWidth="1.6" aria-hidden="true" />
        {/snippet}
      </EmptyState>
    {/if}
  {:else}
    <div class="trash-header">
      <TrashIcon size="18" strokeWidth="2" class="trash-icon" aria-hidden="true" />
      <h2>{m.trash_title()}</h2>
      <span class="trash-count">{trashedSessions.length}</span>
      <button
        class="empty-all-btn"
        onclick={emptyAll}
        disabled={emptying || pending.size > 0}
      >
        {emptying ? m.trash_emptying() : m.trash_empty_trash()}
      </button>
    </div>

    <div class="trash-list">
      {#each trashedSessions as session (session.id)}
        <div class="trash-card" aria-busy={emptying || pending.has(session.id)}>
          <div class="trash-card-info">
            <div class="trash-card-name">{displayName(session)}</div>
            <div class="trash-card-meta">
              <span class="trash-agent">{session.agent}</span>
              <span class="trash-project">{session.project}</span>
              <span class="trash-msgs">{m.trash_msgs({
                count: session.user_message_count,
                countLabel: session.user_message_count.toLocaleString(),
              })}</span>
              {#if session.deleted_at}
                <span class="trash-deleted">{m.trash_deleted_ago({ time: formatRelativeTime(session.deleted_at) })}</span>
              {/if}
            </div>
          </div>
          <div class="trash-card-actions">
            {#if pending.has(session.id)}
              <span class="row-progress" role="status">{m.subagent_inline_loading()}</span>
            {/if}
            <button
              class="restore-btn"
              onclick={() => restoreSession(session.id)}
              title={m.trash_restore_session()}
              disabled={emptying || pending.has(session.id)}
            >
              {m.trash_restore()}
            </button>
            <button
              class="perm-delete-btn"
              onclick={() => permanentDelete(session.id)}
              title={m.trash_permanently_delete()}
              disabled={emptying || pending.has(session.id)}
            >
              {m.trash_delete_forever()}
            </button>
          </div>
          {#if rowErrors.has(session.id)}
            <div class="row-error" role="alert">
              <strong>{m.insights_page_error()}</strong>
              {#if rowErrors.get(session.id)}<span>{rowErrors.get(session.id)}</span>{/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .trash-page {
    max-width: 800px;
    margin: 0 auto;
    padding: 40px 24px;
  }

  .trash-header {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-bottom: 8px;
  }

  :global(.trash-icon) {
    color: var(--text-muted);
  }

  .trash-header h2 {
    font-size: 20px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .trash-count {
    background: var(--text-muted);
    color: white;
    font-size: 11px;
    font-weight: 600;
    padding: 1px 7px;
    border-radius: 10px;
  }

  .empty-all-btn {
    margin-left: auto;
    font-size: 11px;
    font-weight: 500;
    color: var(--accent-red, #e55);
    background: none;
    border: 1px solid var(--accent-red, #e55);
    border-radius: var(--radius-sm);
    padding: 4px 12px;
    cursor: pointer;
    transition: background 0.12s;
  }

  .empty-all-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent-red, #e55) 8%, transparent);
  }

  .loading-state {
    text-align: center;
    color: var(--text-muted);
    padding: 40px 0;
    font-size: 13px;
  }

  .loading-state.refreshing {
    padding: 8px 0;
  }

  .trash-error,
  .row-error {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    color: var(--text-secondary);
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  .trash-error {
    padding: 12px;
    margin-bottom: 16px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
  }

  .row-error {
    flex-basis: 100%;
  }

  .row-progress {
    font-size: 11px;
    color: var(--text-muted);
  }

  .trash-page button:disabled {
    opacity: 0.55;
    cursor: progress;
  }

  .trash-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .trash-card {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    background: var(--bg-surface);
    border: 1px solid var(--border-muted);
    border-radius: 8px;
    padding: 12px 14px;
    gap: 12px;
    transition: border-color 0.15s;
  }

  .trash-card:hover {
    border-color: var(--border-default);
  }

  .trash-card-info {
    flex: 1 1 240px;
    min-width: 0;
  }

  .trash-card-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-bottom: 3px;
  }

  .trash-card-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 10px;
    color: var(--text-muted);
  }

  .trash-agent {
    font-weight: 600;
    text-transform: capitalize;
  }

  .trash-project {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 150px;
  }

  .trash-msgs {
    white-space: nowrap;
  }

  .trash-deleted {
    white-space: nowrap;
    color: var(--accent-red, #e55);
    font-style: italic;
  }

  .trash-card-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .restore-btn {
    font-size: 11px;
    font-weight: 500;
    color: var(--accent-green);
    background: none;
    border: 1px solid var(--accent-green);
    border-radius: var(--radius-sm);
    padding: 4px 10px;
    cursor: pointer;
    transition: background 0.12s;
  }

  .restore-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent-green) 8%, transparent);
  }

  .perm-delete-btn {
    font-size: 11px;
    font-weight: 500;
    color: var(--accent-red, #e55);
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    padding: 4px 10px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }

  .perm-delete-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent-red, #e55) 8%, transparent);
  }
</style>
