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

interface ChatOptions {
  sources?: string[]
}

export async function chatWithRag(
  question: string,
  options: ChatOptions = {}
): Promise<ChatResult> {
  const settings = getSettings()

  // 1. Retrieve relevant documents
  let contextDocs = await searchSimilarDocuments(question)

  if (options.sources && options.sources.length > 0) {
    const sourceSet = new Set(options.sources.map((source) => source.toLowerCase()))
    const filteredDocs = contextDocs.filter((doc) => {
      const docSource =
        typeof doc.metadata?.source === 'string' ? doc.metadata.source.toLowerCase() : ''
      return sourceSet.has(docSource)
    })
    if (filteredDocs.length > 0) {
      contextDocs = filteredDocs
    }
  }
  const context = contextDocs.map((doc) => doc.pageContent).join('\n\n')

  console.log(`Retrieved ${contextDocs.length} docs for context`)

  // 2. Extract sources for citations
  const sources: ChatSource[] = contextDocs.map((doc: Document) => {
    const rawPageNumber =
      typeof doc.metadata?.pageNumber === 'number'
        ? doc.metadata.pageNumber
        : typeof doc.metadata?.loc?.pageNumber === 'number'
          ? doc.metadata.loc.pageNumber
          : undefined

    return {
      content: doc.pageContent.slice(0, 200) + (doc.pageContent.length > 200 ? '...' : ''),
      fileName: doc.metadata?.source
        ? String(doc.metadata.source).split(/[\\/]/).pop() || 'Unknown'
        : 'Unknown',
      pageNumber: rawPageNumber && rawPageNumber > 0 ? rawPageNumber : undefined
    }
  })

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
