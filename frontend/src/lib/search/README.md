# In-session find

Find searches the selected session's message text, thinking, skills, code,
tool inputs, outputs, and result history. Inline subagent transcripts remain
scoped to their own sessions. Counts come from message data, independently of
virtualized rows and disclosure state.

## Navigation

The index stays chronological. Newest-first changes message order only; each
message's blocks and occurrences retain their top-to-bottom reading order.
The cursor, result list, and overview rail use that same ordering. An initial
match is pinned before older history arrives, so loading earlier pages does
not change the selected occurrence. Explicit next/previous commands wrap at
the ends of the results.

Enter, Shift+Enter, F3, Shift+F3, and the platform find-next shortcuts operate on
the current input. A navigation request commits pending debounce text before
choosing its target. Result rows from the previous query cannot navigate while
a replacement query is pending. IME composition is allowed to confirm or cancel
candidates without invoking navigation or closing find.

## Presentation and recovery

Search temporarily reveals content hidden by presentation filters without
changing saved preferences. Only the current matching disclosure is opened
automatically. Native CSS highlights do not rewrite transcript text. Precise
reveal handles nested scrolling and the application's text-size/zoom settings.

Historical messages are loaded when find opens. If history remains incomplete
after a load attempt, the bar reports partial results and offers an explicit
retry. Failed loads do not cause an automatic request loop. Late results from a
previous session cannot change the current session's loading state.

## Regression coverage

`navigation.test.ts` covers ordering, stable tuples, opening anchors, and wrap
behavior. `find-input.test.ts` covers composition and event ownership.
`scroll-zoom.test.ts` covers viewport-to-layout coordinate conversion.
`inSessionSearch-regression.test.ts` covers store integration, pending queries,
implicit cursors, and history recovery. Existing session-find browser coverage
is in `frontend/e2e/session-find.spec.ts`.
