#!/usr/bin/env python3
# Apply the review fixes for PR #1491. Removed by the temporary workflow.

from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one replacement target, found {count}")
    file_path.write_text(text.replace(old, new, 1))


Path("internal/db/chinese_fts_runtime.go").write_text(r'''package db

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
)

const simpleFTSDirEnv = "AGENTSVIEW_SIMPLE_DIR"

const (
	chineseFTSFingerprintStatsKey = "messages_chinese_fts_fingerprint_v1"
	chineseFTSSchemaVersion       = "messages-chinese-fts-v2"
)

var (
	simpleFTSRuntimeConfig, simpleFTSRuntimeErr = discoverSimpleFTSRuntime()
)

type simpleFTSRuntime struct {
	libraryPath    string
	dictionaryPath string
	fingerprint    string
}

func (c simpleFTSRuntime) available() bool {
	return c.libraryPath != "" && c.dictionaryPath != "" && c.fingerprint != ""
}

func checkSimpleFTSRuntimeConfig() error {
	return simpleFTSRuntimeErr
}

func discoverSimpleFTSRuntime() (simpleFTSRuntime, error) {
	executablePath, err := os.Executable()
	if err != nil {
		executablePath = ""
	}
	return discoverSimpleFTSRuntimeFrom(executablePath, os.Getenv(simpleFTSDirEnv), runtime.GOOS)
}

func discoverSimpleFTSRuntimeFrom(
	executablePath, explicitDir, goos string,
) (simpleFTSRuntime, error) {
	libraryName, err := simpleFTSLibraryName(goos)
	if err != nil {
		if explicitDir != "" {
			return simpleFTSRuntime{}, err
		}
		// The sidecar is optional. Unsupported platforms retain the standard
		// FTS path unless the user explicitly requested a sidecar directory.
		return simpleFTSRuntime{}, nil
	}

	if explicitDir != "" {
		config, err := validateSimpleFTSRuntime(explicitDir, libraryName)
		if err != nil {
			return simpleFTSRuntime{}, fmt.Errorf(
				"invalid %s: %w", simpleFTSDirEnv, err,
			)
		}
		return config, nil
	}

	var candidates []string
	if executablePath != "" {
		executableDir := filepath.Dir(executablePath)
		candidates = append(candidates,
			filepath.Join(executableDir, "agentsview-simple"),
			filepath.Clean(filepath.Join(
				executableDir, "..", "lib", "agentsview", "simple",
			)),
		)
	}
	for _, candidate := range candidates {
		info, err := os.Stat(candidate)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return simpleFTSRuntime{}, fmt.Errorf(
				"checking bundled simple FTS directory %s: %w", candidate, err,
			)
		}
		if !info.IsDir() {
			return simpleFTSRuntime{}, fmt.Errorf(
				"bundled simple FTS path is not a directory: %s", candidate,
			)
		}
		config, err := validateSimpleFTSRuntime(candidate, libraryName)
		if err != nil {
			return simpleFTSRuntime{}, fmt.Errorf(
				"invalid bundled simple FTS directory %s: %w", candidate, err,
			)
		}
		return config, nil
	}
	return simpleFTSRuntime{}, nil
}

func validateSimpleFTSRuntime(
	dir, libraryName string,
) (simpleFTSRuntime, error) {
	libraryPath := filepath.Join(dir, libraryName)
	if err := requireRegularFile(libraryPath); err != nil {
		return simpleFTSRuntime{}, fmt.Errorf("simple extension: %w", err)
	}
	dictionaryPath := filepath.Join(dir, "dict")
	for _, name := range simpleFTSDictionaryFiles {
		if err := requireRegularFile(filepath.Join(dictionaryPath, name)); err != nil {
			return simpleFTSRuntime{}, fmt.Errorf("cppjieba dictionary: %w", err)
		}
	}
	fingerprint, err := fingerprintSimpleFTSRuntime(libraryPath, dictionaryPath)
	if err != nil {
		return simpleFTSRuntime{}, err
	}
	return simpleFTSRuntime{
		libraryPath:    libraryPath,
		dictionaryPath: dictionaryPath,
		fingerprint:    fingerprint,
	}, nil
}

var simpleFTSDictionaryFiles = []string{
	"hmm_model.utf8",
	"idf.utf8",
	"jieba.dict.utf8",
	"stop_words.utf8",
	"user.dict.utf8",
}

func fingerprintSimpleFTSRuntime(
	libraryPath, dictionaryPath string,
) (string, error) {
	h := sha256.New()
	_, _ = io.WriteString(h, chineseFTSSchemaVersion+"\n")

	type fingerprintFile struct {
		name string
		path string
	}
	files := []fingerprintFile{{
		name: filepath.Base(libraryPath),
		path: libraryPath,
	}}
	for _, name := range simpleFTSDictionaryFiles {
		files = append(files, fingerprintFile{
			name: name,
			path: filepath.Join(dictionaryPath, name),
		})
	}
	for _, item := range files {
		_, _ = io.WriteString(h, item.name+"\x00")
		file, err := os.Open(item.path)
		if err != nil {
			return "", fmt.Errorf(
				"opening simple FTS fingerprint input %s: %w", item.path, err,
			)
		}
		_, copyErr := io.Copy(h, file)
		closeErr := file.Close()
		if copyErr != nil {
			return "", fmt.Errorf(
				"hashing simple FTS fingerprint input %s: %w", item.path, copyErr,
			)
		}
		if closeErr != nil {
			return "", fmt.Errorf(
				"closing simple FTS fingerprint input %s: %w", item.path, closeErr,
			)
		}
		_, _ = io.WriteString(h, "\x00")
	}
	return fmt.Sprintf("%s:%x", chineseFTSSchemaVersion, h.Sum(nil)), nil
}

func simpleFTSLibraryName(goos string) (string, error) {
	switch goos {
	case "linux":
		return "libsimple.so", nil
	case "darwin":
		return "libsimple.dylib", nil
	case "windows":
		return "simple.dll", nil
	default:
		return "", fmt.Errorf("simple FTS is unsupported on %s", goos)
	}
}

func requireRegularFile(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("%s is not a regular file", path)
	}
	return nil
}

type chineseFTSTransactor interface {
	BeginTx(context.Context, *sql.TxOptions) (*sql.Tx, error)
}

// ensureChineseFTS atomically reconciles the derived Chinese index with the
// loaded extension and dictionaries. The table, complete backfill, fingerprint,
// and connection-local maintenance triggers become visible together.
func ensureChineseFTS(
	ctx context.Context, conn chineseFTSTransactor, forceRebuild bool,
) error {
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("beginning Chinese FTS transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	for _, trigger := range []string{
		"messages_chinese_ai",
		"messages_chinese_ad",
		"messages_chinese_au",
	} {
		if _, err := tx.ExecContext(ctx, "DROP TRIGGER IF EXISTS "+trigger); err != nil {
			return fmt.Errorf("dropping Chinese FTS trigger %s: %w", trigger, err)
		}
	}

	var tableExists bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM sqlite_master
			WHERE type = 'table' AND name = 'messages_chinese_fts'
		)`).Scan(&tableExists); err != nil {
		return fmt.Errorf("checking Chinese FTS table: %w", err)
	}

	if !simpleFTSRuntimeConfig.available() {
		if tableExists {
			if _, err := tx.ExecContext(ctx, "DROP TABLE messages_chinese_fts"); err != nil {
				return fmt.Errorf("dropping unavailable Chinese FTS: %w", err)
			}
		}
		if _, err := tx.ExecContext(
			ctx, "DELETE FROM stats WHERE key = ?", chineseFTSFingerprintStatsKey,
		); err != nil {
			return fmt.Errorf("clearing Chinese FTS fingerprint: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("committing Chinese FTS removal: %w", err)
		}
		return nil
	}

	var storedFingerprint string
	fingerprintErr := tx.QueryRowContext(ctx,
		"SELECT CAST(value AS TEXT) FROM stats WHERE key = ?",
		chineseFTSFingerprintStatsKey,
	).Scan(&storedFingerprint)
	if fingerprintErr != nil && !errors.Is(fingerprintErr, sql.ErrNoRows) {
		return fmt.Errorf("reading Chinese FTS fingerprint: %w", fingerprintErr)
	}
	current := tableExists && fingerprintErr == nil &&
		storedFingerprint == simpleFTSRuntimeConfig.fingerprint

	if forceRebuild || !current {
		if tableExists {
			if _, err := tx.ExecContext(ctx, "DROP TABLE messages_chinese_fts"); err != nil {
				return fmt.Errorf("dropping stale Chinese FTS: %w", err)
			}
		}
		if _, err := tx.ExecContext(ctx, schemaChineseFTS); err != nil {
			return fmt.Errorf("creating Chinese FTS: %w", err)
		}
		if _, err := tx.ExecContext(ctx,
			"INSERT INTO messages_chinese_fts(messages_chinese_fts) VALUES('rebuild')",
		); err != nil {
			return fmt.Errorf("backfilling Chinese FTS: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO stats (key, value) VALUES (?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
			chineseFTSFingerprintStatsKey,
			simpleFTSRuntimeConfig.fingerprint,
		); err != nil {
			return fmt.Errorf("storing Chinese FTS fingerprint: %w", err)
		}
	}

	if _, err := tx.ExecContext(ctx, schemaChineseFTSTriggers); err != nil {
		return fmt.Errorf("installing Chinese FTS triggers: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("committing Chinese FTS transaction: %w", err)
	}
	return nil
}

func installChineseFTSTriggers(conn *sql.DB) error {
	return ensureChineseFTS(context.Background(), conn, false)
}
''')

Path("internal/db/chinese_fts_search.go").write_text(r'''package db

import (
	"context"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

type messageFTSQuery struct {
	table string
	match string
	plain string
}

func (db *DB) prepareMessageFTSQuery(
	ctx context.Context, raw string,
) (messageFTSQuery, error) {
	trimmed := strings.TrimSpace(raw)
	prepared := PrepareFTSQuery(trimmed)
	query := messageFTSQuery{
		table: "messages_fts",
		match: prepared,
		plain: StripFTSQuotes(prepared),
	}
	if prepared == "" || !containsCJK(trimmed) || !db.HasChineseFTS() {
		return query, nil
	}

	query.table = "messages_chinese_fts"
	if strings.HasPrefix(trimmed, `"`) {
		// A leading quote is the established opt-in for an explicit FTS5
		// expression. Preserve phrases, operators, and grouping verbatim.
		query.match = prepared
		return query, nil
	}

	if err := db.getReader().QueryRowContext(
		ctx, "SELECT jieba_query(?)", trimmed,
	).Scan(&query.match); err != nil {
		return messageFTSQuery{}, fmt.Errorf(
			"preparing Chinese FTS query: %w", err,
		)
	}
	if strings.TrimSpace(query.match) == "" {
		return messageFTSQuery{}, &SearchInputError{
			Msg: "search: Chinese FTS query is empty after tokenization",
		}
	}
	return query, nil
}

func containsCJK(text string) bool {
	for len(text) > 0 {
		r, size := utf8.DecodeRuneInString(text)
		if r == utf8.RuneError && size == 1 {
			text = text[1:]
			continue
		}
		if unicode.In(r,
			unicode.Han,
			unicode.Hangul,
			unicode.Hiragana,
			unicode.Katakana,
		) {
			return true
		}
		text = text[size:]
	}
	return false
}
''')

Path("internal/db/sqlite_driver.go").write_text(r'''package db

import (
	"database/sql"
	"database/sql/driver"
	"fmt"
	"sync"

	"github.com/mattn/go-sqlite3"
)

const (
	sqliteUsageDriverName   = "agentsview_sqlite3"
	sqliteArchiveDriverName = "agentsview_archive_sqlite3"
)

var simpleFTSDictionaryMu sync.Mutex

func init() {
	sql.Register(sqliteUsageDriverName, &sqlite3.SQLiteDriver{
		ConnectHook: configureSQLiteConnection,
	})
	drv := &sqlite3.SQLiteDriver{ConnectHook: configureArchiveSQLiteConnection}
	if simpleFTSRuntimeConfig.available() {
		drv.Extensions = []string{simpleFTSRuntimeConfig.libraryPath}
	}
	sql.Register(sqliteArchiveDriverName, drv)
}

func configureSQLiteConnection(conn *sqlite3.SQLiteConn) error {
	if err := conn.RegisterFunc(
		"agentsview_timestamp_unix_micro",
		sqliteTimestampUnixMicro,
		true,
	); err != nil {
		return err
	}
	if err := conn.RegisterFunc(
		"agentsview_usage_output_tokens",
		sqliteUsageOutputTokens,
		true,
	); err != nil {
		return err
	}
	if err := conn.RegisterFunc(
		"agentsview_usage_web_search_requests",
		parseUsageWebSearchRequests,
		true,
	); err != nil {
		return err
	}
	return nil
}

func configureArchiveSQLiteConnection(conn *sqlite3.SQLiteConn) error {
	if err := configureSQLiteConnection(conn); err != nil {
		return err
	}
	if !simpleFTSRuntimeConfig.available() {
		return nil
	}
	// The extension stores the dictionary path in module-global state. SQLite
	// can unload and reload an extension when every archive connection closes,
	// so configure each connection while serializing the shared assignment.
	simpleFTSDictionaryMu.Lock()
	defer simpleFTSDictionaryMu.Unlock()
	if _, err := conn.Exec(
		"SELECT jieba_dict(?)",
		[]driver.Value{simpleFTSRuntimeConfig.dictionaryPath},
	); err != nil {
		return fmt.Errorf("configuring simple FTS5 dictionaries: %w", err)
	}
	return nil
}

func sqliteTimestampUnixMicro(raw string) any {
	t, ok := parseTimestamp(raw)
	if !ok {
		return nil
	}
	return t.UnixMicro()
}
''')

replace_once(
    "internal/db/db.go",
    '''\tif simpleFTSRuntimeConfig.available() {
\t\tif _, err := w.Exec(schemaChineseFTS); err != nil {
\t\t\treturn fmt.Errorf("recreate Chinese fts: %w", err)
\t\t}
\t\tif _, err := w.Exec(
\t\t\t"INSERT INTO messages_chinese_fts(messages_chinese_fts)" +
\t\t\t\t" VALUES('rebuild')",
\t\t); err != nil {
\t\t\treturn fmt.Errorf("rebuild Chinese fts index: %w", err)
\t\t}
\t\tif _, err := w.Exec(schemaChineseFTSTriggers); err != nil {
\t\t\treturn fmt.Errorf("recreate Chinese fts triggers: %w", err)
\t\t}
\t}
\treturn nil
''',
    '''\tif err := ensureChineseFTS(context.Background(), w, true); err != nil {
\t\treturn fmt.Errorf("rebuild Chinese fts index: %w", err)
\t}
\treturn nil
''',
)

replace_once(
    "internal/db/db.go",
    '''func (db *DB) HasChineseFTS() bool {
\tif !simpleFTSRuntimeConfig.available() {
\t\treturn false
\t}
\t_, err := db.getReader().Exec(
\t\t"SELECT 1 FROM messages_chinese_fts LIMIT 1",
\t)
\treturn err == nil
}
''',
    '''func (db *DB) HasChineseFTS() bool {
\tif !simpleFTSRuntimeConfig.available() {
\t\treturn false
\t}
\tvar storedFingerprint string
\tif err := db.getReader().QueryRow(
\t\t"SELECT CAST(value AS TEXT) FROM stats WHERE key = ?",
\t\tchineseFTSFingerprintStatsKey,
\t).Scan(&storedFingerprint); err != nil ||
\t\tstoredFingerprint != simpleFTSRuntimeConfig.fingerprint {
\t\treturn false
\t}
\t_, err := db.getReader().Exec(
\t\t"SELECT 1 FROM messages_chinese_fts LIMIT 1",
\t)
\treturn err == nil
}
''',
)

replace_once(
    "internal/db/db.go",
    '''\tvar chineseFTSCount int
\tif err := w.QueryRowContext(ctx,
\t\t"SELECT count(*) FROM sqlite_master"+
\t\t\t" WHERE type='table' AND name='messages_chinese_fts'",
\t).Scan(&chineseFTSCount); err != nil {
\t\treturn fmt.Errorf("checking Chinese FTS table: %w", err)
\t}
\thadChineseFTS := chineseFTSCount > 0
\tif !simpleFTSRuntimeConfig.available() {
\t\tif hadChineseFTS {
\t\t\t// The index is derived data. Dropping it keeps the archive writable
\t\t\t// when the optional sidecar is removed and guarantees a later
\t\t\t// sidecar-enabled open backfills instead of using a stale index.
\t\t\tif _, err := w.ExecContext(ctx,
\t\t\t\t"DROP TABLE messages_chinese_fts",
\t\t\t); err != nil {
\t\t\t\treturn fmt.Errorf("dropping unavailable Chinese FTS: %w", err)
\t\t\t}
\t\t}
\t} else {
\t\tif _, err := w.ExecContext(ctx, schemaChineseFTS); err != nil {
\t\t\treturn fmt.Errorf("initializing Chinese FTS: %w", err)
\t\t}
\t\tif !hadChineseFTS {
\t\t\tif _, err := w.ExecContext(ctx,
\t\t\t\t"INSERT INTO messages_chinese_fts(messages_chinese_fts)"+
\t\t\t\t\t" VALUES('rebuild')",
\t\t\t); err != nil {
\t\t\t\treturn fmt.Errorf("backfilling Chinese FTS: %w", err)
\t\t\t}
\t\t}
\t\tif _, err := w.ExecContext(ctx, schemaChineseFTSTriggers); err != nil {
\t\t\treturn fmt.Errorf("initializing Chinese FTS triggers: %w", err)
\t\t}
\t}
''',
    '''\tif err := ensureChineseFTS(ctx, w, false); err != nil {
\t\treturn fmt.Errorf("initializing Chinese FTS: %w", err)
\t}
''',
)

replace_once(
    "internal/db/db.go",
    '''\tfor _, s := range stmts {
\t\tif _, err := w.Exec(s); err != nil {
\t\t\treturn fmt.Errorf("drop fts (%s): %w", s, err)
\t\t}
\t}
\treturn nil
}

// RebuildFTS recreates''',
    '''\tfor _, s := range stmts {
\t\tif _, err := w.Exec(s); err != nil {
\t\t\treturn fmt.Errorf("drop fts (%s): %w", s, err)
\t\t}
\t}
\tif _, err := w.Exec(
\t\t"DELETE FROM stats WHERE key = ?", chineseFTSFingerprintStatsKey,
\t); err != nil {
\t\treturn fmt.Errorf("clearing Chinese fts fingerprint: %w", err)
\t}
\treturn nil
}

// RebuildFTS recreates''',
)

test_path = Path("internal/db/chinese_fts_test.go")
test_text = test_path.read_text()
old_test_text = test_text

test_text = test_text.replace(
    '''\tassert.Equal(t, dictDir, got.dictionaryPath)
}
''',
    '''\tassert.Equal(t, dictDir, got.dictionaryPath)
\tassert.NotEmpty(t, got.fingerprint)

\toriginalFingerprint := got.fingerprint
\trequire.NoError(t, os.WriteFile(
\t\tfilepath.Join(dictDir, "user.dict.utf8"), []byte("changed"), 0o600,
\t))
\tchanged, err := discoverSimpleFTSRuntimeFrom(
\t\tfilepath.Join(t.TempDir(), "agentsview"), dir, "linux",
\t)
\trequire.NoError(t, err)
\tassert.NotEqual(t, originalFingerprint, changed.fingerprint)
}

func TestDiscoverSimpleFTSRuntimeUnsupportedPlatformIsOptional(t *testing.T) {
\tgot, err := discoverSimpleFTSRuntimeFrom(
\t\tfilepath.Join(t.TempDir(), "agentsview"), "", "freebsd",
\t)
\trequire.NoError(t, err)
\tassert.False(t, got.available())

\t_, err = discoverSimpleFTSRuntimeFrom(
\t\tfilepath.Join(t.TempDir(), "agentsview"), t.TempDir(), "freebsd",
\t)
\trequire.Error(t, err)
}
''',
    1,
)

needle = '''\tordered, err := d.SearchContent(context.Background(), ContentSearchFilter{
\t\tPattern: "法国",
'''
insert = '''\tseedSearchSession(t, d, "separated", "proj", [][2]string{
\t\t{"user", "中文和搜索之间插入了额外内容。"},
\t})

\tandQuery, err := d.SearchContent(context.Background(), ContentSearchFilter{
\t\tPattern: "中文 搜索",
\t\tMode:    "fts",
\t\tSources: []string{"messages"},
\t\tLimit:   20,
\t})
\trequire.NoError(t, err)
\tandIDs := make(map[string]bool)
\tfor _, match := range andQuery.Matches {
\t\tandIDs[match.SessionID] = true
\t}
\tassert.True(t, andIDs["chinese"])
\tassert.True(t, andIDs["separated"])

\tphrase, err := d.SearchContent(context.Background(), ContentSearchFilter{
\t\tPattern: `"中文 搜索"`,
\t\tMode:    "fts",
\t\tSources: []string{"messages"},
\t\tLimit:   20,
\t})
\trequire.NoError(t, err)
\trequire.Len(t, phrase.Matches, 1)
\tassert.Equal(t, "chinese", phrase.Matches[0].SessionID)

\texpression, err := d.prepareMessageFTSQuery(
\t\tcontext.Background(), `"中文" OR "国法"`,
\t)
\trequire.NoError(t, err)
\tassert.Equal(t, `"中文" OR "国法"`, expression.match)

\torQuery, err := d.SearchContent(context.Background(), ContentSearchFilter{
\t\tPattern: `"中文" OR "国法"`,
\t\tMode:    "fts",
\t\tSources: []string{"messages"},
\t\tLimit:   20,
\t})
\trequire.NoError(t, err)
\torIDs := make(map[string]bool)
\tfor _, match := range orQuery.Matches {
\t\torIDs[match.SessionID] = true
\t}
\tassert.True(t, orIDs["chinese"])
\tassert.True(t, orIDs["reverse"])

\tordered, err := d.SearchContent(context.Background(), ContentSearchFilter{
\t\tPattern: "法国",
'''
if needle not in test_text:
    raise RuntimeError("internal/db/chinese_fts_test.go: query insertion target missing")
test_text = test_text.replace(needle, insert, 1)

needle = '''\trequire.NoError(t, d.CloseWriter())
\trequire.NoError(t, d.ReopenWriter())
'''
insert = '''\tvar storedFingerprint string
\trequire.NoError(t, d.getReader().QueryRow(
\t\t"SELECT CAST(value AS TEXT) FROM stats WHERE key = ?",
\t\tchineseFTSFingerprintStatsKey,
\t).Scan(&storedFingerprint))
\tassert.Equal(t, simpleFTSRuntimeConfig.fingerprint, storedFingerprint)

\t// Simulate a pre-fix partial build: the table exists without the atomic
\t// completion fingerprint. Reopen must replace and backfill it.
\t_, err = d.getWriter().Exec(`
\t\tDROP TRIGGER IF EXISTS messages_chinese_ai;
\t\tDROP TRIGGER IF EXISTS messages_chinese_ad;
\t\tDROP TRIGGER IF EXISTS messages_chinese_au;
\t\tDROP TABLE messages_chinese_fts;
\t\tCREATE VIRTUAL TABLE messages_chinese_fts USING fts5(
\t\t\tcontent,
\t\t\tcontent='messages',
\t\t\tcontent_rowid='id',
\t\t\ttokenize='simple'
\t\t);
\t\tDELETE FROM stats WHERE key = '` + chineseFTSFingerprintStatsKey + `'`)
\trequire.NoError(t, err)
\trequire.NoError(t, d.Reopen())
\trepaired, err := d.SearchContent(context.Background(), ContentSearchFilter{
\t\tPattern: "中文搜索",
\t\tMode:    "fts",
\t\tSources: []string{"messages"},
\t\tLimit:   20,
\t})
\trequire.NoError(t, err)
\trequire.NotEmpty(t, repaired.Matches)
\tassert.Equal(t, "chinese", repaired.Matches[0].SessionID)

\t_, err = d.getWriter().Exec(
\t\t"UPDATE stats SET value = 'stale' WHERE key = ?",
\t\tchineseFTSFingerprintStatsKey,
\t)
\trequire.NoError(t, err)
\tassert.False(t, d.HasChineseFTS())
\trequire.NoError(t, d.Reopen())
\tassert.True(t, d.HasChineseFTS())

\trequire.NoError(t, d.CloseWriter())
\trequire.NoError(t, d.ReopenWriter())
'''
if needle not in test_text:
    raise RuntimeError("internal/db/chinese_fts_test.go: repair insertion target missing")
test_text = test_text.replace(needle, insert, 1)

if test_text == old_test_text:
    raise RuntimeError("internal/db/chinese_fts_test.go: no changes applied")
test_path.write_text(test_text)
