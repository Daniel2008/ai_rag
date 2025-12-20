import { Document } from '@langchain/core/documents'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { SemanticChunker, SemanticChunkConfig } from '../semanticChunker'

/** 分块策略类型 */
export type ChunkingStrategy = 'semantic' | 'fixed'

/**
 * 统一的文本分块函数
 * 根据配置选择语义分块或固定分块
 */
export async function splitTextToDocuments(
  content: string,
  metadata: Record<string, unknown>,
  strategy: ChunkingStrategy = 'semantic',
  semanticConfig?: SemanticChunkConfig
): Promise<Document[]> {
  if (strategy === 'semantic') {
    const chunker = new SemanticChunker({
      maxChunkSize: 800,
      minChunkSize: 200,
      chunkOverlap: 150,
      preserveHeadings: true,
      preserveLists: true,
      preserveCodeBlocks: true,
      languageMode: 'auto',
      ...semanticConfig
    })

    const chunks = await chunker.splitText(content)
    return chunks.map(
      (chunk, index) =>
        new Document({
          pageContent: chunk.content,
          metadata: {
            ...metadata,
            chunkIndex: chunk.metadata.chunkIndex ?? index,
            blockTypes: chunk.metadata.blockTypes ?? [],
            hasHeading: chunk.metadata.hasHeading ?? false,
            headingText: chunk.metadata.headingText ?? '',
            chunkingStrategy: 'semantic'
          }
        })
    )
  } else {
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
      separators: ['\n\n', '\n', '。', '！', '？', '；', '.', '!', '?', ';', ' ', '']
    })

    const docs = await splitter.createDocuments(
      [content],
      [{ ...metadata, chunkingStrategy: 'fixed' }]
    )
    return docs
  }
}
