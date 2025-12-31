package api

import (
	"database/sql"
	"log"

	"github.com/gin-gonic/gin"
)

// SetupRoutes configures all API routes
func SetupRoutes(r *gin.Engine, db *sql.DB, ollamaURL string) {
	// Initialize Ollama service with official client
	ollamaService, err := NewOllamaService(ollamaURL)
	if err != nil {
		log.Printf("Warning: Failed to initialize Ollama service: %v", err)
	}

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// API v1 routes
	v1 := r.Group("/api/v1")
	{
		// Chat routes
		chats := v1.Group("/chats")
		{
			chats.GET("", ListChatsHandler(db))
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

				// Fallback proxy for any other endpoints
				ollama.Any("/*path", ollamaService.ProxyHandler())
			}
		} else {
			// Fallback to simple proxy if service init failed
			v1.Any("/ollama/*path", OllamaProxyHandler(ollamaURL))
		}
	}
}
