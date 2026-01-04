package proxy

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"time"
)

// Handler is a custom SSE-aware reverse proxy for llama-server.
// It properly handles streaming responses with per-chunk flushing.
type Handler struct {
	upstream   *Upstream
	httpClient *http.Client
	logger     *slog.Logger

	// Callbacks for pre/post request handling
	onNoUpstream   func(w http.ResponseWriter, r *http.Request)
	onUpstreamDown func(w http.ResponseWriter, r *http.Request, err error)
}

// NewHandler creates a new proxy handler.
func NewHandler(upstream *Upstream) *Handler {
	return &Handler{
		upstream: upstream,
		httpClient: &http.Client{
			// Long timeout for streaming completions
			Timeout: 10 * time.Minute,
			Transport: &http.Transport{
				// Disable compression to prevent buffering
				DisableCompression: true,
				// Connection pooling
				MaxIdleConns:        10,
				MaxIdleConnsPerHost: 10,
				IdleConnTimeout:     90 * time.Second,
			},
		},
		logger: slog.Default().With("component", "proxy"),
	}
}

// SetNoUpstreamHandler sets a callback for when no upstream is available.
func (h *Handler) SetNoUpstreamHandler(fn func(w http.ResponseWriter, r *http.Request)) {
	h.onNoUpstream = fn
}

// SetUpstreamDownHandler sets a callback for upstream connection errors.
func (h *Handler) SetUpstreamDownHandler(fn func(w http.ResponseWriter, r *http.Request, err error)) {
	h.onUpstreamDown = fn
}

// ServeHTTP proxies requests to the upstream llama-server with SSE support.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	upstreamURL := h.upstream.Get()
	if upstreamURL == "" {
		if h.onNoUpstream != nil {
			h.onNoUpstream(w, r)
		} else {
			http.Error(w, `{"error":"no upstream configured","code":"MODEL_NOT_SELECTED"}`, http.StatusConflict)
		}
		return
	}

	// Create upstream request with client's context
	// This ensures cancellation propagates when client disconnects
	ctx := r.Context()
	upstreamReq, err := http.NewRequestWithContext(ctx, r.Method, upstreamURL+r.URL.Path, r.Body)
	if err != nil {
		h.logger.Error("failed to create upstream request", "error", err)
		http.Error(w, `{"error":"internal error","code":"INTERNAL_ERROR"}`, http.StatusInternalServerError)
		return
	}

	// Copy headers (but not hop-by-hop headers)
	for key, values := range r.Header {
		if isHopByHop(key) {
			continue
		}
		for _, value := range values {
			upstreamReq.Header.Add(key, value)
		}
	}

	// Pass through request ID for tracing
	if reqID := r.Header.Get("X-Request-Id"); reqID != "" {
		upstreamReq.Header.Set("X-Request-Id", reqID)
	}

	// Make the upstream request
	resp, err := h.httpClient.Do(upstreamReq)
	if err != nil {
		// Check if it was cancelled by client
		if ctx.Err() != nil {
			h.logger.Debug("client disconnected", "error", ctx.Err())
			return
		}

		h.logger.Error("upstream request failed", "error", err)
		if h.onUpstreamDown != nil {
			h.onUpstreamDown(w, r, err)
		} else {
			http.Error(w, `{"error":"upstream unavailable","code":"UPSTREAM_UNAVAILABLE"}`, http.StatusBadGateway)
		}
		return
	}
	defer resp.Body.Close()

	// Copy response headers
	for key, values := range resp.Header {
		if isHopByHop(key) {
			continue
		}
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}

	// Disable buffering for SSE
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")

	// Write status code
	w.WriteHeader(resp.StatusCode)

	// Check if this is a streaming response
	contentType := resp.Header.Get("Content-Type")
	if isSSE(contentType) || isNDJSON(contentType) {
		h.streamResponse(ctx, w, resp.Body)
	} else {
		// Non-streaming: just copy
		io.Copy(w, resp.Body)
	}
}

// streamResponse handles SSE/NDJSON streaming with per-chunk flushing.
func (h *Handler) streamResponse(ctx context.Context, w http.ResponseWriter, body io.Reader) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		h.logger.Warn("response writer does not support flushing")
		io.Copy(w, body)
		return
	}

	// Read and forward chunks
	buf := make([]byte, 4096)
	for {
		select {
		case <-ctx.Done():
			h.logger.Debug("client disconnected during streaming")
			return
		default:
		}

		n, err := body.Read(buf)
		if n > 0 {
			if _, writeErr := w.Write(buf[:n]); writeErr != nil {
				h.logger.Debug("write error during streaming", "error", writeErr)
				return
			}
			flusher.Flush()
		}

		if err != nil {
			if err != io.EOF {
				h.logger.Debug("read error during streaming", "error", err)
			}
			return
		}
	}
}

// isSSE checks if content type indicates Server-Sent Events.
func isSSE(contentType string) bool {
	return contentType == "text/event-stream" ||
		contentType == "text/event-stream; charset=utf-8"
}

// isNDJSON checks if content type indicates newline-delimited JSON.
func isNDJSON(contentType string) bool {
	return contentType == "application/x-ndjson" ||
		contentType == "application/json-lines"
}

// isHopByHop returns true for hop-by-hop headers that shouldn't be forwarded.
func isHopByHop(header string) bool {
	switch header {
	case "Connection", "Keep-Alive", "Proxy-Authenticate",
		"Proxy-Authorization", "Te", "Trailers", "Transfer-Encoding", "Upgrade":
		return true
	}
	return false
}

// StreamingHandler returns an http.Handler that proxies to the given path.
func (h *Handler) StreamingHandler(path string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Override the path
		originalPath := r.URL.Path
		r.URL.Path = path
		h.ServeHTTP(w, r)
		r.URL.Path = originalPath
	}
}
