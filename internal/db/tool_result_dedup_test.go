package db

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestToolCallResultSummaryStorage pins both halves of the tool-result
// rule: the column is written only for a call with no result events, and a
// loaded call with events shows the summary derived from them. The loaded
// ResultContent must match what the parser produced at sync time.
func TestToolCallResultSummaryStorage(t *testing.T) {
	tests := []struct {
		name          string
		call          ToolCall
		wantStored    string
		wantStoredLen int
		wantLoaded    string
	}{
		{
			name: "single event summary is not stored",
			call: ToolCall{
				ToolName:            "Bash",
				Category:            "Bash",
				ToolUseID:           "call_one",
				ResultContent:       "total 4\ndrwxr-xr-x",
				ResultContentLength: len("total 4\ndrwxr-xr-x"),
				ResultEvents: []ToolResultEvent{{
					ToolUseID:     "call_one",
					Source:        "function_call_output",
					Status:        "completed",
					Content:       "total 4\ndrwxr-xr-x",
					ContentLength: len("total 4\ndrwxr-xr-x"),
				}},
			},
			wantStored:    "",
			wantStoredLen: len("total 4\ndrwxr-xr-x"),
			wantLoaded:    "total 4\ndrwxr-xr-x",
		},
		{
			name: "multi event summary is derived, not stored",
			call: ToolCall{
				ToolName:            "Task",
				Category:            "Task",
				ToolUseID:           "call_many",
				ResultContent:       "agent-1:\nfirst\n\nagent-2:\nsecond",
				ResultContentLength: len("agent-1:\nfirst\n\nagent-2:\nsecond"),
				ResultEvents: []ToolResultEvent{
					{
						ToolUseID:     "call_many",
						AgentID:       "agent-1",
						Source:        "subagent_notification",
						Status:        "completed",
						Content:       "first",
						ContentLength: len("first"),
						EventIndex:    0,
					},
					{
						ToolUseID:     "call_many",
						AgentID:       "agent-2",
						Source:        "subagent_notification",
						Status:        "completed",
						Content:       "second",
						ContentLength: len("second"),
						EventIndex:    1,
					},
				},
			},
			wantStored:    "",
			wantStoredLen: len("agent-1:\nfirst\n\nagent-2:\nsecond"),
			wantLoaded:    "agent-1:\nfirst\n\nagent-2:\nsecond",
		},
		{
			name: "stale summary over a single event is replaced on read",
			call: ToolCall{
				ToolName:            "Task",
				Category:            "Task",
				ToolUseID:           "call_diff",
				ResultContent:       "agent-1:\nonly",
				ResultContentLength: len("agent-1:\nonly"),
				ResultEvents: []ToolResultEvent{{
					ToolUseID:     "call_diff",
					AgentID:       "agent-1",
					Source:        "subagent_notification",
					Status:        "completed",
					Content:       "only",
					ContentLength: len("only"),
				}},
			},
			wantStored:    "",
			wantStoredLen: len("agent-1:\nonly"),
			wantLoaded:    "only",
		},
		{
			name: "call without events keeps its summary in the column",
			call: ToolCall{
				ToolName:            "Bash",
				Category:            "Bash",
				ToolUseID:           "call_plain",
				ResultContent:       "paired result",
				ResultContentLength: len("paired result"),
			},
			wantStored:    "paired result",
			wantStoredLen: len("paired result"),
			wantLoaded:    "paired result",
		},
		{
			name: "blocked category keeps its blanked shape",
			call: ToolCall{
				ToolName:            "Read",
				Category:            "Read",
				ToolUseID:           "call_blocked",
				ResultContent:       "",
				ResultContentLength: 4096,
				ResultEvents: []ToolResultEvent{{
					ToolUseID:     "call_blocked",
					Source:        "function_call_output",
					Status:        "completed",
					Content:       "",
					ContentLength: 4096,
				}},
			},
			wantStored:    "",
			wantStoredLen: 4096,
			wantLoaded:    "",
		},
		{
			name: "empty summary over a blank event stays empty",
			call: ToolCall{
				ToolName:            "Bash",
				Category:            "Bash",
				ToolUseID:           "call_blank",
				ResultContent:       "",
				ResultContentLength: 0,
				ResultEvents: []ToolResultEvent{{
					ToolUseID:     "call_blank",
					Source:        "function_call_output",
					Status:        "completed",
					Content:       "   ",
					ContentLength: 3,
				}},
			},
			wantStored:    "",
			wantStoredLen: 0,
			wantLoaded:    "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d := testDB(t)
			insertSession(t, d, "s-dedup", "proj")
			call := tt.call
			call.SessionID = "s-dedup"
			require.NoError(t, d.InsertMessages([]Message{{
				SessionID:  "s-dedup",
				Ordinal:    0,
				Role:       "assistant",
				Content:    "running a tool",
				HasToolUse: true,
				ToolCalls:  []ToolCall{call},
			}}))

			var stored string
			var storedLen int
			require.NoError(t, d.Reader().QueryRow(`
				SELECT COALESCE(result_content, ''),
				       COALESCE(result_content_length, 0)
				FROM tool_calls
				WHERE session_id = ? AND tool_use_id = ?`,
				"s-dedup", call.ToolUseID,
			).Scan(&stored, &storedLen))
			assert.Equal(t, tt.wantStored, stored, "stored result_content")
			assert.Equal(t, tt.wantStoredLen, storedLen,
				"stored result_content_length")

			msgs, err := d.GetMessages(
				context.Background(), "s-dedup", 0, 10, true,
			)
			require.NoError(t, err)
			require.Len(t, msgs, 1)
			require.Len(t, msgs[0].ToolCalls, 1)
			assert.Equal(t, tt.wantLoaded,
				msgs[0].ToolCalls[0].ResultContent,
				"loaded ToolCall.ResultContent")
			assert.Len(t, msgs[0].ToolCalls[0].ResultEvents,
				len(call.ResultEvents), "result events survive")
		})
	}
}

// TestSearchSessionFindsDedupedResultContent covers the in-session find bar,
// which reads the column in SQL instead of loading tool calls.
func TestSearchSessionFindsDedupedResultContent(t *testing.T) {
	d := testDB(t)
	insertSession(t, d, "s-find", "proj")
	require.NoError(t, d.InsertMessages([]Message{{
		SessionID:  "s-find",
		Ordinal:    0,
		Role:       "assistant",
		Content:    "running a tool",
		HasToolUse: true,
		ToolCalls: []ToolCall{{
			SessionID:           "s-find",
			ToolName:            "Bash",
			Category:            "Bash",
			ToolUseID:           "call_find",
			ResultContent:       "needle in the output",
			ResultContentLength: len("needle in the output"),
			ResultEvents: []ToolResultEvent{{
				ToolUseID:     "call_find",
				Source:        "function_call_output",
				Status:        "completed",
				Content:       "needle in the output",
				ContentLength: len("needle in the output"),
			}},
		}},
	}}))

	ordinals, err := d.SearchSession(context.Background(), "s-find", "needle")
	require.NoError(t, err)
	assert.Equal(t, []int{0}, ordinals)
}

func TestRestoreToolCallResultContent(t *testing.T) {
	tests := []struct {
		name string
		call ToolCall
		want string
	}{
		{
			name: "no events keeps the stored summary",
			call: ToolCall{ResultContent: "summary", ResultContentLength: 7},
			want: "summary",
		},
		{
			name: "single event derives its content",
			call: ToolCall{
				ResultContentLength: 5,
				ResultEvents:        []ToolResultEvent{{Content: "event"}},
			},
			want: "event",
		},
		{
			name: "events replace a stored summary",
			call: ToolCall{
				ResultContent:       "stale",
				ResultContentLength: 5,
				ResultEvents:        []ToolResultEvent{{Content: "event"}},
			},
			want: "event",
		},
		{
			name: "whitespace-only event derives empty",
			call: ToolCall{
				ResultEvents: []ToolResultEvent{{Content: "  "}},
			},
			want: "",
		},
		{
			name: "multiple agents are rendered in first-seen order",
			call: ToolCall{
				ResultContentLength: 5,
				ResultEvents: []ToolResultEvent{
					{AgentID: "b", Content: "one"},
					{AgentID: "a", Content: "two"},
					{AgentID: "b", Content: "three"},
				},
			},
			want: "b:\nthree\n\na:\ntwo",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			call := tt.call
			RestoreToolCallResultContent(&call)
			assert.Equal(t, tt.want, call.ResultContent)
		})
	}
}

// TestSubagentLinkKeepsDedupedSummary pins the incremental link path: a
// linked result for a call that already has a stored event must never
// re-inflate result_content, and the loaded call still shows the summary.
func TestSubagentLinkKeepsDedupedSummary(t *testing.T) {
	d := testDB(t)
	insertSession(t, d, "s-link", "proj")
	require.NoError(t, d.InsertMessages([]Message{{
		SessionID:  "s-link",
		Ordinal:    0,
		Role:       "assistant",
		Content:    "spawning an agent",
		HasToolUse: true,
		ToolCalls: []ToolCall{{
			SessionID:           "s-link",
			ToolName:            "Agent",
			Category:            "Task",
			ToolUseID:           "call_link",
			ResultContent:       "agent finished",
			ResultContentLength: len("agent finished"),
			// The event carries no ToolUseID of its own; the insert path
			// copies the call's id onto it, so the link path could find it
			// either way. The test pins the stored shape, not the key.
			ResultEvents: []ToolResultEvent{{
				Source:        "subagent_notification",
				Status:        "completed",
				Content:       "agent finished",
				ContentLength: len("agent finished"),
			}},
		}},
	}}))

	stored := func() (string, int) {
		var content string
		var length int
		require.NoError(t, d.Reader().QueryRow(`
			SELECT COALESCE(result_content, ''),
			       COALESCE(result_content_length, 0)
			FROM tool_calls WHERE session_id = ? AND tool_use_id = ?`,
			"s-link", "call_link",
		).Scan(&content, &length))
		return content, length
	}

	content, length := stored()
	require.Empty(t, content, "insert must dedup the single-event summary")
	require.Equal(t, len("agent finished"), length)

	link := func(result string) {
		require.NoError(t, d.WriteSessionIncremental("s-link", nil,
			IncrementalSessionUpdate{
				MsgCount:    1,
				NextOrdinal: 1,
				SubagentLinks: []ToolCallSubagentLink{{
					ToolUseID:         "call_link",
					SubagentSessionID: "agent-child",
					ResultContent:     result,
					ResultContentLen:  len(result),
					HasResult:         true,
				}},
			}))
	}

	link("agent finished")
	content, length = stored()
	assert.Empty(t, content, "link repeating the event must stay deduped")
	assert.Equal(t, len("agent finished"), length)

	msgs, err := d.GetMessages(context.Background(), "s-link", 0, 10, true)
	require.NoError(t, err)
	require.Len(t, msgs, 1)
	require.Len(t, msgs[0].ToolCalls, 1)
	assert.Equal(t, "agent finished", msgs[0].ToolCalls[0].ResultContent)
	assert.Equal(t, "agent-child", msgs[0].ToolCalls[0].SubagentSessionID)

	link("agent finished with a longer final report")
	content, length = stored()
	assert.Empty(t, content,
		"a call with events never stores a summary, whatever the link says")
	assert.Equal(t, len("agent finished with a longer final report"), length)
}
