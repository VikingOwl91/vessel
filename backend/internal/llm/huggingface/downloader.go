// Package huggingface provides utilities for downloading GGUF models from HuggingFace.
package huggingface

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	// HuggingFace API base URL.
	apiBaseURL = "https://huggingface.co/api/models"
	// HuggingFace file download base URL.
	downloadBaseURL = "https://huggingface.co"
	// User agent for requests.
	userAgent = "vessel/1.0"
	// Default HTTP timeout for metadata requests.
	defaultHTTPTimeout = 30 * time.Second
)

// Common errors returned by the downloader.
var (
	ErrAria2cNotFound    = errors.New("aria2c not found in PATH")
	ErrRepoNotFound      = errors.New("repository not found")
	ErrFileNotFound      = errors.New("file not found in repository")
	ErrHashMismatch      = errors.New("SHA256 hash verification failed")
	ErrDownloadFailed    = errors.New("download failed")
	ErrDiskFull          = errors.New("disk full or write error")
	ErrNetworkError      = errors.New("network error")
	ErrInvalidRepoID     = errors.New("invalid repository ID format (expected owner/repo)")
	ErrDownloadCanceled  = errors.New("download canceled")
)

// DownloadProgress reports the current state of a download operation.
type DownloadProgress struct {
	// Status describes the current operation: "downloading", "verifying", "complete", "error".
	Status string `json:"status"`
	// Downloaded is the number of bytes downloaded so far.
	Downloaded int64 `json:"downloaded"`
	// Total is the total file size in bytes.
	Total int64 `json:"total"`
	// Speed is the current download speed in bytes per second.
	Speed float64 `json:"speed"`
	// Percentage is the download progress from 0 to 100.
	Percentage float64 `json:"percentage"`
	// Error contains error details if Status is "error".
	Error string `json:"error,omitempty"`
}

// GGUFFile represents a GGUF model file available in a HuggingFace repository.
type GGUFFile struct {
	// Filename is the name of the file.
	Filename string `json:"filename"`
	// Size is the file size in bytes.
	Size int64 `json:"size"`
	// SHA256 is the file's SHA256 hash.
	SHA256 string `json:"sha256"`
	// QuantType is the quantization type extracted from the filename (e.g., Q4_K_M, Q5_K_S).
	QuantType string `json:"quant_type"`
	// URL is the direct download URL for the file.
	URL string `json:"url"`
}

// hfTreeEntry represents a file entry from the HuggingFace tree API.
type hfTreeEntry struct {
	Type string `json:"type"`
	Path string `json:"path"`
	Size int64  `json:"size"`
	OID  string `json:"oid"` // SHA256 hash
}

// GGUFDownloader handles downloading GGUF model files from HuggingFace.
type GGUFDownloader struct {
	modelsDir  string       // Base directory for storing models.
	aria2cPath string       // Path to aria2c binary, empty if not available.
	httpClient *http.Client // HTTP client for API requests.
	mu         sync.Mutex   // Protects concurrent operations.
}

// NewGGUFDownloader creates a new downloader instance.
// modelsDir is the base directory where models will be stored.
// Returns an error if the directory cannot be created.
func NewGGUFDownloader(modelsDir string) (*GGUFDownloader, error) {
	// Create models directory structure.
	hfDir := filepath.Join(modelsDir, "huggingface")
	if err := os.MkdirAll(hfDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create models directory: %w", err)
	}

	// Look for aria2c in PATH.
	aria2cPath, _ := exec.LookPath("aria2c")

	return &GGUFDownloader{
		modelsDir:  modelsDir,
		aria2cPath: aria2cPath,
		httpClient: &http.Client{
			Timeout: defaultHTTPTimeout,
		},
	}, nil
}

// HasAria2c returns true if aria2c is available for fast downloads.
func (d *GGUFDownloader) HasAria2c() bool {
	return d.aria2cPath != ""
}

// Download downloads a GGUF file from a HuggingFace repository.
// repoID should be in the format "owner/repo" (e.g., "TheBloke/Llama-2-7B-GGUF").
// filename is the specific GGUF file to download.
// progress is an optional callback for receiving download progress updates.
// Returns the local file path of the downloaded model.
func (d *GGUFDownloader) Download(ctx context.Context, repoID string, filename string, progress func(DownloadProgress)) (string, error) {
	// Validate repo ID format.
	if err := validateRepoID(repoID); err != nil {
		return "", err
	}

	// Get the destination path.
	destPath := d.GetModelPath(repoID, filename)

	// Create parent directories.
	if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
		return "", fmt.Errorf("failed to create model directory: %w", err)
	}

	// Check if already downloaded and verified.
	if d.IsDownloaded(repoID, filename) {
		hashPath := destPath + ".sha256"
		if _, err := os.Stat(hashPath); err == nil {
			// Read expected hash.
			hashBytes, err := os.ReadFile(hashPath)
			if err == nil {
				expectedHash := strings.TrimSpace(string(hashBytes))
				if err := d.VerifySHA256(destPath, expectedHash); err == nil {
					if progress != nil {
						stat, _ := os.Stat(destPath)
						progress(DownloadProgress{
							Status:     "complete",
							Downloaded: stat.Size(),
							Total:      stat.Size(),
							Percentage: 100,
						})
					}
					return destPath, nil
				}
			}
		}
	}

	// Get file info to retrieve size and hash.
	files, err := d.ListAvailableGGUFs(ctx, repoID)
	if err != nil {
		return "", fmt.Errorf("failed to list repository files: %w", err)
	}

	var targetFile *GGUFFile
	for i := range files {
		if files[i].Filename == filename {
			targetFile = &files[i]
			break
		}
	}
	if targetFile == nil {
		return "", fmt.Errorf("%w: %s", ErrFileNotFound, filename)
	}

	// Build download URL.
	url := targetFile.URL

	// Report initial progress.
	if progress != nil {
		progress(DownloadProgress{
			Status:     "downloading",
			Downloaded: 0,
			Total:      targetFile.Size,
			Percentage: 0,
		})
	}

	// Prefer aria2c for faster downloads, fall back to HTTP.
	var downloadErr error
	if d.aria2cPath != "" {
		downloadErr = d.DownloadWithAria2c(ctx, url, destPath, progress)
	} else {
		downloadErr = d.DownloadWithHTTP(ctx, url, destPath, progress)
	}

	if downloadErr != nil {
		return "", downloadErr
	}

	// Verify SHA256 if available.
	if targetFile.SHA256 != "" {
		if progress != nil {
			progress(DownloadProgress{
				Status:     "verifying",
				Downloaded: targetFile.Size,
				Total:      targetFile.Size,
				Percentage: 100,
			})
		}

		if err := d.VerifySHA256(destPath, targetFile.SHA256); err != nil {
			// Remove corrupted file.
			os.Remove(destPath)
			return "", err
		}

		// Store hash for future verification.
		hashPath := destPath + ".sha256"
		if err := os.WriteFile(hashPath, []byte(targetFile.SHA256), 0644); err != nil {
			// Non-fatal, just log.
			fmt.Fprintf(os.Stderr, "warning: failed to save hash file: %v\n", err)
		}
	}

	if progress != nil {
		progress(DownloadProgress{
			Status:     "complete",
			Downloaded: targetFile.Size,
			Total:      targetFile.Size,
			Percentage: 100,
		})
	}

	return destPath, nil
}

// DownloadWithAria2c downloads a file using aria2c for maximum speed.
// Uses 16 parallel connections with 1MB split size.
func (d *GGUFDownloader) DownloadWithAria2c(ctx context.Context, url string, destPath string, progress func(DownloadProgress)) error {
	if d.aria2cPath == "" {
		return ErrAria2cNotFound
	}

	destDir := filepath.Dir(destPath)
	destName := filepath.Base(destPath)

	// Build aria2c command with optimal settings.
	// -x 16: max connections per server
	// -s 16: split file into 16 parts
	// -k 1M: min split size 1MB
	// -c: continue/resume download
	// --console-log-level=notice: show progress
	// --summary-interval=1: update progress every second
	// -U: user agent
	args := []string{
		"-x", "16",
		"-s", "16",
		"-k", "1M",
		"-c",
		"--console-log-level=notice",
		"--summary-interval=1",
		"-U", userAgent,
		"-d", destDir,
		"-o", destName,
		url,
	}

	cmd := exec.CommandContext(ctx, d.aria2cPath, args...)

	// Capture stderr for progress parsing.
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start aria2c: %w", err)
	}

	// Parse progress from stderr.
	if progress != nil {
		go d.parseAria2cProgress(stderr, progress)
	} else {
		// Drain stderr to prevent blocking.
		go io.Copy(io.Discard, stderr)
	}

	// Wait for completion.
	if err := cmd.Wait(); err != nil {
		if ctx.Err() != nil {
			return ErrDownloadCanceled
		}
		return fmt.Errorf("%w: aria2c exited with error: %v", ErrDownloadFailed, err)
	}

	return nil
}

// parseAria2cProgress parses aria2c stderr output and calls the progress callback.
// aria2c progress lines look like:
// [#abc123 1.2GiB/4.5GiB(27%) CN:16 DL:125MiB ETA:27s]
func (d *GGUFDownloader) parseAria2cProgress(r io.Reader, progress func(DownloadProgress)) {
	// Regex to match aria2c progress output.
	// Example: [#abc123 1.2GiB/4.5GiB(27%) CN:16 DL:125MiB ETA:27s]
	progressRe := regexp.MustCompile(`\[#\w+\s+([0-9.]+)([KMGTi]+B?)/([0-9.]+)([KMGTi]+B?)\((\d+)%\).*DL:([0-9.]+)([KMGTi]+B?)`)

	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		line := scanner.Text()
		matches := progressRe.FindStringSubmatch(line)
		if len(matches) >= 8 {
			downloaded := parseSize(matches[1], matches[2])
			total := parseSize(matches[3], matches[4])
			percentage, _ := strconv.ParseFloat(matches[5], 64)
			speed := parseSize(matches[6], matches[7])

			progress(DownloadProgress{
				Status:     "downloading",
				Downloaded: downloaded,
				Total:      total,
				Speed:      float64(speed),
				Percentage: percentage,
			})
		}
	}
}

// parseSize converts a size string like "1.2" with unit "GiB" to bytes.
func parseSize(valueStr, unit string) int64 {
	value, err := strconv.ParseFloat(valueStr, 64)
	if err != nil {
		return 0
	}

	multiplier := int64(1)
	unit = strings.ToUpper(strings.TrimSuffix(unit, "B"))
	unit = strings.TrimSuffix(unit, "I")

	switch unit {
	case "K":
		multiplier = 1024
	case "M":
		multiplier = 1024 * 1024
	case "G":
		multiplier = 1024 * 1024 * 1024
	case "T":
		multiplier = 1024 * 1024 * 1024 * 1024
	}

	return int64(value * float64(multiplier))
}

// DownloadWithHTTP downloads a file using standard HTTP as a fallback.
// Supports resumable downloads via Range headers.
func (d *GGUFDownloader) DownloadWithHTTP(ctx context.Context, url string, destPath string, progress func(DownloadProgress)) error {
	// Check for existing partial download.
	var existingSize int64
	if stat, err := os.Stat(destPath); err == nil {
		existingSize = stat.Size()
	}

	// Create HTTP request.
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("User-Agent", userAgent)

	// Resume from existing download.
	if existingSize > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", existingSize))
	}

	// Use a client without timeout for large downloads.
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ErrDownloadCanceled
		}
		return fmt.Errorf("%w: %v", ErrNetworkError, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return ErrFileNotFound
	}

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		return fmt.Errorf("%w: HTTP %d", ErrDownloadFailed, resp.StatusCode)
	}

	// Determine total size.
	var totalSize int64
	if resp.StatusCode == http.StatusPartialContent {
		// Parse Content-Range: bytes 1000-9999/10000
		contentRange := resp.Header.Get("Content-Range")
		if parts := strings.Split(contentRange, "/"); len(parts) == 2 {
			totalSize, _ = strconv.ParseInt(parts[1], 10, 64)
		}
	} else {
		totalSize = resp.ContentLength
		existingSize = 0 // Server doesn't support range, start over.
	}

	// Open file for writing (append or create).
	var file *os.File
	if existingSize > 0 && resp.StatusCode == http.StatusPartialContent {
		file, err = os.OpenFile(destPath, os.O_WRONLY|os.O_APPEND, 0644)
	} else {
		file, err = os.Create(destPath)
	}
	if err != nil {
		return fmt.Errorf("%w: %v", ErrDiskFull, err)
	}
	defer file.Close()

	// Create progress reporter.
	var downloaded int64 = existingSize
	lastReport := time.Now()
	var lastDownloaded int64 = existingSize

	buf := make([]byte, 32*1024) // 32KB buffer
	for {
		select {
		case <-ctx.Done():
			return ErrDownloadCanceled
		default:
		}

		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, writeErr := file.Write(buf[:n]); writeErr != nil {
				return fmt.Errorf("%w: %v", ErrDiskFull, writeErr)
			}
			downloaded += int64(n)

			// Report progress every 100ms.
			if progress != nil && time.Since(lastReport) > 100*time.Millisecond {
				elapsed := time.Since(lastReport).Seconds()
				speed := float64(downloaded-lastDownloaded) / elapsed
				var percentage float64
				if totalSize > 0 {
					percentage = float64(downloaded) / float64(totalSize) * 100
				}

				progress(DownloadProgress{
					Status:     "downloading",
					Downloaded: downloaded,
					Total:      totalSize,
					Speed:      speed,
					Percentage: percentage,
				})

				lastReport = time.Now()
				lastDownloaded = downloaded
			}
		}

		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			if ctx.Err() != nil {
				return ErrDownloadCanceled
			}
			return fmt.Errorf("%w: %v", ErrNetworkError, readErr)
		}
	}

	return nil
}

// ListAvailableGGUFs lists all GGUF files available in a HuggingFace repository.
func (d *GGUFDownloader) ListAvailableGGUFs(ctx context.Context, repoID string) ([]GGUFFile, error) {
	if err := validateRepoID(repoID); err != nil {
		return nil, err
	}

	// Fetch repository tree.
	url := fmt.Sprintf("%s/%s/tree/main", apiBaseURL, repoID)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("User-Agent", userAgent)

	resp, err := d.httpClient.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ErrDownloadCanceled
		}
		return nil, fmt.Errorf("%w: %v", ErrNetworkError, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrRepoNotFound
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HuggingFace API error: HTTP %d", resp.StatusCode)
	}

	var entries []hfTreeEntry
	if err := json.NewDecoder(resp.Body).Decode(&entries); err != nil {
		return nil, fmt.Errorf("failed to parse API response: %w", err)
	}

	// Filter for GGUF files.
	var ggufFiles []GGUFFile
	for _, entry := range entries {
		if entry.Type != "file" {
			continue
		}
		if !strings.HasSuffix(strings.ToLower(entry.Path), ".gguf") {
			continue
		}

		ggufFiles = append(ggufFiles, GGUFFile{
			Filename:  entry.Path,
			Size:      entry.Size,
			SHA256:    entry.OID,
			QuantType: extractQuantType(entry.Path),
			URL:       fmt.Sprintf("%s/%s/resolve/main/%s", downloadBaseURL, repoID, entry.Path),
		})
	}

	return ggufFiles, nil
}

// GetModelPath returns the local file path where a model would be stored.
func (d *GGUFDownloader) GetModelPath(repoID, filename string) string {
	parts := strings.SplitN(repoID, "/", 2)
	if len(parts) != 2 {
		return filepath.Join(d.modelsDir, "huggingface", repoID, filename)
	}
	return filepath.Join(d.modelsDir, "huggingface", parts[0], parts[1], filename)
}

// IsDownloaded checks if a model file has already been downloaded.
func (d *GGUFDownloader) IsDownloaded(repoID, filename string) bool {
	path := d.GetModelPath(repoID, filename)
	stat, err := os.Stat(path)
	return err == nil && stat.Size() > 0
}

// VerifySHA256 verifies that a file matches the expected SHA256 hash.
func (d *GGUFDownloader) VerifySHA256(path string, expectedHash string) error {
	if expectedHash == "" {
		return nil // No hash to verify.
	}

	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("failed to open file for verification: %w", err)
	}
	defer file.Close()

	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return fmt.Errorf("failed to compute hash: %w", err)
	}

	actualHash := hex.EncodeToString(hasher.Sum(nil))
	if !strings.EqualFold(actualHash, expectedHash) {
		return fmt.Errorf("%w: expected %s, got %s", ErrHashMismatch, expectedHash, actualHash)
	}

	return nil
}

// DeleteModel removes a downloaded model and its hash file.
func (d *GGUFDownloader) DeleteModel(repoID, filename string) error {
	path := d.GetModelPath(repoID, filename)

	// Remove the model file.
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete model: %w", err)
	}

	// Remove the hash file.
	hashPath := path + ".sha256"
	if err := os.Remove(hashPath); err != nil && !os.IsNotExist(err) {
		// Non-fatal, just log.
		fmt.Fprintf(os.Stderr, "warning: failed to remove hash file: %v\n", err)
	}

	// Try to remove empty parent directories.
	dir := filepath.Dir(path)
	for dir != d.modelsDir && dir != "/" {
		if err := os.Remove(dir); err != nil {
			break // Directory not empty or other error.
		}
		dir = filepath.Dir(dir)
	}

	return nil
}

// validateRepoID checks that a repository ID is in the expected format.
func validateRepoID(repoID string) error {
	parts := strings.SplitN(repoID, "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return ErrInvalidRepoID
	}
	return nil
}

// extractQuantType extracts the quantization type from a GGUF filename.
// Examples: "model-Q4_K_M.gguf" -> "Q4_K_M", "model.Q5_K_S.gguf" -> "Q5_K_S"
func extractQuantType(filename string) string {
	// Common quantization patterns.
	patterns := []string{
		`[_.-](Q\d+_K_[A-Z]+)`,       // Q4_K_M, Q5_K_S, etc.
		`[_.-](Q\d+_[A-Z]+)`,         // Q4_0, Q5_1, etc.
		`[_.-](IQ\d+_[A-Z]+)`,        // IQ4_XS, IQ3_XXS, etc.
		`[_.-](F\d+)`,                // F16, F32
		`[_.-](BF\d+)`,               // BF16
		`[_.-](q\d+_k_[a-z]+)`,       // lowercase variants
	}

	for _, pattern := range patterns {
		re := regexp.MustCompile(pattern)
		if matches := re.FindStringSubmatch(filename); len(matches) >= 2 {
			return strings.ToUpper(matches[1])
		}
	}

	return ""
}
