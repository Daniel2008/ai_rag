桌面端 RAG (检索增强生成) 应用规划书
1. 产品定位
面向大众用户的桌面端智能知识库应用。用户可以导入本地文档（PDF, Word, Markdown 等），通过聊天的方式与文档进行交互，获取精准的答案并能查看引用来源。强调易用性、隐私安全（本地处理）和现代化交互体验。

2. 功能规划 (Feature Plan)
核心功能 (MVP 阶段)
多格式文档导入: 支持拖拽上传 PDF, DOCX, TXT, MD, CSV 等常见格式。
本地向量知识库: 自动对文档进行分块 (Chunking) 和 向量化 (Embedding)，存储在本地，无需上传云端。
智能问答对话: 类似 ChatGPT 的聊天界面，支持针对“当前文档”、“自选多个文档”、“特定文档集”或“全库”提问。
引用溯源: 模型的回答必须包含引用来源 (Citations)，点击可跳转到原文对应段落。
模型配置:
云端模式: 支持设置 OpenAI / DeepSeek / Claude 等 API Key。
本地模式: 集成或连接 Ollama / Llama.cpp，允许用户下载并运行本地小模型 (如 qwen2.5-7b-instruct)，确保完全离线可用。
进阶功能 (V2 阶段)
混合搜索 (Hybrid Search): 结合关键词搜索 (BM25) 和 语义搜索 (Vector)，提高召回准确率。
多轮对话上下文: 能够记住之前的问答历史。
Prompt 模板: 内置常用的提问模板（如“总结摘要”、“提取关键数据”）。
知识图谱可视化: 展示文档之间的关联（可选）。
3. 技术栈建议 (Technology Stack)
考虑到需要开发桌面端应用，且 RAG 相关的生态主要集中在 Python 和 JavaScript/TypeScript，以下提供三套推荐方案：

方案 A：现代 Web 技术栈 (推荐 - 平衡开发效率与体验)
这套方案利用 Web 技术构建精美 UI，同时利用 Node.js 生态处理逻辑。

应用框架: Electron (或 Tauri 如果偏好 Rust 且追求更小体积)。
前端框架: React 或 Vue 3 + TailwindCSS (打造现代化 UI)。
语言: TypeScript。
RAG 核心: LangChain.js。
向量数据库: LanceDB (嵌入式，无需独立服务器，速度快，对 Electron 友好) 或 Orama (纯各类搜索)。
本地模型胶水层: Ollama (推荐用户安装 Ollama，应用通过 API 调用)。
方案 B：Python 原生全栈 (适合利用 Python 丰富 AI 生态)
如果 RAG 逻辑非常复杂，依赖特定的 Python 库 (如 LlamaIndex, unstructured)。

UI 框架: PyQt6 / PySide6 (传统桌面 UI，开发略繁琐) 或 Flet (基于 Flutter 的 Python 封装，UI 较现代)。
RAG 核心: LangChain (Python) 或 LlamaIndex。
打包工具: PyInstaller 或 Nuitka。
优势: 直接调用 Python 生态最强的 AI 库。
劣势: 打包体积大，UI 交互不仅 Web 技术栈灵活。
方案 C：混合架构 (高性能 UI + 强逻辑)
UI 层: Flutter 或 Electron。
逻辑层: Python 后端 (FastAPI)，打包成可执行文件作为子进程运行。
通信: HTTP 或 gRPC / Stdin-Stdout。
优势: 结合了最好的 UI 和最好的 AI 逻辑处理。
劣势: 架构复杂，不仅需要维护 UI 还需要维护 Python 环境的打包。
4. 推荐实施路线 (Implementation Roadmap)
我建议采用 方案 A (Electron + TypeScript + LangChain.js)，因为：

LangChain.js 现在的生态已经非常成熟。
LanceDB 或 Voyage 等向量库在 Node 环境下表现优异且无需 Python 环境，极大降低了用户安装门槛（不需要用户装 Python）。
开发效率高，UI 可以做得非常漂亮。
第一阶段：原型开发
初始化 Electron + React 项目。
实现基础的聊天 UI 布局。
集成 Ollama API 实现基本的对话功能。
第二阶段：RAG 实现
引入 LangChain.js。
实现文件读取与文本分割 (Text Splitter)。
集成 Embedding 模型 (可以使用本地 transformers.js 或 Ollama embedding)。
集成向量存储 (MemoryVectorStore 先行，后切换到 LanceDB)。
第三阶段：优化与打包
添加引用来源高亮功能。
美化 UI，增加深色模式。
使用 electron-builder 打包发布。

