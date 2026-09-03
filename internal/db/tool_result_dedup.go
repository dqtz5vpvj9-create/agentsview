package db

import (
	"context"
	"strings"
)

// tool_calls.result_content is stored only for a call that has no result
// events. When a call has one or more tool_result_events rows, the archive
// keeps the events and derives the summary from them on every read with
// SummarizeToolResultEvents, the same function the parser runs at sync time.
//
// On a real archive the overwhelming majority of calls have a single event
// whose content is the summary byte for byte, so storing the summary too
// doubled roughly 40% of the file. Deriving for every call with events, not
// only single-event ones, keeps one representation: the column means "the
// result of a call that has no event rows" and nothing else.
// result_content_length still records the summary's size at write time.

// DedupToolCallResultSummary returns the result summary to persist for a call
// with the given result events: empty when events exist, the summary
// otherwise.
func DedupToolCallResultSummary(
	summary string, events []ToolResultEvent,
) string {
	if len(events) > 0 {
		return ""
	}
	return summary
}

// RestoreToolCallResultContent derives the summary for a loaded call that
// carries result events, so every consumer sees the same ResultContent the
// parser produced when the call was written.
func RestoreToolCallResultContent(tc *ToolCall) {
	if len(tc.ResultEvents) == 0 {
		return
	}
	tc.ResultContent = SummarizeToolResultEvents(tc.ResultEvents)
}

// RestoreMessageResultContent applies RestoreToolCallResultContent across a
// loaded message slice. Call it once the messages carry both their tool calls
// and their result events.
func RestoreMessageResultContent(msgs []Message) {
	for i := range msgs {
		for j := range msgs[i].ToolCalls {
			RestoreToolCallResultContent(&msgs[i].ToolCalls[j])
		}
	}
}

// SummarizeToolResultEvents renders the display summary for a call's result
// events: the latest content per agent in first-seen agent order, each
// prefixed with its agent id when more than one agent reported, followed by
// the last anonymous event. Whitespace-only events are skipped. A single
// event summarizes to its own content.
func SummarizeToolResultEvents(events []ToolResultEvent) string {
	if len(events) == 0 {
		return ""
	}
	type agentSummary struct {
		order   int
		content string
	}
	latestByAgent := map[string]agentSummary{}
	orderedAgents := make([]string, 0, len(events))
	lastAnon := ""
	allHaveAgentID := true
	for _, ev := range events {
		if strings.TrimSpace(ev.Content) == "" {
			continue
		}
		agentID := strings.TrimSpace(ev.AgentID)
		if agentID == "" {
			allHaveAgentID = false
			lastAnon = ev.Content
			continue
		}
		if _, ok := latestByAgent[agentID]; !ok {
			latestByAgent[agentID] = agentSummary{
				order:   len(orderedAgents),
				content: ev.Content,
			}
			orderedAgents = append(orderedAgents, agentID)
			continue
		}
		entry := latestByAgent[agentID]
		entry.content = ev.Content
		latestByAgent[agentID] = entry
	}
	if len(latestByAgent) <= 1 {
		if len(latestByAgent) == 1 {
			summary := latestByAgent[orderedAgents[0]].content
			if lastAnon != "" {
				return summary + "\n\n" + lastAnon
			}
			return summary
		}
		return lastAnon
	}
	parts := make([]string, 0, len(orderedAgents))
	for _, agentID := range orderedAgents {
		parts = append(parts, agentID+":\n"+latestByAgent[agentID].content)
	}
	if !allHaveAgentID && lastAnon != "" {
		parts = append(parts, lastAnon)
	}
	return strings.Join(parts, "\n\n")
}

// SummarizeToolResultEventsContext is SummarizeToolResultEvents for callers
// that thread a cancellation context through long parses.
func SummarizeToolResultEventsContext(
	ctx context.Context, events []ToolResultEvent,
) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	return SummarizeToolResultEvents(events), nil
}
