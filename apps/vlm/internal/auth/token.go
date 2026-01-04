package auth

import (
	"net/http"
	"strings"
)

// TokenValidator validates bearer tokens for API requests
type TokenValidator struct {
	token                    string
	requireTokenForInference bool
}

// NewTokenValidator creates a new token validator
func NewTokenValidator(token string, requireTokenForInference bool) *TokenValidator {
	return &TokenValidator{
		token:                    token,
		requireTokenForInference: requireTokenForInference,
	}
}

// ValidateRequest checks if the request has a valid bearer token
// Returns true if the request is authorized
func (v *TokenValidator) ValidateRequest(r *http.Request) bool {
	// If no token configured, allow all requests
	if v.token == "" {
		return true
	}

	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		return false
	}

	// Expect "Bearer <token>"
	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return false
	}

	return parts[1] == v.token
}

// RequiresAuth returns true if the given path requires authentication
func (v *TokenValidator) RequiresAuth(path string) bool {
	// /vlm/* control plane always requires auth
	if strings.HasPrefix(path, "/vlm/") {
		// Exception: health check is public
		if path == "/vlm/health" {
			return false
		}
		return true
	}

	// /v1/* inference endpoints depend on config
	if strings.HasPrefix(path, "/v1/") {
		return v.requireTokenForInference
	}

	// Everything else is public
	return false
}

// Middleware returns an HTTP middleware that enforces token authentication
func (v *TokenValidator) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if v.RequiresAuth(r.URL.Path) && !v.ValidateRequest(r) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"error":"unauthorized","code":"UNAUTHORIZED"}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// MiddlewareFunc returns the middleware as a HandlerFunc for use with Gin
func (v *TokenValidator) MiddlewareFunc() func(http.Handler) http.Handler {
	return v.Middleware
}
