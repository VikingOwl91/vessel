package api

import (
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// SearchRequest represents a web search request
type SearchRequest struct {
	Query      string `json:"query" binding:"required"`
	MaxResults int    `json:"maxResults"`
}

// SearchResult represents a single search result
type SearchResult struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Snippet string `json:"snippet"`
}

// WebSearchProxyHandler returns a handler that performs web searches via DuckDuckGo
// Uses curl/wget when available for better compatibility
func WebSearchProxyHandler() gin.HandlerFunc {
	fetcher := GetFetcher()

	return func(c *gin.Context) {
		var req SearchRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		// Set default and max results
		maxResults := req.MaxResults
		if maxResults <= 0 {
			maxResults = 5
		}
		if maxResults > 10 {
			maxResults = 10
		}

		// Build DuckDuckGo HTML search URL
		searchURL := fmt.Sprintf("https://html.duckduckgo.com/html/?q=%s", url.QueryEscape(req.Query))

		// Set up fetch options with browser-like headers
		opts := DefaultFetchOptions()
		opts.Timeout = 20 * time.Second
		opts.MaxLength = 500000 // 500KB is plenty for search results

		// Fetch search results
		result, err := fetcher.Fetch(c.Request.Context(), searchURL, opts)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "failed to perform search: " + err.Error()})
			return
		}

		// Check status
		if result.StatusCode >= 400 {
			c.JSON(http.StatusBadGateway, gin.H{"error": "search failed: HTTP " + http.StatusText(result.StatusCode)})
			return
		}

		// Parse results from HTML
		results := parseDuckDuckGoResults(result.Content, maxResults)

		c.JSON(http.StatusOK, gin.H{
			"query":       req.Query,
			"results":     results,
			"count":       len(results),
			"fetchMethod": string(result.Method),
		})
	}
}

// parseDuckDuckGoResults extracts search results from DuckDuckGo HTML
func parseDuckDuckGoResults(html string, maxResults int) []SearchResult {
	var results []SearchResult

	// DuckDuckGo HTML result structure:
	// <div class="result results_links results_links_deep web-result">
	//   <a class="result__a" href="...">Title</a>
	//   <a class="result__snippet">Snippet text...</a>
	// </div>

	// Match each result block (more permissive pattern)
	resultPattern := regexp.MustCompile(`(?s)<div[^>]*class="[^"]*results_links[^"]*"[^>]*>(.*?)</div>\s*</div>`)

	// Patterns for extracting components
	titleURLPattern := regexp.MustCompile(`(?s)<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]+)</a>`)
	snippetPattern := regexp.MustCompile(`(?s)<a[^>]*class="result__snippet"[^>]*>(.*?)</a>`)

	resultBlocks := resultPattern.FindAllStringSubmatch(html, maxResults*3)

	for _, match := range resultBlocks {
		if len(results) >= maxResults {
			break
		}
		if len(match) < 2 {
			continue
		}

		block := match[1]
		var result SearchResult

		// Extract title and URL
		titleMatch := titleURLPattern.FindStringSubmatch(block)
		if len(titleMatch) >= 3 {
			result.URL = decodeURL(titleMatch[1])
			result.Title = cleanHTML(titleMatch[2])
		}

		// Extract snippet (can contain HTML like <b> tags)
		snippetMatch := snippetPattern.FindStringSubmatch(block)
		if len(snippetMatch) >= 2 {
			result.Snippet = cleanHTML(snippetMatch[1])
		}

		// Only add if we have a title and URL
		if result.Title != "" && result.URL != "" {
			// Skip DuckDuckGo internal links
			if strings.Contains(result.URL, "duckduckgo.com") {
				continue
			}
			results = append(results, result)
		}
	}

	// Fallback: try a simpler pattern if no results found
	if len(results) == 0 {
		results = parseSimpleDuckDuckGo(html, maxResults)
	}

	return results
}

// parseSimpleDuckDuckGo is a fallback parser using simpler patterns
func parseSimpleDuckDuckGo(html string, maxResults int) []SearchResult {
	var results []SearchResult

	// Look for result__a links (main result titles)
	pattern := regexp.MustCompile(`(?s)<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)</a>`)
	matches := pattern.FindAllStringSubmatch(html, maxResults*2)

	for _, match := range matches {
		if len(results) >= maxResults {
			break
		}

		if len(match) >= 3 {
			url := decodeURL(match[1])
			title := cleanHTML(match[2])

			// Skip empty or DuckDuckGo internal
			if url == "" || title == "" || strings.Contains(url, "duckduckgo.com") {
				continue
			}

			results = append(results, SearchResult{
				Title:   title,
				URL:     url,
				Snippet: "", // Snippet extraction is more complex
			})
		}
	}

	return results
}

// decodeURL extracts the actual URL from DuckDuckGo's redirect URL
func decodeURL(ddgURL string) string {
	// DuckDuckGo wraps URLs in redirect links like:
	// //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com&...
	if strings.Contains(ddgURL, "uddg=") {
		parsed, err := url.Parse(ddgURL)
		if err == nil {
			uddg := parsed.Query().Get("uddg")
			if uddg != "" {
				return uddg
			}
		}
	}

	// Sometimes URLs start with // (protocol-relative)
	if strings.HasPrefix(ddgURL, "//") {
		return "https:" + ddgURL
	}

	return ddgURL
}

// cleanHTML removes HTML tags and decodes entities
func cleanHTML(s string) string {
	// Remove HTML tags
	tagPattern := regexp.MustCompile(`<[^>]*>`)
	s = tagPattern.ReplaceAllString(s, "")

	// Decode common HTML entities
	s = strings.ReplaceAll(s, "&amp;", "&")
	s = strings.ReplaceAll(s, "&lt;", "<")
	s = strings.ReplaceAll(s, "&gt;", ">")
	s = strings.ReplaceAll(s, "&quot;", "\"")
	s = strings.ReplaceAll(s, "&#39;", "'")
	s = strings.ReplaceAll(s, "&nbsp;", " ")

	// Clean up whitespace
	s = strings.TrimSpace(s)
	spacePattern := regexp.MustCompile(`\s+`)
	s = spacePattern.ReplaceAllString(s, " ")

	return s
}
