import { ipcMain } from 'electron'
import { basename } from 'path'
import { TaskType } from '../rag/progressTypes'
import { loadAndSplitFileInWorker } from '../rag/workerManager'
import { loadFromUrl } from '../rag/urlLoader'
import {
    addDocumentsToStore,
    removeSourceFromStore
} from '../rag/store/index'
import { updateConversationTimestamp } from '../db/service'
import {
    createBatchProgress,
    createDocumentParseComplete,
    createDocumentParseProgress,
    sendRagProcessProgress,
    sendRagProcessProgressMessage,
    toFrontendProgressFormat
} from '../utils/progressHelper'
import { upsertIndexedFileRecord, refreshKnowledgeBase } from '../rag/knowledgeBase'
import { SmartPromptGenerator } from '../rag/smartFeatures'
import { isSchemaMismatchError } from '../utils/errorHandler'
import { runLangGraphChat } from '../rag/langgraphChat'

export function registerRagIngestionIpc(): void {
    ipcMain.handle('rag:processFile', async (event, filePaths: string | string[]) => {
        const paths = Array.isArray(filePaths) ? filePaths : [filePaths]
        const results: { success: boolean; count?: number; preview?: string; error?: string }[] = []

        // 总进度计算
        let processedCount = 0
        const totalFiles = paths.length
        const isBatch = totalFiles > 1

        for (const filePath of paths) {
            console.log('Processing file:', filePath)
            const fileName = basename(filePath)

            // 计算基础进度（每个文件占据 100/totalFiles 的进度空间）
            const fileProgressRange = 100 / totalFiles
            const basePercent = Math.round(processedCount * fileProgressRange)

            try {
                // 发送进度：开始解析文档
                if (isBatch) {
                    const batchProgress = createBatchProgress(
                        TaskType.DOCUMENT_PARSE,
                        processedCount + 1,
                        totalFiles,
                        fileName,
                        5
                    )
                    sendRagProcessProgress(event.sender, toFrontendProgressFormat(batchProgress))
                } else {
                    const parseProgress = createDocumentParseProgress(5, fileName)
                    sendRagProcessProgress(event.sender, toFrontendProgressFormat(parseProgress))
                }

                // 1. 先清理旧索引（如果存在），避免重复
                try {
                    await removeSourceFromStore(filePath)
                } catch (e) {
                    console.warn('Failed to clean up old index for', filePath, e)
                }

                const docs = await loadAndSplitFileInWorker(filePath)
                console.log(`Processed ${docs.length} chunks`)

                // 发送进度：文档解析完成
                const parseCompleteProgress = createDocumentParseComplete(docs.length, fileName)
                if (isBatch) {
                    sendRagProcessProgress(event.sender, {
                        ...toFrontendProgressFormat(parseCompleteProgress),
                        stage: `${fileName} 解析完成 (${processedCount + 1}/${totalFiles})`,
                        percent: basePercent + Math.round(fileProgressRange * 0.15) // 15% 用于解析
                    })
                } else {
                    sendRagProcessProgress(event.sender, toFrontendProgressFormat(parseCompleteProgress))
                }

                const preview = docs[0]?.pageContent.slice(0, 160)

                // 生成摘要和要点
                let summary: string | undefined
                let keyPoints: string[] | undefined
                try {
                    const generator = new SmartPromptGenerator()
                    const content = docs
                        .slice(0, 10)
                        .map((d) => d.pageContent)
                        .join('\n\n')
                    if (content.length > 100) {
                        const result = await generator.generateSummary(content, { length: 'short' })
                        summary = result.summary
                        keyPoints = result.keyPoints
                    }
                } catch (e) {
                    console.warn('Failed to generate smart features for', fileName, e)
                }

                const record = {
                    path: filePath,
                    name: fileName,
                    chunkCount: docs.length,
                    preview,
                    summary,
                    keyPoints,
                    updatedAt: Date.now()
                }

                try {
                    // 添加进度回调，传递向量化进度
                    await addDocumentsToStore(docs, (progress) => {
                        // 计算当前文件内的进度（向量化占据剩余 80% 的进度）
                        const vectorProgress = (progress.progress || 0) / 100
                        const currentPercent =
                            basePercent + Math.round(fileProgressRange * (0.15 + vectorProgress * 0.8))

                        let stageMessage = progress.message
                        if (isBatch) {
                            stageMessage = `(${processedCount + 1}/${totalFiles}) ${progress.message}`
                        }

                        sendRagProcessProgress(event.sender, {
                            stage: stageMessage,
                            percent: Math.min(currentPercent, 99),
                            taskType: progress.taskType
                        })
                    })
                    upsertIndexedFileRecord(record)
                    results.push({ success: true, count: docs.length, preview })
                } catch (error) {
                    if (isSchemaMismatchError(error)) {
                        console.warn('Detected LanceDB schema mismatch, rebuilding knowledge base...')
                        sendRagProcessProgress(event.sender, {
                            stage: '检测到索引变更，正在重建...',
                            percent: 80,
                            taskType: 'index_rebuild'
                        })
                        upsertIndexedFileRecord(record)
                        await refreshKnowledgeBase((progress) => {
                            sendRagProcessProgressMessage(event.sender, progress)
                        })
                        results.push({ success: true, count: docs.length, preview })
                    } else {
                        throw error
                    }
                }
            } catch (error) {
                console.error('Error processing file:', filePath, error)
                // 发送错误进度，包含文件名
                sendRagProcessProgress(event.sender, {
                    stage: `处理失败: ${fileName}`,
                    percent: basePercent,
                    error: String(error),
                    taskType: 'error'
                })
                results.push({ success: false, error: String(error) })
            }

            processedCount++
        }

        // 发送进度：完成
        const completeMessage =
            totalFiles === 1 ? '文档已添加到知识库' : `${totalFiles} 个文档已添加到知识库`
        sendRagProcessProgress(event.sender, {
            stage: completeMessage,
            percent: 100,
            taskType: 'completed'
        })

        const successCount = results.filter((r) => r.success).length
        return {
            success: successCount > 0,
            count: results.reduce((acc, r) => acc + (r.count || 0), 0),
            preview: results.find((r) => r.preview)?.preview,
            error: successCount === 0 ? results[0]?.error : undefined
        }
    })

    // 从 URL 加载内容到知识库
    ipcMain.handle('rag:processUrl', async (event, url: string) => {
        try {
            console.log('Processing URL:', url)

            // 提取域名作为简短标识
            let urlLabel = url
            try {
                const urlObj = new URL(url)
                urlLabel = urlObj.hostname.replace('www.', '')
            } catch {
                // 保持原 URL
            }

            // 发送进度：开始抓取
            sendRagProcessProgress(event.sender, {
                stage: `正在抓取: ${urlLabel}`,
                percent: 5,
                taskType: 'document_parse'
            })

            const result = await loadFromUrl(url, {
                onProgress: (stage, percent) => {
                    sendRagProcessProgress(event.sender, {
                        stage,
                        percent,
                        taskType: 'document_parse'
                    })
                }
            })

            if (!result.success || !result.documents) {
                throw new Error(result.error || '无法获取网页内容')
            }

            console.log(`Fetched ${result.documents.length} chunks from URL`)

            // 发送进度：内容获取完成
            const title = result.title || urlLabel
            sendRagProcessProgress(event.sender, {
                stage: `"${title}" 抓取完成`,
                percent: 25,
                taskType: 'document_parse'
            })

            const preview = result.content?.slice(0, 160) || ''
            const record = {
                path: url,
                name: result.title || url,
                chunkCount: result.documents.length,
                preview,
                updatedAt: Date.now(),
                sourceType: 'url' as const,
                url: url,
                siteName: result.meta?.siteName
            }

            try {
                // 添加进度回调，优化进度显示
                await addDocumentsToStore(result.documents, (progress) => {
                    // 向量化进度从 25% 到 95%
                    const vectorPercent = 25 + Math.round((progress.progress || 0) * 0.7)
                    sendRagProcessProgress(event.sender, {
                        stage: progress.message,
                        percent: vectorPercent,
                        taskType: progress.taskType
                    })
                })
                upsertIndexedFileRecord(record)
            } catch (error) {
                if (isSchemaMismatchError(error)) {
                    console.warn('Detected LanceDB schema mismatch, rebuilding knowledge base...')
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

            // 发送进度：完成
            sendRagProcessProgress(event.sender, {
                stage: `"${title}" 已添加到知识库`,
                percent: 100,
                taskType: 'completed'
            })

            return {
                success: true,
                count: result.documents.length,
                title: result.title,
                preview
            }
        } catch (error) {
            console.error('Error processing URL:', error)
            // 优化错误消息
            let errorMessage = String(error)
            if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo')) {
                errorMessage = '无法访问该网址，请检查网络连接'
            } else if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
                errorMessage = '网站拒绝访问'
            } else if (errorMessage.includes('404')) {
                errorMessage = '页面不存在'
            }

            sendRagProcessProgress(event.sender, {
                stage: errorMessage,
                percent: 0,
                error: errorMessage,
                taskType: 'error'
            })
            return { success: false, error: errorMessage }
        }
    })

    // 生成会话标题
    ipcMain.handle('rag:generateTitle', async (_, conversationKey: string, question: string) => {
        try {
            const { generateConversationTitle } = await import('../rag/chat/title')
            // 前端传入 (conversationKey, question)
            // 1. 生成标题
            const title = await generateConversationTitle(question)
            // 2. 保存到数据库
            await updateConversationTimestamp(conversationKey, title)
            return title
        } catch (error) {
            console.error('Failed to generate title:', error)
            return question.slice(0, 20)
        }
    })

    // RAG 对话接口
    ipcMain.on('rag:chat', async (event, payload: any) => {
        const { question, sources, tags, conversationKey } = payload
        try {
            console.log('[IPC] rag:chat started', { question, conversationKey })

            await runLangGraphChat(
                question,
                sources,
                conversationKey,
                // onToken
                (token) => {
                    event.sender.send('rag:chat-token', token)
                },
                tags,
                // onSources
                (sources) => {
                    event.sender.send('rag:chat-sources', sources)
                },
                // onSuggestions
                (suggestions) => {
                    event.sender.send('rag:chat-suggestions', suggestions)
                }
            )

            // 完成
            event.sender.send('rag:chat-done')
        } catch (error) {
            console.error('[IPC] Chat error:', error)
            event.sender.send('rag:chat-error', String(error))
        }
    })

    // 辅助接口：直接运行 LangGraph (保留以支持特定场景)
    ipcMain.handle('chat:langgraph', async (event, question: string, _history: any[], options: any) => {
        try {
            return await runLangGraphChat(
                question,
                options?.sources,
                options?.conversationId,
                (chunk) => event.sender.send('chat:token', chunk),
                options?.tags
            )
        } catch (error) {
            console.error('[IPC] chat:langgraph error:', error)
            throw error
        }
    })
}
