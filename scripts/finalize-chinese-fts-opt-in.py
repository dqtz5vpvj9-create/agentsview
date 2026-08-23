#!/usr/bin/env python3
# Keep the legacy-writer freshness ledger fully opt-in. Archives that have never
# enabled the Chinese sidecar retain the original write path without extra
# tables or triggers.

from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one replacement target, found {count}")
    file_path.write_text(text.replace(old, new, 1))


replace_once(
    "internal/db/chinese_fts_runtime.go",
    '''\tdefer func() { _ = tx.Rollback() }()

\tif _, err := tx.ExecContext(ctx, schemaChineseFTSPendingSessions); err != nil {
\t\treturn fmt.Errorf("installing Chinese FTS freshness ledger: %w", err)
\t}

\tfor _, trigger := range []string{
''',
    '''\tdefer func() { _ = tx.Rollback() }()

\tfor _, trigger := range []string{
''',
)

replace_once(
    "internal/db/chinese_fts_runtime.go",
    '''\tvar pendingSessions int
\tif err := tx.QueryRowContext(ctx,
\t\t"SELECT count(*) FROM messages_chinese_fts_pending_sessions",
\t).Scan(&pendingSessions); err != nil {
\t\treturn fmt.Errorf("checking Chinese FTS freshness ledger: %w", err)
\t}

\tif !simpleFTSRuntimeConfig.available() {
''',
    '''\tvar pendingTableExists bool
\tif err := tx.QueryRowContext(ctx, `
\t\tSELECT EXISTS(
\t\t\tSELECT 1 FROM sqlite_master
\t\t\tWHERE type = 'table'
\t\t\t  AND name = 'messages_chinese_fts_pending_sessions'
\t\t)`).Scan(&pendingTableExists); err != nil {
\t\treturn fmt.Errorf("checking Chinese FTS freshness ledger table: %w", err)
\t}

\ttrackFreshness := simpleFTSRuntimeConfig.available() ||
\t\ttableExists || pendingTableExists
\tif !trackFreshness {
\t\tif _, err := tx.ExecContext(
\t\t\tctx, "DELETE FROM stats WHERE key = ?", chineseFTSFingerprintStatsKey,
\t\t); err != nil {
\t\t\treturn fmt.Errorf("clearing orphaned Chinese FTS fingerprint: %w", err)
\t\t}
\t\tif err := tx.Commit(); err != nil {
\t\t\treturn fmt.Errorf("committing disabled Chinese FTS state: %w", err)
\t\t}
\t\treturn nil
\t}

\tif _, err := tx.ExecContext(ctx, schemaChineseFTSPendingSessions); err != nil {
\t\treturn fmt.Errorf("installing Chinese FTS freshness ledger: %w", err)
\t}
\tvar pendingSessions int
\tif err := tx.QueryRowContext(ctx,
\t\t"SELECT count(*) FROM messages_chinese_fts_pending_sessions",
\t).Scan(&pendingSessions); err != nil {
\t\treturn fmt.Errorf("checking Chinese FTS freshness ledger: %w", err)
\t}

\tif !simpleFTSRuntimeConfig.available() {
''',
)

# Drop the TEMP session acknowledgements together with the FTS maintenance
# triggers. Persistent pending-session triggers then record any bulk mutations
# until RebuildFTS completes atomically.
replace_once(
    "internal/db/db.go",
    '''\tstmts := []string{
\t\t"DROP TRIGGER IF EXISTS messages_chinese_ai",
\t\t"DROP TRIGGER IF EXISTS messages_chinese_ad",
\t\t"DROP TRIGGER IF EXISTS messages_chinese_au",
\t\t"DROP TABLE IF EXISTS messages_chinese_fts",
''',
    '''\tstmts := []string{
\t\t"DROP TRIGGER IF EXISTS messages_chinese_ai",
\t\t"DROP TRIGGER IF EXISTS messages_chinese_ad",
\t\t"DROP TRIGGER IF EXISTS messages_chinese_au",
\t\t"DROP TRIGGER IF EXISTS sessions_chinese_pending_ai",
\t\t"DROP TRIGGER IF EXISTS sessions_chinese_pending_au",
\t\t"DROP TRIGGER IF EXISTS sessions_chinese_pending_ad",
\t\t"DROP TABLE IF EXISTS messages_chinese_fts",
''',
)
