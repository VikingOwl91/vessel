package api

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"

	"vessel-backend/internal/backends"
)

// AIHandlers provides HTTP handlers for the unified AI API
type AIHandlers struct {
	registry *backends.Registry
}

// NewAIHandlers creates a new AIHandlers instance
func NewAIHandlers(registry *backends.Registry) *AIHandlers {
	return &AIHandlers{
		registry: registry,
	}
}

// ListBackendsHandler returns information about all configured backends
func (h *AIHandlers) ListBackendsHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		infos := h.registry.AllInfo(c.Request.Context())

		c.JSON(http.StatusOK, gin.H{
			"backends": infos,
			"active":   h.registry.ActiveType().String(),
		})
	}
}

// DiscoverBackendsHandler probes for available backends
func (h *AIHandlers) DiscoverBackendsHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Endpoints []backends.DiscoveryEndpoint `json:"endpoints"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			// Use default endpoints if none provided
			req.Endpoints = backends.DefaultDiscoveryEndpoints()
		}

		if len(req.Endpoints) == 0 {
			req.Endpoints = backends.DefaultDiscoveryEndpoints()
		}

		results := h.registry.Discover(c.Request.Context(), req.Endpoints)

		c.JSON(http.StatusOK, gin.H{
			"results": results,
		})
	}
}

// SetActiveHandler sets the active backend
func (h *AIHandlers) SetActiveHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Type string `json:"type" binding:"required"`
		}

		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "type is required"})
			return
		}

		backendType, err := backends.ParseBackendType(req.Type)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if err := h.registry.SetActive(backendType); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"active": backendType.String(),
		})
	}
}

// HealthCheckHandler checks the health of a specific backend
func (h *AIHandlers) HealthCheckHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		typeParam := c.Param("type")

		backendType, err := backends.ParseBackendType(typeParam)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		backend, ok := h.registry.Get(backendType)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "backend not registered"})
			return
		}

		if err := backend.HealthCheck(c.Request.Context()); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"status": "unhealthy",
				"error":  err.Error(),
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"status": "healthy",
		})
	}
}

// ListModelsHandler returns models from the active backend
func (h *AIHandlers) ListModelsHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		active := h.registry.Active()
		if active == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "no active backend"})
			return
		}

		models, err := active.ListModels(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"models":  models,
			"backend": active.Type().String(),
		})
	}
}

// ChatHandler handles chat requests through the active backend
func (h *AIHandlers) ChatHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		active := h.registry.Active()
		if active == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "no active backend"})
			return
		}

		var req backends.ChatRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		if err := req.Validate(); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		// Check if streaming is requested
		streaming := req.Stream != nil && *req.Stream

		if streaming {
			h.handleStreamingChat(c, active, &req)
		} else {
			h.handleNonStreamingChat(c, active, &req)
		}
	}
}

// handleNonStreamingChat handles non-streaming chat requests
func (h *AIHandlers) handleNonStreamingChat(c *gin.Context, backend backends.LLMBackend, req *backends.ChatRequest) {
	resp, err := backend.Chat(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, resp)
}

// handleStreamingChat handles streaming chat requests
func (h *AIHandlers) handleStreamingChat(c *gin.Context, backend backends.LLMBackend, req *backends.ChatRequest) {
	// Set headers for NDJSON streaming
	c.Header("Content-Type", "application/x-ndjson")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("Transfer-Encoding", "chunked")

	ctx := c.Request.Context()
	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "streaming not supported"})
		return
	}

	chunkCh, err := backend.StreamChat(ctx, req)
	if err != nil {
		errResp := gin.H{"error": err.Error()}
		data, _ := json.Marshal(errResp)
		c.Writer.Write(append(data, '\n'))
		flusher.Flush()
		return
	}

	for chunk := range chunkCh {
		select {
		case <-ctx.Done():
			return
		default:
		}

		data, err := json.Marshal(chunk)
		if err != nil {
			continue
		}

		_, err = c.Writer.Write(append(data, '\n'))
		if err != nil {
			return
		}
		flusher.Flush()
	}
}

// RegisterBackendHandler registers a new backend
func (h *AIHandlers) RegisterBackendHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req backends.BackendConfig
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		if err := req.Validate(); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		// Create adapter based on type
		var backend backends.LLMBackend
		var err error

		switch req.Type {
		case backends.BackendTypeOllama:
			// Would import ollama adapter
			c.JSON(http.StatusNotImplemented, gin.H{"error": "use /api/v1/ai/backends/discover to register backends"})
			return
		case backends.BackendTypeLlamaCpp, backends.BackendTypeLMStudio:
			// Would import openai adapter
			c.JSON(http.StatusNotImplemented, gin.H{"error": "use /api/v1/ai/backends/discover to register backends"})
			return
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "unknown backend type"})
			return
		}

		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if err := h.registry.Register(backend); err != nil {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusCreated, gin.H{
			"type":    req.Type.String(),
			"baseUrl": req.BaseURL,
		})
	}
}
