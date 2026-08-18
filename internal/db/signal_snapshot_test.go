package db

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestReplaceSessionSignalsIfRevisionRejectsStaleSnapshot(t *testing.T) {
	d := testDB(t)
	insertSession(t, d, "signal-race", "proj")

	sess, err := d.GetSessionFull(context.Background(), "signal-race")
	require.NoError(t, err)
	require.NotNil(t, sess)
	require.NotNil(t, sess.TranscriptRevision)
	currentRevision := *sess.TranscriptRevision
	initialOutcome := sess.Outcome

	update := SessionSignalUpdate{
		Outcome:             "completed",
		OutcomeConfidence:   "high",
		SecretLeakCount:     1,
		SecretsRulesVersion: "rules-v1",
		QualitySignals: QualitySignals{
			Version: CurrentQualitySignalVersion,
		},
	}
	finding := SecretFinding{
		RuleName:       "test-secret",
		Confidence:     "definite",
		LocationKind:   "message",
		MessageOrdinal: 0,
		MatchEnd:       4,
		RedactedMatch:  "****",
		RulesVersion:   "rules-v1",
	}
	state := SessionSignalState{
		State:         []byte("stale-state"),
		SignalVersion: CurrentQualitySignalVersion,
	}

	applied, err := d.ReplaceSessionSignalsIfRevision(
		"signal-race", currentRevision+"-stale", []SecretFinding{finding},
		update, state,
	)
	require.NoError(t, err)
	require.False(t, applied)

	afterReject, err := d.GetSessionFull(context.Background(), "signal-race")
	require.NoError(t, err)
	require.Equal(t, initialOutcome, afterReject.Outcome)
	_, ok, err := d.GetSessionSignalState("signal-race")
	require.NoError(t, err)
	require.False(t, ok)
	findings, err := d.SessionSecretFindings(context.Background(), "signal-race")
	require.NoError(t, err)
	require.Empty(t, findings)

	applied, err = d.ReplaceSessionSignalsIfRevision(
		"signal-race", currentRevision, []SecretFinding{finding}, update, state,
	)
	require.NoError(t, err)
	require.True(t, applied)

	afterApply, err := d.GetSessionFull(context.Background(), "signal-race")
	require.NoError(t, err)
	require.Equal(t, "completed", afterApply.Outcome)
	storedState, ok, err := d.GetSessionSignalState("signal-race")
	require.NoError(t, err)
	require.True(t, ok)
	require.Equal(t, currentRevision, storedState.TranscriptRevision)
	require.Equal(t, []byte("stale-state"), storedState.State)
	findings, err = d.SessionSecretFindings(context.Background(), "signal-race")
	require.NoError(t, err)
	require.Len(t, findings, 1)
}
