package api

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
)

// RuntimeStatus represents the status of a runtime backend.
type RuntimeStatus struct {
	Name      string `json:"name"`
	Type      string `json:"type"`
	URL       string `json:"url"`
	Available bool   `json:"available"`
	Error     string `json:"error,omitempty"`
	Version   string `json:"version,omitempty"`
	Model     string `json:"model,omitempty"` // Currently loaded model (for VLM)
}

// RuntimesResponse is the response for /api/v1/runtimes.
type RuntimesResponse struct {
	Runtimes []RuntimeStatus `json:"runtimes"`
}

// RuntimesHandler returns the status of all configured runtime backends.
func RuntimesHandler(ollamaURL string) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
		defer cancel()

		runtimes := []RuntimeStatus{}

		// Check Ollama
		ollamaStatus := checkOllama(ctx, ollamaURL)
		runtimes = append(runtimes, ollamaStatus)

		// Check VLM if configured
		vlmURL := os.Getenv("VLM_URL")
		vlmEnabled := os.Getenv("VLM_ENABLED") == "true"
		if vlmEnabled && vlmURL != "" {
			vlmToken := os.Getenv("VLM_TOKEN")
			vlmStatus := checkVLM(ctx, vlmURL, vlmToken)
			runtimes = append(runtimes, vlmStatus)
		}

		// Check direct llama.cpp if configured
		llamaCppURL := os.Getenv("LLAMA_CPP_URL")
		if llamaCppURL != "" {
			llamaStatus := checkLlamaCpp(ctx, llamaCppURL)
			runtimes = append(runtimes, llamaStatus)
		}

		c.JSON(http.StatusOK, RuntimesResponse{Runtimes: runtimes})
	}
}

func checkOllama(ctx context.Context, url string) RuntimeStatus {
	status := RuntimeStatus{
		Name: "ollama",
		Type: "ollama",
		URL:  url,
	}

	client := &http.Client{Timeout: 3 * time.Second}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url+"/api/tags", nil)
	if err != nil {
		status.Error = err.Error()
		return status
	}

	resp, err := client.Do(req)
	if err != nil {
		status.Error = "Ollama not reachable"
		return status
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		status.Available = true
	} else {
		status.Error = "Unexpected status: " + resp.Status
	}

	return status
}

func checkVLM(ctx context.Context, url, token string) RuntimeStatus {
	status := RuntimeStatus{
		Name: "vlm",
		Type: "vlm",
		URL:  url,
	}

	client := &http.Client{Timeout: 3 * time.Second}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url+"/vlm/status", nil)
	if err != nil {
		status.Error = err.Error()
		return status
	}

	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := client.Do(req)
	if err != nil {
		status.Error = "VLM not reachable"
		return status
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		status.Available = true

		// Parse VLM status for model info
		var vlmStatus struct {
			State   string `json:"state"`
			ModelID string `json:"model_id"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&vlmStatus); err == nil {
			status.Model = vlmStatus.ModelID
			if vlmStatus.State != "running" && vlmStatus.State != "idle" {
				status.Available = false
				status.Error = "VLM state: " + vlmStatus.State
			}
		}
	} else if resp.StatusCode == http.StatusUnauthorized {
		status.Error = "VLM authentication failed (check VLM_TOKEN)"
	} else {
		status.Error = "Unexpected status: " + resp.Status
	}

	return status
}

func checkLlamaCpp(ctx context.Context, url string) RuntimeStatus {
	status := RuntimeStatus{
		Name: "llama-cpp",
		Type: "llama-cpp-server",
		URL:  url,
	}

	client := &http.Client{Timeout: 3 * time.Second}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url+"/health", nil)
	if err != nil {
		status.Error = err.Error()
		return status
	}

	resp, err := client.Do(req)
	if err != nil {
		status.Error = "llama.cpp server not reachable"
		return status
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		status.Available = true
	} else {
		status.Error = "Unexpected status: " + resp.Status
	}

	return status
}
