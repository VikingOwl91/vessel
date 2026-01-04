// Package huggingface provides a client for interacting with the HuggingFace API
// to search for GGUF models, retrieve model information, and list files.
package huggingface

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultBaseURL     = "https://huggingface.co"
	defaultTimeout     = 30 * time.Second
	maxRetries         = 3
	retryBaseDelay     = 1 * time.Second
	modelCacheTTL      = 1 * time.Hour
	fileListCacheTTL   = 15 * time.Minute
)

// Common errors returned by the client.
var (
	ErrNotFound      = errors.New("resource not found")
	ErrRateLimited   = errors.New("rate limited")
	ErrUnauthorized  = errors.New("unauthorized")
	ErrBadRequest    = errors.New("bad request")
	ErrServerError   = errors.New("server error")
)

// Client provides methods to interact with the HuggingFace API.
type Client struct {
	httpClient *http.Client
	apiToken   string
	baseURL    string

	// Cache for model info and file listings
	cacheMu        sync.RWMutex
	modelCache     map[string]*cacheEntry[*ModelInfo]
	fileListCache  map[string]*cacheEntry[[]FileInfo]
}

// cacheEntry wraps a cached value with expiration time.
type cacheEntry[T any] struct {
	value     T
	expiresAt time.Time
}

// SearchFilter contains parameters for filtering model searches.
type SearchFilter struct {
	Tags      []string // e.g., ["gguf", "llama"]
	Library   string   // e.g., "gguf"
	Sort      string   // "downloads", "likes", "modified"
	Direction string   // "asc", "desc"
	Limit     int
}

// Model represents a HuggingFace model from search results.
type Model struct {
	ID          string    `json:"id"`          // "TheBloke/Llama-2-7B-GGUF"
	Author      string    `json:"author"`
	ModelID     string    `json:"modelId"`
	SHA         string    `json:"sha"`
	Tags        []string  `json:"tags"`
	Downloads   int       `json:"downloads"`
	Likes       int       `json:"likes"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"lastModified"`
}

// ModelInfo extends Model with additional details.
type ModelInfo struct {
	Model
	Description string     `json:"description"`
	License     string     `json:"license"`
	Siblings    []FileInfo `json:"siblings"` // Files in repo
}

// FileInfo contains metadata about a file in a repository.
// Supports both model siblings (rfilename) and tree API (path) responses.
type FileInfo struct {
	Filename    string   `json:"rfilename"` // From model siblings
	Path        string   `json:"path"`      // From tree API
	Size        int64    `json:"size"`
	BlobID      string   `json:"oid"`
	LFS         *LFSInfo `json:"lfs,omitempty"`
	Type        string   `json:"type,omitempty"` // "file" or "directory" from tree API
}

// Name returns the filename, preferring Path over Filename (for tree API).
func (f FileInfo) Name() string {
	if f.Path != "" {
		return f.Path
	}
	return f.Filename
}

// TotalSize returns the file size, using LFS size if available.
func (f FileInfo) TotalSize() int64 {
	if f.LFS != nil && f.LFS.Size > 0 {
		return f.LFS.Size
	}
	return f.Size
}

// LFSInfo contains Git LFS metadata for large files.
type LFSInfo struct {
	Size        int64  `json:"size"`
	SHA256      string `json:"sha256"`
	PointerSize int    `json:"pointerSize"`
}

// GGUFFileInfo extends FileInfo with parsed GGUF metadata.
type GGUFFileInfo struct {
	FileInfo
	QuantType string // Parsed from filename: Q4_K_M, Q5_K_S, etc.
	ParamSize string // Parsed: 7B, 13B, 70B
	BaseModel string // Parsed: llama, mistral, etc.
}

// APIError represents an error response from the HuggingFace API.
type APIError struct {
	StatusCode int
	Message    string
	Err        error
}

func (e *APIError) Error() string {
	if e.Message != "" {
		return fmt.Sprintf("huggingface API error (HTTP %d): %s", e.StatusCode, e.Message)
	}
	return fmt.Sprintf("huggingface API error (HTTP %d): %v", e.StatusCode, e.Err)
}

func (e *APIError) Unwrap() error {
	return e.Err
}

// NewClient creates a new HuggingFace API client.
// The apiToken is optional but provides higher rate limits and access to private repos.
func NewClient(apiToken string) *Client {
	return &Client{
		httpClient: &http.Client{
			Timeout: defaultTimeout,
		},
		apiToken:      apiToken,
		baseURL:       defaultBaseURL,
		modelCache:    make(map[string]*cacheEntry[*ModelInfo]),
		fileListCache: make(map[string]*cacheEntry[[]FileInfo]),
	}
}

// NewClientWithOptions creates a client with custom HTTP client and base URL.
func NewClientWithOptions(apiToken string, httpClient *http.Client, baseURL string) *Client {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: defaultTimeout}
	}
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	return &Client{
		httpClient:    httpClient,
		apiToken:      apiToken,
		baseURL:       strings.TrimSuffix(baseURL, "/"),
		modelCache:    make(map[string]*cacheEntry[*ModelInfo]),
		fileListCache: make(map[string]*cacheEntry[[]FileInfo]),
	}
}

// SearchModels searches for GGUF models matching the query and filter criteria.
func (c *Client) SearchModels(ctx context.Context, query string, filter SearchFilter) ([]Model, error) {
	params := url.Values{}
	if query != "" {
		params.Set("search", query)
	}

	// Add filter for GGUF library by default if not specified
	if filter.Library != "" {
		params.Set("library", filter.Library)
	}

	// Add tags as filter
	for _, tag := range filter.Tags {
		params.Add("filter", tag)
	}

	// Sorting
	if filter.Sort != "" {
		params.Set("sort", filter.Sort)
	}
	if filter.Direction != "" {
		params.Set("direction", filter.Direction)
	}

	// Limit
	if filter.Limit > 0 {
		params.Set("limit", strconv.Itoa(filter.Limit))
	}

	endpoint := fmt.Sprintf("%s/api/models?%s", c.baseURL, params.Encode())

	var models []Model
	if err := c.doRequestWithRetry(ctx, http.MethodGet, endpoint, nil, &models); err != nil {
		return nil, fmt.Errorf("search models: %w", err)
	}

	return models, nil
}

// GetModel retrieves detailed information about a specific model.
// Results are cached for 1 hour.
func (c *Client) GetModel(ctx context.Context, repoID string) (*ModelInfo, error) {
	// Check cache first
	if cached := c.getModelFromCache(repoID); cached != nil {
		return cached, nil
	}

	// HuggingFace API expects the slash in owner/repo to NOT be escaped
	endpoint := fmt.Sprintf("%s/api/models/%s", c.baseURL, repoID)

	var info ModelInfo
	if err := c.doRequestWithRetry(ctx, http.MethodGet, endpoint, nil, &info); err != nil {
		return nil, fmt.Errorf("get model %s: %w", repoID, err)
	}

	// Cache the result
	c.cacheModel(repoID, &info)

	return &info, nil
}

// ListFiles lists all files in a repository at the specified path.
// Results are cached for 15 minutes.
func (c *Client) ListFiles(ctx context.Context, repoID string, path string) ([]FileInfo, error) {
	cacheKey := repoID + ":" + path

	// Check cache first
	if cached := c.getFileListFromCache(cacheKey); cached != nil {
		return cached, nil
	}

	// Build endpoint - path defaults to root (main branch)
	// HuggingFace API expects the slash in owner/repo to NOT be escaped
	endpoint := fmt.Sprintf("%s/api/models/%s/tree/main", c.baseURL, repoID)
	if path != "" && path != "/" {
		endpoint = fmt.Sprintf("%s/%s", endpoint, url.PathEscape(path))
	}

	var files []FileInfo
	if err := c.doRequestWithRetry(ctx, http.MethodGet, endpoint, nil, &files); err != nil {
		return nil, fmt.Errorf("list files %s/%s: %w", repoID, path, err)
	}

	// Cache the result
	c.cacheFileList(cacheKey, files)

	return files, nil
}

// GetFileInfo retrieves metadata for a specific file in a repository.
func (c *Client) GetFileInfo(ctx context.Context, repoID string, filename string) (*FileInfo, error) {
	// First, try to get the file info from the model's siblings list (cached)
	model, err := c.GetModel(ctx, repoID)
	if err == nil {
		for _, sibling := range model.Siblings {
			if sibling.Filename == filename {
				return &sibling, nil
			}
		}
	}

	// If not found in siblings, try the tree endpoint
	files, err := c.ListFiles(ctx, repoID, "")
	if err != nil {
		return nil, fmt.Errorf("get file info %s/%s: %w", repoID, filename, err)
	}

	for _, f := range files {
		if f.Filename == filename {
			return &f, nil
		}
	}

	return nil, fmt.Errorf("get file info %s/%s: %w", repoID, filename, ErrNotFound)
}

// GetGGUFFiles lists only .gguf files in a repository with parsed metadata.
// Uses the tree API to get accurate file sizes since the model siblings list
// often doesn't include them.
func (c *Client) GetGGUFFiles(ctx context.Context, repoID string) ([]GGUFFileInfo, error) {
	// Use tree API to get files with proper sizes
	// The /tree/main endpoint returns file info including sizes
	treeFiles, err := c.ListFiles(ctx, repoID, "")
	if err != nil {
		return nil, fmt.Errorf("get GGUF files %s: %w", repoID, err)
	}

	var ggufFiles []GGUFFileInfo
	for _, file := range treeFiles {
		// Skip directories
		if file.Type == "directory" {
			continue
		}

		// Use Name() which prefers Path over Filename
		filename := file.Name()
		if !strings.HasSuffix(strings.ToLower(filename), ".gguf") {
			continue
		}

		quantType, paramSize, baseModel := parseGGUFFilename(filename)
		ggufFiles = append(ggufFiles, GGUFFileInfo{
			FileInfo:  file,
			QuantType: quantType,
			ParamSize: paramSize,
			BaseModel: baseModel,
		})
	}

	return ggufFiles, nil
}

// doRequestWithRetry performs an HTTP request with automatic retry on rate limiting.
func (c *Client) doRequestWithRetry(ctx context.Context, method, endpoint string, body io.Reader, result any) error {
	var lastErr error

	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			// Exponential backoff
			delay := retryBaseDelay * time.Duration(1<<(attempt-1))
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(delay):
			}
		}

		err := c.doRequest(ctx, method, endpoint, body, result)
		if err == nil {
			return nil
		}

		lastErr = err

		// Only retry on rate limiting
		var apiErr *APIError
		if errors.As(err, &apiErr) && apiErr.StatusCode == http.StatusTooManyRequests {
			continue
		}

		// Don't retry other errors
		return err
	}

	return fmt.Errorf("max retries exceeded: %w", lastErr)
}

// doRequest performs an HTTP request and decodes the JSON response.
func (c *Client) doRequest(ctx context.Context, method, endpoint string, body io.Reader, result any) error {
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Accept", "application/json")
	if c.apiToken != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiToken)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("execute request: %w", err)
	}
	defer resp.Body.Close()

	// Handle non-2xx status codes
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return c.handleErrorResponse(resp)
	}

	// Decode response
	if result != nil {
		if err := json.NewDecoder(resp.Body).Decode(result); err != nil {
			return fmt.Errorf("decode response: %w", err)
		}
	}

	return nil
}

// handleErrorResponse converts HTTP error responses to appropriate errors.
func (c *Client) handleErrorResponse(resp *http.Response) error {
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))

	var baseErr error
	var message string

	switch resp.StatusCode {
	case http.StatusNotFound:
		baseErr = ErrNotFound
		message = "resource not found"
	case http.StatusTooManyRequests:
		baseErr = ErrRateLimited
		message = "rate limited - retry later"
	case http.StatusUnauthorized:
		baseErr = ErrUnauthorized
		message = "invalid or missing API token"
	case http.StatusForbidden:
		baseErr = ErrUnauthorized
		message = "access denied"
	case http.StatusBadRequest:
		baseErr = ErrBadRequest
		message = "invalid request"
	default:
		if resp.StatusCode >= 500 {
			baseErr = ErrServerError
			message = "server error"
		} else {
			baseErr = errors.New("request failed")
			message = string(body)
		}
	}

	// Try to extract error message from response body
	if len(body) > 0 {
		var errResp struct {
			Error   string `json:"error"`
			Message string `json:"message"`
		}
		if json.Unmarshal(body, &errResp) == nil {
			if errResp.Error != "" {
				message = errResp.Error
			} else if errResp.Message != "" {
				message = errResp.Message
			}
		}
	}

	return &APIError{
		StatusCode: resp.StatusCode,
		Message:    message,
		Err:        baseErr,
	}
}

// Cache methods

func (c *Client) getModelFromCache(repoID string) *ModelInfo {
	c.cacheMu.RLock()
	defer c.cacheMu.RUnlock()

	entry, ok := c.modelCache[repoID]
	if !ok || time.Now().After(entry.expiresAt) {
		return nil
	}
	return entry.value
}

func (c *Client) cacheModel(repoID string, info *ModelInfo) {
	c.cacheMu.Lock()
	defer c.cacheMu.Unlock()

	c.modelCache[repoID] = &cacheEntry[*ModelInfo]{
		value:     info,
		expiresAt: time.Now().Add(modelCacheTTL),
	}
}

func (c *Client) getFileListFromCache(key string) []FileInfo {
	c.cacheMu.RLock()
	defer c.cacheMu.RUnlock()

	entry, ok := c.fileListCache[key]
	if !ok || time.Now().After(entry.expiresAt) {
		return nil
	}
	return entry.value
}

func (c *Client) cacheFileList(key string, files []FileInfo) {
	c.cacheMu.Lock()
	defer c.cacheMu.Unlock()

	c.fileListCache[key] = &cacheEntry[[]FileInfo]{
		value:     files,
		expiresAt: time.Now().Add(fileListCacheTTL),
	}
}

// ClearCache removes all cached entries.
func (c *Client) ClearCache() {
	c.cacheMu.Lock()
	defer c.cacheMu.Unlock()

	c.modelCache = make(map[string]*cacheEntry[*ModelInfo])
	c.fileListCache = make(map[string]*cacheEntry[[]FileInfo])
}

// GGUF filename parsing

var (
	// Matches quantization types like Q4_K_M, Q5_K_S, Q8_0, IQ4_XS, etc.
	quantPattern = regexp.MustCompile(`(?i)(I?Q\d+[_-]?[A-Z0-9]*[_-]?[A-Z]*)`)
	// Matches parameter sizes like 7B, 13B, 70B, 1.5B, etc.
	paramPattern = regexp.MustCompile(`(?i)(\d+(?:\.\d+)?[BbMm])`)
	// Matches common base model names
	baseModelPattern = regexp.MustCompile(`(?i)(llama|mistral|mixtral|phi|qwen|gemma|codellama|deepseek|yi|falcon|mpt|opt|bloom|starcoder|wizardlm|vicuna|orca|zephyr|neural|openhermes|nous|dolphin|stable|tinyllama)`)
)

// parseGGUFFilename extracts metadata from a GGUF filename.
// Examples:
//   - "llama-2-7b.Q4_K_M.gguf" -> Q4_K_M, 7B, llama
//   - "mistral-7b-instruct-v0.2.Q5_K_S.gguf" -> Q5_K_S, 7B, mistral
//   - "TheBloke_Llama-2-13B-chat-GGUF_Q4_K_M.gguf" -> Q4_K_M, 13B, llama
func parseGGUFFilename(filename string) (quantType, paramSize, baseModel string) {
	// Remove extension and path
	name := strings.TrimSuffix(filename, ".gguf")
	name = strings.TrimSuffix(name, ".GGUF")

	// Extract quantization type
	if match := quantPattern.FindString(name); match != "" {
		// Normalize: uppercase, use underscores
		quantType = strings.ToUpper(strings.ReplaceAll(match, "-", "_"))
	}

	// Extract parameter size
	if match := paramPattern.FindString(name); match != "" {
		// Normalize: uppercase
		paramSize = strings.ToUpper(match)
	}

	// Extract base model name
	if match := baseModelPattern.FindString(name); match != "" {
		baseModel = strings.ToLower(match)
	}

	return quantType, paramSize, baseModel
}

// GetDownloadURL returns the direct download URL for a file in a repository.
func (c *Client) GetDownloadURL(repoID, filename string) string {
	return fmt.Sprintf("%s/%s/resolve/main/%s", c.baseURL, repoID, filename)
}

// IsGGUFFile checks if a filename is a GGUF file.
func IsGGUFFile(filename string) bool {
	lower := strings.ToLower(filename)
	return strings.HasSuffix(lower, ".gguf")
}
