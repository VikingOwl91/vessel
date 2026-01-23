package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	"vessel-backend/internal/api"
	"vessel-backend/internal/backends"
	"vessel-backend/internal/backends/ollama"
	"vessel-backend/internal/backends/openai"
	"vessel-backend/internal/database"
)

// Version is set at build time via -ldflags, or defaults to dev
var Version = "0.6.1"

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func main() {
	var (
		port        = flag.String("port", getEnvOrDefault("PORT", "8080"), "Server port")
		dbPath      = flag.String("db", getEnvOrDefault("DB_PATH", "./data/vessel.db"), "Database file path")
		ollamaURL   = flag.String("ollama-url", getEnvOrDefault("OLLAMA_URL", "http://localhost:11434"), "Ollama API URL")
		llamacppURL = flag.String("llamacpp-url", getEnvOrDefault("LLAMACPP_URL", "http://localhost:8081"), "llama.cpp server URL")
		lmstudioURL = flag.String("lmstudio-url", getEnvOrDefault("LMSTUDIO_URL", "http://localhost:1234"), "LM Studio server URL")
	)
	flag.Parse()

	// Initialize database
	db, err := database.OpenDatabase(*dbPath)
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	defer db.Close()

	// Run migrations
	if err := database.RunMigrations(db); err != nil {
		log.Fatalf("Failed to run migrations: %v", err)
	}

	// Initialize backend registry
	registry := backends.NewRegistry()

	// Register Ollama backend
	ollamaAdapter, err := ollama.NewAdapter(backends.BackendConfig{
		Type:    backends.BackendTypeOllama,
		BaseURL: *ollamaURL,
	})
	if err != nil {
		log.Printf("Warning: Failed to create Ollama adapter: %v", err)
	} else {
		if err := registry.Register(ollamaAdapter); err != nil {
			log.Printf("Warning: Failed to register Ollama backend: %v", err)
		}
	}

	// Register llama.cpp backend (if URL is configured)
	if *llamacppURL != "" {
		llamacppAdapter, err := openai.NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeLlamaCpp,
			BaseURL: *llamacppURL,
		})
		if err != nil {
			log.Printf("Warning: Failed to create llama.cpp adapter: %v", err)
		} else {
			if err := registry.Register(llamacppAdapter); err != nil {
				log.Printf("Warning: Failed to register llama.cpp backend: %v", err)
			}
		}
	}

	// Register LM Studio backend (if URL is configured)
	if *lmstudioURL != "" {
		lmstudioAdapter, err := openai.NewAdapter(backends.BackendConfig{
			Type:    backends.BackendTypeLMStudio,
			BaseURL: *lmstudioURL,
		})
		if err != nil {
			log.Printf("Warning: Failed to create LM Studio adapter: %v", err)
		} else {
			if err := registry.Register(lmstudioAdapter); err != nil {
				log.Printf("Warning: Failed to register LM Studio backend: %v", err)
			}
		}
	}

	// Setup Gin router
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Logger())
	r.Use(gin.Recovery())

	// CORS configuration
	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	// Register routes
	api.SetupRoutes(r, db, *ollamaURL, Version, registry)

	// Create server
	srv := &http.Server{
		Addr:    ":" + *port,
		Handler: r,
	}

	// Initialize fetcher and log the method being used
	fetcher := api.GetFetcher()
	log.Printf("URL fetcher method: %s (headless Chrome: %v)", fetcher.Method(), fetcher.HasChrome())

	// Graceful shutdown handling
	go func() {
		log.Printf("Server starting on port %s", *port)
		log.Printf("Database: %s", *dbPath)
		log.Printf("Backends configured:")
		log.Printf("  - Ollama: %s", *ollamaURL)
		log.Printf("  - llama.cpp: %s", *llamacppURL)
		log.Printf("  - LM Studio: %s", *lmstudioURL)
		log.Printf("Active backend: %s", registry.ActiveType().String())
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}

	log.Println("Server exited")
}
