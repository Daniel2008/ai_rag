# 智汇 RAG Wiki

欢迎来到 **智汇 RAG** 项目的 Wiki 文档！

## 目录

### 入门指南

- [快速开始](../README.md#快速开始)
- [安装配置](../README.md#安装)
- [系统要求](../README.md#环境要求)

### 核心文档

- [架构设计](Architecture.md) - 系统架构与技术选型
- [功能详解](Features.md) - 详细功能说明
- [开发指南](Development.md) - 开发环境与流程

## 项目概述

**智汇 RAG** 是一款基于 RAG（Retrieval-Augmented Generation）技术的桌面级 AI 知识库助手。它允许用户导入各种格式的文档，构建个人知识库，并通过自然语言与知识库进行对话交互。

### 核心能力

| 能力       | 描述                                             |
| ---------- | ------------------------------------------------ |
| 文档导入   | 支持 PDF、Word、PPT、Excel、TXT、Markdown 等格式 |
| 网页抓取   | 从 URL 直接导入网页内容                          |
| 语义检索   | 基于向量的语义相似度搜索                         |
| 关键词检索 | BM25 算法的精准关键词匹配                        |
| 混合检索   | 向量 + 关键词的 RRF 融合排序                     |
| 流式对话   | 实时流式输出 AI 回答                             |
| 多模型支持 | OpenAI、Claude、Ollama 本地模型                  |
| 文档生成   | 基于知识库生成 Word/PPT                          |

### 技术亮点

1. **本地优先**: 数据存储在本地，保护隐私安全
2. **混合检索**: 结合语义搜索与关键词搜索，提高召回率
3. **多模型支持**: 灵活切换不同 AI 模型
4. **跨平台**: 支持 Windows、macOS、Linux

## 快速导航

### 我想了解...

- **项目架构** → [Architecture.md](Architecture.md)
- **功能特性** → [Features.md](Features.md)
- **如何开发** → [Development.md](Development.md)
- **快速上手** → [README.md](../README.md)

### 常见问题

#### Q: 支持哪些文档格式？

A: PDF、DOCX、PPTX、XLSX、ODT、ODP、ODS、TXT、MD

#### Q: 支持哪些 AI 模型？

A: OpenAI (GPT-4/3.5)、Anthropic (Claude)、Ollama (本地模型)

#### Q: 数据存储在哪里？

A: 所有数据存储在本地，使用 LanceDB（向量）和 SQLite（元数据）

#### Q: 需要联网吗？

A: 仅在调用云端 AI 模型时需要网络；使用 Ollama 本地模型可完全离线使用

## 更新日志

### v1.0.1

- 优化混合检索性能
- 增加标签筛选功能
- 修复 Windows 打包问题

### v1.0.0

- 首次发布
- 支持多格式文档导入
- 实现 RAG 对话功能
- 集成多 AI 模型

---

如有问题或建议，欢迎提交 [Issue](https://github.com/zhihui-rag/zhihui-rag/issues)！
