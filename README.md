# 智汇 RAG - AI 智能知识库助手

<p align="center">
  <img src="build/icon.png" alt="智汇 RAG Logo" width="128" height="128">
</p>

<p align="center">
  <strong>基于 RAG 技术的桌面级 AI 知识库助手</strong>
</p>

<p align="center">
  支持文档问答 | 智能检索 | 文档生成 | 多模型集成
</p>

---

## 简介

**智汇 RAG** 是一款基于 Electron + React + TypeScript 开发的桌面应用，采用先进的 RAG（Retrieval-Augmented Generation）技术，帮助用户构建个人知识库，实现智能文档问答和知识检索。

### 核心特性

- **多格式文档支持**: PDF、Word (docx)、PowerPoint (pptx)、Excel (xlsx)、TXT、Markdown 等
- **网页内容导入**: 支持从 URL 直接抓取网页内容并入库
- **混合检索策略**: 结合向量语义搜索 + BM25 关键词检索，提高检索精度
- **多模型集成**: 支持 OpenAI、Anthropic Claude、Ollama 本地模型
- **本地向量存储**: 使用 LanceDB 实现高性能向量索引
- **流式对话**: 实时流式输出 AI 回答
- **智能摘要生成**: 自动提取文档摘要和关键要点
- **文档集管理**: 支持创建文档集，按主题组织知识
- **标签系统**: 通过标签快速筛选相关内容
- **跨平台支持**: Windows、macOS、Linux

## 快速开始

### 环境要求

- **Node.js**: >= 18.0.0
- **pnpm**: >= 8.0.0
- **操作系统**: Windows 10+、macOS 10.15+、Linux (Ubuntu 20.04+)

### 安装

```bash
# 克隆项目
git clone https://github.com/zhihui-rag/zhihui-rag.git
cd zhihui-rag

# 安装依赖
pnpm install
```

### 开发模式

```bash
pnpm run dev
```

### 构建应用

```bash
# Windows
pnpm run build:win

# macOS
pnpm run build:mac

# Linux
pnpm run build:linux
```

## 技术栈

### 前端

- **React 19** - UI 框架
- **TypeScript** - 类型安全
- **Ant Design X** - 企业级 UI 组件库
- **TailwindCSS 4** - 原子化 CSS 框架
- **Vite 7** - 构建工具

### 后端（主进程）

- **Electron** - 跨平台桌面框架
- **LangChain** - LLM 应用框架
- **LangGraph** - 对话流程编排
- **LanceDB** - 向量数据库
- **better-sqlite3** - SQLite 数据存储

### AI 能力

- **@langchain/openai** - OpenAI 模型集成
- **@langchain/anthropic** - Claude 模型集成
- **@langchain/ollama** - 本地 Ollama 模型
- **@huggingface/transformers** - 本地 Embedding 模型
- **onnxruntime-node** - 本地推理运行时

### 文档处理

- **pdf-parse** - PDF 解析
- **officeparser** - Office 文档解析
- **docx** - Word 文档生成
- **pptxgenjs** - PPT 文档生成
- **tesseract.js** - OCR 文字识别

## 项目结构

```
src/
├── main/                    # Electron 主进程
│   ├── db/                  # 数据库操作（SQLite）
│   ├── document/            # 文档生成（Word、PPT）
│   ├── rag/                 # RAG 核心功能
│   │   ├── chat/            # 对话上下文管理
│   │   ├── graph/           # LangGraph 对话流程
│   │   ├── knowledgeBase/   # 知识库管理
│   │   ├── store/           # 向量存储（LanceDB）
│   │   └── utils/           # RAG 工具函数
│   ├── utils/               # 通用工具
│   ├── index.ts             # 主进程入口
│   └── settings.ts          # 应用设置
├── preload/                 # 预加载脚本
├── renderer/                # 渲染进程（React 前端）
│   └── src/
│       ├── components/      # UI 组件
│       ├── hooks/           # React Hooks
│       ├── providers/       # 上下文 Provider
│       ├── types/           # 类型定义
│       └── App.tsx          # 应用入口
└── types/                   # 共享类型定义
```

## 核心功能

### 文档导入与索引

- 支持拖拽上传或点击选择文件
- 自动解析文档内容并分块
- 语义向量化存储
- 增量索引更新

### 智能检索

- **向量语义搜索**: 基于内容含义进行检索
- **BM25 关键词搜索**: 精准匹配关键词
- **RRF 融合排序**: 结合多路召回结果
- **MMR 去重**: 提高结果多样性
- **Rerank 重排序**: 可选的精排模型

### 对话问答

- 流式回答输出
- 引用来源标注
- 会话历史管理
- 多轮对话记忆

### 文档生成

- 基于知识库内容生成 Word 文档
- 基于知识库内容生成 PPT 演示文稿

## 配置说明

应用启动后，点击设置图标进行配置：

### 模型配置

- **AI 服务商**: OpenAI / Anthropic / Ollama
- **API Key**: 对应服务商的密钥
- **模型选择**: 可选择具体模型

### 嵌入模型

- **本地模型**: 使用 HuggingFace 模型（推荐 bge-small-zh-v1.5）
- **API 模型**: 使用 OpenAI Embeddings

### RAG 配置

- **检索数量**: 每次检索返回的文档数量
- **相关性阈值**: 过滤低相关性结果
- **混合检索**: 启用/禁用 BM25 混合搜索
- **重排序**: 启用/禁用 Rerank 精排

## 开发脚本

```bash
# 开发模式
pnpm run dev

# 类型检查
pnpm run typecheck

# 代码格式化
pnpm run format

# 代码检查
pnpm run lint

# 运行测试
pnpm run test
```

## 推荐 IDE 配置

- [VSCode](https://code.visualstudio.com/)
- [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)
- [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
- [Tailwind CSS IntelliSense](https://marketplace.visualstudio.com/items?itemName=bradlc.vscode-tailwindcss)

## 许可证

[MIT License](LICENSE)

## 贡献

欢迎提交 Issue 和 Pull Request！

## 更多文档

详细文档请查看 [Wiki](wiki/HOME.md)：

- [架构设计](wiki/Architecture.md)
- [功能详解](wiki/Features.md)
- [开发指南](wiki/Development.md)
