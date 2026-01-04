package api

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"vessel-backend/internal/llm"
)

// LLMService provides unified HTTP handlers for multi-backend LLM operations
type LLMService struct {
	manager *llm.Manager
}

// NewLLMService creates a new LLM service with the given manager
func NewLLMService(manager *llm.Manager) *LLMService {
	return &LLMService{
		manager: manager,
	}
}

// SetupRoutes registers all LLM routes on the given router group
func (s *LLMService) SetupRoutes(r *gin.RouterGroup) {
	// Backend management
	r.GET("/backends", s.ListBackendsHandler())
	r.PUT("/backends/primary", s.SetPrimaryBackendHandler())

	// Unified chat and models (uses primary backend by default)
	r.POST("/chat", s.ChatHandler())
	r.GET("/models", s.ListModelsHandler())
	r.GET("/models/:name", s.ShowModelHandler())

	// Backend-specific operations
	r.GET("/backends/:name/models", s.BackendModelsHandler())
	r.POST("/backends/:name/chat", s.BackendChatHandler())
}

// ListBackendsHandler returns all registered backends with availability status
func (s *LLMService) ListBackendsHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		infos := s.manager.ListInfo(c.Request.Context())
		c.JSON(http.StatusOK, gin.H{"backends": infos})
	}
}

// SetPrimaryBackendHandler sets the primary backend
func (s *LLMService) SetPrimaryBackendHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Name string `json:"name" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		if err := s.manager.SetPrimary(req.Name); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"status": "ok", "primary": req.Name})
	}
}

// ChatHandler handles chat requests using the primary or specified backend
func (s *LLMService) ChatHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req llm.ChatRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		// Determine which backend to use
		backendName := c.Query("backend")
		var backend llm.Backend

		if backendName != "" {
			var exists bool
			backend, exists = s.manager.Get(backendName)
			if !exists {
				c.JSON(http.StatusNotFound, gin.H{"error": "backend not found: " + backendName})
				return
			}
		} else {
			backend = s.manager.Primary()
			if backend == nil {
				c.JSON(http.StatusServiceUnavailable, gin.H{"error": "no primary backend configured"})
				return
			}
		}

		if req.Stream {
			s.handleStreamingChat(c, backend, &req)
		} else {
			s.handleNonStreamingChat(c, backend, &req)
		}
	}
}

// handleStreamingChat handles streaming chat responses
func (s *LLMService) handleStreamingChat(c *gin.Context, backend llm.Backend, req *llm.ChatRequest) {
	// Set headers for streaming
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

	_, err := backend.Chat(ctx, req, func(resp llm.ChatResponse) error {
		// Check if context is cancelled
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Marshal and write response
		data, err := json.Marshal(resp)
		if err != nil {
			return err
		}

		_, err = c.Writer.Write(append(data, '\n'))
		if err != nil {
			return err
		}
		flusher.Flush()
		return nil
	})

	if err != nil && err != context.Canceled {
		// Write error as final message if we haven't finished
		errResp := gin.H{"error": err.Error()}
		data, _ := json.Marshal(errResp)
		c.Writer.Write(append(data, '\n'))
		flusher.Flush()
	}
}

// handleNonStreamingChat handles non-streaming chat responses
func (s *LLMService) handleNonStreamingChat(c *gin.Context, backend llm.Backend, req *llm.ChatRequest) {
	resp, err := backend.Chat(c.Request.Context(), req, nil)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "chat failed: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, resp)
}

// ListModelsHandler returns models from the primary backend or all backends
func (s *LLMService) ListModelsHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()
		allBackends := c.Query("all") == "true"

		if allBackends {
			// Aggregate models from all backends
			result := make(map[string][]llm.ModelInfo)
			for _, backend := range s.manager.List() {
				models, err := backend.ListModels(ctx)
				if err != nil {
					// Include error info but continue with other backends
					result[backend.Name()] = nil
					continue
				}
				result[backend.Name()] = models
			}
			c.JSON(http.StatusOK, gin.H{"models": result})
			return
		}

		// Use primary backend
		backend := s.manager.Primary()
		if backend == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "no primary backend configured"})
			return
		}

		models, err := backend.ListModels(ctx)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "failed to list models: " + err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"models": models})
	}
}

// ShowModelHandler returns details for a specific model from the primary backend
func (s *LLMService) ShowModelHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		modelName := c.Param("name")
		if modelName == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "model name required"})
			return
		}

		// Check if a specific backend is requested
		backendName := c.Query("backend")
		var backend llm.Backend

		if backendName != "" {
			var exists bool
			backend, exists = s.manager.Get(backendName)
			if !exists {
				c.JSON(http.StatusNotFound, gin.H{"error": "backend not found: " + backendName})
				return
			}
		} else {
			backend = s.manager.Primary()
			if backend == nil {
				c.JSON(http.StatusServiceUnavailable, gin.H{"error": "no primary backend configured"})
				return
			}
		}

		details, err := backend.ShowModel(c.Request.Context(), modelName)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "failed to show model: " + err.Error()})
			return
		}
		c.JSON(http.StatusOK, details)
	}
}

// BackendModelsHandler returns models for a specific backend
func (s *LLMService) BackendModelsHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		backendName := c.Param("name")
		backend, exists := s.manager.Get(backendName)
		if !exists {
			c.JSON(http.StatusNotFound, gin.H{"error": "backend not found: " + backendName})
			return
		}

		models, err := backend.ListModels(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "failed to list models: " + err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"models": models})
	}
}

// BackendChatHandler handles chat requests for a specific backend
func (s *LLMService) BackendChatHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		backendName := c.Param("name")
		backend, exists := s.manager.Get(backendName)
		if !exists {
			c.JSON(http.StatusNotFound, gin.H{"error": "backend not found: " + backendName})
			return
		}

		var req llm.ChatRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		if req.Stream {
			s.handleStreamingChat(c, backend, &req)
		} else {
			s.handleNonStreamingChat(c, backend, &req)
		}
	}
}
