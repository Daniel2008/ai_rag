# 实施计划：RAG 核心功能 (RAG Core Features)

## 目标
实现基于 Ollama 的本地对话功能，并结合向量数据库 (MemoryVectorStore) 实现文档检索增强生成 (RAG)。

## 当前状态
- [x] 基础项目搭建 (Electron + React + TS)
- [x] 文档读取与分块 (PDF/Text Loader + RecursiveSplitter)
- [x] 基础 UI 框架

## 拟定变更 (Proposed Changes)

### 1. 逻辑层 (src/main/rag)
- **Vector Store Integration**:
  - 引入 `@langchain/community/vectorstores/memory` (或 `hnswlib-node`)。
  - 引入 `@langchain/community/embeddings/ollama`。
  - 创建 `store.ts`: 负责管理向量存储的单例，提供 `addDocuments` 和 `similaritySearch` 方法。
- **RAG Service**:
  - 创建 `rag.ts`: 封装 RAG 流程。
  - `query(question)`:
    1. 将问题转化为向量。
    2. 在 Vector Store 中检索相关文档块。
    3. 构建 Prompt (Context + Question)。
    4. 调用 Ollama 模型 (使用 `ollama` 库或 `@langchain/community/chat_models/ollama`) 生成回答。

### 2. IPC 通信 (src/main, src/preload)
- **更新 `rag:processFile`**:
  - 处理完文件分块后，立即调用 `store.addDocuments()` 将其存入向量库。
- **新增 `rag:chat`**:
  - 接收用户问题。
  - 返回流式回答 (Streaming Response) 或一次性回答。

### 3. UI 层 (src/renderer)
- **Chat Interface**:
  - 更新 `App.tsx` 或创建 `Chat.tsx` 组件。
  - 实现消息列表展示 (User vs AI)。
  - 实现输入框发送功能。
  - 支持 Markdown 渲染 (使用 `react-markdown`)。
  - 显示 "Thinking..." 或流式输出效果。

## 验证计划 (Verification Plan)
1. **Ollama 连接测试**: 确保本地 Ollama 服务运行，并能通过代码调用模型。
2. **文档索引测试**: 上传文档后，日志显示 "Added x chunks to vector store"。
3. **RAG 回答测试**:
   - 提问文档中的具体内容。
   - 确认回答是基于文档内容的 (检查引用或准确性)。
