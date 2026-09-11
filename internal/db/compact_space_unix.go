//go:build !windows

package db

import (
	"os"

	"golang.org/x/sys/unix"
)

func filesystemFreeBytes(path string) (uint64, bool, error) {
	var stat unix.Statfs_t
	if err := unix.Statfs(path, &stat); err != nil {
		return 0, false, err
	}
	return stat.Bavail * uint64(stat.Bsize), true, nil
}

func sameFilesystem(first, second string) (bool, error) {
	var firstStat, secondStat unix.Stat_t
	if err := unix.Stat(first, &firstStat); err != nil {
		return false, err
	}
	if err := unix.Stat(second, &secondStat); err != nil {
		return false, err
	}
	return firstStat.Dev == secondStat.Dev, nil
}

func syncDirectory(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}
