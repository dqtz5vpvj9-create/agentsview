//go:build !windows

package db

import "os"

// replaceInstalledFile atomically installs source over target on Unix. Both
// paths are required to be on the same filesystem by the caller.
func replaceInstalledFile(source, target string) error {
	return os.Rename(source, target)
}
