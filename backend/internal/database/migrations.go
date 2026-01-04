package database

import (
	"database/sql"
	"fmt"
)

const migrationsSQL = `
-- Chats table
CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'New Chat',
    model TEXT NOT NULL DEFAULT '',
    pinned INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_version INTEGER NOT NULL DEFAULT 1
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    parent_id TEXT,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    sibling_index INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_version INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES messages(id) ON DELETE SET NULL
);

-- Attachments table
CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    data BLOB NOT NULL,
    filename TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- Indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_parent_id ON messages(parent_id);
CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chats_sync_version ON chats(sync_version);
CREATE INDEX IF NOT EXISTS idx_messages_sync_version ON messages(sync_version);

-- Remote models registry (cached from ollama.com)
CREATE TABLE IF NOT EXISTS remote_models (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    model_type TEXT NOT NULL DEFAULT 'community' CHECK (model_type IN ('official', 'community')),

    -- Model architecture details (from ollama show)
    architecture TEXT,
    parameter_size TEXT,
    context_length INTEGER,
    embedding_length INTEGER,
    quantization TEXT,

    -- Capabilities (stored as JSON array)
    capabilities TEXT NOT NULL DEFAULT '[]',

    -- Default parameters (stored as JSON object)
    default_params TEXT NOT NULL DEFAULT '{}',

    -- License info
    license TEXT,

    -- Popularity metrics
    pull_count INTEGER NOT NULL DEFAULT 0,

    -- Available tags/variants (stored as JSON array)
    tags TEXT NOT NULL DEFAULT '[]',

    -- Timestamps
    ollama_updated_at TEXT,
    details_fetched_at TEXT,
    scraped_at TEXT NOT NULL DEFAULT (datetime('now')),

    -- URL to model page
    url TEXT NOT NULL
);

-- Indexes for remote models
CREATE INDEX IF NOT EXISTS idx_remote_models_name ON remote_models(name);
CREATE INDEX IF NOT EXISTS idx_remote_models_model_type ON remote_models(model_type);
CREATE INDEX IF NOT EXISTS idx_remote_models_pull_count ON remote_models(pull_count DESC);
CREATE INDEX IF NOT EXISTS idx_remote_models_scraped_at ON remote_models(scraped_at);

-- Settings table (key-value store for simple settings)
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Backend configurations table (LLM backend settings)
CREATE TABLE IF NOT EXISTS backend_configs (
    name TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    config_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- GGUF models table (local models with canonical identity)
CREATE TABLE IF NOT EXISTS gguf_models (
    id TEXT PRIMARY KEY,                    -- Computed from sha256
    repo_id TEXT,                           -- HuggingFace repo (nullable for local files)
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    sha256 TEXT NOT NULL,                   -- Checksum for identity verification
    file_size INTEGER NOT NULL,

    -- Metadata (extracted from GGUF or manifest)
    architecture TEXT,                      -- llama, mistral, qwen, etc.
    parameter_count TEXT,                   -- 7B, 13B, 70B
    quantization TEXT,                      -- Q4_K_M, Q8_0, F16
    context_length INTEGER,                 -- Max context window

    -- Chat template (critical for correct formatting)
    chat_template TEXT,                     -- Jinja2 template string
    chat_template_name TEXT,                -- Template identifier (chatml, llama2, etc.)
    stop_sequences TEXT DEFAULT '[]',       -- JSON array of stop tokens
    bos_token TEXT,                         -- Beginning of sequence token
    eos_token TEXT,                         -- End of sequence token
    default_system_prompt TEXT,             -- Default system message

    -- Status tracking
    download_status TEXT DEFAULT 'complete' CHECK (download_status IN ('pending', 'downloading', 'complete', 'failed', 'paused')),
    download_progress INTEGER DEFAULT 0,
    verified_at TEXT,                       -- Last checksum verification

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(file_path)
);

-- Indexes for GGUF models
CREATE INDEX IF NOT EXISTS idx_gguf_models_sha256 ON gguf_models(sha256);
CREATE INDEX IF NOT EXISTS idx_gguf_models_repo_id ON gguf_models(repo_id);
CREATE INDEX IF NOT EXISTS idx_gguf_models_architecture ON gguf_models(architecture);
CREATE INDEX IF NOT EXISTS idx_gguf_models_download_status ON gguf_models(download_status);

-- Chat templates table (centralized template storage)
CREATE TABLE IF NOT EXISTS chat_templates (
    name TEXT PRIMARY KEY,                  -- Template identifier (chatml, llama2, mistral, etc.)
    template TEXT NOT NULL,                 -- Jinja2 or Go template string
    stop_sequences TEXT DEFAULT '[]',       -- JSON array of stop tokens
    bos_token TEXT,
    eos_token TEXT,
    system_format TEXT,                     -- How to format system messages
    add_generation_prompt INTEGER DEFAULT 1, -- Whether to add assistant prefix
    description TEXT,                       -- Human-readable description
    source TEXT,                            -- Where this template came from
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pre-populate common chat templates
INSERT OR IGNORE INTO chat_templates (name, template, stop_sequences, bos_token, eos_token, description) VALUES
('chatml', '<|im_start|>system
{{system}}<|im_end|>
<|im_start|>user
{{user}}<|im_end|>
<|im_start|>assistant
{{assistant}}<|im_end|>', '["<|im_end|>", "<|im_start|>"]', '<|im_start|>', '<|im_end|>', 'ChatML format used by many models'),
('llama2', '[INST] <<SYS>>
{{system}}
<</SYS>>

{{user}} [/INST] {{assistant}} </s>', '["</s>"]', '<s>', '</s>', 'Llama 2 chat format'),
('llama3', '<|begin_of_text|><|start_header_id|>system<|end_header_id|>

{{system}}<|eot_id|><|start_header_id|>user<|end_header_id|}

{{user}}<|eot_id|><|start_header_id|>assistant<|end_header_id|>

{{assistant}}<|eot_id|>', '["<|eot_id|>", "<|end_of_text|>"]', '<|begin_of_text|>', '<|end_of_text|>', 'Llama 3 chat format'),
('mistral', '[INST] {{system}}

{{user}} [/INST]{{assistant}}</s>', '["</s>"]', '<s>', '</s>', 'Mistral instruct format'),
('gemma', '<start_of_turn>user
{{user}}<end_of_turn>
<start_of_turn>model
{{assistant}}<end_of_turn>', '["<end_of_turn>"]', '<bos>', '<eos>', 'Google Gemma format'),
('phi3', '<|system|>
{{system}}<|end|>
<|user|>
{{user}}<|end|>
<|assistant|>
{{assistant}}<|end|>', '["<|end|>", "<|endoftext|>"]', '', '<|endoftext|>', 'Microsoft Phi-3 format'),
('qwen2', '<|im_start|>system
{{system}}<|im_end|>
<|im_start|>user
{{user}}<|im_end|>
<|im_start|>assistant
{{assistant}}<|im_end|>', '["<|im_end|>", "<|endoftext|>"]', '', '<|endoftext|>', 'Qwen 2 format (ChatML variant)');

-- Model-to-template mapping (for models that don't embed their template)
CREATE TABLE IF NOT EXISTS model_template_mappings (
    model_pattern TEXT PRIMARY KEY,         -- Glob pattern to match model names
    template_name TEXT NOT NULL,            -- References chat_templates.name
    priority INTEGER DEFAULT 0,             -- Higher priority = checked first
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (template_name) REFERENCES chat_templates(name)
);

-- Pre-populate common model patterns
INSERT OR IGNORE INTO model_template_mappings (model_pattern, template_name, priority) VALUES
('*llama-3*', 'llama3', 100),
('*llama-2*', 'llama2', 90),
('*mistral*', 'mistral', 80),
('*gemma*', 'gemma', 80),
('*phi-3*', 'phi3', 80),
('*qwen*', 'qwen2', 80),
('*chatml*', 'chatml', 50),
('*', 'chatml', 0);
`

// Additional migrations for schema updates (run separately to handle existing tables)
const additionalMigrations = `
-- Add tag_sizes column for storing file sizes per tag variant
-- This column stores a JSON object mapping tag names to file sizes in bytes
-- Example: {"8b": 4700000000, "70b": 40000000000}
`

// RunMigrations executes all database migrations
func RunMigrations(db *sql.DB) error {
	_, err := db.Exec(migrationsSQL)
	if err != nil {
		return fmt.Errorf("failed to run migrations: %w", err)
	}

	// Add tag_sizes column if it doesn't exist
	// SQLite doesn't have IF NOT EXISTS for ALTER TABLE, so we check first
	var count int
	err = db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('remote_models') WHERE name='tag_sizes'`).Scan(&count)
	if err != nil {
		return fmt.Errorf("failed to check tag_sizes column: %w", err)
	}
	if count == 0 {
		_, err = db.Exec(`ALTER TABLE remote_models ADD COLUMN tag_sizes TEXT NOT NULL DEFAULT '{}'`)
		if err != nil {
			return fmt.Errorf("failed to add tag_sizes column: %w", err)
		}
	}

	// Add system_prompt_id column to chats table if it doesn't exist
	err = db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('chats') WHERE name='system_prompt_id'`).Scan(&count)
	if err != nil {
		return fmt.Errorf("failed to check system_prompt_id column: %w", err)
	}
	if count == 0 {
		_, err = db.Exec(`ALTER TABLE chats ADD COLUMN system_prompt_id TEXT`)
		if err != nil {
			return fmt.Errorf("failed to add system_prompt_id column: %w", err)
		}
	}

	return nil
}
