# 架构设计

本文档详细介绍智汇 RAG 的系统架构设计。

## 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Electron 应用                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────┐    ┌─────────────────────────────────┐ │
│  │    渲染进程 (React)   │    │         主进程 (Node.js)         │ │
│  │                     │    │                                 │ │
│  │  ┌───────────────┐  │    │  ┌─────────────────────────────┐│ │
│  │  │   UI 组件      │  │◄──►│  │       IPC 处理器            ││ │
│  │  │  (Ant Design)  │  │    │  └─────────────────────────────┘│ │
│  │  └───────────────┘  │    │              │                  │ │
│  │         │          │    │              ▼                  │ │
│  │  ┌───────────────┐  │    │  ┌─────────────────────────────┐│ │
│  │  │   状态管理     │  │    │  │      RAG 核心引擎           ││ │
│  │  │  (React Hooks) │  │    │  │  ┌─────────┐ ┌───────────┐ ││ │
│  │  └───────────────┘  │    │  │  │ 向量存储 │ │ 混合检索  │ ││ │
│  │         │          │    │  │  │(LanceDB)│ │(BM25+Vec) │ ││ │
│  │  ┌───────────────┐  │    │  │  └─────────┘ └───────────┘ ││ │
│  │  │  聊天 Provider │  │    │  │  ┌─────────┐ ┌───────────┐ ││ │
│  │  │  (@ant/x-sdk)  │  │    │  │  │ 文档处理 │ │ LLM 调用  │ ││ │
│  │  └───────────────┘  │    │  │  │(解析/分块)│ │(LangChain)│ ││ │
│  └─────────────────────┘    │  │  └─────────┘ └───────────┘ ││ │
│                             │  └─────────────────────────────┘│ │
│                             │              │                  │ │
│                             │              ▼                  │ │
│                             │  ┌─────────────────────────────┐│ │
│                             │  │       数据存储层             ││ │
│                             │  │  SQLite │ LanceDB │ 文件系统 ││ │
│                             │  └─────────────────────────────┘│ │
│                             └─────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## 进程架构

### 渲染进程 (Renderer)

渲染进程负责 UI 展示和用户交互，基于 React 19 构建：

```
src/renderer/src/
├── App.tsx                  # 应用根组件
├── components/
│   ├── chat/                # 聊天相关组件
│   │   ├── ChatArea.tsx     # 聊天区域
│   │   ├── ChatInput.tsx    # 输入框
│   │   ├── ChatSidebar.tsx  # 对话列表
│   │   └── WelcomeScreen.tsx # 欢迎页
│   ├── AppSidebar.tsx       # 知识库面板
│   ├── SettingsDialog.tsx   # 设置弹窗
│   └── TitleBar.tsx         # 自定义标题栏
├── hooks/
│   ├── useChatWithXChat.ts  # 聊天逻辑 Hook
│   ├── useConversations.ts  # 会话管理 Hook
│   ├── useKnowledgeBase.ts  # 知识库 Hook
│   └── useProgress.ts       # 进度管理 Hook
└── providers/
    ├── ElectronChatProvider.ts  # Electron IPC 封装
    └── ElectronXRequest.ts      # 请求处理
```

### 主进程 (Main)

主进程负责核心业务逻辑和系统级操作：

```
src/main/
├── index.ts                 # 主进程入口，IPC 处理
├── settings.ts              # 应用设置管理
├── db/
│   ├── index.ts             # SQLite 数据库初始化
│   └── service.ts           # 会话/消息 CRUD
├── rag/
│   ├── chat/                # 对话相关
│   │   ├── contextBuilder.ts # 上下文构建
│   │   ├── memory.ts        # 对话记忆
│   │   ├── streamer.ts      # 流式输出
│   │   └── utils.ts         # 工具函数
│   ├── graph/               # LangGraph 对话流程
│   │   ├── chatGraph.ts     # 对话图定义
│   │   ├── state.ts         # 状态定义
│   │   └── nodes/           # 各个节点
│   ├── knowledgeBase/       # 知识库管理
│   │   ├── collections.ts   # 文档集管理
│   │   ├── import.ts        # 文档导入
│   │   ├── indexing.ts      # 索引管理
│   │   └── store.ts         # 存储操作
│   └── store/               # 向量存储
│       ├── core.ts          # LanceDB 核心
│       ├── embeddings.ts    # 向量嵌入
│       ├── bm25.ts          # BM25 搜索
│       ├── vectorSearch.ts  # 向量搜索
│       └── algorithms.ts    # 算法实现
└── document/                # 文档生成
    ├── wordGenerator.ts     # Word 生成
    └── pptGenerator.ts      # PPT 生成
```

## 核心模块

### 1. 向量存储模块 (store/)

负责文档向量化和向量检索：

```typescript
// 核心流程
文档 → 分块 → 向量化 → LanceDB 存储
                          ↓
                    查询向量化
                          ↓
                    相似度搜索
```

**关键组件**:

- `core.ts`: LanceDB 连接和表管理
- `embeddings.ts`: 多种嵌入模型支持（本地/API）
- `vectorSearch.ts`: 向量搜索实现
- `bm25.ts`: BM25 关键词搜索

### 2. 混合检索模块 (hybridSearch.ts)

实现向量搜索 + 关键词搜索的融合：

```typescript
interface HybridSearchConfig {
  vectorWeight: 0.7 // 向量搜索权重
  keywordWeight: 0.3 // 关键词搜索权重
  topK: 10 // 返回数量
  rrfK: 60 // RRF 参数
  rerank: boolean // 是否重排序
  multiQuery: boolean // 是否多查询扩展
}
```

**融合策略**: 使用 Reciprocal Rank Fusion (RRF) 算法合并多路召回结果。

### 3. 对话流程模块 (graph/)

基于 LangGraph 实现的对话流程：

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  开始    │───►│  检索    │───►│  生成    │───►│  结束    │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
                     │                │
                     ▼                ▼
              ┌──────────┐    ┌──────────┐
              │ 向量搜索 │    │ LLM 调用 │
              │ BM25搜索 │    │ 流式输出 │
              └──────────┘    └──────────┘
```

### 4. 文档处理模块

**解析支持**:

- PDF: `pdf-parse`
- Office: `officeparser` (docx/pptx/xlsx)
- 纯文本: 直接读取
- OCR: `tesseract.js`（图片中的文字）

**分块策略**:

- 语义分块：基于段落和句子边界
- 固定大小分块：可配置 chunk size
- 重叠分块：保证上下文连贯

## 数据流

### 文档导入流程

```
用户上传文件
      │
      ▼
┌─────────────────┐
│   文档解析       │ ← pdf-parse / officeparser
└─────────────────┘
      │
      ▼
┌─────────────────┐
│   文本分块       │ ← semantic chunking
└─────────────────┘
      │
      ▼
┌─────────────────┐
│   向量嵌入       │ ← HuggingFace / OpenAI
└─────────────────┘
      │
      ▼
┌─────────────────┐
│  存储到 LanceDB │
└─────────────────┘
      │
      ▼
┌─────────────────┐
│ 更新元数据(SQLite)│
└─────────────────┘
```

### 对话问答流程

```
用户提问
      │
      ▼
┌─────────────────┐
│   查询预处理     │ ← 多查询扩展（可选）
└─────────────────┘
      │
      ▼
┌─────────────────┐
│   混合检索       │
│ ┌─────┐ ┌─────┐ │
│ │向量 │ │BM25 │ │
│ └─────┘ └─────┘ │
└─────────────────┘
      │
      ▼
┌─────────────────┐
│   RRF 融合       │
└─────────────────┘
      │
      ▼
┌─────────────────┐
│ Rerank 重排序    │ ← 可选
└─────────────────┘
      │
      ▼
┌─────────────────┐
│  构建 Prompt     │ ← 上下文 + 历史 + 问题
└─────────────────┘
      │
      ▼
┌─────────────────┐
│   LLM 生成       │ ← OpenAI / Claude / Ollama
└─────────────────┘
      │
      ▼
┌─────────────────┐
│   流式输出       │ → 前端渲染
└─────────────────┘
```

## 存储设计

### SQLite 数据库

```sql
-- 会话表
CREATE TABLE conversations (
  key TEXT PRIMARY KEY,
  label TEXT,
  starred INTEGER DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER
);

-- 消息表
CREATE TABLE messages (
  key TEXT PRIMARY KEY,
  conversation_key TEXT,
  role TEXT,         -- 'user' | 'ai' | 'system'
  content TEXT,
  sources TEXT,      -- JSON 数组
  suggestions TEXT,  -- JSON 数组
  status TEXT,
  created_at INTEGER,
  FOREIGN KEY (conversation_key) REFERENCES conversations(key)
);

-- 索引文件记录表
CREATE TABLE indexed_files (
  path TEXT PRIMARY KEY,
  name TEXT,
  chunk_count INTEGER,
  preview TEXT,
  summary TEXT,
  key_points TEXT,   -- JSON 数组
  status TEXT,
  source_type TEXT,  -- 'file' | 'url'
  updated_at INTEGER
);

-- 文档集表
CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  name TEXT,
  description TEXT,
  files TEXT,        -- JSON 数组
  created_at INTEGER,
  updated_at INTEGER
);
```

### LanceDB 向量表

```typescript
interface VectorRecord {
  id: string // 唯一 ID
  text: string // 文本内容
  vector: Float32Array // 向量 (维度取决于模型)
  source: string // 来源文件路径
  metadata: {
    title?: string
    pageNumber?: number
    chunkIndex?: number
    tags?: string[]
  }
}
```

## 技术选型

### 为什么选择 LanceDB？

1. **嵌入式数据库**: 无需单独部署服务
2. **高性能**: 基于 Apache Arrow，支持大规模向量
3. **持久化**: 数据直接存储在文件系统
4. **易用性**: 简单的 API，支持过滤查询

### 为什么选择 LangGraph？

1. **流程编排**: 声明式定义对话流程
2. **状态管理**: 内置状态追踪
3. **可扩展**: 易于添加新节点和边
4. **调试友好**: 可视化流程图

### 为什么选择本地嵌入模型？

1. **隐私保护**: 数据不出本地
2. **无网络依赖**: 离线可用
3. **成本节约**: 无 API 调用费用
4. **低延迟**: 本地推理速度快

## 性能优化

### 向量搜索优化

- **批量嵌入**: 多文档同时向量化
- **查询缓存**: 缓存常见查询结果
- **索引预热**: 启动时预加载索引

### 前端优化

- **懒加载**: 设置面板、知识库面板延迟加载
- **虚拟滚动**: 消息列表虚拟化
- **防抖节流**: 输入和搜索防抖

### 主进程优化

- **Worker 线程**: 文档解析在独立 Worker 中执行
- **流式处理**: 大文件分块处理
- **内存管理**: 及时释放大对象

## 扩展指南

### 添加新的文档格式

1. 在 `src/main/rag/loader.ts` 添加解析器
2. 实现 `load(filePath): Promise<Document[]>` 方法
3. 在 `dialog:openFile` 中添加文件扩展名

### 添加新的 AI 模型

1. 在 `src/main/utils/createChatModel.ts` 添加模型创建逻辑
2. 在设置界面添加模型选项
3. 处理特定模型的参数差异

### 添加新的检索策略

1. 在 `src/main/rag/store/` 添加新的搜索器
2. 在 `hybridSearch.ts` 中集成
3. 更新配置选项
