export * from './store'
export * from './core'
export * from './indexing'
export * from './import'
export * from './collections'

// Re-export specific types if needed
import { getSnapshot, pruneCollectionsForMissingFiles } from './core'
import { KnowledgeBaseSnapshot } from '../../../types/files'

export function getKnowledgeBaseSnapshot(): KnowledgeBaseSnapshot {
  pruneCollectionsForMissingFiles()
  return getSnapshot()
}
