package api

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/vikingowl91/vessel/apps/vlm/internal/config"
	"github.com/vikingowl91/vessel/apps/vlm/internal/process"
	"github.com/vikingowl91/vessel/apps/vlm/internal/proxy"
	"github.com/vikingowl91/vessel/apps/vlm/internal/scheduler"
)

// InferenceAPI handles /v1/* OpenAI-compatible inference routes.
type InferenceAPI struct {
	cfg       *config.Config
	switcher  *process.Switcher
	scheduler *scheduler.Scheduler
	proxy     *proxy.Handler
	upstream  *proxy.Upstream
	logger    *slog.Logger
}

// NewInferenceAPI creates a new inference API handler.
func NewInferenceAPI(cfg *config.Config, switcher *process.Switcher, sched *scheduler.Scheduler, upstream *proxy.Upstream) *InferenceAPI {
	proxyHandler := proxy.NewHandler(upstream)

	// Set up error handlers
	proxyHandler.SetNoUpstreamHandler(func(w http.ResponseWriter, r *http.Request) {
		respondError(w, http.StatusConflict, "MODEL_NOT_SELECTED", "no model loaded, use /vlm/models/select first")
	})

	proxyHandler.SetUpstreamDownHandler(func(w http.ResponseWriter, r *http.Request, err error) {
		respondError(w, http.StatusBadGateway, "UPSTREAM_UNAVAILABLE", "llama-server is not responding")
	})

	return &InferenceAPI{
		cfg:       cfg,
		switcher:  switcher,
		scheduler: sched,
		proxy:     proxyHandler,
		upstream:  upstream,
		logger:    slog.Default().With("component", "inference-api"),
	}
}

// Register registers inference routes on the given mux.
func (i *InferenceAPI) Register(mux *http.ServeMux) {
	// Wrap proxy with scheduler and model-switching check
	handler := i.wrapHandler(i.proxy)

	// OpenAI-compatible routes
	mux.HandleFunc("POST /v1/chat/completions", handler)
	mux.HandleFunc("GET /v1/models", i.handleModels)
}

// wrapHandler adds middleware for scheduling and model switching checks.
func (i *InferenceAPI) wrapHandler(next http.Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Check if model is loaded
		if !i.switcher.HasActiveModel() {
			respondError(w, http.StatusConflict, "MODEL_NOT_SELECTED", "no model loaded, use /vlm/models/select first")
			return
		}

		// Check if switching is in progress
		if i.switcher.IsSwitching() {
			w.Header().Set("Retry-After", "5")
			respondError(w, http.StatusServiceUnavailable, "MODEL_SWITCHING", "model switch in progress, retry later")
			return
		}

		// Acquire scheduler slot
		release, err := i.scheduler.Acquire(r.Context(), scheduler.IsInteractiveRequest(r))
		if err != nil {
			w.Header().Set("Retry-After", "5")
			respondError(w, http.StatusServiceUnavailable, "QUEUE_FULL", "scheduler queue full, retry with backoff")
			return
		}
		defer release()

		// Update upstream URL (may have changed after model switch)
		i.upstream.Set(i.switcher.UpstreamURL())

		next.ServeHTTP(w, r)
	}
}

// OpenAIModelResponse is an OpenAI-compatible model listing response.
type OpenAIModelResponse struct {
	Object string          `json:"object"`
	Data   []OpenAIModel   `json:"data"`
}

// OpenAIModel represents a single model in OpenAI format.
type OpenAIModel struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	OwnedBy string `json:"owned_by"`
}

func (i *InferenceAPI) handleModels(w http.ResponseWriter, r *http.Request) {
	models := scanModels(i.cfg.ExpandedDirs())

	data := make([]OpenAIModel, 0, len(models))
	for _, m := range models {
		data = append(data, OpenAIModel{
			ID:      m.ID,
			Object:  "model",
			Created: time.Now().Unix(),
			OwnedBy: "local",
		})
	}

	respondJSON(w, http.StatusOK, OpenAIModelResponse{
		Object: "list",
		Data:   data,
	})
}

// UpdateUpstream updates the upstream URL pointer.
// Called after a model switch completes.
func (i *InferenceAPI) UpdateUpstream() {
	i.upstream.Set(i.switcher.UpstreamURL())
}
