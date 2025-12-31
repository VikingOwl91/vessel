package api

import (
	"net/http"
	"net/url"
	"time"

	"github.com/gin-gonic/gin"
)

// URLFetchRequest represents a request to fetch a URL
type URLFetchRequest struct {
	URL       string `json:"url" binding:"required"`
	MaxLength int    `json:"maxLength"`
}

// URLFetchProxyHandler returns a handler that fetches URLs for the frontend
// This bypasses CORS restrictions for the fetch_url tool
// Uses curl/wget when available for better compatibility, falls back to native Go
func URLFetchProxyHandler() gin.HandlerFunc {
	fetcher := GetFetcher()

	return func(c *gin.Context) {
		var req URLFetchRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		// Validate URL
		parsedURL, err := url.Parse(req.URL)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid URL: " + err.Error()})
			return
		}

		// Only allow HTTP/HTTPS
		if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "only HTTP and HTTPS URLs are supported"})
			return
		}

		// Set up fetch options
		opts := DefaultFetchOptions()
		opts.Timeout = 30 * time.Second

		// Set max length (default 500KB)
		if req.MaxLength > 0 && req.MaxLength <= 500000 {
			opts.MaxLength = req.MaxLength
		}

		// Fetch the URL
		result, err := fetcher.Fetch(c.Request.Context(), req.URL, opts)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "failed to fetch URL: " + err.Error()})
			return
		}

		// Check status
		if result.StatusCode >= 400 {
			c.JSON(http.StatusBadGateway, gin.H{
				"error":  "HTTP " + http.StatusText(result.StatusCode),
				"status": result.StatusCode,
			})
			return
		}

		// Return the content
		c.JSON(http.StatusOK, gin.H{
			"content":     result.Content,
			"contentType": result.ContentType,
			"url":         result.FinalURL,
			"status":      result.StatusCode,
			"fetchMethod": string(result.Method),
		})
	}
}

// GetFetchMethodHandler returns a handler that reports the current fetch method
func GetFetchMethodHandler() gin.HandlerFunc {
	fetcher := GetFetcher()

	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"method":    string(fetcher.Method()),
			"hasChrome": fetcher.HasChrome(),
		})
	}
}
