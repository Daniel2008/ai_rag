import { ipcMain } from 'electron'
import { basename } from 'path'
import { normalizeError, isSchemaMismatchError } from '../utils/errorHandler'
import {
    getKnowledgeBaseSnapshot,
    refreshKnowledgeBase,
    removeIndexedFileRecord,
    upsertIndexedFileRecord
} from '../rag/knowledgeBase'
import {
    sendRagProcessProgress,
    sendRagProcessProgressMessage
} from '../utils/progressHelper'
import { removeSourceFromStore, addDocumentsToStore } from '../rag/store/index'
import { loadFromUrl } from '../rag/urlLoader'
import { loadAndSplitFileInWorker } from '../rag/workerManager'

export function registerKnowledgeBaseIpc(): void {
    ipcMain.handle('kb:list', () => {
        return getKnowledgeBaseSnapshot()
    })

    // 重建全部索引（全量）
    ipcMain.handle('kb:rebuild', async (event) => {
        try {
            sendRagProcessProgress(event.sender, {
                stage: '准备重建知识库索引...',
                percent: 2,
                taskType: 'index_rebuild'
            })

            const snapshot = await refreshKnowledgeBase((progress) => {
                sendRagProcessProgressMessage(event.sender, progress)
            }, false) // 显式传 false 表示全量重建

            sendRagProcessProgress(event.sender, {
                stage: '知识库索引重建完成',
                percent: 100,
                taskType: 'completed'
            })

            return snapshot
        } catch (error) {
            console.error('Failed to rebuild knowledge base:', error)
            sendRagProcessProgress(event.sender, {
                stage: '知识库重建失败',
                percent: 0,
                error: normalizeError(error).message,
                taskType: 'error'
            })
            throw error
        }
    })

    // 增量更新知识库
    ipcMain.handle('kb:refresh', async (event) => {
        try {
            sendRagProcessProgress(event.sender, {
                stage: '正在扫描文件变更...',
                percent: 2,
                taskType: 'index_rebuild'
            })

            const snapshot = await refreshKnowledgeBase((progress) => {
                sendRagProcessProgressMessage(event.sender, progress)
            }, true) // 显式传 true 表示增量更新

            sendRagProcessProgress(event.sender, {
                stage: '知识库更新完成',
                percent: 100,
                taskType: 'completed'
            })

            return snapshot
        } catch (error) {
            console.error('Failed to refresh knowledge base:', error)
            sendRagProcessProgress(event.sender, {
                stage: '知识库更新失败',
                percent: 0,
                error: normalizeError(error).message,
                taskType: 'error'
            })
            throw error
        }
    })

    ipcMain.handle('files:list', () => {
        return getKnowledgeBaseSnapshot()
    })

    ipcMain.handle('files:remove', async (_, filePath: string) => {
        return removeIndexedFileRecord(filePath)
    })

    ipcMain.handle('files:reindex', async (event, filePath: string) => {
        const isUrl = filePath.startsWith('http://') || filePath.startsWith('https://')
        const displayName = isUrl
            ? (() => {
                try {
                    return new URL(filePath).hostname
                } catch {
                    return filePath
                }
            })()
            : basename(filePath)

        try {
            sendRagProcessProgress(event.sender, {
                stage: `准备重新索引: ${displayName}`,
                percent: 5,
                taskType: 'index_rebuild'
            })

            await removeSourceFromStore(filePath)

            if (isUrl) {
                sendRagProcessProgress(event.sender, {
                    stage: `正在重新抓取: ${displayName}`,
                    percent: 15,
                    taskType: 'document_parse'
                })

                const result = await loadFromUrl(filePath)
                if (!(result.success && result.documents)) {
                    throw new Error(result.error || '内容获取失败')
                }

                sendRagProcessProgress(event.sender, {
                    stage: `抓取完成，共 ${result.documents.length} 个片段`,
                    percent: 25,
                    taskType: 'document_parse'
                })

                const preview = result.content?.slice(0, 160) || ''
                const record = {
                    path: filePath,
                    name: result.title || filePath,
                    chunkCount: result.documents.length,
                    preview,
                    updatedAt: Date.now(),
                    sourceType: 'url' as const,
                    url: filePath,
                    siteName: result.meta?.siteName
                }

                try {
                    await addDocumentsToStore(result.documents, (progress) => {
                        const percent = 25 + Math.round((progress.progress || 0) * 0.7)
                        sendRagProcessProgress(event.sender, {
                            stage: progress.message,
                            percent,
                            taskType: progress.taskType
                        })
                    })
                    upsertIndexedFileRecord(record)
                } catch (error) {
                    if (isSchemaMismatchError(error)) {
                        sendRagProcessProgress(event.sender, {
                            stage: '检测到索引变更，正在重建...',
                            percent: 80,
                            taskType: 'index_rebuild'
                        })
                        upsertIndexedFileRecord(record)
                        await refreshKnowledgeBase((progress) => {
                            sendRagProcessProgressMessage(event.sender, progress)
                        })
                    } else {
                        throw error
                    }
                }

                sendRagProcessProgress(event.sender, {
                    stage: `${displayName} 重新索引完成`,
                    percent: 100,
                    taskType: 'completed'
                })

                return getKnowledgeBaseSnapshot()
            }

            // 文件处理
            sendRagProcessProgress(event.sender, {
                stage: `正在重新解析: ${displayName}`,
                percent: 15,
                taskType: 'document_parse'
            })

            const docs = await loadAndSplitFileInWorker(filePath)

            sendRagProcessProgress(event.sender, {
                stage: `解析完成，共 ${docs.length} 个片段`,
                percent: 25,
                taskType: 'document_parse'
            })

            const preview = docs[0]?.pageContent.slice(0, 160)
            const record = {
                path: filePath,
                name: basename(filePath),
                chunkCount: docs.length,
                preview,
                updatedAt: Date.now()
            }

            try {
                await addDocumentsToStore(docs, (progress) => {
                    const percent = 25 + Math.round((progress.progress || 0) * 0.7)
                    sendRagProcessProgress(event.sender, {
                        stage: progress.message,
                        percent,
                        taskType: progress.taskType
                    })
                })
                upsertIndexedFileRecord(record)
            } catch (error) {
                if (isSchemaMismatchError(error)) {
                    sendRagProcessProgress(event.sender, {
                        stage: '检测到索引变更，正在重建...',
                        percent: 80,
                        taskType: 'index_rebuild'
                    })
                    upsertIndexedFileRecord(record)
                    await refreshKnowledgeBase((progress) => {
                        sendRagProcessProgressMessage(event.sender, progress)
                    })
                } else {
                    throw error
                }
            }

            sendRagProcessProgress(event.sender, {
                stage: `${displayName} 重新索引完成`,
                percent: 100,
                taskType: 'completed'
            })

            return getKnowledgeBaseSnapshot()
        } catch (error) {
            console.error('Error reindexing:', error)
            sendRagProcessProgress(event.sender, {
                stage: `重新索引失败: ${displayName}`,
                percent: 0,
                error: String(error),
                taskType: 'error'
            })
            throw error
        }
    })
}
