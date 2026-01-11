import { ipcMain } from 'electron'
import type { ChatMessage } from '../../types/chat'
import {
    getAllConversations,
    createConversation,
    updateConversationTimestamp,
    deleteConversation,
    getMessages,
    saveMessage,
    updateMessage
} from '../db/service'

export function registerDatabaseIpc(): void {
    ipcMain.handle('db:getConversations', () => getAllConversations())

    ipcMain.handle('db:createConversation', (_, key: string, label: string) =>
        createConversation(key, label)
    )

    ipcMain.handle('db:updateConversation', (_, key: string, label: string) => {
        updateConversationTimestamp(key, label)
    })

    ipcMain.handle('db:deleteConversation', (_, key: string) => deleteConversation(key))

    ipcMain.handle('db:getMessages', (_, key: string, limit?: number, offset?: number) =>
        getMessages(key, limit, offset)
    )

    ipcMain.handle('db:saveMessage', (_, conversationKey: string, message: ChatMessage) =>
        saveMessage(conversationKey, message)
    )

    ipcMain.handle('db:updateMessage', (_, messageKey: string, updates: Partial<ChatMessage>) =>
        updateMessage(messageKey, updates)
    )
}
