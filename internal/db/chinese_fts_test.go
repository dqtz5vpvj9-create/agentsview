package db

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestContainsCJK(t *testing.T) {
	t.Parallel()
	assert.True(t, containsCJK("SQLite 中文搜索"))
	assert.True(t, containsCJK("日本語"))
	assert.True(t, containsCJK("한국어"))
	assert.False(t, containsCJK("get_views error-401"))
}

func TestDiscoverSimpleFTSRuntimeFrom(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(
		filepath.Join(dir, "libsimple.so"), []byte("library"), 0o600,
	))
	dictDir := filepath.Join(dir, "dict")
	require.NoError(t, os.Mkdir(dictDir, 0o700))
	for _, name := range []string{
		"hmm_model.utf8",
		"idf.utf8",
		"jieba.dict.utf8",
		"stop_words.utf8",
		"user.dict.utf8",
	} {
		require.NoError(t, os.WriteFile(
			filepath.Join(dictDir, name), []byte(name), 0o600,
		))
	}

	got, err := discoverSimpleFTSRuntimeFrom(
		filepath.Join(t.TempDir(), "agentsview"), dir, "linux",
	)
	require.NoError(t, err)
	assert.Equal(t, filepath.Join(dir, "libsimple.so"), got.libraryPath)
	assert.Equal(t, dictDir, got.dictionaryPath)
}

func TestDiscoverSimpleFTSRuntimeExplicitDirIsValidated(t *testing.T) {
	_, err := discoverSimpleFTSRuntimeFrom(
		filepath.Join(t.TempDir(), "agentsview"), t.TempDir(), "linux",
	)
	require.Error(t, err)
	assert.Contains(t, err.Error(), simpleFTSDirEnv)
}

func TestChineseFTSSearch(t *testing.T) {
	if !simpleFTSRuntimeConfig.available() {
		t.Skip("simple FTS5 runtime is not installed for this test process")
	}
	d := testDB(t)
	seedSearchSession(t, d, "chinese", "proj", [][2]string{
		{"user", "请验证这段长句中的中文搜索功能，并检查 SQLite 集成。"},
		{"assistant", "发现一个错误，随后修复。"},
	})
	seedSearchSession(t, d, "france", "proj", [][2]string{
		{"user", "法国的首都是巴黎。"},
	})
	seedSearchSession(t, d, "reverse", "proj", [][2]string{
		{"user", "这份材料讨论国法体系。"},
	})
	seedSearchSession(t, d, "english", "proj", [][2]string{
		{"user", "The runner is running get_views after error-401."},
	})

	for _, query := range []string{"中文搜索", "搜索", "错", "SQLite 中文搜索"} {
		page, err := d.SearchContent(context.Background(), ContentSearchFilter{
			Pattern: query,
			Mode:    "fts",
			Sources: []string{"messages"},
			Limit:   20,
		})
		require.NoError(t, err, "query %q", query)
		require.NotEmpty(t, page.Matches, "query %q", query)
		assert.Equal(t, "chinese", page.Matches[0].SessionID, "query %q", query)
	}

	ordered, err := d.SearchContent(context.Background(), ContentSearchFilter{
		Pattern: "法国",
		Mode:    "fts",
		Sources: []string{"messages"},
		Limit:   20,
	})
	require.NoError(t, err)
	require.Len(t, ordered.Matches, 1)
	assert.Equal(t, "france", ordered.Matches[0].SessionID)

	grouped, err := d.Search(context.Background(), SearchFilter{
		Query: "中文搜索",
		Limit: 20,
	})
	require.NoError(t, err)
	require.NotEmpty(t, grouped.Results)
	assert.Equal(t, "chinese", grouped.Results[0].SessionID)

	// ASCII-only queries continue through the existing Porter-tokenized index.
	english, err := d.SearchContent(context.Background(), ContentSearchFilter{
		Pattern: "run",
		Mode:    "fts",
		Sources: []string{"messages"},
		Limit:   20,
	})
	require.NoError(t, err)
	require.NotEmpty(t, english.Matches)
	assert.Equal(t, "english", english.Matches[0].SessionID)

	require.NoError(t, d.CloseWriter())
	require.NoError(t, d.ReopenWriter())
	seedSearchSession(t, d, "reopened", "proj", [][2]string{
		{"user", "重新打开写连接以后仍然可以搜索新增中文。"},
	})
	reopened, err := d.SearchContent(context.Background(), ContentSearchFilter{
		Pattern: "新增中文",
		Mode:    "fts",
		Sources: []string{"messages"},
		Limit:   20,
	})
	require.NoError(t, err)
	require.NotEmpty(t, reopened.Matches)
	assert.Equal(t, "reopened", reopened.Matches[0].SessionID)
}
