import { getDB } from './index'
import type { ChatMessage } from '../../../src/types/chat'

export function getAllConversations(): { key: string; label: string; timestamp: number }[] {
  const db = getDB()
  const stmt = db.prepare('SELECT key, label, timestamp FROM conversations ORDER BY timestamp DESC')
  return stmt.all() as { key: string; label: string; timestamp: number }[]
}

export function createConversation(key: string, label: string): void {
  const db = getDB()
  const now = Date.now()
  // 使用 INSERT OR IGNORE 避免重复 key 导致的错误
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO conversations (key, label, timestamp, created_at) VALUES (?, ?, ?, ?)'
  )
  stmt.run(key, label, now, now)
}

export function updateConversationTimestamp(key: string, label: string): void {
  const db = getDB()
  const now = Date.now()
  const stmt = db.prepare('UPDATE conversations SET timestamp = ?, label = ? WHERE key = ?')
  stmt.run(now, label, key)
}

export function deleteConversation(key: string): void {
  const db = getDB()
  const stmt = db.prepare('DELETE FROM conversations WHERE key = ?')
  stmt.run(key)
}

export function getMessages(
  conversationKey: string,
  limit: number = 50,
  offset: number = 0
): ChatMessage[] {
  const db = getDB()

  // 性能优化：使用子查询避免 JS 中的 reverse() 操作
  // 先获取最新的 N 条消息，然后按时间正序返回
  const stmt = db.prepare(`
    SELECT * FROM (
      SELECT id as key, role, content, timestamp, status, sources
      FROM messages
      WHERE conversation_key = ?
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    ) ORDER BY timestamp ASC
  `)

  const rows = stmt.all(conversationKey, limit, offset) as Array<{
    key: string
    role: 'user' | 'ai' | 'system'
    content: string
    timestamp: number
    status: 'success' | 'error' | 'pending'
    sources: string | null
  }>

  return rows.map((row) => ({
    key: row.key,
    role: row.role,
    content: row.content,
    timestamp: row.timestamp,
    status: row.status,
    sources: row.sources ? JSON.parse(row.sources) : undefined,
    typing: false // Stored messages are never typing
  }))
}

// 性能优化：使用事务合并多次数据库操作
export function saveMessage(conversationKey: string, message: ChatMessage): void {
  const db = getDB()

  const insertMsg = db.prepare(`
    INSERT OR REPLACE INTO messages (id, conversation_key, role, content, timestamp, status, sources)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const updateConv = db.prepare('UPDATE conversations SET timestamp = ? WHERE key = ?')

  // 使用事务确保原子性并提升性能
  const saveTransaction = db.transaction(() => {
    insertMsg.run(
      message.key,
      conversationKey,
      message.role,
      message.content,
      message.timestamp || Date.now(),
      message.status || 'success',
      message.sources ? JSON.stringify(message.sources) : null
    )
    updateConv.run(Date.now(), conversationKey)
  })

  saveTransaction()
}

// 性能优化：批量保存消息
export function saveMessages(conversationKey: string, messages: ChatMessage[]): void {
  if (messages.length === 0) return

  const db = getDB()

  const insertMsg = db.prepare(`
    INSERT OR REPLACE INTO messages (id, conversation_key, role, content, timestamp, status, sources)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const updateConv = db.prepare('UPDATE conversations SET timestamp = ? WHERE key = ?')

  // 使用事务批量插入
  const batchInsert = db.transaction((msgs: ChatMessage[]) => {
    for (const message of msgs) {
      insertMsg.run(
        message.key,
        conversationKey,
        message.role,
        message.content,
        message.timestamp || Date.now(),
        message.status || 'success',
        message.sources ? JSON.stringify(message.sources) : null
      )
    }
    updateConv.run(Date.now(), conversationKey)
  })

  batchInsert(messages)
}

export function updateMessage(messageKey: string, updates: Partial<ChatMessage>): void {
  const db = getDB()
  const keys = Object.keys(updates).filter((k) => k !== 'key' && k !== 'typing')
  if (keys.length === 0) return

  const sets = keys.map((k) => `${k === 'key' ? 'id' : k} = ?`).join(', ')
  const values = keys.map((k) => {
    const val = updates[k as keyof ChatMessage]
    if (k === 'sources') return JSON.stringify(val)
    return val
  })

  const stmt = db.prepare(`UPDATE messages SET ${sets} WHERE id = ?`)
  stmt.run(...values, messageKey)
}
