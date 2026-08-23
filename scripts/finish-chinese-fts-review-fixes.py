#!/usr/bin/env python3
# Complete the PR #1491 repair after apply-chinese-fts-review-fixes.py.
# The temporary workflow removes this file after the tested commit is created.

from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one replacement target, found {count}")
    file_path.write_text(text.replace(old, new, 1))


# Preserve the existing SQLite helper functions and serialize the extension's
# process-global dictionary state against query-time Jieba initialization.
replace_once(
    "internal/db/sqlite_driver.go",
    "var simpleFTSDictionaryMu sync.Mutex",
    "var simpleFTSDictionaryMu sync.RWMutex",
)
replace_once(
    "internal/db/sqlite_driver.go",
    '''func sqliteTimestampUnixMicro(raw string) any {
\tt, ok := parseTimestamp(raw)
\tif !ok {
\t\treturn nil
\t}
\treturn t.UnixMicro()
}
''',
    '''func sqliteTimestampUnixMicro(raw string) any {
\ttimestamp, ok := ParseStoredTimestamp(raw)
\tif !ok {
\t\treturn nil
\t}
\treturn timestamp.UTC().UnixMicro()
}

func sqliteUsageOutputTokens(tokenJSON string) int {
\t_, outputTokens, _, _ := parseUsageTokenCounters(tokenJSON)
\treturn outputTokens
}
''',
)

replace_once(
    "internal/db/chinese_fts_search.go",
    '''\tif err := db.getReader().QueryRowContext(
\t\tctx, "SELECT jieba_query(?)", trimmed,
\t).Scan(&query.match); err != nil {
\t\treturn messageFTSQuery{}, fmt.Errorf(
\t\t\t"preparing Chinese FTS query: %w", err,
\t\t)
\t}
''',
    '''\tsimpleFTSDictionaryMu.RLock()
\terr := db.getReader().QueryRowContext(
\t\tctx, "SELECT jieba_query(?)", trimmed,
\t).Scan(&query.match)
\tsimpleFTSDictionaryMu.RUnlock()
\tif err != nil {
\t\treturn messageFTSQuery{}, fmt.Errorf(
\t\t\t"preparing Chinese FTS query: %w", err,
\t\t)
\t}
''',
)

# A persistent, extension-free pending-session ledger survives writes from an
# older AgentsView binary. Current sidecar-enabled writers clear only the
# generation they created; a pre-existing generation remains visible and makes
# the Chinese index unavailable until the next atomic rebuild.
replace_once(
    "internal/db/chinese_fts_runtime.go",
    '''var (
\tsimpleFTSRuntimeConfig, simpleFTSRuntimeErr = discoverSimpleFTSRuntime()
)

type simpleFTSRuntime struct {
''',
    '''var (
\tsimpleFTSRuntimeConfig, simpleFTSRuntimeErr = discoverSimpleFTSRuntime()
)

const schemaChineseFTSPendingSessions = `
CREATE TABLE IF NOT EXISTS messages_chinese_fts_pending_sessions (
    session_id TEXT PRIMARY KEY,
    generation INTEGER NOT NULL CHECK (generation > 0)
);

DROP TRIGGER IF EXISTS sessions_chinese_pending_bi;
DROP TRIGGER IF EXISTS sessions_chinese_pending_bu;
DROP TRIGGER IF EXISTS sessions_chinese_pending_bd;

CREATE TRIGGER sessions_chinese_pending_bi
BEFORE INSERT ON sessions BEGIN
    INSERT INTO messages_chinese_fts_pending_sessions(session_id, generation)
        VALUES(new.id, 1)
    ON CONFLICT(session_id) DO UPDATE SET
        generation = messages_chinese_fts_pending_sessions.generation + 1;
END;

CREATE TRIGGER sessions_chinese_pending_bu
BEFORE UPDATE OF transcript_revision ON sessions
WHEN old.transcript_revision IS NOT new.transcript_revision BEGIN
    INSERT INTO messages_chinese_fts_pending_sessions(session_id, generation)
        VALUES(new.id, 1)
    ON CONFLICT(session_id) DO UPDATE SET
        generation = messages_chinese_fts_pending_sessions.generation + 1;
END;

CREATE TRIGGER sessions_chinese_pending_bd
BEFORE DELETE ON sessions BEGIN
    INSERT INTO messages_chinese_fts_pending_sessions(session_id, generation)
        VALUES(old.id, 1)
    ON CONFLICT(session_id) DO UPDATE SET
        generation = messages_chinese_fts_pending_sessions.generation + 1;
END;
`

type simpleFTSRuntime struct {
''',
)

replace_once(
    "internal/db/chinese_fts_runtime.go",
    '''\tdefer func() { _ = tx.Rollback() }()

\tfor _, trigger := range []string{
\t\t"messages_chinese_ai",
\t\t"messages_chinese_ad",
\t\t"messages_chinese_au",
\t} {
''',
    '''\tdefer func() { _ = tx.Rollback() }()

\tif _, err := tx.ExecContext(ctx, schemaChineseFTSPendingSessions); err != nil {
\t\treturn fmt.Errorf("installing Chinese FTS freshness ledger: %w", err)
\t}

\tfor _, trigger := range []string{
\t\t"messages_chinese_ai",
\t\t"messages_chinese_ad",
\t\t"messages_chinese_au",
\t\t"sessions_chinese_pending_ai",
\t\t"sessions_chinese_pending_au",
\t\t"sessions_chinese_pending_ad",
\t} {
''',
)

replace_once(
    "internal/db/chinese_fts_runtime.go",
    '''\tif err := tx.QueryRowContext(ctx, `
\t\tSELECT EXISTS(
\t\t\tSELECT 1 FROM sqlite_master
\t\t\tWHERE type = 'table' AND name = 'messages_chinese_fts'
\t\t)`).Scan(&tableExists); err != nil {
\t\treturn fmt.Errorf("checking Chinese FTS table: %w", err)
\t}

\tif !simpleFTSRuntimeConfig.available() {
''',
    '''\tif err := tx.QueryRowContext(ctx, `
\t\tSELECT EXISTS(
\t\t\tSELECT 1 FROM sqlite_master
\t\t\tWHERE type = 'table' AND name = 'messages_chinese_fts'
\t\t)`).Scan(&tableExists); err != nil {
\t\treturn fmt.Errorf("checking Chinese FTS table: %w", err)
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

replace_once(
    "internal/db/chinese_fts_runtime.go",
    '''\tcurrent := tableExists && fingerprintErr == nil &&
\t\tstoredFingerprint == simpleFTSRuntimeConfig.fingerprint
''',
    '''\tcurrent := tableExists && fingerprintErr == nil && pendingSessions == 0 &&
\t\tstoredFingerprint == simpleFTSRuntimeConfig.fingerprint
''',
)

replace_once(
    "internal/db/chinese_fts_runtime.go",
    '''\t\tif _, err := tx.ExecContext(ctx, `
\t\t\tINSERT INTO stats (key, value) VALUES (?, ?)
\t\t\tON CONFLICT(key) DO UPDATE SET value = excluded.value`,
\t\t\tchineseFTSFingerprintStatsKey,
\t\t\tsimpleFTSRuntimeConfig.fingerprint,
\t\t); err != nil {
\t\t\treturn fmt.Errorf("storing Chinese FTS fingerprint: %w", err)
\t\t}
\t}

\tif _, err := tx.ExecContext(ctx, schemaChineseFTSTriggers); err != nil {
''',
    '''\t\tif _, err := tx.ExecContext(ctx, `
\t\t\tINSERT INTO stats (key, value) VALUES (?, ?)
\t\t\tON CONFLICT(key) DO UPDATE SET value = excluded.value`,
\t\t\tchineseFTSFingerprintStatsKey,
\t\t\tsimpleFTSRuntimeConfig.fingerprint,
\t\t); err != nil {
\t\t\treturn fmt.Errorf("storing Chinese FTS fingerprint: %w", err)
\t\t}
\t\tif _, err := tx.ExecContext(
\t\t\tctx, "DELETE FROM messages_chinese_fts_pending_sessions",
\t\t); err != nil {
\t\t\treturn fmt.Errorf("clearing Chinese FTS freshness ledger: %w", err)
\t\t}
\t}

\tif _, err := tx.ExecContext(ctx, schemaChineseFTSTriggers); err != nil {
''',
)

# Session-level TEMP triggers acknowledge only a fresh generation. If another
# writer already left generation 1 behind, the current write advances it to 2
# and cannot accidentally declare the index current.
replace_once(
    "internal/db/db.go",
    '''const schemaChineseFTSTriggers = `
CREATE TEMP TRIGGER IF NOT EXISTS messages_chinese_ai
AFTER INSERT ON main.messages BEGIN
    INSERT INTO messages_chinese_fts(rowid, content) VALUES (new.id, new.content);
END;
` + messagesChineseADTriggerDDL + `
CREATE TEMP TRIGGER IF NOT EXISTS messages_chinese_au
AFTER UPDATE ON main.messages BEGIN
    INSERT INTO messages_chinese_fts(messages_chinese_fts, rowid, content)
        VALUES('delete', old.id, old.content);
    INSERT INTO messages_chinese_fts(rowid, content) VALUES (new.id, new.content);
END;
`
''',
    '''const schemaChineseFTSTriggers = `
CREATE TEMP TRIGGER IF NOT EXISTS messages_chinese_ai
AFTER INSERT ON main.messages BEGIN
    INSERT INTO messages_chinese_fts(rowid, content) VALUES (new.id, new.content);
END;
` + messagesChineseADTriggerDDL + `
CREATE TEMP TRIGGER IF NOT EXISTS messages_chinese_au
AFTER UPDATE ON main.messages BEGIN
    INSERT INTO messages_chinese_fts(messages_chinese_fts, rowid, content)
        VALUES('delete', old.id, old.content);
    INSERT INTO messages_chinese_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TEMP TRIGGER IF NOT EXISTS sessions_chinese_pending_ai
AFTER INSERT ON main.sessions BEGIN
    DELETE FROM messages_chinese_fts_pending_sessions
    WHERE session_id = new.id AND generation = 1;
END;
CREATE TEMP TRIGGER IF NOT EXISTS sessions_chinese_pending_au
AFTER UPDATE OF transcript_revision ON main.sessions
WHEN old.transcript_revision IS NOT new.transcript_revision BEGIN
    DELETE FROM messages_chinese_fts_pending_sessions
    WHERE session_id = new.id AND generation = 1;
END;
CREATE TEMP TRIGGER IF NOT EXISTS sessions_chinese_pending_ad
AFTER DELETE ON main.sessions BEGIN
    DELETE FROM messages_chinese_fts_pending_sessions
    WHERE session_id = old.id AND generation = 1;
END;
`
''',
)

replace_once(
    "internal/db/db.go",
    '''\tvar storedFingerprint string
\tif err := db.getReader().QueryRow(
\t\t"SELECT CAST(value AS TEXT) FROM stats WHERE key = ?",
\t\tchineseFTSFingerprintStatsKey,
\t).Scan(&storedFingerprint); err != nil ||
\t\tstoredFingerprint != simpleFTSRuntimeConfig.fingerprint {
\t\treturn false
\t}
\t_, err := db.getReader().Exec(
''',
    '''\tvar storedFingerprint string
\tif err := db.getReader().QueryRow(
\t\t"SELECT CAST(value AS TEXT) FROM stats WHERE key = ?",
\t\tchineseFTSFingerprintStatsKey,
\t).Scan(&storedFingerprint); err != nil ||
\t\tstoredFingerprint != simpleFTSRuntimeConfig.fingerprint {
\t\treturn false
\t}
\tvar pendingSessions int
\tif err := db.getReader().QueryRow(
\t\t"SELECT count(*) FROM messages_chinese_fts_pending_sessions",
\t).Scan(&pendingSessions); err != nil || pendingSessions != 0 {
\t\treturn false
\t}
\t_, err := db.getReader().Exec(
''',
)

# Verify that a writer using the plain SQLite driver can mutate an archive,
# leaves a durable freshness record, and causes the next sidecar-enabled open
# to rebuild before serving Chinese results.
test_path = Path("internal/db/chinese_fts_test.go")
test_text = test_path.read_text()
legacy_test = r'''

func TestChineseFTSRebuildsAfterLegacyWriter(t *testing.T) {
	if !simpleFTSRuntimeConfig.available() {
		t.Skip("simple FTS5 runtime is not installed for this test process")
	}
	path := filepath.Join(t.TempDir(), "legacy-writer.db")
	d, err := Open(path)
	require.NoError(t, err)
	seedSearchSession(t, d, "legacy", "proj", [][2]string{
		{"user", "原始中文内容。"},
	})
	require.NoError(t, d.Close())

	raw, err := sql.Open("sqlite3", makeDSN(path, false))
	require.NoError(t, err)
	tx, err := raw.Begin()
	require.NoError(t, err)
	_, err = tx.Exec(
		"UPDATE messages SET content = ? WHERE session_id = ?",
		"旧版本写入的新内容可以在重开后检索。", "legacy",
	)
	require.NoError(t, err)
	_, err = tx.Exec(`
		UPDATE sessions
		SET transcript_revision = COALESCE(transcript_revision, 0) + 1
		WHERE id = ?`, "legacy")
	require.NoError(t, err)
	require.NoError(t, tx.Commit())

	var pending int
	require.NoError(t, raw.QueryRow(
		"SELECT count(*) FROM messages_chinese_fts_pending_sessions",
	).Scan(&pending))
	assert.Equal(t, 1, pending)
	require.NoError(t, raw.Close())

	d, err = Open(path)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, d.Close()) })
	page, err := d.SearchContent(context.Background(), ContentSearchFilter{
		Pattern: "旧版本写入",
		Mode:    "fts",
		Sources: []string{"messages"},
		Limit:   20,
	})
	require.NoError(t, err)
	require.NotEmpty(t, page.Matches)
	assert.Equal(t, "legacy", page.Matches[0].SessionID)

	require.NoError(t, d.getReader().QueryRow(
		"SELECT count(*) FROM messages_chinese_fts_pending_sessions",
	).Scan(&pending))
	assert.Zero(t, pending)
}
'''
if "func TestChineseFTSRebuildsAfterLegacyWriter" in test_text:
    raise RuntimeError("legacy-writer test already exists")
test_path.write_text(test_text.rstrip() + legacy_test + "\n")
