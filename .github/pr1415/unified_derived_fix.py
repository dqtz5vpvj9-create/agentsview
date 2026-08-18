from __future__ import annotations

import os
import re
from pathlib import Path

root = Path(os.environ["TARGET"]).resolve()


def read(rel: str) -> str:
    return (root / rel).read_text()


def write(rel: str, text: str) -> None:
    (root / rel).write_text(text)


def balanced_body(text: str, brace: int) -> tuple[int, int]:
    depth = 0
    i = brace
    in_str = False
    raw = False
    rune = False
    esc = False
    line_comment = False
    block_comment = False
    while i < len(text):
        c = text[i]
        n = text[i + 1] if i + 1 < len(text) else ""
        if line_comment:
            if c == "\n":
                line_comment = False
            i += 1
            continue
        if block_comment:
            if c == "*" and n == "/":
                block_comment = False
                i += 2
                continue
            i += 1
            continue
        if in_str:
            if raw:
                if c == "`":
                    in_str = False
                    raw = False
            elif rune:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == "'":
                    in_str = False
                    rune = False
            else:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    in_str = False
            i += 1
            continue
        if c == "/" and n == "/":
            line_comment = True
            i += 2
            continue
        if c == "/" and n == "*":
            block_comment = True
            i += 2
            continue
        if c == '"':
            in_str = True
            i += 1
            continue
        if c == "`":
            in_str = True
            raw = True
            i += 1
            continue
        if c == "'":
            in_str = True
            rune = True
            i += 1
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return brace, i + 1
        i += 1
    raise RuntimeError("unbalanced Go body")


def split_args(value: str) -> list[str]:
    result: list[str] = []
    start = 0
    depth = 0
    in_str: str | None = None
    escaped = False
    for index, char in enumerate(value):
        if in_str is not None:
            if in_str != "`" and escaped:
                escaped = False
            elif in_str != "`" and char == "\\":
                escaped = True
            elif char == in_str:
                in_str = None
            continue
        if char in ('"', "'", "`"):
            in_str = char
            continue
        if char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
        elif char == "," and depth == 0:
            result.append(value[start:index].strip())
            start = index + 1
    tail = value[start:].strip()
    if tail:
        result.append(tail)
    return result


# Mutable compact-state maps must remain writable after omitempty JSON decode.
rel = "internal/signals/incremental.go"
text = read(rel)
old = "editLast := maps.Clone(s.EditLast)"
assert old in text
text = text.replace(old, "editLast := cloneMutableMap(s.EditLast)", 1)
if "func cloneMutableMap[" not in text:
    marker = "func (s *IncrementalState) FoldToolHealth("
    index = text.index(marker)
    helper = """func cloneMutableMap[K comparable, V any](in map[K]V) map[K]V {
\tout := maps.Clone(in)
\tif out == nil {
\t\tout = make(map[K]V)
\t}
\treturn out
}

"""
    text = text[:index] + helper + text[index:]
write(rel, text)

rel = "internal/sync/signal_maintain.go"
text = read(rel)
match = re.search(r"func cloneCounts\(in map\[string\]int\) map\[string\]int \{", text)
assert match
_, end = balanced_body(text, text.index("{", match.start()))
replacement = """func cloneCounts(in map[string]int) map[string]int {
\tout := maps.Clone(in)
\tif out == nil {
\t\tout = make(map[string]int)
\t}
\treturn out
}"""
text = text[: match.start()] + replacement + text[end:]
write(rel, text)

# A readable parent with no turn IDs is still unresolved and must stay retryable.
rel = "internal/parser/codex.go"
text = read(rel)
old = """\tif parentID != \"\" && b.resolveParentTurns != nil {
\t\tb.parentTurnIDs, resolved = b.resolveParentTurns(parentID)
\t}
\tb.forkGate.armFromMeta(payload, resolved)"""
assert old in text
new = """\tif parentID != \"\" && b.resolveParentTurns != nil {
\t\tb.parentTurnIDs, resolved = b.resolveParentTurns(parentID)
\t\tresolved = resolved && len(b.parentTurnIDs) > 0
\t\tif !resolved {
\t\t\tb.parentTurnIDs = nil
\t\t}
\t}
\tb.forkGate.armFromMeta(payload, resolved)"""
text = text.replace(old, new, 1)
write(rel, text)

(root / "internal/parser/codex_parent_resolution_test.go").write_text(
    '''package parser

import (
\t"testing"

\t"github.com/stretchr/testify/require"
\t"github.com/tidwall/gjson"
)

func TestCodexForkGateKeepsReadableEmptyParentRetryable(t *testing.T) {
\tb := newCodexSessionBuilder(false, newCodexSeedSink())
\tb.resolveParentTurns = func(string) (map[string]struct{}, bool) {
\t\treturn map[string]struct{}{}, true
\t}
\tb.armForkGate(gjson.Parse(`{"forked_from_id":"parent-thread"}`))

\trequire.False(t, b.forkGate.active)
\trequire.False(t, b.forkGate.resolvedOnce)
\trequire.Nil(t, b.parentTurnIDs)
\trequire.Contains(t, b.forkGate.retryReason(), "parent-thread")

\tdelayed := newCodexSessionBuilder(false, newCodexSeedSink())
\tdelayed.resolveParentTurns = func(string) (map[string]struct{}, bool) {
\t\treturn map[string]struct{}{"parent-turn": {}}, true
\t}
\tdelayed.armForkGate(gjson.Parse(`{"forked_from_id":"parent-thread"}`))

\trequire.True(t, delayed.forkGate.active)
\trequire.True(t, delayed.forkGate.resolvedOnce)
\trequire.Contains(t, delayed.parentTurnIDs, "parent-turn")
\trequire.Empty(t, delayed.forkGate.retryReason())
}
'''
)

# Identical staged content still needs metadata/rules-derived publication.
rel = "internal/db/staged_content.go"
text = read(rel)
needle = """\tif contentBefore == contentAfter {
\t\t// Keep the existing row identities, revision, export marker, and recall
\t\t// evidence. Only the machine-local checkpoint may need to advance.
\t\tif err := tx.Rollback(); err != nil {
\t\t\treturn err
\t\t}
\t\treturn commitStagedCheckpointOnly(
\t\t\tctx, conn, sessionID, cp, blobs,
\t\t)
\t}
\t// Summary resolution above recorded per-call content-failure
\t// verdicts; fold them into the final signal update and findings now,
\t// inside the same transaction as the rows they describe.
\tsignals, findings, err := signalsFn(contentFailureVerdicts(staged))
\tif err != nil {
\t\treturn fmt.Errorf(
\t\t\t\"computing staged signals for %s: %w\", sessionID, err,
\t\t)
\t}
"""
assert needle in text
replacement = """\t// Summary resolution above recorded per-call content-failure verdicts.
\t// Compute every derived value even when the normalized transcript is
\t// unchanged: metadata, detector rules, or a prior failed publication can
\t// make automation, signals, and findings stale independently of row bytes.
\tsignals, findings, err := signalsFn(contentFailureVerdicts(staged))
\tif err != nil {
\t\treturn fmt.Errorf(
\t\t\t\"computing staged signals for %s: %w\", sessionID, err,
\t\t)
\t}
\tif contentBefore == contentAfter {
\t\t// Keep parser-owned row identities and transcript revision stable, but
\t\t// publish all metadata-dependent derived state and the checkpoint.
\t\tif err := tx.Rollback(); err != nil {
\t\t\treturn err
\t\t}
\t\treturn commitStagedDerivedStateOnly(
\t\t\tctx, conn, sessionID, signals, findings, cp, blobs,
\t\t)
\t}
"""
text = text.replace(needle, replacement, 1)
match = re.search(r"func commitStagedCheckpointOnly\(", text)
assert match
_, end = balanced_body(text, text.index("{", match.start()))
helper = """func commitStagedDerivedStateOnly(
\tctx context.Context, conn *sql.Conn, sessionID string,
\tsignals SessionSignalUpdate, findings []SecretFinding,
\tcp *ParserCheckpoint, blobs *ParserCheckpointBlobs,
) error {
\ttx, err := conn.BeginTx(ctx, nil)
\tif err != nil {
\t\treturn err
\t}
\tdefer func() { _ = tx.Rollback() }()

\tif err := resetIncrementalMarkerTx(tx, sessionID); err != nil {
\t\treturn err
\t}
\tif err := updateSessionAutomationFromMessagesTx(tx, sessionID); err != nil {
\t\treturn err
\t}
\tif err := updateSessionSignalsTx(tx, sessionID, signals); err != nil {
\t\treturn err
\t}
\tif err := replaceSecretFindingsTx(
\t\ttx, sessionID, findings,
\t\tsignals.SecretLeakCount, signals.SecretsRulesVersion,
\t); err != nil {
\t\treturn err
\t}
\tif cp == nil || blobs == nil {
\t\tif err := deleteParserCheckpointTx(tx, sessionID); err != nil {
\t\t\treturn err
\t\t}
\t} else {
\t\tc := *cp
\t\tb := *blobs
\t\tc.SessionID = sessionID
\t\tb.SessionID = sessionID
\t\tif err := upsertParserCheckpointTx(tx, c, b); err != nil {
\t\t\treturn err
\t\t}
\t}
\treturn tx.Commit()
}"""
text = text[: match.start()] + helper + text[end:]
write(rel, text)

# Find the existing revision-conditional publication method and extend its
# guard to every session metadata field consumed by full signal computation.
rel = "internal/db/signal_maintenance.go"
text = read(rel)
method = None
for candidate in re.finditer(r"func \(db \*DB\) (\w+)\(", text):
    brace = text.find("{", candidate.start())
    if brace < 0:
        continue
    _, body_end = balanced_body(text, brace)
    body = text[candidate.start() : body_end]
    header = text[candidate.start() : brace]
    if (
        "transcript_revision" in body
        and "replaceSecretFindingsTx" in body
        and "upsertSessionSignalStateTx" in body
        and "(bool, error)" in header
    ):
        method = (candidate.group(1), candidate.start(), brace, body_end, body)
        break
assert method is not None, "conditional signal publisher not found"
name, start, brace, end, body = method
header = text[start:brace]
revision_match = re.search(
    r"\b(expected\w*[Rr]evision|\w*[Rr]evision)\b", header
)
assert revision_match is not None
revision_name = revision_match.group(1)
new_header = header
grouped = re.compile(r"(\b\w+)\s*,\s*" + re.escape(revision_name) + r"\s+string")
if grouped.search(new_header):
    new_header = grouped.sub(
        r"\1 string, expected SignalInputSnapshot", new_header, count=1
    )
else:
    new_header = re.sub(
        r"\b" + re.escape(revision_name) + r"\s+string",
        "expected SignalInputSnapshot",
        new_header,
        count=1,
    )
assert new_header != header
new_body = body[len(header) :]
new_body = re.sub(
    r"\b" + re.escape(revision_name) + r"\b",
    "expected.TranscriptRevision",
    new_body,
)
insert_marker = "\tif err := replaceSecretFindingsTx("
position = new_body.find(insert_marker)
if position < 0:
    insert_marker = "\tif err := updateSessionSignalsTx("
    position = new_body.find(insert_marker)
assert position >= 0
check = """\tinputsMatch, err := signalInputSnapshotMatchesTx(
\t\ttx, sessionID, expected,
\t)
\tif err != nil {
\t\treturn false, err
\t}
\tif !inputsMatch {
\t\treturn false, nil
\t}
"""
new_body = new_body[:position] + check + new_body[position:]
text = text[:start] + new_header + new_body + text[end:]
write(rel, text)

(root / "internal/db/signal_input_snapshot.go").write_text(
    '''package db

import (
\t"database/sql"
\t"fmt"
)

// SignalInputSnapshot is the complete session-row input consumed by full
// signal computation, paired with the transcript revision that identifies the
// message and tool snapshot.
type SignalInputSnapshot struct {
\tTranscriptRevision   string
\tMessageCount         int
\tIsAutomated          bool
\tEndedAt              string
\tHasEndedAt           bool
\tPeakContextTokens    int
\tHasPeakContextTokens bool
}

// SignalInputSnapshotFromSession captures signal-driving metadata loaded for
// one full recompute.
func SignalInputSnapshotFromSession(
\ts Session, transcriptRevision string,
) SignalInputSnapshot {
\tout := SignalInputSnapshot{
\t\tTranscriptRevision:   transcriptRevision,
\t\tMessageCount:         s.MessageCount,
\t\tIsAutomated:          s.IsAutomated,
\t\tPeakContextTokens:    s.PeakContextTokens,
\t\tHasPeakContextTokens: s.HasPeakContextTokens,
\t}
\tif s.EndedAt != nil {
\t\tout.EndedAt = *s.EndedAt
\t\tout.HasEndedAt = true
\t}
\treturn out
}

func signalInputSnapshotMatchesTx(
\ttx *sql.Tx, sessionID string, expected SignalInputSnapshot,
) (bool, error) {
\tvar revision, endedAt string
\tvar messageCount, isAutomated, hasEndedAt int
\tvar peakContextTokens, hasPeakContextTokens int
\terr := tx.QueryRow(`
\t\tSELECT transcript_revision, message_count, is_automated,
\t\t       COALESCE(ended_at, ''), ended_at IS NOT NULL,
\t\t       peak_context_tokens, has_peak_context_tokens
\t\tFROM sessions WHERE id = ?`, sessionID,
\t).Scan(
\t\t&revision, &messageCount, &isAutomated,
\t\t&endedAt, &hasEndedAt,
\t\t&peakContextTokens, &hasPeakContextTokens,
\t)
\tif err != nil {
\t\tif err == sql.ErrNoRows {
\t\t\treturn false, nil
\t\t}
\t\treturn false, fmt.Errorf(
\t\t\t"loading signal input snapshot %s: %w", sessionID, err,
\t\t)
\t}
\treturn revision == expected.TranscriptRevision &&
\t\tmessageCount == expected.MessageCount &&
\t\t(isAutomated != 0) == expected.IsAutomated &&
\t\tendedAt == expected.EndedAt &&
\t\t(hasEndedAt != 0) == expected.HasEndedAt &&
\t\tpeakContextTokens == expected.PeakContextTokens &&
\t\t(hasPeakContextTokens != 0) == expected.HasPeakContextTokens, nil
}
'''
)

# Pass the whole canonical input snapshot into the existing conditional
# publisher.
rel = "internal/sync/engine.go"
text = read(rel)
needle = "e.db." + name + "("
index = text.find(needle)
assert index >= 0, f"call {name} not found"
open_paren = text.find("(", index + len("e.db." + name))
depth = 0
close = None
in_str: str | None = None
escaped = False
for cursor in range(open_paren, len(text)):
    char = text[cursor]
    if in_str is not None:
        if in_str != "`" and escaped:
            escaped = False
        elif in_str != "`" and char == "\\":
            escaped = True
        elif char == in_str:
            in_str = None
        continue
    if char in ('"', "'", "`"):
        in_str = char
        continue
    if char == "(":
        depth += 1
    elif char == ")":
        depth -= 1
        if depth == 0:
            close = cursor
            break
assert close is not None
arguments = split_args(text[open_paren + 1 : close])
revision_index = next(
    (i for i, argument in enumerate(arguments) if re.search("revision", argument, re.I)),
    None,
)
assert revision_index is not None
function_start = text.rfind("\nfunc ", 0, index)
function_brace = text.find("{", function_start)
_, function_end = balanced_body(text, function_brace)
function_text = text[function_start:function_end]
session_match = (
    re.search(r"computeSignalsAndSecrets\(\*(\w+),", function_text)
    or re.search(r"computeSignalsFromMessages\(\*(\w+),", function_text)
    or re.search(r"\b(\w+)\s*,\s*err\s*:=\s*e\.db\.GetSession", function_text)
)
assert session_match is not None, "session snapshot variable not found"
session_var = session_match.group(1)
old_revision_argument = arguments[revision_index]
arguments[revision_index] = (
    f"db.SignalInputSnapshotFromSession(*{session_var}, {old_revision_argument})"
)
new_call = "e.db." + name + "(" + ", ".join(arguments) + ")"
text = text[:index] + new_call + text[close + 1 :]
write(rel, text)

# Regressions.
(root / "internal/signals/incremental_nil_maps_test.go").write_text(
    '''package signals

import (
\t"testing"

\t"github.com/stretchr/testify/require"
)

func TestIncrementalStateEmptyMapsRemainWritable(t *testing.T) {
\tvar state IncrementalState
\trequire.NoError(t, state.UnmarshalBinary([]byte(`{"codec_version":2}`)))

\tnext, _, ok := state.FoldToolHealth([]ToolCallRow{{
\t\tCategory:       "Edit",
\t\tInputJSON:      `{"file_path":"a.go"}`,
\t\tMessageOrdinal: 1,
\t}}, nil, ToolHealthRow{})
\trequire.True(t, ok)
\trequire.NotNil(t, next.EditLast)
\trequire.Contains(t, next.EditLast, "a.go")
}
'''
)

(root / "internal/sync/signal_nil_maps_test.go").write_text(
    '''package sync

import (
\t"testing"

\t"github.com/stretchr/testify/require"
)

func TestCloneCountsNilReturnsWritableMap(t *testing.T) {
\tcounts := cloneCounts(nil)
\tcounts["model"]++
\trequire.Equal(t, 1, counts["model"])
}
'''
)

(root / "internal/db/staged_metadata_republish_test.go").write_text(
    '''package db

import (
\t"context"
\t"database/sql"
\t"os"
\t"testing"

\t"github.com/stretchr/testify/require"
)

type metadataOnlyStagedResults struct{ path string }

func (s *metadataOnlyStagedResults) ResolveSummary(
\tcontext.Context, string,
) (string, int, error) {
\treturn "", 0, nil
}
func (s *metadataOnlyStagedResults) InsertEventsTx(
\tcontext.Context, *sql.Tx, string, map[string]StagedToolCallPosition,
) error {
\treturn nil
}
func (s *metadataOnlyStagedResults) Path() string { return s.path }
func (s *metadataOnlyStagedResults) Close() error { return nil }

func TestStagedIdenticalContentPublishesDerivedStateWithoutRevisionBump(
\tt *testing.T,
) {
\td := testDB(t)
\tinsertSession(t, d, "s1", "proj")
\tinsertMessages(t, d, Message{
\t\tSessionID: "s1", Ordinal: 0, Role: "assistant", Content: "done",
\t})
\t_, err := d.getWriter().Exec(`
\t\tUPDATE sessions SET transcript_revision = '7',
\t\t       last_write_incremental = 1, outcome = 'unknown',
\t\t       quality_signal_version = 0, secrets_rules_version = ''
\t\tWHERE id = 's1'`)
\trequire.NoError(t, err)

\tscratch, err := os.CreateTemp(t.TempDir(), "staged-*.db")
\trequire.NoError(t, err)
\trequire.NoError(t, scratch.Close())
\tstaged := &metadataOnlyStagedResults{path: scratch.Name()}
\tcalls := 0
\terr = d.ReplaceSessionContentStaged(
\t\tcontext.Background(), "s1", []Message{{
\t\t\tSessionID: "s1", Ordinal: 0, Role: "assistant", Content: "done",
\t\t}}, staged, nil,
\t\tfunc(map[string]bool) (SessionSignalUpdate, []SecretFinding, error) {
\t\t\tcalls++
\t\t\treturn SessionSignalUpdate{
\t\t\t\tOutcome: "success", OutcomeConfidence: "high",
\t\t\t\tSecretsRulesVersion: "rules-v2",
\t\t\t\tQualitySignals: QualitySignals{Version: CurrentQualitySignalVersion},
\t\t\t}, []SecretFinding{{
\t\t\t\tSessionID: "s1", RuleName: "test-rule",
\t\t\t\tConfidence: "definite", LocationKind: "message",
\t\t\t\tMessageOrdinal: 0, RulesVersion: "rules-v2",
\t\t\t}}, nil
\t\t},
\t)
\trequire.NoError(t, err)
\trequire.Equal(t, 1, calls)

\tvar revision, outcome, rules string
\tvar incremental, findingCount int
\trequire.NoError(t, d.Reader().QueryRow(`
\t\tSELECT transcript_revision, outcome, secrets_rules_version,
\t\t       last_write_incremental
\t\tFROM sessions WHERE id = 's1'`,
\t).Scan(&revision, &outcome, &rules, &incremental))
\trequire.Equal(t, "7", revision)
\trequire.Equal(t, "success", outcome)
\trequire.Equal(t, "rules-v2", rules)
\trequire.Zero(t, incremental)
\trequire.NoError(t, d.Reader().QueryRow(`
\t\tSELECT COUNT(*) FROM secret_findings WHERE session_id = 's1'`,
\t).Scan(&findingCount))
\trequire.Equal(t, 1, findingCount)
}
'''
)

(root / "internal/db/signal_input_snapshot_test.go").write_text(
    '''package db

import (
\t"context"
\t"testing"

\t"github.com/stretchr/testify/require"
)

func TestSignalInputSnapshotDetectsMetadataOnlyChange(t *testing.T) {
\td := testDB(t)
\tinsertSession(t, d, "s1", "proj")
\tsess, err := d.GetSession(context.Background(), "s1")
\trequire.NoError(t, err)
\trequire.NotNil(t, sess)
\tvar revision string
\trequire.NoError(t, d.Reader().QueryRow(
\t\t`SELECT transcript_revision FROM sessions WHERE id = 's1'`,
\t).Scan(&revision))
\texpected := SignalInputSnapshotFromSession(*sess, revision)

\t_, err = d.getWriter().Exec(`
\t\tUPDATE sessions SET ended_at = '2026-08-18T00:00:00Z'
\t\tWHERE id = 's1'`)
\trequire.NoError(t, err)
\ttx, err := d.getWriter().Begin()
\trequire.NoError(t, err)
\tdefer func() { _ = tx.Rollback() }()
\tmatches, err := signalInputSnapshotMatchesTx(tx, "s1", expected)
\trequire.NoError(t, err)
\trequire.False(t, matches)
}
'''
)

print(name)
