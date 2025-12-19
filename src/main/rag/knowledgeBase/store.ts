import ElectronStore from 'electron-store'
import { IndexedFileRecord, DocumentCollection, DocumentTag } from '../../../types/files'

interface KnowledgeBaseStoreShape {
  files: IndexedFileRecord[]
  collections: DocumentCollection[]
  tags: DocumentTag[]
}

const StoreConstructor = ((ElectronStore as unknown as { default?: typeof ElectronStore })
  .default ?? ElectronStore) as typeof ElectronStore

const storeConfig: Record<string, unknown> = {
  name: 'knowledge-base',
  projectName: 'ai-rag-app',
  defaults: { files: [], collections: [], tags: [] }
}

const store = new (StoreConstructor as new (
  config: Record<string, unknown>
) => ElectronStore<KnowledgeBaseStoreShape>)(storeConfig)

export function getIndexedFileRecords(): IndexedFileRecord[] {
  return store.get('files')
}

export function saveIndexedFileRecords(records: IndexedFileRecord[]): void {
  store.set('files', records)
}

export function getDocumentCollections(): DocumentCollection[] {
  return store.get('collections')
}

export function saveDocumentCollections(collections: DocumentCollection[]): void {
  store.set('collections', collections)
}

export function getAvailableTags(): DocumentTag[] {
  return store.get('tags') || []
}

export function saveAvailableTags(tags: DocumentTag[]): void {
  store.set('tags', tags)
}
