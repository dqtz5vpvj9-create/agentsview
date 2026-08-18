//go:build !aix && !darwin && !dragonfly && !freebsd && !illumos && !linux && !netbsd && !openbsd && !solaris && !windows

package remotesync

func isMirrorJournalDirectorySyncUnsupported(error) bool { return false }
