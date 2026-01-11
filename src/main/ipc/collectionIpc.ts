import { ipcMain } from 'electron'
import {
    createDocumentCollection,
    updateDocumentCollection,
    deleteDocumentCollection
} from '../rag/knowledgeBase'

export function registerCollectionsIpc(): void {
    ipcMain.handle(
        'collections:create',
        (_, payload: { name: string; description?: string; files?: string[] }) => {
            return createDocumentCollection(payload)
        }
    )

    ipcMain.handle(
        'collections:update',
        (_, payload: { id: string; name?: string; description?: string; files?: string[] }) => {
            const { id, ...updates } = payload
            return updateDocumentCollection(id, updates)
        }
    )

    ipcMain.handle('collections:delete', async (_, collectionId: string) => {
        return await deleteDocumentCollection(collectionId)
    })
}
