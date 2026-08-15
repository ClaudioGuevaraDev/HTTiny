//go:build !windows

package httpexec

import (
	"errors"
	"syscall"
)

// Everywhere except Windows the stdlib constants are the real errno values, so the
// straightforward check is correct. See failure_windows.go for why Windows needs its
// own version.

func isConnectionRefused(err error) bool { return errors.Is(err, syscall.ECONNREFUSED) }

func isSyscallTimeout(err error) bool { return errors.Is(err, syscall.ETIMEDOUT) }
