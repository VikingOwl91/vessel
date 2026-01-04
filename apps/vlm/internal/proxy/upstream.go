package proxy

import (
	"sync/atomic"
)

// Upstream represents an atomic pointer to an upstream server URL.
// This allows safe swapping during model switches without lock contention.
type Upstream struct {
	url atomic.Value // stores string
}

// NewUpstream creates a new Upstream with the given initial URL.
func NewUpstream(url string) *Upstream {
	u := &Upstream{}
	u.url.Store(url)
	return u
}

// Get returns the current upstream URL.
func (u *Upstream) Get() string {
	v := u.url.Load()
	if v == nil {
		return ""
	}
	return v.(string)
}

// Set atomically updates the upstream URL.
func (u *Upstream) Set(url string) {
	u.url.Store(url)
}

// IsSet returns true if an upstream URL is configured.
func (u *Upstream) IsSet() bool {
	return u.Get() != ""
}
