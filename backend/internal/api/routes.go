package api

import (
	"database/sql"
	"log"

	"github.com/gin-gonic/gin"
)

// SetupRoutes configures all API routes
func SetupRoutes(r *gin.Engine, db *sql.DB, ollamaURL string, appVersion string) {
	// Initialize Ollama service with official client
	ollamaService, err := NewOllamaService(ollamaURL)
	if err != nil {
		log.Printf("Warning: Failed to initialize Ollama service: %v", err)
	}

	// Initialize model registry service
	var modelRegistry *ModelRegistryService
	if ollamaService != nil {
		modelRegistry = NewModelRegistryService(db, ollamaService.Client())
	} else {
		modelRegistry = NewModelRegistryService(db, nil)
	}

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Version endpoint (for update notifications)
	r.GET("/api/v1/version", VersionHandler(appVersion))

	// API v1 routes
	v1 := r.Group("/api/v1")
	{
		// Chat routes
		chats := v1.Group("/chats")
		{
			chats.GET("", ListChatsHandler(db))
			chats.GET("/grouped", ListGroupedChatsHandler(db))
			chats.POST("", CreateChatHandler(db))
			chats.GET("/:id", GetChatHandler(db))
			chats.PUT("/:id", UpdateChatHandler(db))
			chats.DELETE("/:id", DeleteChatHandler(db))

			// Message routes (nested under chats)
			chats.POST("/:id/messages", CreateMessageHandler(db))
		}

		// Sync routes
		sync := v1.Group("/sync")
		{
			sync.POST("/push", PushChangesHandler(db))
			sync.GET("/pull", PullChangesHandler(db))
		}

		// URL fetch proxy (for tools that need to fetch external URLs)
		// Uses curl/wget when available, falls back to native Go HTTP client
		v1.POST("/proxy/fetch", URLFetchProxyHandler())
		v1.GET("/proxy/fetch-method", GetFetchMethodHandler())

		// Web search proxy (for web_search tool)
		v1.POST("/proxy/search", WebSearchProxyHandler())

		// IP-based geolocation (fallback when browser geolocation fails)
		v1.GET("/location", IPGeolocationHandler())

		// Tool execution (for Python tools)
		v1.POST("/tools/execute", ExecuteToolHandler())

		// Model registry routes (cached models from ollama.com)
		models := v1.Group("/models")
		{
			// === Local Models (from Ollama instance) ===
			// List local models with filtering, sorting, pagination
			models.GET("/local", modelRegistry.ListLocalModelsHandler())
			// Get unique model families for filter dropdowns
			models.GET("/local/families", modelRegistry.GetLocalFamiliesHandler())
			// Check for available updates (compares local vs remote registry)
			models.GET("/local/updates", modelRegistry.CheckUpdatesHandler())

			// === Remote Models (from ollama.com cache) ===
			// List/search remote models (from cache)
			models.GET("/remote", modelRegistry.ListRemoteModelsHandler())
			// Get single model details
			models.GET("/remote/:slug", modelRegistry.GetRemoteModelHandler())
			// Fetch detailed info from Ollama (requires model to be pulled)
			models.POST("/remote/:slug/details", modelRegistry.FetchModelDetailsHandler())
			// Fetch tag sizes from ollama.com (scrapes model detail page)
			models.POST("/remote/:slug/sizes", modelRegistry.FetchTagSizesHandler())
			// Sync models from ollama.com
			models.POST("/remote/sync", modelRegistry.SyncModelsHandler())
			// Get sync status
			models.GET("/remote/status", modelRegistry.SyncStatusHandler())
		}

		// Ollama API routes (using official client)
		if ollamaService != nil {
			ollama := v1.Group("/ollama")
			{
				// Model management
				ollama.GET("/api/tags", ollamaService.ListModelsHandler())
				ollama.POST("/api/show", ollamaService.ShowModelHandler())
				ollama.POST("/api/pull", ollamaService.PullModelHandler())
				ollama.DELETE("/api/delete", ollamaService.DeleteModelHandler())
				ollama.POST("/api/copy", ollamaService.CopyModelHandler())

				// Chat and generation
				ollama.POST("/api/chat", ollamaService.ChatHandler())
				ollama.POST("/api/generate", ollamaService.GenerateHandler())

				// Embeddings
				ollama.POST("/api/embed", ollamaService.EmbedHandler())
				ollama.POST("/api/embeddings", ollamaService.EmbedHandler()) // Legacy endpoint

				// Status
				ollama.GET("/api/version", ollamaService.VersionHandler())
				ollama.GET("/", ollamaService.HeartbeatHandler())
			}
		}

		// Fallback proxy for direct Ollama access (separate path to avoid conflicts)
		v1.Any("/ollama-proxy/*path", OllamaProxyHandler(ollamaURL))
	}
}
