import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

const dbPath = join(app.getPath('userData'), 'chat_history.db')

// Initialize DB
let db: Database.Database | null = null

export function getDB(): Database.Database {
  if (!db) {
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL') // Better performance
    initSchema()
  }
  return db
}

function initSchema(): void {
  if (!db) return

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      key TEXT PRIMARY KEY,
      label TEXT,
      timestamp INTEGER,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_key TEXT,
      role TEXT,
      content TEXT,
      timestamp INTEGER,
      status TEXT,
      sources TEXT, -- JSON string
      FOREIGN KEY(conversation_key) REFERENCES conversations(key) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conv_key ON messages(conversation_key);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    
    -- 性能优化：复合索引，用于按会话查询并按时间排序
    CREATE INDEX IF NOT EXISTS idx_messages_conv_timestamp ON messages(conversation_key, timestamp DESC);
  `)
}
