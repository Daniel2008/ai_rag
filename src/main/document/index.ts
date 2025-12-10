/**
 * 文档生成模块导出
 */
export * from './types'
export { generateDocument, setLLMChatFunction } from './documentGenerator'
export { generateWordDocument } from './wordGenerator'
export { generatePPTDocument } from './pptGenerator'
export {
  detectDocumentIntent,
  streamDocumentGeneration,
  handleDocumentGenerationIfNeeded
} from './documentChatService'
export type { DocumentChatRequest } from './documentChatService'
