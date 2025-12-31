package api

import (
	"database/sql"

	"github.com/gin-gonic/gin"
)

// SetupRoutes configures all API routes
func SetupRoutes(r *gin.Engine, db *sql.DB, ollamaURL string) {
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

		// Ollama proxy (optional)
		v1.Any("/ollama/*path", OllamaProxyHandler(ollamaURL))
	}
}
