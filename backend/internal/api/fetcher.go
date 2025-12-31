package api

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/cookiejar"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/chromedp/chromedp"
)

// FetchMethod represents the method used to fetch URLs
type FetchMethod string

const (
	FetchMethodCurl     FetchMethod = "curl"
	FetchMethodWget     FetchMethod = "wget"
	FetchMethodChrome   FetchMethod = "chrome"
	FetchMethodNative   FetchMethod = "native"
)

// FetchResult contains the result of a URL fetch
type FetchResult struct {
	Content     string
	ContentType string
	FinalURL    string
	StatusCode  int
	Method      FetchMethod
}

// FetchOptions configures the fetch behavior
type FetchOptions struct {
	MaxLength        int
	Timeout          time.Duration
	UserAgent        string
	Headers          map[string]string
	FollowRedirects  bool
	// ForceHeadless forces using headless browser even if curl succeeds
	ForceHeadless    bool
	// WaitForSelector waits for a specific CSS selector before capturing content
	WaitForSelector  string
	// WaitTime is additional time to wait for JS to render (default 2s for headless)
	WaitTime         time.Duration
}

// DefaultFetchOptions returns sensible defaults
func DefaultFetchOptions() FetchOptions {
	return FetchOptions{
		MaxLength:       500000, // 500KB
		Timeout:         30 * time.Second,
		UserAgent:       "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		Headers:         make(map[string]string),
		FollowRedirects: true,
		WaitTime:        2 * time.Second,
	}
}

// Fetcher provides URL fetching with multiple backend support
type Fetcher struct {
	curlPath    string
	wgetPath    string
	chromePath  string
	httpClient  *http.Client
	method      FetchMethod
	hasChrome   bool
	mu          sync.RWMutex

	// chromedp allocator context (reused for efficiency)
	allocCtx    context.Context
	allocCancel context.CancelFunc
}

var (
	globalFetcher *Fetcher
	fetcherOnce   sync.Once
)

// GetFetcher returns the singleton Fetcher instance
func GetFetcher() *Fetcher {
	fetcherOnce.Do(func() {
		globalFetcher = NewFetcher()
	})
	return globalFetcher
}

// NewFetcher creates a new Fetcher, detecting available tools
func NewFetcher() *Fetcher {
	f := &Fetcher{}
	f.detectTools()
	f.initHTTPClient()
	f.initChromeDp()
	return f
}

// detectTools checks which external tools are available
func (f *Fetcher) detectTools() {
	f.mu.Lock()
	defer f.mu.Unlock()

	// Check for curl
	if path, err := exec.LookPath("curl"); err == nil {
		f.curlPath = path
		f.method = FetchMethodCurl
	}

	// Check for wget
	if path, err := exec.LookPath("wget"); err == nil {
		f.wgetPath = path
		if f.method == "" {
			f.method = FetchMethodWget
		}
	}

	// Check for Chrome/Chromium (for headless browser support)
	chromePaths := []string{
		"google-chrome",
		"google-chrome-stable",
		"chromium",
		"chromium-browser",
		"/usr/bin/google-chrome",
		"/usr/bin/chromium",
		"/usr/bin/chromium-browser",
		"/snap/bin/chromium",
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	}

	for _, p := range chromePaths {
		if path, err := exec.LookPath(p); err == nil {
			f.chromePath = path
			f.hasChrome = true
			log.Printf("[Fetcher] Found Chrome at: %s", path)
			break
		}
	}

	// Fall back to native if nothing else available
	if f.method == "" {
		f.method = FetchMethodNative
	}
}

// initHTTPClient sets up the native Go HTTP client with cookie support
func (f *Fetcher) initHTTPClient() {
	jar, _ := cookiejar.New(nil)

	f.httpClient = &http.Client{
		Jar:     jar,
		Timeout: 30 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return fmt.Errorf("too many redirects")
			}
			return nil
		},
	}
}

// initChromeDp initializes the chromedp allocator if Chrome is available
func (f *Fetcher) initChromeDp() {
	if !f.hasChrome {
		return
	}

	// Create a persistent allocator context for reuse
	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.Flag("headless", true),
		chromedp.Flag("disable-gpu", true),
		chromedp.Flag("no-sandbox", true),
		chromedp.Flag("disable-dev-shm-usage", true),
		chromedp.Flag("disable-extensions", true),
		chromedp.Flag("disable-background-networking", true),
		chromedp.Flag("disable-sync", true),
		chromedp.Flag("disable-translate", true),
		chromedp.Flag("mute-audio", true),
		chromedp.Flag("hide-scrollbars", true),
		chromedp.UserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"),
	)

	if f.chromePath != "" {
		opts = append(opts, chromedp.ExecPath(f.chromePath))
	}

	f.allocCtx, f.allocCancel = chromedp.NewExecAllocator(context.Background(), opts...)
	log.Printf("[Fetcher] Chrome headless browser initialized")
}

// Close cleans up resources
func (f *Fetcher) Close() {
	if f.allocCancel != nil {
		f.allocCancel()
	}
}

// Method returns the current primary fetch method being used
func (f *Fetcher) Method() FetchMethod {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return f.method
}

// HasChrome returns whether headless Chrome is available
func (f *Fetcher) HasChrome() bool {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return f.hasChrome
}

// Fetch fetches a URL using the best available method
// For most sites, uses curl/wget. Falls back to headless browser for JS-heavy sites.
func (f *Fetcher) Fetch(ctx context.Context, url string, opts FetchOptions) (*FetchResult, error) {
	// If force headless is set and Chrome is available, use it directly
	if opts.ForceHeadless && f.hasChrome {
		return f.fetchWithChrome(ctx, url, opts)
	}

	// Try fast methods first
	result, err := f.fetchFast(ctx, url, opts)
	if err != nil {
		return nil, err
	}

	// Check if content looks like a JS-rendered page that needs headless browser
	if f.hasChrome && f.isJSRenderedPage(result.Content) {
		log.Printf("[Fetcher] Content appears to be JS-rendered, trying headless browser for: %s", url)
		headlessResult, headlessErr := f.fetchWithChrome(ctx, url, opts)
		if headlessErr == nil && len(headlessResult.Content) > len(result.Content) {
			return headlessResult, nil
		}
		// If headless failed or got less content, return original
		if headlessErr != nil {
			log.Printf("[Fetcher] Headless browser failed: %v, using original content", headlessErr)
		}
	}

	return result, nil
}

// fetchFast tries curl, wget, or native HTTP in order
func (f *Fetcher) fetchFast(ctx context.Context, url string, opts FetchOptions) (*FetchResult, error) {
	f.mu.RLock()
	curlPath := f.curlPath
	wgetPath := f.wgetPath
	method := f.method
	f.mu.RUnlock()

	switch method {
	case FetchMethodCurl:
		return f.fetchWithCurl(ctx, url, curlPath, opts)
	case FetchMethodWget:
		return f.fetchWithWget(ctx, url, wgetPath, opts)
	default:
		return f.fetchNative(ctx, url, opts)
	}
}

// isJSRenderedPage checks if the content appears to be a JS-rendered page
// that hasn't actually rendered its content yet
func (f *Fetcher) isJSRenderedPage(content string) bool {
	// Too short content often indicates JS rendering needed
	if len(strings.TrimSpace(content)) < 500 {
		return true
	}

	// Common patterns indicating JS-only rendering
	jsPatterns := []string{
		`<div id="root"></div>`,
		`<div id="app"></div>`,
		`<div id="__next"></div>`,
		`<div id="__nuxt"></div>`,
		`noscript`,
		`"Loading..."`,
		`"loading..."`,
		`window.__INITIAL_STATE__`,
		`window.__NUXT__`,
		`window.__NEXT_DATA__`,
	}

	contentLower := strings.ToLower(content)
	for _, pattern := range jsPatterns {
		if strings.Contains(contentLower, strings.ToLower(pattern)) {
			// Found JS pattern, but also check if there's substantial content
			// Extract text content (very rough)
			textContent := stripHTMLTags(content)
			if len(strings.TrimSpace(textContent)) < 1000 {
				return true
			}
		}
	}

	// Check for common documentation sites that need JS
	jsHeavySites := []string{
		"docs.rs",
		"reactjs.org",
		"vuejs.org",
		"angular.io",
		"nextjs.org",
		"vercel.com",
		"netlify.com",
	}

	for _, site := range jsHeavySites {
		if strings.Contains(content, site) {
			textContent := stripHTMLTags(content)
			if len(strings.TrimSpace(textContent)) < 2000 {
				return true
			}
		}
	}

	return false
}

// stripHTMLTags removes HTML tags from content (rough extraction)
func stripHTMLTags(content string) string {
	// Remove script and style tags with their content
	scriptRe := regexp.MustCompile(`(?is)<script[^>]*>.*?</script>`)
	content = scriptRe.ReplaceAllString(content, "")

	styleRe := regexp.MustCompile(`(?is)<style[^>]*>.*?</style>`)
	content = styleRe.ReplaceAllString(content, "")

	// Remove all remaining tags
	tagRe := regexp.MustCompile(`<[^>]*>`)
	content = tagRe.ReplaceAllString(content, " ")

	// Collapse whitespace
	spaceRe := regexp.MustCompile(`\s+`)
	content = spaceRe.ReplaceAllString(content, " ")

	return strings.TrimSpace(content)
}

// fetchWithChrome uses headless Chrome to fetch and render the page
func (f *Fetcher) fetchWithChrome(ctx context.Context, url string, opts FetchOptions) (*FetchResult, error) {
	if !f.hasChrome || f.allocCtx == nil {
		return nil, fmt.Errorf("headless Chrome not available")
	}

	// Create a timeout context
	timeout := opts.Timeout
	if timeout == 0 {
		timeout = 30 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	// Create a new browser context from the allocator
	browserCtx, browserCancel := chromedp.NewContext(f.allocCtx)
	defer browserCancel()

	var content string
	var finalURL string

	// Wait time for JS to render
	waitTime := opts.WaitTime
	if waitTime == 0 {
		waitTime = 2 * time.Second
	}

	// Build the actions
	actions := []chromedp.Action{
		chromedp.Navigate(url),
	}

	// Wait for specific selector if provided
	if opts.WaitForSelector != "" {
		actions = append(actions, chromedp.WaitVisible(opts.WaitForSelector, chromedp.ByQuery))
	} else {
		// Default: wait for body to be visible and give JS time to render
		actions = append(actions,
			chromedp.WaitVisible("body", chromedp.ByQuery),
			chromedp.Sleep(waitTime),
		)
	}

	// Get the final URL and content
	actions = append(actions,
		chromedp.Location(&finalURL),
		chromedp.OuterHTML("html", &content, chromedp.ByQuery),
	)

	// Execute
	if err := chromedp.Run(browserCtx, actions...); err != nil {
		return nil, fmt.Errorf("chromedp failed: %w", err)
	}

	// Truncate if needed
	if len(content) > opts.MaxLength {
		content = content[:opts.MaxLength]
	}

	return &FetchResult{
		Content:     content,
		ContentType: "text/html",
		FinalURL:    finalURL,
		StatusCode:  200,
		Method:      FetchMethodChrome,
	}, nil
}

// fetchWithCurl uses curl to fetch the URL
func (f *Fetcher) fetchWithCurl(ctx context.Context, url string, curlPath string, opts FetchOptions) (*FetchResult, error) {
	args := []string{
		"-sS",                          // Silent but show errors
		"-L",                           // Follow redirects
		"--max-time", fmt.Sprintf("%d", int(opts.Timeout.Seconds())),
		"--max-filesize", fmt.Sprintf("%d", opts.MaxLength),
		"-A", opts.UserAgent,           // User agent
		"-w", "\n---CURL_INFO---\n%{content_type}\n%{url_effective}\n%{http_code}", // Output metadata
		"--compressed",                 // Accept compressed responses
	}

	// Add custom headers
	for key, value := range opts.Headers {
		args = append(args, "-H", fmt.Sprintf("%s: %s", key, value))
	}

	// Add common headers for better compatibility
	args = append(args,
		"-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
		"-H", "Accept-Language: en-US,en;q=0.5",
		"-H", "DNT: 1",
		"-H", "Connection: keep-alive",
		"-H", "Upgrade-Insecure-Requests: 1",
	)

	args = append(args, url)

	cmd := exec.CommandContext(ctx, curlPath, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		// Check if it's a context cancellation
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("curl failed: %s - %s", err.Error(), stderr.String())
	}

	output := stdout.String()

	// Parse the output - content and metadata are separated by ---CURL_INFO---
	parts := strings.Split(output, "\n---CURL_INFO---\n")
	if len(parts) != 2 {
		return nil, fmt.Errorf("unexpected curl output format")
	}

	content := parts[0]
	metaLines := strings.Split(strings.TrimSpace(parts[1]), "\n")

	if len(metaLines) < 3 {
		return nil, fmt.Errorf("incomplete curl metadata")
	}

	contentType := metaLines[0]
	finalURL := metaLines[1]
	statusCode := 200
	fmt.Sscanf(metaLines[2], "%d", &statusCode)

	// Truncate content if needed
	if len(content) > opts.MaxLength {
		content = content[:opts.MaxLength]
	}

	return &FetchResult{
		Content:     content,
		ContentType: contentType,
		FinalURL:    finalURL,
		StatusCode:  statusCode,
		Method:      FetchMethodCurl,
	}, nil
}

// fetchWithWget uses wget to fetch the URL
func (f *Fetcher) fetchWithWget(ctx context.Context, url string, wgetPath string, opts FetchOptions) (*FetchResult, error) {
	args := []string{
		"-q",                           // Quiet
		"-O", "-",                      // Output to stdout
		"--timeout", fmt.Sprintf("%d", int(opts.Timeout.Seconds())),
		"--user-agent", opts.UserAgent,
		"--max-redirect", "10",         // Follow up to 10 redirects
		"--header", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
		"--header", "Accept-Language: en-US,en;q=0.5",
	}

	// Add custom headers
	for key, value := range opts.Headers {
		args = append(args, "--header", fmt.Sprintf("%s: %s", key, value))
	}

	args = append(args, url)

	cmd := exec.CommandContext(ctx, wgetPath, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("wget failed: %s - %s", err.Error(), stderr.String())
	}

	content := stdout.String()

	// Truncate content if needed
	if len(content) > opts.MaxLength {
		content = content[:opts.MaxLength]
	}

	// wget doesn't easily provide metadata, so we use defaults
	return &FetchResult{
		Content:     content,
		ContentType: "text/html", // Assume HTML (wget doesn't easily give us this)
		FinalURL:    url,         // wget doesn't easily give us the final URL
		StatusCode:  200,
		Method:      FetchMethodWget,
	}, nil
}

// fetchNative uses Go's native http.Client with enhanced capabilities
func (f *Fetcher) fetchNative(ctx context.Context, url string, opts FetchOptions) (*FetchResult, error) {
	// Create request with context
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Set headers
	req.Header.Set("User-Agent", opts.UserAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.5")
	req.Header.Set("Accept-Encoding", "gzip, deflate")
	req.Header.Set("DNT", "1")
	req.Header.Set("Connection", "keep-alive")
	req.Header.Set("Upgrade-Insecure-Requests", "1")

	// Add custom headers
	for key, value := range opts.Headers {
		req.Header.Set(key, value)
	}

	// Create a client with custom timeout
	client := &http.Client{
		Jar:     f.httpClient.Jar,
		Timeout: opts.Timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if !opts.FollowRedirects {
				return http.ErrUseLastResponse
			}
			if len(via) >= 10 {
				return fmt.Errorf("too many redirects")
			}
			return nil
		},
	}

	// Execute request
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	// Read body with limit
	body, err := io.ReadAll(io.LimitReader(resp.Body, int64(opts.MaxLength)))
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	return &FetchResult{
		Content:     string(body),
		ContentType: resp.Header.Get("Content-Type"),
		FinalURL:    resp.Request.URL.String(),
		StatusCode:  resp.StatusCode,
		Method:      FetchMethodNative,
	}, nil
}

// FetchWithHeadless explicitly uses headless browser (for API use)
func (f *Fetcher) FetchWithHeadless(ctx context.Context, url string, opts FetchOptions) (*FetchResult, error) {
	if !f.hasChrome {
		return nil, fmt.Errorf("headless Chrome not available - Chrome/Chromium not found")
	}
	return f.fetchWithChrome(ctx, url, opts)
}

// TryFetchWithFallback attempts to fetch using all available methods
func (f *Fetcher) TryFetchWithFallback(ctx context.Context, url string, opts FetchOptions) (*FetchResult, error) {
	f.mu.RLock()
	curlPath := f.curlPath
	wgetPath := f.wgetPath
	hasChrome := f.hasChrome
	f.mu.RUnlock()

	var lastErr error

	// Try curl first if available
	if curlPath != "" {
		result, err := f.fetchWithCurl(ctx, url, curlPath, opts)
		if err == nil {
			return result, nil
		}
		lastErr = fmt.Errorf("curl: %w", err)
	}

	// Try wget if available
	if wgetPath != "" {
		result, err := f.fetchWithWget(ctx, url, wgetPath, opts)
		if err == nil {
			return result, nil
		}
		lastErr = fmt.Errorf("wget: %w", err)
	}

	// Try native HTTP
	result, err := f.fetchNative(ctx, url, opts)
	if err == nil {
		return result, nil
	}
	lastErr = fmt.Errorf("native: %w", err)

	// Last resort: try headless Chrome
	if hasChrome {
		result, err := f.fetchWithChrome(ctx, url, opts)
		if err == nil {
			return result, nil
		}
		lastErr = fmt.Errorf("chrome: %w", err)
	}

	return nil, fmt.Errorf("all fetch methods failed: %v", lastErr)
}
