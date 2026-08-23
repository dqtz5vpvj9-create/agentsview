package db

import (
	"context"
	"fmt"
	"strings"
	"unicode"
)

type messageFTSQuery struct {
	table string
	match string
	plain string
}

func (db *DB) prepareMessageFTSQuery(
	ctx context.Context, raw string,
) (messageFTSQuery, error) {
	prepared := PrepareFTSQuery(raw)
	plain := StripFTSQuotes(prepared)
	query := messageFTSQuery{
		table: "messages_fts",
		match: prepared,
		plain: plain,
	}
	if plain == "" || !containsCJK(raw) || !db.HasChineseFTS() {
		return query, nil
	}
	if err := db.getReader().QueryRowContext(
		ctx, "SELECT jieba_query(?)", plain,
	).Scan(&query.match); err != nil {
		return messageFTSQuery{}, fmt.Errorf(
			"preparing Chinese FTS query: %w", err,
		)
	}
	query.table = "messages_chinese_fts"
	return query, nil
}

func containsCJK(value string) bool {
	return strings.IndexFunc(value, func(r rune) bool {
		return unicode.In(r,
			unicode.Han,
			unicode.Hangul,
			unicode.Hiragana,
			unicode.Katakana,
		)
	}) >= 0
}
