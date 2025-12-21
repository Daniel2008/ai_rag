import { MessageOutlined } from '@ant-design/icons'
import { createElement } from 'react'
import type { Conversation, SerializableConversation } from '../types/chat'
import type { IndexedFile, IndexedFileRecord } from '../types/files'
import {
  CONVERSATIONS_STORAGE_KEY,
  ACTIVE_CONVERSATION_KEY,
  STARRED_CONVERSATIONS_KEY
} from '../constants/chat'

/** 保存对话到 localStorage */
export function saveConversationsToStorage(conversations: Conversation[]): void {
  try {
    const serializable: SerializableConversation[] = conversations.map((conv) => ({
      key: conv.key,
      label: conv.label,
      timestamp: conv.timestamp,
      messages: conv.messages
    }))
    localStorage.setItem(CONVERSATIONS_STORAGE_KEY, JSON.stringify(serializable))
  } catch (error) {
    console.error('Failed to save conversations to storage:', error)
  }
}

/** 从 localStorage 加载对话 */
export function loadConversationsFromStorage(): Conversation[] {
  try {
    const stored = localStorage.getItem(CONVERSATIONS_STORAGE_KEY)
    if (!stored) return []

    const serializable: SerializableConversation[] = JSON.parse(stored)
    return serializable.map((conv) => ({
      ...conv,
      icon: createElement(MessageOutlined),
      messages: conv.messages.map((msg) => ({
        ...msg,
        // 确保从存储加载时重置加载状态
        typing: false,
        status: msg.status === 'pending' ? 'success' : msg.status
      }))
    }))
  } catch (error) {
    console.error('Failed to load conversations from storage:', error)
    return []
  }
}

/** 保存当前激活的对话键 */
export function saveActiveConversationKey(key: string | undefined): void {
  try {
    if (key) {
      localStorage.setItem(ACTIVE_CONVERSATION_KEY, key)
    } else {
      localStorage.removeItem(ACTIVE_CONVERSATION_KEY)
    }
  } catch (error) {
    console.error('Failed to save active conversation key:', error)
  }
}

/** 加载当前激活的对话键 */
export function loadActiveConversationKey(): string | undefined {
  try {
    return localStorage.getItem(ACTIVE_CONVERSATION_KEY) || undefined
  } catch (error) {
    console.error('Failed to load active conversation key:', error)
    return undefined
  }
}

export function saveStarredConversationKeys(keys: string[]): void {
  try {
    localStorage.setItem(STARRED_CONVERSATIONS_KEY, JSON.stringify(keys))
  } catch (error) {
    console.error('Failed to save starred conversation keys:', error)
  }
}

export function loadStarredConversationKeys(): string[] {
  try {
    const raw = localStorage.getItem(STARRED_CONVERSATIONS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
  } catch (error) {
    console.error('Failed to load starred conversation keys:', error)
    return []
  }
}

/** 从文件路径提取文件名（支持 URL 解码） */
export function extractFileName(filePath: string): string {
  const name = filePath.split(/[\\/]/).pop() ?? filePath
  // 尝试解码 URL 编码的文件名（如中文字符 %E4%B8%AD%E5%8C%BB -> 中医）
  try {
    return decodeURIComponent(name)
  } catch {
    // 如果解码失败，返回原始名称
    return name
  }
}

/** 合并文件记录与临时文件 */
export function mergeRecordsWithTransient(
  records: IndexedFileRecord[],
  prevFiles: IndexedFile[]
): IndexedFile[] {
  const recordMap = new Map(records.map((record) => [record.path, record]))
  const normalized: IndexedFile[] = records.map((record) => ({
    ...record,
    status: 'ready' as const,
    error: undefined
  }))
  const transient = prevFiles.filter((file) => !recordMap.has(file.path) && file.status !== 'ready')
  return [...normalized, ...transient].sort((a, b) => b.updatedAt - a.updatedAt)
}
