# 打包体积优化指南

## 📦 当前优化措施

### 1. 压缩优化
- **压缩方式**: `maximum`（最大压缩）
- **效果**: 相比 `store` 可减少 30-50% 体积
- **代价**: 打包时间增加约 20-30%

### 2. 文件排除优化

#### 排除的文件类型
- **文档文件**: `*.md`, `*.txt`, `*.log`
- **测试文件**: `test/`, `__tests__/`, `tests/`, `examples/`
- **开发文件**: `.github/`, `.vscode/`, `.idea/`, `tsconfig.json`
- **类型定义**: `*.d.ts`（运行时不需要）
- **源码映射**: `*.map`, `*.min.map`
- **许可证文件**: `LICENSE`, `license.*`
- **覆盖率报告**: `coverage/`, `.nyc_output/`, `.jest/`

#### 排除的目录
- `node_modules/.bin/` - 可执行文件
- `node_modules/*/test/` - 测试代码
- `node_modules/*/docs/` - 文档
- `node_modules/*/examples/` - 示例代码

### 3. extraResources 优化

对必须解包的原生模块进行过滤：
- `@lancedb` - 排除测试、文档、源码映射
- `apache-arrow` - 排除测试、文档、源码映射
- `@huggingface/transformers` - 排除测试、文档、源码映射
- `onnxruntime-node` - 排除测试、文档、源码映射

## 📊 体积对比

| 优化项 | 优化前 | 优化后 | 减少 |
|--------|--------|--------|------|
| 压缩方式 | store | maximum | ~30-50% |
| 文档文件 | 包含 | 排除 | ~5-10% |
| 测试文件 | 包含 | 排除 | ~10-15% |
| 源码映射 | 包含 | 排除 | ~5-10% |
| **总体减少** | 基准 | 优化后 | **~40-60%** |

## 🔧 进一步优化建议

### 1. 使用 Tree Shaking

确保代码中只导入需要的模块：

```typescript
// ❌ 不好：导入整个库
import * as langchain from '@langchain/core'

// ✅ 好：只导入需要的
import { Document } from '@langchain/core/documents'
```

### 2. 代码分割

已配置的代码分割：
- `react-vendor` - React 相关
- `antd-vendor` - Ant Design 相关
- `langchain-vendor` - LangChain 相关

### 3. 动态导入

对于大型依赖，使用动态导入：

```typescript
// 按需加载
const module = await import('./heavy-module')
```

### 4. 排除未使用的依赖

检查 `package.json`，移除未使用的依赖：

```bash
# 使用工具检查未使用的依赖
npx depcheck
```

### 5. 使用更小的替代库

考虑使用更轻量的替代方案：
- 图标库：使用 SVG 图标而不是大型图标库
- UI 组件：只导入需要的组件

## 🎯 体积分析工具

### 1. 分析打包体积

```bash
# 构建并分析
pnpm run build:win:dir

# 查看 dist/win-unpacked 目录大小
# Windows PowerShell
Get-ChildItem -Path dist/win-unpacked -Recurse | Measure-Object -Property Length -Sum
```

### 2. 使用 electron-builder 分析

```bash
# 启用详细日志查看打包内容
pnpm run build:win:debug
```

### 3. 使用工具分析

```bash
# 安装分析工具
npm install -g electron-builder-analyzer

# 分析打包结果
electron-builder-analyzer dist/win-unpacked
```

## 📋 体积优化检查清单

- [x] 使用最大压缩 (`compression: maximum`)
- [x] 排除文档文件 (`*.md`, `*.txt`)
- [x] 排除测试文件 (`test/`, `__tests__/`)
- [x] 排除类型定义 (`*.d.ts`)
- [x] 排除源码映射 (`*.map`)
- [x] 排除开发文件 (`.github/`, `.vscode/`)
- [x] 优化 extraResources 过滤
- [ ] 检查未使用的依赖
- [ ] 使用 Tree Shaking
- [ ] 代码分割优化
- [ ] 动态导入大型模块

## ⚠️ 注意事项

### 1. 压缩时间

`maximum` 压缩会增加打包时间：
- `store`: ~30-60 秒
- `maximum`: ~60-120 秒

如果打包时间过长，可以改用 `normal` 压缩。

### 2. 必需文件

以下文件**不能**排除：
- 原生模块 (`.node` 文件)
- 必需的资源文件
- 运行时依赖

### 3. 测试

优化后务必测试应用功能：
- 确保所有功能正常
- 检查原生模块是否正常工作
- 验证资源文件是否正确加载

## 🔍 常见问题

### Q: 打包后应用无法运行

**A**: 可能排除了必需的文件，检查：
1. 原生模块是否正确解包
2. 资源文件是否包含
3. 查看错误日志

### Q: 体积仍然很大

**A**: 可能的原因：
1. 大型依赖（如 `@huggingface/transformers`）
2. 原生模块（如 `onnxruntime-node`）
3. 未优化的代码

### Q: 如何进一步减小体积

**A**: 
1. 使用更小的依赖替代方案
2. 移除未使用的功能
3. 考虑使用 Web 版本替代 Electron
4. 使用应用商店分发（自动更新）

## 📚 相关资源

- [Electron Builder 文档](https://www.electron.build/)
- [打包优化最佳实践](https://www.electron.build/configuration/configuration)
- [Tree Shaking 指南](https://webpack.js.org/guides/tree-shaking/)

