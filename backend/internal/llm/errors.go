package llm

import (
	"errors"
	"fmt"
	"strings"
)

// Common errors returned by backends.
var (
	// ErrBackendUnavailable indicates the backend is not reachable.
	ErrBackendUnavailable = errors.New("backend unavailable")
	// ErrModelNotFound indicates the requested model does not exist.
	ErrModelNotFound = errors.New("model not found")
	// ErrNotSupported indicates the operation is not supported by the backend.
	ErrNotSupported = errors.New("operation not supported")
	// ErrAuthentication indicates invalid or missing credentials.
	ErrAuthentication = errors.New("authentication failed")
	// ErrRateLimited indicates the request was rate limited.
	ErrRateLimited = errors.New("rate limited")
	// ErrContextCanceled indicates the operation was canceled via context.
	ErrContextCanceled = errors.New("context canceled")
)

// ErrorCategory classifies errors for appropriate handling and user messaging.
type ErrorCategory string

const (
	// ErrCategoryLoadFailure indicates model loading failed (bad GGUF, wrong arch).
	ErrCategoryLoadFailure ErrorCategory = "load_failure"
	// ErrCategoryVRAM indicates GPU memory issues (OOM, KV cache too large).
	ErrCategoryVRAM ErrorCategory = "vram_oom"
	// ErrCategoryBackendInit indicates backend initialization failed (Vulkan issues).
	ErrCategoryBackendInit ErrorCategory = "backend_init"
	// ErrCategoryRuntime indicates a runtime crash (sidecar died).
	ErrCategoryRuntime ErrorCategory = "runtime_crash"
	// ErrCategoryNetwork indicates network/connection issues.
	ErrCategoryNetwork ErrorCategory = "network"
	// ErrCategoryAuth indicates authentication/authorization issues.
	ErrCategoryAuth ErrorCategory = "auth"
	// ErrCategoryRateLimit indicates rate limiting.
	ErrCategoryRateLimit ErrorCategory = "rate_limit"
	// ErrCategoryValidation indicates invalid request parameters.
	ErrCategoryValidation ErrorCategory = "validation"
	// ErrCategoryUnknown indicates an unclassified error.
	ErrCategoryUnknown ErrorCategory = "unknown"
)

// ErrorContext provides debugging information for errors.
type ErrorContext struct {
	// EngineVersion is the backend/engine version.
	EngineVersion string `json:"engine_version,omitempty"`
	// ModelID is the model that was being used.
	ModelID string `json:"model_id,omitempty"`
	// FlagsUsed are the command-line flags or options used.
	FlagsUsed []string `json:"flags_used,omitempty"`
	// StderrTail is the last N lines of stderr (for sidecar processes).
	StderrTail string `json:"stderr_tail,omitempty"`
	// RequestID is the request identifier if available.
	RequestID string `json:"request_id,omitempty"`
}

// BackendError wraps errors from backend operations with additional context.
type BackendError struct {
	// Backend is the type of backend that produced the error.
	Backend BackendType
	// Op is the operation that failed (e.g., "Chat", "ListModels").
	Op string
	// Err is the underlying error.
	Err error
	// HTTPCode is the HTTP status code, if applicable.
	HTTPCode int
	// Category classifies the error for handling.
	Category ErrorCategory
	// Suggestion is an actionable message for the user.
	Suggestion string
	// Context provides debugging information.
	Context *ErrorContext
}

// Error returns the error message.
func (e *BackendError) Error() string {
	base := fmt.Sprintf("%s %s: %v", e.Backend, e.Op, e.Err)
	if e.HTTPCode != 0 {
		base = fmt.Sprintf("%s (HTTP %d)", base, e.HTTPCode)
	}
	if e.Suggestion != "" {
		base = fmt.Sprintf("%s - %s", base, e.Suggestion)
	}
	return base
}

// Unwrap returns the underlying error for errors.Is and errors.As.
func (e *BackendError) Unwrap() error {
	return e.Err
}

// NewBackendError creates a new BackendError.
func NewBackendError(backend BackendType, op string, err error) *BackendError {
	return &BackendError{
		Backend: backend,
		Op:      op,
		Err:     err,
	}
}

// NewBackendErrorWithCode creates a new BackendError with an HTTP status code.
func NewBackendErrorWithCode(backend BackendType, op string, err error, httpCode int) *BackendError {
	return &BackendError{
		Backend:  backend,
		Op:       op,
		Err:      err,
		HTTPCode: httpCode,
	}
}

// NewCategorizedError creates a BackendError with category and suggestion.
func NewCategorizedError(backend BackendType, op string, err error, category ErrorCategory, suggestion string) *BackendError {
	return &BackendError{
		Backend:    backend,
		Op:         op,
		Err:        err,
		Category:   category,
		Suggestion: suggestion,
	}
}

// WithContext adds error context to a BackendError.
func (e *BackendError) WithContext(ctx *ErrorContext) *BackendError {
	e.Context = ctx
	return e
}

// ClassifyError attempts to categorize an error based on its message.
func ClassifyError(err error) ErrorCategory {
	if err == nil {
		return ErrCategoryUnknown
	}
	msg := strings.ToLower(err.Error())

	switch {
	case strings.Contains(msg, "out of memory") || strings.Contains(msg, "oom") || strings.Contains(msg, "vram"):
		return ErrCategoryVRAM
	case strings.Contains(msg, "failed to load") || strings.Contains(msg, "invalid model") || strings.Contains(msg, "gguf"):
		return ErrCategoryLoadFailure
	case strings.Contains(msg, "vulkan") || strings.Contains(msg, "cuda") || strings.Contains(msg, "backend init"):
		return ErrCategoryBackendInit
	case strings.Contains(msg, "connection") || strings.Contains(msg, "timeout") || strings.Contains(msg, "refused"):
		return ErrCategoryNetwork
	case strings.Contains(msg, "unauthorized") || strings.Contains(msg, "forbidden") || strings.Contains(msg, "401") || strings.Contains(msg, "403"):
		return ErrCategoryAuth
	case strings.Contains(msg, "rate limit") || strings.Contains(msg, "429"):
		return ErrCategoryRateLimit
	default:
		return ErrCategoryUnknown
	}
}

// IsBackendUnavailable checks if the error indicates a backend connectivity issue.
func IsBackendUnavailable(err error) bool {
	return errors.Is(err, ErrBackendUnavailable)
}

// IsModelNotFound checks if the error indicates a missing model.
func IsModelNotFound(err error) bool {
	return errors.Is(err, ErrModelNotFound)
}

// IsNotSupported checks if the error indicates an unsupported operation.
func IsNotSupported(err error) bool {
	return errors.Is(err, ErrNotSupported)
}

// IsRateLimited checks if the error indicates rate limiting.
func IsRateLimited(err error) bool {
	return errors.Is(err, ErrRateLimited)
}
