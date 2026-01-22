package api

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"vessel-backend/internal/database"
	"vessel-backend/internal/models"

	"github.com/gin-gonic/gin"
	_ "modernc.org/sqlite"
)

func setupTestDB(t *testing.T) *sql.DB {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("failed to open test db: %v", err)
	}

	if err := database.RunMigrations(db); err != nil {
		t.Fatalf("failed to run migrations: %v", err)
	}

	return db
}

func setupRouter(db *sql.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(gin.Recovery())

	r.GET("/chats", ListChatsHandler(db))
	r.GET("/chats/grouped", ListGroupedChatsHandler(db))
	r.GET("/chats/:id", GetChatHandler(db))
	r.POST("/chats", CreateChatHandler(db))
	r.PATCH("/chats/:id", UpdateChatHandler(db))
	r.DELETE("/chats/:id", DeleteChatHandler(db))
	r.POST("/chats/:id/messages", CreateMessageHandler(db))

	return r
}

func TestListChatsHandler(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	router := setupRouter(db)

	// Seed some data
	chat1 := &models.Chat{ID: "chat1", Title: "Chat 1", Model: "gpt-4", Archived: false}
	chat2 := &models.Chat{ID: "chat2", Title: "Chat 2", Model: "gpt-4", Archived: true}
	models.CreateChat(db, chat1)
	models.CreateChat(db, chat2)

	t.Run("List non-archived chats", func(t *testing.T) {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("GET", "/chats", nil)
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}

		var response map[string][]models.Chat
		json.Unmarshal(w.Body.Bytes(), &response)
		if len(response["chats"]) != 1 {
			t.Errorf("expected 1 chat, got %d", len(response["chats"]))
		}
	})

	t.Run("List including archived chats", func(t *testing.T) {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("GET", "/chats?include_archived=true", nil)
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}

		var response map[string][]models.Chat
		json.Unmarshal(w.Body.Bytes(), &response)
		if len(response["chats"]) != 2 {
			t.Errorf("expected 2 chats, got %d", len(response["chats"]))
		}
	})
}

func TestListGroupedChatsHandler(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	router := setupRouter(db)

	// Seed some data
	models.CreateChat(db, &models.Chat{ID: "chat1", Title: "Apple Chat", Model: "gpt-4"})
	models.CreateChat(db, &models.Chat{ID: "chat2", Title: "Banana Chat", Model: "gpt-4"})

	t.Run("Search chats", func(t *testing.T) {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("GET", "/chats/grouped?search=Apple", nil)
		router.ServeHTTP(w, req)

		var resp models.GroupedChatsResponse
		json.Unmarshal(w.Body.Bytes(), &resp)
		if resp.Total != 1 {
			t.Errorf("expected 1 chat, got %d", resp.Total)
		}
	})

	t.Run("Pagination", func(t *testing.T) {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("GET", "/chats/grouped?limit=1&offset=0", nil)
		router.ServeHTTP(w, req)

		var resp models.GroupedChatsResponse
		json.Unmarshal(w.Body.Bytes(), &resp)
		if len(resp.Groups) != 1 || len(resp.Groups[0].Chats) != 1 {
			t.Errorf("expected 1 chat in response, got %d", len(resp.Groups[0].Chats))
		}
	})
}

func TestGetChatHandler(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	router := setupRouter(db)

	chat := &models.Chat{ID: "test-chat", Title: "Test Chat", Model: "gpt-4"}
	models.CreateChat(db, chat)

	t.Run("Get existing chat", func(t *testing.T) {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("GET", "/chats/test-chat", nil)
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	t.Run("Get non-existent chat", func(t *testing.T) {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("GET", "/chats/invalid", nil)
		router.ServeHTTP(w, req)

		if w.Code != http.StatusNotFound {
			t.Errorf("expected status 404, got %d", w.Code)
		}
	})
}

func TestCreateChatHandler(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	router := setupRouter(db)

	body := CreateChatRequest{Title: "New Chat Title", Model: "gpt-4"}
	jsonBody, _ := json.Marshal(body)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("POST", "/chats", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("expected status 201, got %d", w.Code)
	}

	var chat models.Chat
	json.Unmarshal(w.Body.Bytes(), &chat)
	if chat.Title != "New Chat Title" {
		t.Errorf("expected title 'New Chat Title', got '%s'", chat.Title)
	}
}

func TestUpdateChatHandler(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	router := setupRouter(db)

	chat := &models.Chat{ID: "test-chat", Title: "Old Title", Model: "gpt-4"}
	models.CreateChat(db, chat)

	newTitle := "Updated Title"
	body := UpdateChatRequest{Title: &newTitle}
	jsonBody, _ := json.Marshal(body)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest("PATCH", "/chats/test-chat", bytes.NewBuffer(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", w.Code)
	}

	var updatedChat models.Chat
	json.Unmarshal(w.Body.Bytes(), &updatedChat)
	if updatedChat.Title != "Updated Title" {
		t.Errorf("expected title 'Updated Title', got '%s'", updatedChat.Title)
	}
}

func TestDeleteChatHandler(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	router := setupRouter(db)

	chat := &models.Chat{ID: "test-chat", Title: "To Delete", Model: "gpt-4"}
	models.CreateChat(db, chat)

	t.Run("Delete existing chat", func(t *testing.T) {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("DELETE", "/chats/test-chat", nil)
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d", w.Code)
		}
	})

	t.Run("Delete non-existent chat", func(t *testing.T) {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("DELETE", "/chats/invalid", nil)
		router.ServeHTTP(w, req)

		if w.Code != http.StatusNotFound {
			t.Errorf("expected status 404, got %d", w.Code)
		}
	})
}

func TestCreateMessageHandler(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	router := setupRouter(db)

	chat := &models.Chat{ID: "test-chat", Title: "Message Test", Model: "gpt-4"}
	models.CreateChat(db, chat)

	t.Run("Create valid message", func(t *testing.T) {
		body := CreateMessageRequest{
			Role:    "user",
			Content: "Hello world",
		}
		jsonBody, _ := json.Marshal(body)

		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/chats/test-chat/messages", bytes.NewBuffer(jsonBody))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, req)

		if w.Code != http.StatusCreated {
			t.Errorf("expected status 201, got %d", w.Code)
			fmt.Println(w.Body.String())
		}
	})

	t.Run("Create message with invalid role", func(t *testing.T) {
		body := CreateMessageRequest{
			Role:    "invalid",
			Content: "Hello world",
		}
		jsonBody, _ := json.Marshal(body)

		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/chats/test-chat/messages", bytes.NewBuffer(jsonBody))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d", w.Code)
		}
	})
}
