package httpexec

import (
	"errors"
	"syscall"
)

// Winsock error numbers.
//
// On Windows, syscall.ECONNREFUSED and syscall.ETIMEDOUT are synthetic
// APPLICATION_ERROR constants (536870934 and friends) that the socket layer never
// produces, and syscall.Errno.Is only maps to ErrPermission/ErrExist/ErrNotExist/
// ErrUnsupported. A refused connection really arrives as Errno(10061), so
// `errors.Is(err, syscall.ECONNREFUSED)` is *always false here* — verified by
// dialling a closed port: the error carries 10061 while the constant is 536870934.
//
// Getting this wrong reports the single most common local-development failure
// ("nothing is listening on that port") as a generic unknown error, on the platform
// this app is developed on. golang.org/x/sys/windows declares these, but it is an
// indirect dependency and these are two constants.
const (
	wsaeConnRefused = syscall.Errno(10061)
	wsaeTimedOut    = syscall.Errno(10060)
)

func isConnectionRefused(err error) bool { return errors.Is(err, wsaeConnRefused) }

func isSyscallTimeout(err error) bool { return errors.Is(err, wsaeTimedOut) }
