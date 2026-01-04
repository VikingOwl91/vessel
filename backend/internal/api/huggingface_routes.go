package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"vessel-backend/internal/llm/huggingface"
)

// HuggingFaceService provides HTTP handlers for HuggingFace API operations.
type HuggingFaceService struct {
	client          *huggingface.Client
	downloadManager *DownloadManager
	defaultModelsDir string
}

// NewHuggingFaceService creates a new HuggingFace service.
// apiToken is optional but provides higher rate limits.
// modelsDir is the default directory for storing downloaded models.
func NewHuggingFaceService(apiToken string, modelsDir string) (*HuggingFaceService, error) {
	if modelsDir == "" {
		// Default to ~/.vessel/models
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return nil, fmt.Errorf("failed to get user home directory: %w", err)
		}
		modelsDir = filepath.Join(homeDir, ".vessel", "models")
	}

	downloader, err := huggingface.NewGGUFDownloader(modelsDir)
	if err != nil {
		return nil, fmt.Errorf("failed to create downloader: %w", err)
	}

	return &HuggingFaceService{
		client:           huggingface.NewClient(apiToken),
		downloadManager:  NewDownloadManager(downloader),
		defaultModelsDir: modelsDir,
	}, nil
}

// SetupRoutes registers HuggingFace routes on the given router group.
func (s *HuggingFaceService) SetupRoutes(rg *gin.RouterGroup) {
	hf := rg.Group("/huggingface")
	{
		// Model search and listing
		hf.GET("/models", s.SearchModelsHandler())
		hf.GET("/models/:owner/:repo/files", s.ListGGUFFilesHandler())

		// Local models
		hf.GET("/local", s.ListLocalModelsHandler())
		hf.DELETE("/local/:filename", s.DeleteLocalModelHandler())

		// Download management
		hf.POST("/download", s.StartDownloadHandler())
		hf.GET("/downloads", s.ListDownloadsHandler())
		hf.GET("/downloads/:id", s.GetDownloadHandler())
		hf.GET("/downloads/:id/stream", s.StreamDownloadProgressHandler())
		hf.DELETE("/downloads/:id", s.CancelDownloadHandler())
	}
}

// SearchModelsHandler handles GET /api/v1/huggingface/models
// Query params: q (search query), limit (default 20), sort (downloads, likes, trending)
func (s *HuggingFaceService) SearchModelsHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		query := c.Query("q")
		limitStr := c.DefaultQuery("limit", "20")
		sort := c.DefaultQuery("sort", "downloads")

		limit, err := strconv.Atoi(limitStr)
		if err != nil || limit <= 0 {
			limit = 20
		}
		if limit > 100 {
			limit = 100
		}

		// Map sort parameter to HuggingFace API values
		// HuggingFace API uses -1 for descending, 1 for ascending
		sortValue := sort
		direction := "-1" // Default to descending
		switch sort {
		case "downloads":
			sortValue = "downloads"
		case "likes":
			sortValue = "likes"
		case "trending":
			sortValue = "trendingScore"
			direction = "-1"
		case "modified", "updated":
			sortValue = "lastModified"
		}

		filter := huggingface.SearchFilter{
			Tags:      []string{"gguf"},
			Library:   "gguf",
			Sort:      sortValue,
			Direction: direction,
			Limit:     limit,
		}

		models, err := s.client.SearchModels(c.Request.Context(), query, filter)
		if err != nil {
			s.handleClientError(c, err)
			return
		}

		// Transform to response format
		type modelResponse struct {
			ID           string    `json:"id"`
			Author       string    `json:"author"`
			Name         string    `json:"name"`
			Downloads    int       `json:"downloads"`
			Likes        int       `json:"likes"`
			Tags         []string  `json:"tags"`
			LastModified time.Time `json:"lastModified"`
		}

		response := make([]modelResponse, len(models))
		for i, m := range models {
			// Extract author and name from ID if not present (ID format: "author/model-name")
			author := m.Author
			name := m.ModelID
			if strings.Contains(m.ID, "/") {
				parts := strings.SplitN(m.ID, "/", 2)
				if author == "" {
					author = parts[0]
				}
				if name == "" && len(parts) > 1 {
					name = parts[1]
				}
			}
			if name == "" {
				name = m.ID
			}

			response[i] = modelResponse{
				ID:           m.ID,
				Author:       author,
				Name:         name,
				Downloads:    m.Downloads,
				Likes:        m.Likes,
				Tags:         m.Tags,
				LastModified: m.UpdatedAt,
			}
		}

		c.JSON(http.StatusOK, gin.H{
			"models": response,
			"count":  len(response),
		})
	}
}

// ListGGUFFilesHandler handles GET /api/v1/huggingface/models/:owner/:repo/files
// Returns list of GGUF files with name, size, quantization info
func (s *HuggingFaceService) ListGGUFFilesHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		owner := c.Param("owner")
		repo := c.Param("repo")
		repoID := owner + "/" + repo

		files, err := s.client.GetGGUFFiles(c.Request.Context(), repoID)
		if err != nil {
			s.handleClientError(c, err)
			return
		}

		// Transform to response format
		type fileResponse struct {
			Filename     string `json:"filename"`
			Size         int64  `json:"size"`
			SizeFormatted string `json:"sizeFormatted"`
			QuantType    string `json:"quantType"`
			ParamSize    string `json:"paramSize"`
			BaseModel    string `json:"baseModel"`
			DownloadURL  string `json:"downloadUrl"`
		}

		response := make([]fileResponse, len(files))
		for i, f := range files {
			// Use helper methods for tree API compatibility
			filename := f.FileInfo.Name()
			size := f.FileInfo.TotalSize()

			response[i] = fileResponse{
				Filename:      filename,
				Size:          size,
				SizeFormatted: formatBytes(size),
				QuantType:     f.QuantType,
				ParamSize:     f.ParamSize,
				BaseModel:     f.BaseModel,
				DownloadURL:   s.client.GetDownloadURL(repoID, filename),
			}
		}

		c.JSON(http.StatusOK, gin.H{
			"repo":  repoID,
			"files": response,
			"count": len(response),
		})
	}
}

// DownloadRequest represents a request to start a download.
type DownloadRequest struct {
	Repo     string `json:"repo" binding:"required"`
	Filename string `json:"filename" binding:"required"`
	DestDir  string `json:"destDir"`
}

// StartDownloadHandler handles POST /api/v1/huggingface/download
// Starts a download and returns the download ID for tracking progress
func (s *HuggingFaceService) StartDownloadHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		var req DownloadRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		// Use default models directory if not specified
		destDir := req.DestDir
		if destDir == "" {
			destDir = s.defaultModelsDir
		}

		// Validate the destination directory
		if err := os.MkdirAll(destDir, 0755); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid destination directory: " + err.Error()})
			return
		}

		// Start the download
		download, err := s.downloadManager.StartDownload(req.Repo, req.Filename, destDir)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to start download: " + err.Error()})
			return
		}

		c.JSON(http.StatusAccepted, gin.H{
			"id":       download.ID,
			"repo":     download.Repo,
			"filename": download.Filename,
			"destPath": download.DestPath,
			"status":   download.Status,
			"message":  "Download started. Use /downloads/:id/stream for SSE progress updates.",
		})
	}
}

// ListDownloadsHandler handles GET /api/v1/huggingface/downloads
// Returns list of active and recent downloads
func (s *HuggingFaceService) ListDownloadsHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		downloads := s.downloadManager.ListDownloads()

		type downloadResponse struct {
			ID         string  `json:"id"`
			Repo       string  `json:"repo"`
			Filename   string  `json:"filename"`
			DestPath   string  `json:"destPath"`
			Status     string  `json:"status"`
			Progress   float64 `json:"progress"`
			Downloaded int64   `json:"downloaded"`
			Total      int64   `json:"total"`
			Speed      float64 `json:"speed"`
			Error      string  `json:"error,omitempty"`
			StartedAt  string  `json:"startedAt"`
		}

		response := make([]downloadResponse, len(downloads))
		for i, d := range downloads {
			response[i] = downloadResponse{
				ID:         d.ID,
				Repo:       d.Repo,
				Filename:   d.Filename,
				DestPath:   d.DestPath,
				Status:     d.Status,
				Progress:   d.Progress.Percentage,
				Downloaded: d.Progress.Downloaded,
				Total:      d.Progress.Total,
				Speed:      d.Progress.Speed,
				Error:      d.Progress.Error,
				StartedAt:  d.StartedAt.Format(time.RFC3339),
			}
		}

		c.JSON(http.StatusOK, gin.H{
			"downloads": response,
			"count":     len(response),
		})
	}
}

// GetDownloadHandler handles GET /api/v1/huggingface/downloads/:id
// Returns current status of a specific download
func (s *HuggingFaceService) GetDownloadHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")

		download, ok := s.downloadManager.GetDownload(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "download not found"})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"id":         download.ID,
			"repo":       download.Repo,
			"filename":   download.Filename,
			"destPath":   download.DestPath,
			"status":     download.Status,
			"progress":   download.Progress.Percentage,
			"downloaded": download.Progress.Downloaded,
			"total":      download.Progress.Total,
			"speed":      download.Progress.Speed,
			"error":      download.Progress.Error,
			"startedAt":  download.StartedAt.Format(time.RFC3339),
		})
	}
}

// StreamDownloadProgressHandler handles GET /api/v1/huggingface/downloads/:id/stream
// Streams download progress via Server-Sent Events (SSE)
func (s *HuggingFaceService) StreamDownloadProgressHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")

		download, ok := s.downloadManager.GetDownload(id)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "download not found"})
			return
		}

		// Set SSE headers
		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache")
		c.Header("Connection", "keep-alive")
		c.Header("X-Accel-Buffering", "no")

		ctx := c.Request.Context()
		flusher, ok := c.Writer.(http.Flusher)
		if !ok {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "streaming not supported"})
			return
		}

		// Subscribe to progress updates
		progressChan := download.Subscribe()
		defer download.Unsubscribe(progressChan)

		// Send initial state
		s.sendSSEProgress(c.Writer, flusher, download.Progress)

		// Stream progress updates
		for {
			select {
			case <-ctx.Done():
				return
			case progress, ok := <-progressChan:
				if !ok {
					return
				}
				s.sendSSEProgress(c.Writer, flusher, progress)
				if progress.Status == "complete" || progress.Status == "error" || progress.Status == "canceled" {
					return
				}
			}
		}
	}
}

func (s *HuggingFaceService) sendSSEProgress(w http.ResponseWriter, flusher http.Flusher, progress huggingface.DownloadProgress) {
	data, _ := json.Marshal(progress)
	fmt.Fprintf(w, "data: %s\n\n", data)
	flusher.Flush()
}

// CancelDownloadHandler handles DELETE /api/v1/huggingface/downloads/:id
// Cancels an active download
func (s *HuggingFaceService) CancelDownloadHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")

		if err := s.downloadManager.CancelDownload(id); err != nil {
			if errors.Is(err, ErrDownloadNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "download not found"})
			} else {
				c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			}
			return
		}

		c.JSON(http.StatusOK, gin.H{"status": "canceled"})
	}
}

// ListLocalModelsHandler handles GET /api/v1/huggingface/local
// Returns list of GGUF files in the local models directory
func (s *HuggingFaceService) ListLocalModelsHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		type localModel struct {
			Filename      string    `json:"filename"`
			Size          int64     `json:"size"`
			SizeFormatted string    `json:"sizeFormatted"`
			QuantType     string    `json:"quantType"`
			ModifiedAt    time.Time `json:"modifiedAt"`
			Path          string    `json:"path"`
		}

		models := []localModel{}

		// Ensure models directory exists
		if err := os.MkdirAll(s.defaultModelsDir, 0755); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to access models directory: " + err.Error()})
			return
		}

		// Walk the models directory looking for GGUF files
		err := filepath.Walk(s.defaultModelsDir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return nil // Skip files we can't access
			}

			// Skip directories
			if info.IsDir() {
				return nil
			}

			// Only include GGUF files
			if !strings.HasSuffix(strings.ToLower(info.Name()), ".gguf") {
				return nil
			}

			// Extract quantization type from filename
			quantType := extractQuantType(info.Name())

			models = append(models, localModel{
				Filename:      info.Name(),
				Size:          info.Size(),
				SizeFormatted: formatBytes(info.Size()),
				QuantType:     quantType,
				ModifiedAt:    info.ModTime(),
				Path:          path,
			})

			return nil
		})

		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to scan models directory: " + err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"models":    models,
			"count":     len(models),
			"directory": s.defaultModelsDir,
		})
	}
}

// DeleteLocalModelHandler handles DELETE /api/v1/huggingface/local/:filename
// Deletes a local GGUF model file
func (s *HuggingFaceService) DeleteLocalModelHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		filename := c.Param("filename")

		// Validate filename to prevent path traversal
		if strings.Contains(filename, "/") || strings.Contains(filename, "\\") || strings.Contains(filename, "..") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid filename"})
			return
		}

		// Only allow deleting GGUF files
		if !strings.HasSuffix(strings.ToLower(filename), ".gguf") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "can only delete GGUF files"})
			return
		}

		filePath := filepath.Join(s.defaultModelsDir, filename)

		// Check if file exists
		info, err := os.Stat(filePath)
		if os.IsNotExist(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "model not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to check file: " + err.Error()})
			return
		}

		// Ensure it's a file, not a directory
		if info.IsDir() {
			c.JSON(http.StatusBadRequest, gin.H{"error": "cannot delete directory"})
			return
		}

		// Delete the file
		if err := os.Remove(filePath); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete model: " + err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"status":   "deleted",
			"filename": filename,
		})
	}
}

// extractQuantType extracts the quantization type from a GGUF filename.
// Common patterns: Q4_K_M, Q5_K_S, Q8_0, IQ4_XS, F16, BF16
func extractQuantType(filename string) string {
	// Common quantization patterns in order of specificity
	patterns := []string{
		"Q4_K_M", "Q4_K_S", "Q4_0", "Q4_1",
		"Q5_K_M", "Q5_K_S", "Q5_0", "Q5_1",
		"Q6_K", "Q8_0", "Q8_1",
		"Q2_K", "Q3_K_M", "Q3_K_S", "Q3_K_L",
		"IQ4_XS", "IQ4_NL", "IQ3_XXS", "IQ3_XS", "IQ3_M", "IQ3_S",
		"IQ2_XXS", "IQ2_XS", "IQ2_S", "IQ2_M",
		"IQ1_S", "IQ1_M",
		"BF16", "F16", "F32",
	}

	upper := strings.ToUpper(filename)
	for _, p := range patterns {
		if strings.Contains(upper, p) {
			return p
		}
	}

	// Also check for simple patterns like Q4, Q5, Q8 (without underscore suffix)
	simplePatterns := []string{"Q8", "Q6", "Q5", "Q4", "Q3", "Q2"}
	for _, p := range simplePatterns {
		if strings.Contains(upper, p) {
			return p
		}
	}

	return ""
}

// handleClientError converts HuggingFace client errors to HTTP responses.
func (s *HuggingFaceService) handleClientError(c *gin.Context, err error) {
	var apiErr *huggingface.APIError
	if errors.As(err, &apiErr) {
		switch {
		case errors.Is(apiErr.Err, huggingface.ErrNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": apiErr.Message})
		case errors.Is(apiErr.Err, huggingface.ErrUnauthorized):
			c.JSON(http.StatusUnauthorized, gin.H{"error": apiErr.Message})
		case errors.Is(apiErr.Err, huggingface.ErrRateLimited):
			c.JSON(http.StatusTooManyRequests, gin.H{"error": apiErr.Message})
		case errors.Is(apiErr.Err, huggingface.ErrBadRequest):
			c.JSON(http.StatusBadRequest, gin.H{"error": apiErr.Message})
		default:
			c.JSON(http.StatusBadGateway, gin.H{"error": apiErr.Message})
		}
		return
	}

	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		c.JSON(http.StatusGatewayTimeout, gin.H{"error": "request timed out"})
		return
	}

	c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
}

// formatBytes converts bytes to human-readable format.
func formatBytes(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bytes)/float64(div), "KMGTPE"[exp])
}

// DownloadManager tracks active and completed downloads.
type DownloadManager struct {
	downloader *huggingface.GGUFDownloader
	downloads  map[string]*Download
	mu         sync.RWMutex
}

// Download represents an active or completed download.
type Download struct {
	ID        string
	Repo      string
	Filename  string
	DestPath  string
	Status    string // "pending", "downloading", "verifying", "complete", "error", "canceled"
	Progress  huggingface.DownloadProgress
	StartedAt time.Time
	Error     error

	ctx        context.Context
	cancel     context.CancelFunc
	mu         sync.RWMutex
	subscribers []chan huggingface.DownloadProgress
}

// Subscribe returns a channel that receives progress updates.
func (d *Download) Subscribe() chan huggingface.DownloadProgress {
	d.mu.Lock()
	defer d.mu.Unlock()

	ch := make(chan huggingface.DownloadProgress, 10)
	d.subscribers = append(d.subscribers, ch)
	return ch
}

// Unsubscribe removes a subscriber channel.
func (d *Download) Unsubscribe(ch chan huggingface.DownloadProgress) {
	d.mu.Lock()
	defer d.mu.Unlock()

	for i, sub := range d.subscribers {
		if sub == ch {
			d.subscribers = append(d.subscribers[:i], d.subscribers[i+1:]...)
			close(ch)
			return
		}
	}
}

func (d *Download) broadcast(progress huggingface.DownloadProgress) {
	d.mu.Lock()
	defer d.mu.Unlock()

	d.Progress = progress
	d.Status = progress.Status

	for _, ch := range d.subscribers {
		select {
		case ch <- progress:
		default:
			// Channel full, skip
		}
	}
}

func (d *Download) closeSubscribers() {
	d.mu.Lock()
	defer d.mu.Unlock()

	for _, ch := range d.subscribers {
		close(ch)
	}
	d.subscribers = nil
}

// Common errors for download manager.
var (
	ErrDownloadNotFound = errors.New("download not found")
	ErrDownloadNotActive = errors.New("download is not active")
)

// NewDownloadManager creates a new download manager.
func NewDownloadManager(downloader *huggingface.GGUFDownloader) *DownloadManager {
	return &DownloadManager{
		downloader: downloader,
		downloads:  make(map[string]*Download),
	}
}

// StartDownload begins a new download and returns its tracking info.
func (m *DownloadManager) StartDownload(repo, filename, destDir string) (*Download, error) {
	id := uuid.New().String()
	ctx, cancel := context.WithCancel(context.Background())

	// Create a temporary downloader with the specified destination
	downloader, err := huggingface.NewGGUFDownloader(destDir)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("failed to create downloader: %w", err)
	}

	destPath := downloader.GetModelPath(repo, filename)

	download := &Download{
		ID:        id,
		Repo:      repo,
		Filename:  filename,
		DestPath:  destPath,
		Status:    "pending",
		StartedAt: time.Now(),
		ctx:       ctx,
		cancel:    cancel,
	}

	m.mu.Lock()
	m.downloads[id] = download
	m.mu.Unlock()

	// Start download in background
	go func() {
		_, err := downloader.Download(ctx, repo, filename, func(progress huggingface.DownloadProgress) {
			download.broadcast(progress)
		})

		if err != nil {
			if errors.Is(err, huggingface.ErrDownloadCanceled) || errors.Is(err, context.Canceled) {
				download.broadcast(huggingface.DownloadProgress{
					Status: "canceled",
					Error:  "download canceled by user",
				})
			} else {
				download.broadcast(huggingface.DownloadProgress{
					Status: "error",
					Error:  err.Error(),
				})
			}
			download.Error = err
		}

		download.closeSubscribers()
	}()

	return download, nil
}

// GetDownload returns a download by ID.
func (m *DownloadManager) GetDownload(id string) (*Download, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	download, ok := m.downloads[id]
	return download, ok
}

// ListDownloads returns all tracked downloads.
func (m *DownloadManager) ListDownloads() []*Download {
	m.mu.RLock()
	defer m.mu.RUnlock()

	downloads := make([]*Download, 0, len(m.downloads))
	for _, d := range m.downloads {
		downloads = append(downloads, d)
	}
	return downloads
}

// CancelDownload cancels an active download.
func (m *DownloadManager) CancelDownload(id string) error {
	m.mu.RLock()
	download, ok := m.downloads[id]
	m.mu.RUnlock()

	if !ok {
		return ErrDownloadNotFound
	}

	if download.Status == "complete" || download.Status == "error" || download.Status == "canceled" {
		return ErrDownloadNotActive
	}

	download.cancel()
	return nil
}

// CleanupOldDownloads removes completed/errored downloads older than the given duration.
func (m *DownloadManager) CleanupOldDownloads(maxAge time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()

	cutoff := time.Now().Add(-maxAge)
	for id, d := range m.downloads {
		if d.StartedAt.Before(cutoff) && (d.Status == "complete" || d.Status == "error" || d.Status == "canceled") {
			delete(m.downloads, id)
		}
	}
}
