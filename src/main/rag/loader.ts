
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { Document } from '@langchain/core/documents'
import path from 'path'
import fs from 'fs/promises'

export async function loadAndSplitFile(filePath: string): Promise<Document[]> {
  const ext = path.extname(filePath).toLowerCase()
  let docs: Document[]

  if (ext === '.pdf') {
    const loader = new PDFLoader(filePath)
    docs = await loader.load()
  } else if (ext === '.txt' || ext === '.md') {
    // 自定义文本文件加载逻辑
    const content = await fs.readFile(filePath, 'utf-8')
    docs = [new Document({ pageContent: content, metadata: { source: filePath } })]
  } else {
    throw new Error(`Unsupported file type: ${ext}`)
  }
  
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  })

  const splitDocs = await splitter.splitDocuments(docs)
  return splitDocs
}
