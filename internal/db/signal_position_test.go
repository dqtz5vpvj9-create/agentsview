package db

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestToolCallsByPositionKeepsExactOccurrences(t *testing.T) {
	d := testDB(t)
	for _, sessionID := range []string{"s1", "s2"} {
		insertSession(t, d, sessionID, "project-a")
		for ordinal := range 2 {
			insertMessages(t, d, Message{
				SessionID: sessionID, Ordinal: ordinal, Role: "assistant", HasToolUse: true,
				ToolCalls: []ToolCall{
					{SessionID: sessionID, ToolName: "exec_command", Category: "Bash", ToolUseID: "reused", ResultContent: "first"},
					{SessionID: sessionID, ToolName: "exec_command", Category: "Bash", ToolUseID: "reused", ResultContent: "second"},
				},
			})
		}
	}
	tx, err := d.getWriter().Begin()
	require.NoError(t, err)
	defer func() { require.NoError(t, tx.Rollback()) }()
	q := signalTxQuery{tx: tx, sessionID: "s1"}
	facts, err := q.ToolCallsByPosition(t.Context(), []ToolCallPosition{
		{MessageOrdinal: 1, CallIndex: 0},
		{MessageOrdinal: 0, CallIndex: 1},
		{MessageOrdinal: 0, CallIndex: 1},
		{MessageOrdinal: 9, CallIndex: 0},
	})
	require.NoError(t, err)
	require.Len(t, facts, 2, "repeated positions and other sessions must not add facts")
	got := make(map[ToolCallPosition]string)
	for _, fact := range facts {
		got[ToolCallPosition{MessageOrdinal: fact.MessageOrdinal, CallIndex: fact.CallIndex}] = fact.ResultContent
	}
	assert.Equal(t, map[ToolCallPosition]string{
		{MessageOrdinal: 1, CallIndex: 0}: "first",
		{MessageOrdinal: 0, CallIndex: 1}: "second",
	}, got)
}
