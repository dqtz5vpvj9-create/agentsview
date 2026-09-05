//go:build windows

package parser

import (
	"os"
	"syscall"
)

func sourceFileIdentity(info os.FileInfo) (inode, device uint64) {
	return 0, 0
}

// sourceFileHandleIdentity returns the stable filesystem identity of an open
// file: the NTFS file index and volume serial number, the Windows analog of
// inode and device. os.FileInfo.Sys() does not carry these, so they must be
// read through the open handle. Zeros mean the identity is unavailable.
func sourceFileHandleIdentity(f *os.File) (id, volume uint64) {
	var info syscall.ByHandleFileInformation
	err := syscall.GetFileInformationByHandle(syscall.Handle(f.Fd()), &info)
	if err != nil {
		return 0, 0
	}
	return uint64(info.FileIndexHigh)<<32 | uint64(info.FileIndexLow),
		uint64(info.VolumeSerialNumber)
}
