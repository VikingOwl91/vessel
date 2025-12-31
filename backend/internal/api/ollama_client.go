package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"

	"github.com/gin-gonic/gin"
	"github.com/ollama/ollama/api"
)

// OllamaService wraps the official Ollama client
type OllamaService struct {
	client    *api.Client
	ollamaURL string
}

// NewOllamaService creates a new Ollama service with the official client
func NewOllamaService(ollamaURL string) (*OllamaService, error) {
	baseURL, err := url.Parse(ollamaURL)
	if err != nil {
		return nil, fmt.Errorf("invalid Ollama URL: %w", err)
	}

	client := api.NewClient(baseURL, http.DefaultClient)

	return &OllamaService{
		client:    client,
		ollamaURL: ollamaURL,
	}, nil
}

// ListModelsHandler returns available models
func (s *OllamaService) ListModelsHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		resp, err := s.client.List(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "failed to list models: " + err.Error()})
			return
		}
		c.JSON(http.StatusOK, resp)
	}
}

// ShowModelHandler returns model details
func (s *OllamaService) ShowModelHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req api.ShowRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		resp, err := s.client.Show(c.Request.Context(), &req)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "failed to show model: " + err.Error()})
			return
		}
		c.JSON(http.StatusOK, resp)
	}
}

// ChatHandler handles streaming chat requests
func (s *OllamaService) ChatHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req api.ChatRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		// Check if streaming is requested (default true for chat)
		streaming := req.Stream == nil || *req.Stream

		if streaming {
			s.handleStreamingChat(c, &req)
		} else {
			s.handleNonStreamingChat(c, &req)
		}
	}
}

// handleStreamingChat handles streaming chat responses
func (s *OllamaService) handleStreamingChat(c *gin.Context, req *api.ChatRequest) {
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

	err := s.client.Chat(ctx, req, func(resp api.ChatResponse) error {
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
func (s *OllamaService) handleNonStreamingChat(c *gin.Context, req *api.ChatRequest) {
	var finalResp api.ChatResponse

	err := s.client.Chat(c.Request.Context(), req, func(resp api.ChatResponse) error {
		finalResp = resp
		return nil
	})

	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "chat failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, finalResp)
}

// GenerateHandler handles streaming generate requests
func (s *OllamaService) GenerateHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req api.GenerateRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		// Check if streaming is requested (default true)
		streaming := req.Stream == nil || *req.Stream

		if streaming {
			s.handleStreamingGenerate(c, &req)
		} else {
			s.handleNonStreamingGenerate(c, &req)
		}
	}
}

// handleStreamingGenerate handles streaming generate responses
func (s *OllamaService) handleStreamingGenerate(c *gin.Context, req *api.GenerateRequest) {
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

	err := s.client.Generate(ctx, req, func(resp api.GenerateResponse) error {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

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
		errResp := gin.H{"error": err.Error()}
		data, _ := json.Marshal(errResp)
		c.Writer.Write(append(data, '\n'))
		flusher.Flush()
	}
}

// handleNonStreamingGenerate handles non-streaming generate responses
func (s *OllamaService) handleNonStreamingGenerate(c *gin.Context, req *api.GenerateRequest) {
	var finalResp api.GenerateResponse

	err := s.client.Generate(c.Request.Context(), req, func(resp api.GenerateResponse) error {
		finalResp = resp
		return nil
	})

	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "generate failed: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, finalResp)
}

// EmbedHandler handles embedding requests
func (s *OllamaService) EmbedHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req api.EmbedRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		resp, err := s.client.Embed(c.Request.Context(), &req)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "embed failed: " + err.Error()})
			return
		}

		c.JSON(http.StatusOK, resp)
	}
}

// PullModelHandler handles model pull requests with progress streaming
func (s *OllamaService) PullModelHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req api.PullRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		c.Header("Content-Type", "application/x-ndjson")
		c.Header("Cache-Control", "no-cache")
		c.Header("Connection", "keep-alive")

		ctx := c.Request.Context()
		flusher, ok := c.Writer.(http.Flusher)
		if !ok {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "streaming not supported"})
			return
		}

		err := s.client.Pull(ctx, &req, func(resp api.ProgressResponse) error {
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
			}

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
			errResp := gin.H{"error": err.Error()}
			data, _ := json.Marshal(errResp)
			c.Writer.Write(append(data, '\n'))
			flusher.Flush()
		}
	}
}

// DeleteModelHandler handles model deletion
func (s *OllamaService) DeleteModelHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req api.DeleteRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		err := s.client.Delete(c.Request.Context(), &req)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "delete failed: " + err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"status": "success"})
	}
}

// CopyModelHandler handles model copying
func (s *OllamaService) CopyModelHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req api.CopyRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		err := s.client.Copy(c.Request.Context(), &req)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "copy failed: " + err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"status": "success"})
	}
}

// VersionHandler returns Ollama version
func (s *OllamaService) VersionHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		version, err := s.client.Version(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "failed to get version: " + err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"version": version})
	}
}

// HeartbeatHandler checks if Ollama is running
func (s *OllamaService) HeartbeatHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		err := s.client.Heartbeat(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "Ollama not reachable: " + err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	}
}

// ProxyHandler provides a generic proxy for any Ollama endpoint not explicitly handled
// This is kept for backwards compatibility with frontend direct calls
func (s *OllamaService) ProxyHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Param("path")
		targetURL := s.ollamaURL + path

		req, err := http.NewRequestWithContext(c.Request.Context(), c.Request.Method, targetURL, c.Request.Body)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create proxy request"})
			return
		}

		// Copy headers
		for key, values := range c.Request.Header {
			for _, value := range values {
				req.Header.Add(key, value)
			}
		}

		client := &http.Client{}
		resp, err := client.Do(req)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "failed to reach Ollama: " + err.Error()})
			return
		}
		defer resp.Body.Close()

		// Copy response headers
		for key, values := range resp.Header {
			for _, value := range values {
				c.Header(key, value)
			}
		}

		c.Status(resp.StatusCode)
		io.Copy(c.Writer, resp.Body)
	}
}
