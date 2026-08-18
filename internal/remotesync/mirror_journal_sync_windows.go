//go:build windows

package remotesync

import (
	"errors"

	"golang.org/x/sys/windows"
)

func isMirrorJournalDirectorySyncUnsupported(err error) bool {
	return errors.Is(err, windows.ERROR_ACCESS_DENIED) ||
		errors.Is(err, windows.ERROR_INVALID_FUNCTION) ||
		errors.Is(err, windows.ERROR_INVALID_HANDLE) ||
		errors.Is(err, windows.ERROR_NOT_SUPPORTED)
}
