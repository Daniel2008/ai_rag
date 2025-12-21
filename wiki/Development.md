# 开发指南

本文档介绍如何搭建开发环境、理解代码结构以及参与项目贡献。

## 目录

- [开发环境搭建](#开发环境搭建)
- [项目结构](#项目结构)
- [开发工作流](#开发工作流)
- [代码规范](#代码规范)
- [调试指南](#调试指南)
- [常见问题](#常见问题)

---

## 开发环境搭建

### 系统要求

| 要求 | 版本 |
|------|------|
| Node.js | >= 18.0.0 |
| pnpm | >= 8.0.0 |
| Git | 最新版 |
| 操作系统 | Windows 10+ / macOS 10.15+ / Linux |

### 安装步骤

#### 1. 克隆项目

```bash
git clone https://github.com/zhihui-rag/zhihui-rag.git
cd zhihui-rag
```

#### 2. 安装 pnpm（如未安装）

```bash
npm install -g pnpm
```

#### 3. 安装依赖

```bash
pnpm install
```

这会自动安装所有依赖并重建原生模块。

#### 4. 启动开发服务器

```bash
pnpm run dev
```

首次启动可能需要下载本地嵌入模型（约 50MB）。

### IDE 配置

推荐使用 **Visual Studio Code**，并安装以下插件：

```json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "bradlc.vscode-tailwindcss",
    "ms-vscode.vscode-typescript-next"
  ]
}
```

#### 工作区设置

创建 `.vscode/settings.json`：

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "typescript.preferences.importModuleSpecifier": "relative",
  "tailwindCSS.experimental.classRegex": [
    ["clsx\\(([^)]*)\\)", "(?:'|\"|`)([^']*)(?:'|\"|`)"]
  ]
}
```

---

## 项目结构

### 目录说明

```
zhihui-rag/
├── build/                   # 构建资源（图标等）
├── dist/                    # 构建输出目录
├── resources/               # 应用资源
├── scripts/                 # 构建脚本
├── src/
│   ├── main/                # 主进程代码
│   ├── preload/             # 预加载脚本
│   ├── renderer/            # 渲染进程代码
│   └── types/               # 共享类型定义
├── electron.vite.config.ts  # Vite 配置
├── electron-builder.yml     # 打包配置
├── package.json
├── tsconfig.json            # 主 TS 配置
├── tsconfig.node.json       # Node 侧 TS 配置
└── tsconfig.web.json        # 浏览器侧 TS 配置
```

### 主进程 (src/main)

```
main/
├── db/                      # 数据库层
│   ├── index.ts             # SQLite 初始化
│   └── service.ts           # CRUD 服务
├── document/                # 文档生成
│   ├── documentGenerator.ts # 生成入口
│   ├── wordGenerator.ts     # Word 生成器
│   ├── pptGenerator.ts      # PPT 生成器
│   └── types.ts             # 类型定义
├── rag/                     # RAG 核心
│   ├── chat/                # 对话处理
│   ├── graph/               # LangGraph 流程
│   ├── knowledgeBase/       # 知识库管理
│   ├── store/               # 向量存储
│   ├── utils/               # 工具函数
│   ├── chat.ts              # 对话入口
│   ├── hybridSearch.ts      # 混合检索
│   ├── langgraphChat.ts     # LangGraph 对话
│   ├── loader.ts            # 文档加载
│   └── localEmbeddings.ts   # 本地嵌入
├── utils/                   # 通用工具
│   ├── config.ts            # 配置常量
│   ├── createChatModel.ts   # 模型创建
│   ├── errorHandler.ts      # 错误处理
│   └── logger.ts            # 日志工具
├── index.ts                 # 主进程入口
└── settings.ts              # 设置管理
```

### 渲染进程 (src/renderer)

```
renderer/src/
├── assets/
│   └── main.css             # 全局样式
├── components/
│   ├── chat/                # 聊天组件
│   │   ├── ChatArea.tsx
│   │   ├── ChatInput.tsx
│   │   ├── ChatSidebar.tsx
│   │   ├── CollectionModal.tsx
│   │   ├── WelcomeScreen.tsx
│   │   └── index.ts
│   ├── AppSidebar.tsx       # 知识库面板
│   ├── SettingsDialog.tsx   # 设置弹窗
│   ├── TitleBar.tsx         # 标题栏
│   └── GlobalProgress.tsx   # 全局进度
├── hooks/
│   ├── useChatWithXChat.ts  # 聊天逻辑
│   ├── useConversations.ts  # 会话管理
│   ├── useKnowledgeBase.ts  # 知识库管理
│   ├── useProgress.ts       # 进度状态
│   └── index.ts
├── providers/
│   ├── ElectronChatProvider.ts
│   └── ElectronXRequest.ts
├── types/
│   ├── chat.ts
│   └── files.ts
├── utils/
│   ├── chat.ts
│   └── ollamaStream.ts
├── App.tsx                  # 应用入口
├── main.tsx                 # 渲染入口
└── theme.ts                 # 主题配置
```

---

## 开发工作流

### 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm run dev` | 启动开发模式 |
| `pnpm run build` | 生产构建（含类型检查） |
| `pnpm run build:fast` | 快速构建（跳过类型检查） |
| `pnpm run build:win` | 构建 Windows 安装包 |
| `pnpm run build:mac` | 构建 macOS 安装包 |
| `pnpm run build:linux` | 构建 Linux 安装包 |
| `pnpm run typecheck` | 类型检查 |
| `pnpm run lint` | ESLint 检查 |
| `pnpm run format` | Prettier 格式化 |
| `pnpm run test` | 运行测试 |

### 开发模式

```bash
pnpm run dev
```

开发模式特性：
- 热重载：前端代码修改自动刷新
- DevTools：F12 打开开发者工具
- 源码映射：方便调试

### 构建流程

```
pnpm run build:win
        │
        ▼
┌───────────────────┐
│   类型检查         │ ← tsc --noEmit
└───────────────────┘
        │
        ▼
┌───────────────────┐
│   Vite 构建        │ ← electron-vite build
│  ┌─────────────┐  │
│  │ 主进程      │  │
│  │ 渲染进程    │  │
│  │ 预加载脚本  │  │
│  └─────────────┘  │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│  Electron Builder │ ← electron-builder --win
│  ┌─────────────┐  │
│  │ 打包 ASAR   │  │
│  │ 原生模块    │  │
│  │ 生成安装包  │  │
│  └─────────────┘  │
└───────────────────┘
        │
        ▼
   dist/zhihui-rag-1.0.1.exe
```

### 添加新功能

#### 1. 添加新的 IPC 接口

主进程 (`src/main/index.ts`):

```typescript
ipcMain.handle('feature:action', async (_, params: ParamType) => {
  // 实现逻辑
  return result
})
```

预加载脚本 (`src/preload/index.ts`):

```typescript
contextBridge.exposeInMainWorld('api', {
  // ...
  featureAction: (params: ParamType) => ipcRenderer.invoke('feature:action', params)
})
```

类型定义 (`src/preload/index.d.ts`):

```typescript
interface ElectronAPI {
  // ...
  featureAction: (params: ParamType) => Promise<ResultType>
}
```

渲染进程使用:

```typescript
const result = await window.api.featureAction(params)
```

#### 2. 添加新的 React 组件

```tsx
// src/renderer/src/components/NewFeature.tsx
import { FC } from 'react'

interface NewFeatureProps {
  // props
}

export const NewFeature: FC<NewFeatureProps> = (props) => {
  return (
    <div>
      {/* 组件内容 */}
    </div>
  )
}
```

#### 3. 添加新的 Hook

```typescript
// src/renderer/src/hooks/useNewFeature.ts
import { useState, useCallback } from 'react'

export function useNewFeature() {
  const [state, setState] = useState()

  const action = useCallback(async () => {
    // 逻辑
  }, [])

  return { state, action }
}
```

---

## 代码规范

### TypeScript

- 使用严格模式 (`strict: true`)
- 避免使用 `any`，必要时使用 `unknown`
- 导出类型使用 `type` 关键字
- 接口命名使用 Pascal Case

### React

- 使用函数组件 + Hooks
- Props 使用接口定义
- 避免内联函数，使用 `useCallback`
- 状态管理优先使用 Hooks

### 代码风格

```javascript
// .prettierrc.yaml
singleQuote: true
semi: false
printWidth: 100
trailingComma: none
```

### ESLint 规则

项目使用 `@electron-toolkit/eslint-config-ts` 和 `@electron-toolkit/eslint-config-prettier`。

主要规则：
- 单引号
- 无分号
- 2空格缩进
- 无未使用变量

### Git 提交规范

使用 Conventional Commits：

```
<type>(<scope>): <subject>

<body>

<footer>
```

类型：
- `feat`: 新功能
- `fix`: 修复 Bug
- `docs`: 文档更新
- `style`: 代码格式
- `refactor`: 重构
- `perf`: 性能优化
- `test`: 测试
- `chore`: 构建/工具

示例：
```
feat(rag): 添加多查询扩展支持

- 实现 QueryExpander 类
- 集成到 HybridSearcher
- 添加配置选项

Closes #123
```

---

## 调试指南

### 主进程调试

#### VSCode 调试配置

创建 `.vscode/launch.json`：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Main Process",
      "type": "node",
      "request": "launch",
      "cwd": "${workspaceFolder}",
      "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/electron-vite",
      "runtimeArgs": ["dev"],
      "env": {
        "REMOTE_DEBUGGING_PORT": "9222"
      }
    }
  ]
}
```

#### 日志调试

使用内置 logger：

```typescript
import { logDebug, logWarn, logError } from './utils/logger'

logDebug('调试信息', 'ModuleName', { data: value })
logWarn('警告信息', 'ModuleName')
logError('错误信息', 'ModuleName', undefined, error)
```

### 渲染进程调试

1. 开发模式下按 `F12` 打开 DevTools
2. 使用 React DevTools 扩展
3. 查看 Console 面板的日志

### LanceDB 调试

```typescript
// 获取表信息
const stats = await table.countRows()
console.log('文档数量:', stats)

// 查看存储路径
import { app } from 'electron'
const dbPath = join(app.getPath('userData'), 'lancedb')
console.log('数据库路径:', dbPath)
```

### 网络请求调试

使用 DevTools Network 面板查看 API 请求。

对于 Ollama 本地模型：
```bash
# 检查 Ollama 服务状态
curl http://localhost:11434/api/version
```

---

## 常见问题

### Q: 安装依赖时报错 node-gyp

**原因**: 原生模块编译需要构建工具

**解决**:
```bash
# Windows
npm install -g windows-build-tools

# macOS
xcode-select --install

# Linux
sudo apt install build-essential
```

### Q: 启动时报错 LanceDB 初始化失败

**原因**: 可能是数据库文件损坏

**解决**:
```bash
# 删除数据库目录（会丢失所有向量数据）
# Windows: %APPDATA%/zhihui-rag/lancedb
# macOS: ~/Library/Application Support/zhihui-rag/lancedb
```

### Q: 嵌入模型下载失败

**原因**: 网络问题

**解决**:
1. 检查网络连接
2. 使用代理
3. 手动下载模型到缓存目录

### Q: 打包后原生模块报错

**原因**: 原生模块未正确解包

**解决**:
确认 `electron-builder.yml` 中的 `asarUnpack` 配置：

```yaml
asarUnpack:
  - node_modules/@lancedb/**
  - node_modules/better-sqlite3/**
  - node_modules/onnxruntime-node/**
```

### Q: 内存占用过高

**原因**: 可能是向量模型或大文件未释放

**解决**:
1. 减少同时打开的文件数
2. 重启应用释放内存
3. 检查是否有内存泄漏

### Q: 热重载不生效

**原因**: 修改了主进程代码

**解决**:
主进程代码修改需要重启开发服务器。

---

## 贡献指南

### 提交 Issue

1. 搜索已有 Issue 避免重复
2. 使用 Issue 模板
3. 提供复现步骤
4. 附上错误日志

### 提交 PR

1. Fork 项目
2. 创建功能分支
3. 编写代码和测试
4. 提交 PR

### 代码审查

- 遵循代码规范
- 添加必要的测试
- 更新相关文档
- 通过 CI 检查
