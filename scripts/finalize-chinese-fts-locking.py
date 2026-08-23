#!/usr/bin/env python3
# Avoid taking the Jieba state lock while database/sql may still open a new
# connection whose ConnectHook needs the write side of the same lock.

from pathlib import Path

path = Path("internal/db/chinese_fts_search.go")
text = path.read_text()
old = '''\tsimpleFTSDictionaryMu.RLock()
\terr := db.getReader().QueryRowContext(
\t\tctx, "SELECT jieba_query(?)", trimmed,
\t).Scan(&query.match)
\tsimpleFTSDictionaryMu.RUnlock()
\tif err != nil {
\t\treturn messageFTSQuery{}, fmt.Errorf(
\t\t\t"preparing Chinese FTS query: %w", err,
\t\t)
\t}
'''
new = '''\tconn, err := db.getReader().Conn(ctx)
\tif err != nil {
\t\treturn messageFTSQuery{}, fmt.Errorf(
\t\t\t"acquiring Chinese FTS query connection: %w", err,
\t\t)
\t}
\tdefer conn.Close()

\tsimpleFTSDictionaryMu.RLock()
\terr = conn.QueryRowContext(
\t\tctx, "SELECT jieba_query(?)", trimmed,
\t).Scan(&query.match)
\tsimpleFTSDictionaryMu.RUnlock()
\tif err != nil {
\t\treturn messageFTSQuery{}, fmt.Errorf(
\t\t\t"preparing Chinese FTS query: %w", err,
\t\t)
\t}
'''
if text.count(old) != 1:
    raise RuntimeError(
        "internal/db/chinese_fts_search.go: locking replacement target missing"
    )
path.write_text(text.replace(old, new, 1))
