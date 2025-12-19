import { randomUUID } from 'crypto'
import ElectronStore from 'electron-store'
import { DocumentTag } from '../../types/files'

interface TagStoreShape {
  tags: DocumentTag[]
}

const StoreConstructor = ((ElectronStore as unknown as { default?: typeof ElectronStore })
  .default ?? ElectronStore) as typeof ElectronStore

const storeConfig: Record<string, unknown> = {
  name: 'document-tags',
  projectName: 'ai-rag-app',
  defaults: { tags: [] }
}

const store = new (StoreConstructor as new (
  config: Record<string, unknown>
) => ElectronStore<TagStoreShape>)(storeConfig)

export function getAllTags(): DocumentTag[] {
  return store.get('tags')
}

export function getTagById(id: string): DocumentTag | undefined {
  const tags = getAllTags()
  return tags.find((t) => t.id === id)
}

export function getTagByName(name: string): DocumentTag | undefined {
  const tags = getAllTags()
  return tags.find((t) => t.name.toLowerCase() === name.toLowerCase())
}

export function createTag(name: string, color?: string): DocumentTag {
  const tags = getAllTags()

  // 检查是否已存在
  const existing = tags.find((t) => t.name.toLowerCase() === name.toLowerCase())
  if (existing) {
    return existing
  }

  const tag: DocumentTag = {
    id: randomUUID(),
    name: name.trim(),
    color: color || getRandomColor(),
    createdAt: Date.now()
  }

  tags.push(tag)
  store.set('tags', tags)
  return tag
}

export function updateTag(id: string, updates: { name?: string; color?: string }): DocumentTag {
  const tags = getAllTags()
  const index = tags.findIndex((t) => t.id === id)

  if (index < 0) {
    throw new Error('标签不存在')
  }

  // 检查名称冲突
  if (updates.name && updates.name !== tags[index].name) {
    const existing = tags.find((t) => t.name.toLowerCase() === updates.name!.toLowerCase())
    if (existing) {
      throw new Error('标签名称已存在')
    }
  }

  tags[index] = {
    ...tags[index],
    ...updates,
    name: updates.name?.trim() || tags[index].name
  }

  store.set('tags', tags)
  return tags[index]
}

export function deleteTag(id: string): void {
  const tags = getAllTags().filter((t) => t.id !== id)
  store.set('tags', tags)
}

export function renameTag(oldName: string, newName: string): DocumentTag | null {
  const tags = getAllTags()
  const tag = tags.find((t) => t.name.toLowerCase() === oldName.toLowerCase())

  if (!tag) return null

  return updateTag(tag.id, { name: newName })
}

// 生成随机颜色
function getRandomColor(): string {
  const colors = [
    '#FF6B6B',
    '#4ECDC4',
    '#45B7D1',
    '#FFA07A',
    '#98D8C8',
    '#F7DC6F',
    '#BB8FCE',
    '#85C1E2',
    '#F8B500',
    '#52B788'
  ]
  return colors[Math.floor(Math.random() * colors.length)]
}

// 为文件添加标签
export function addTagToFile(filePath: string, tagId: string): void {
  const { getIndexedFileRecords, upsertIndexedFileRecord } = require('./knowledgeBase')
  const records = getIndexedFileRecords()
  const record = records.find((r) => r.path === filePath)

  if (!record) {
    throw new Error('文件不存在')
  }

  if (!record.tags) {
    record.tags = []
  }

  if (!record.tags.includes(tagId)) {
    record.tags.push(tagId)
    upsertIndexedFileRecord(record)
  }
}

// 从文件移除标签
export function removeTagFromFile(filePath: string, tagId: string): void {
  const { getIndexedFileRecords, upsertIndexedFileRecord } = require('./knowledgeBase')
  const records = getIndexedFileRecords()
  const record = records.find((r) => r.path === filePath)

  if (!record || !record.tags) return

  record.tags = record.tags.filter((t) => t !== tagId)
  upsertIndexedFileRecord(record)
}

// 获取文件的标签
export function getTagsForFile(filePath: string): DocumentTag[] {
  const { getIndexedFileRecords } = require('./knowledgeBase')
  const records = getIndexedFileRecords()
  const record = records.find((r) => r.path === filePath)

  if (!record || !record.tags) return []

  const allTags = getAllTags()
  return record.tags
    .map((tagId) => allTags.find((t) => t.id === tagId))
    .filter(Boolean) as DocumentTag[]
}
