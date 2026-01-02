package api

import (
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// VersionInfo contains version information for the API response
type VersionInfo struct {
	Current   string `json:"current"`
	Latest    string `json:"latest,omitempty"`
	UpdateURL string `json:"updateUrl,omitempty"`
	HasUpdate bool   `json:"hasUpdate"`
}

// GitHubRelease represents the relevant fields from GitHub releases API
type GitHubRelease struct {
	TagName string `json:"tag_name"`
	HTMLURL string `json:"html_url"`
}

// versionCache holds cached version info with TTL
type versionCache struct {
	mu          sync.RWMutex
	latest      string
	updateURL   string
	lastFetched time.Time
	ttl         time.Duration
}

var cache = &versionCache{
	ttl: 1 * time.Hour,
}

// getGitHubRepo returns the GitHub repo path from env or default
func getGitHubRepo() string {
	if repo := os.Getenv("GITHUB_REPO"); repo != "" {
		return repo
	}
	return "vikingowl/vessel"
}

// fetchLatestRelease fetches the latest release from GitHub
func fetchLatestRelease() (string, string, error) {
	repo := getGitHubRepo()
	url := "https://api.github.com/repos/" + repo + "/releases/latest"

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", "", err
	}

	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", "Vessel-Update-Checker")

	resp, err := client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	// 404 means no releases yet - not an error
	if resp.StatusCode == http.StatusNotFound {
		return "", "", nil
	}

	if resp.StatusCode != http.StatusOK {
		return "", "", nil
	}

	var release GitHubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return "", "", err
	}

	// Strip 'v' prefix if present
	version := strings.TrimPrefix(release.TagName, "v")
	return version, release.HTMLURL, nil
}

// getLatestVersion returns cached version or fetches fresh
func getLatestVersion() (string, string) {
	cache.mu.RLock()
	if time.Since(cache.lastFetched) < cache.ttl && cache.latest != "" {
		latest, url := cache.latest, cache.updateURL
		cache.mu.RUnlock()
		return latest, url
	}
	cache.mu.RUnlock()

	// Fetch fresh
	latest, url, err := fetchLatestRelease()
	if err != nil {
		return "", ""
	}

	// Update cache
	cache.mu.Lock()
	cache.latest = latest
	cache.updateURL = url
	cache.lastFetched = time.Now()
	cache.mu.Unlock()

	return latest, url
}

// compareVersions returns true if latest > current (semver comparison)
func compareVersions(current, latest string) bool {
	if latest == "" || current == "" {
		return false
	}

	// Strip 'v' prefix if present
	current = strings.TrimPrefix(current, "v")
	latest = strings.TrimPrefix(latest, "v")

	currentParts := strings.Split(current, ".")
	latestParts := strings.Split(latest, ".")

	// Compare each segment
	maxLen := len(currentParts)
	if len(latestParts) > maxLen {
		maxLen = len(latestParts)
	}

	for i := 0; i < maxLen; i++ {
		var currentNum, latestNum int

		if i < len(currentParts) {
			currentNum, _ = strconv.Atoi(strings.Split(currentParts[i], "-")[0])
		}
		if i < len(latestParts) {
			latestNum, _ = strconv.Atoi(strings.Split(latestParts[i], "-")[0])
		}

		if latestNum > currentNum {
			return true
		}
		if latestNum < currentNum {
			return false
		}
	}

	return false
}

// VersionHandler returns a handler that provides version information
func VersionHandler(currentVersion string) gin.HandlerFunc {
	return func(c *gin.Context) {
		latest, updateURL := getLatestVersion()

		info := VersionInfo{
			Current:   currentVersion,
			Latest:    latest,
			UpdateURL: updateURL,
			HasUpdate: compareVersions(currentVersion, latest),
		}

		c.JSON(http.StatusOK, info)
	}
}
