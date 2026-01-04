package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/vikingowl91/vessel/apps/vlm/internal/config"
	"github.com/vikingowl91/vessel/apps/vlm/internal/process"
	"github.com/vikingowl91/vessel/apps/vlm/internal/scheduler"
)

// ControlAPI handles /vlm/* control plane routes.
type ControlAPI struct {
	cfg       *config.Config
	switcher  *process.Switcher
	scheduler *scheduler.Scheduler
	logger    *slog.Logger
	startTime time.Time
}

// NewControlAPI creates a new control API handler.
func NewControlAPI(cfg *config.Config, switcher *process.Switcher, sched *scheduler.Scheduler) *ControlAPI {
	return &ControlAPI{
		cfg:       cfg,
		switcher:  switcher,
		scheduler: sched,
		logger:    slog.Default().With("component", "control-api"),
		startTime: time.Now(),
	}
}

// Register registers control routes on the given mux.
func (c *ControlAPI) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /vlm/health", c.handleHealth)
	mux.HandleFunc("GET /vlm/status", c.handleStatus)
	mux.HandleFunc("GET /vlm/models", c.handleListModels)
	mux.HandleFunc("POST /vlm/models/select", c.handleSelectModel)
	mux.HandleFunc("POST /vlm/models/rescan", c.handleRescanModels)
	mux.HandleFunc("GET /vlm/profiles", c.handleListProfiles)
	mux.HandleFunc("GET /vlm/logs", c.handleLogs)
}

// HealthResponse is the response for /vlm/health.
type HealthResponse struct {
	Status string `json:"status"`
	Uptime string `json:"uptime"`
}

func (c *ControlAPI) handleHealth(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, HealthResponse{
		Status: "ok",
		Uptime: time.Since(c.startTime).String(),
	})
}

// StatusResponse is the response for /vlm/status.
type StatusResponse struct {
	State        string           `json:"state"`
	ModelID      string           `json:"model_id,omitempty"`
	Profile      string           `json:"profile,omitempty"`
	UpstreamPort int              `json:"upstream_port,omitempty"`
	Uptime       string           `json:"uptime,omitempty"`
	Scheduler    scheduler.Stats  `json:"scheduler"`
	IsSwitching  bool             `json:"is_switching"`
}

func (c *ControlAPI) handleStatus(w http.ResponseWriter, r *http.Request) {
	status := c.switcher.Status()

	resp := StatusResponse{
		State:        status.State,
		ModelID:      status.ModelID,
		Profile:      status.ProfileName,
		UpstreamPort: status.UpstreamPort,
		Uptime:       status.Uptime,
		Scheduler:    c.scheduler.Stats(),
		IsSwitching:  status.IsSwitching,
	}

	respondJSON(w, http.StatusOK, resp)
}

// ModelInfo represents a local model file.
type ModelInfo struct {
	ID          string `json:"id"`
	Path        string `json:"path"`
	Filename    string `json:"filename"`
	Size        int64  `json:"size"`
	SizeDisplay string `json:"size_display"`
	QuantType   string `json:"quant_type,omitempty"`
}

// ModelsResponse is the response for /vlm/models.
type ModelsResponse struct {
	Models []ModelInfo `json:"models"`
	Count  int         `json:"count"`
}

func (c *ControlAPI) handleListModels(w http.ResponseWriter, r *http.Request) {
	models := scanModels(c.cfg.ExpandedDirs())
	respondJSON(w, http.StatusOK, ModelsResponse{
		Models: models,
		Count:  len(models),
	})
}

// SelectModelRequest is the request body for /vlm/models/select.
type SelectModelRequest struct {
	ModelID string `json:"model_id"`
	Profile string `json:"profile,omitempty"`
}

func (c *ControlAPI) handleSelectModel(w http.ResponseWriter, r *http.Request) {
	var req SelectModelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid JSON body")
		return
	}

	if req.ModelID == "" {
		respondError(w, http.StatusBadRequest, "INVALID_REQUEST", "model_id is required")
		return
	}

	// Resolve model ID to path
	models := scanModels(c.cfg.ExpandedDirs())
	var modelPath string
	for _, m := range models {
		if m.ID == req.ModelID {
			modelPath = m.Path
			break
		}
	}

	if modelPath == "" {
		respondError(w, http.StatusNotFound, "MODEL_NOT_FOUND", "model not found: "+req.ModelID)
		return
	}

	// Use default profile if not specified
	profileName := req.Profile
	if profileName == "" {
		profileName = c.cfg.LlamaCpp.ActiveProfile
	}

	// Check if already switching
	if c.switcher.IsSwitching() {
		respondError(w, http.StatusServiceUnavailable, "MODEL_SWITCHING", "a model switch is already in progress")
		return
	}

	// Perform switch
	result, err := c.switcher.Switch(r.Context(), modelPath, req.ModelID, profileName)
	if err != nil {
		c.logger.Error("model switch failed", "error", err)
		respondError(w, http.StatusInternalServerError, "SWITCH_FAILED", result.Error)
		return
	}

	respondJSON(w, http.StatusOK, result)
}

func (c *ControlAPI) handleRescanModels(w http.ResponseWriter, r *http.Request) {
	models := scanModels(c.cfg.ExpandedDirs())
	respondJSON(w, http.StatusOK, ModelsResponse{
		Models: models,
		Count:  len(models),
	})
}

// ProfileInfo represents a llama.cpp profile.
type ProfileInfo struct {
	Name            string   `json:"name"`
	LlamaServerPath string   `json:"llama_server_path"`
	PreferredBackend string  `json:"preferred_backend"`
	DefaultArgs     []string `json:"default_args"`
	IsActive        bool     `json:"is_active"`
}

// ProfilesResponse is the response for /vlm/profiles.
type ProfilesResponse struct {
	Profiles []ProfileInfo `json:"profiles"`
	Count    int           `json:"count"`
}

func (c *ControlAPI) handleListProfiles(w http.ResponseWriter, r *http.Request) {
	activeProfile := c.switcher.ActiveProfileName()

	profiles := make([]ProfileInfo, 0, len(c.cfg.LlamaCpp.Profiles))
	for _, p := range c.cfg.LlamaCpp.Profiles {
		profiles = append(profiles, ProfileInfo{
			Name:            p.Name,
			LlamaServerPath: p.LlamaServerPath,
			PreferredBackend: p.PreferredBackend,
			DefaultArgs:     p.DefaultArgs,
			IsActive:        p.Name == activeProfile,
		})
	}

	respondJSON(w, http.StatusOK, ProfilesResponse{
		Profiles: profiles,
		Count:    len(profiles),
	})
}

func (c *ControlAPI) handleLogs(w http.ResponseWriter, r *http.Request) {
	current := c.switcher.Current()
	if current == nil {
		respondJSON(w, http.StatusOK, map[string]string{
			"logs": "",
		})
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{
		"logs": current.StderrTail(),
	})
}

// scanModels scans directories for GGUF model files.
func scanModels(dirs []string) []ModelInfo {
	seen := make(map[string]bool)
	var models []ModelInfo

	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}

		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}

			name := entry.Name()
			if !strings.HasSuffix(strings.ToLower(name), ".gguf") {
				continue
			}

			fullPath := filepath.Join(dir, name)

			// Generate model ID from filename
			stem := strings.TrimSuffix(name, ".gguf")
			stem = strings.TrimSuffix(stem, ".GGUF")
			modelID := "llamacpp:" + stem

			// Handle collisions
			if seen[modelID] {
				// Add hash suffix for duplicates
				modelID = modelID + "@" + hashPath(fullPath)[:8]
			}
			seen[modelID] = true

			info, err := entry.Info()
			if err != nil {
				continue
			}

			models = append(models, ModelInfo{
				ID:          modelID,
				Path:        fullPath,
				Filename:    name,
				Size:        info.Size(),
				SizeDisplay: formatBytes(info.Size()),
				QuantType:   extractQuantType(name),
			})
		}
	}

	return models
}

// extractQuantType extracts quantization type from filename.
func extractQuantType(filename string) string {
	lower := strings.ToLower(filename)
	quantTypes := []string{
		"q8_0", "q8_1",
		"q6_k", "q5_k_m", "q5_k_s", "q5_1", "q5_0",
		"q4_k_m", "q4_k_s", "q4_1", "q4_0",
		"q3_k_l", "q3_k_m", "q3_k_s",
		"q2_k", "q2_k_s",
		"iq4_nl", "iq4_xs", "iq3_m", "iq3_s", "iq3_xs", "iq3_xxs",
		"iq2_m", "iq2_s", "iq2_xs", "iq2_xxs",
		"iq1_m", "iq1_s",
		"f32", "f16", "bf16",
	}

	for _, qt := range quantTypes {
		if strings.Contains(lower, qt) {
			return strings.ToUpper(qt)
		}
	}

	return ""
}

// hashPath generates a short hash for a file path.
func hashPath(path string) string {
	// Simple hash for collision handling
	h := uint32(0)
	for _, c := range path {
		h = h*31 + uint32(c)
	}
	return strings.ToUpper(strings.Replace(
		strings.Replace(
			strings.Replace(
				strings.Replace(
					strings.Replace(
						strings.Replace(
							strings.Replace(
								strings.Replace(
									strings.Replace(
										string(h),
										"0", "a", -1),
									"1", "b", -1),
								"2", "c", -1),
							"3", "d", -1),
						"4", "e", -1),
					"5", "f", -1),
				"6", "g", -1),
			"7", "h", -1),
		"8", "i", -1))
}

// formatBytes formats bytes as human-readable string.
func formatBytes(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}

// respondJSON sends a JSON response.
func respondJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// ErrorResponse is a standard error response.
type ErrorResponse struct {
	Error string `json:"error"`
	Code  string `json:"code"`
}

// respondError sends an error response.
func respondError(w http.ResponseWriter, status int, code, message string) {
	respondJSON(w, status, ErrorResponse{
		Error: message,
		Code:  code,
	})
}
