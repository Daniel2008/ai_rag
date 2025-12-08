import { ChatOllama } from '@langchain/ollama'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { PromptTemplate } from '@langchain/core/prompts'
import { searchSimilarDocuments } from './store'
import { RunnableSequence } from '@langchain/core/runnables'
import { Document } from '@langchain/core/documents'
import { getSettings } from '../settings'

export interface ChatSource {
  content: string
  fileName: string
  pageNumber?: number
}

export interface ChatResult {
  stream: AsyncGenerator<string>
  sources: ChatSource[]
}

export async function chatWithRag(question: string): Promise<ChatResult> {
  const settings = getSettings()
  
  // 1. Retrieve relevant documents
  const contextDocs = await searchSimilarDocuments(question)
  const context = contextDocs.map((doc) => doc.pageContent).join('\n\n')

  console.log(`Retrieved ${contextDocs.length} docs for context`)

  // 2. Extract sources for citations
  const sources: ChatSource[] = contextDocs.map((doc: Document) => ({
    content: doc.pageContent.slice(0, 200) + (doc.pageContent.length > 200 ? '...' : ''),
    fileName: doc.metadata?.source
      ? String(doc.metadata.source).split(/[\\/]/).pop() || 'Unknown'
      : 'Unknown',
    pageNumber: doc.metadata?.loc?.pageNumber
  }))

  // 3. Construct Prompt
  const template = `You are a helpful assistant. Answer the question based on the following context. 
If the context doesn't contain relevant information, say so.

Context:
{context}

Question: {question}

Answer:`

  const prompt = PromptTemplate.fromTemplate(template)

  // 4. Initialize Model with settings
  const model = new ChatOllama({
    baseUrl: settings.ollamaUrl,
    model: settings.chatModel
  })

  // 5. Create Chain
  const chain = RunnableSequence.from([prompt, model, new StringOutputParser()])

  // 6. Run Chain (Stream)
  const stream = await chain.stream({
    context,
    question
  })

  return {
    stream,
    sources
  }
}
