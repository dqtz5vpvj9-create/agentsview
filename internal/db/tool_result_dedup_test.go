package db

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestToolCallResultSummaryStorage pins both halves of the tool-result
// dedup: what the archive stores for a call, and what a loaded call looks
// like to every consumer. The loaded ResultContent must match what the
// column held back when the summary was written twice.
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
			name: "multi event summary is stored",
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
			wantStored:    "agent-1:\nfirst\n\nagent-2:\nsecond",
			wantStoredLen: len("agent-1:\nfirst\n\nagent-2:\nsecond"),
			wantLoaded:    "agent-1:\nfirst\n\nagent-2:\nsecond",
		},
		{
			name: "single event summary that differs is stored",
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
			wantStored:    "agent-1:\nonly",
			wantStoredLen: len("agent-1:\nonly"),
			wantLoaded:    "agent-1:\nonly",
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
			name: "stored summary wins",
			call: ToolCall{
				ResultContent:       "summary",
				ResultContentLength: 7,
				ResultEvents:        []ToolResultEvent{{Content: "event"}},
			},
			want: "summary",
		},
		{
			name: "single event refills a cleared summary",
			call: ToolCall{
				ResultContentLength: 5,
				ResultEvents:        []ToolResultEvent{{Content: "event"}},
			},
			want: "event",
		},
		{
			name: "zero length is a genuinely empty summary",
			call: ToolCall{
				ResultEvents: []ToolResultEvent{{Content: "  "}},
			},
			want: "",
		},
		{
			name: "multiple events never refill",
			call: ToolCall{
				ResultContentLength: 5,
				ResultEvents: []ToolResultEvent{
					{Content: "a"}, {Content: "b"},
				},
			},
			want: "",
		},
		{
			name: "no events never refill",
			call: ToolCall{ResultContentLength: 5},
			want: "",
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
