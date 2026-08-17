//go:build !windows

package parser

import "os"

func sourceFileIdentityForPath(_ string, info os.FileInfo) (inode, device uint64) {
	return sourceFileIdentity(info)
}
