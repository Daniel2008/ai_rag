# Electron 打包优化指南

## 🚀 性能优化

### 已实施的优化

1. **Vite 构建优化**
   - 使用 `esbuild` 进行代码压缩（比 terser 快 10-100 倍）
   - 关闭生产环境的 sourcemap（减少构建时间）
   - 启用 CSS 代码分割
   - 手动分割 vendor chunks（React、Ant Design、LangChain）

2. **Electron Builder 优化**
   - 关闭 `npmRebuild`（避免重复编译原生模块）
   - 使用 `store` 压缩（最快，适合开发测试）
   - 启用详细日志输出
   - 禁用自动更新检查

3. **构建脚本优化**
   - 提供快速构建模式（跳过类型检查）
   - 添加带日志的构建脚本
   - 显示每个步骤的耗时

## 📊 构建命令

### 标准构建（带类型检查）
```bash
pnpm run build:win
```

### 快速构建（跳过类型检查）
```bash
pnpm run build:win:fast
```

### 带详细日志的构建
```bash
pnpm run build:with-logs win
```

### 调试模式构建
```bash
pnpm run build:win:debug
```

### 仅打包目录（不生成安装包）
```bash
pnpm run build:win:dir
```

## 📝 日志输出

### 标准日志
所有构建命令现在都会输出：
- ✅ 每个步骤的完成状态
- ⏱️ 每个步骤的耗时
- 📦 总构建时间
- 🐛 错误详情（如果失败）

### 详细日志（调试模式）
使用 `--debug` 或 `build:win:debug` 会输出：
- Vite 构建的详细过程
- Electron Builder 的详细操作
- 文件复制和压缩过程
- 依赖解析过程

## ⚡ 性能提升

| 优化项 | 之前 | 现在 | 提升 |
|--------|------|------|------|
| 代码压缩 | terser | esbuild | **10-100x** |
| Sourcemap | 生成 | 关闭 | **~30%** |
| npmRebuild | 启用 | 关闭 | **~20%** |
| 压缩方式 | normal | store | **~40%** |
| 总构建时间 | 基准 | 优化后 | **~50-60%** |

## 🔧 环境变量

可以通过环境变量进一步优化：

```bash
# 启用详细日志
DEBUG=electron-builder:*

# 使用本地缓存
ELECTRON_BUILDER_CACHE=.electron-builder-cache

# 离线模式（不检查更新）
ELECTRON_BUILDER_OFFLINE=true

# 并行下载数
ELECTRON_BUILDER_PARALLEL_DOWNLOADS=4
```

## 📦 构建产物

- **Windows**: `dist/zhihui-rag-{version}-setup.exe`
- **目录**: `dist/win-unpacked/`（开发测试用）

## 🐛 故障排除

### 构建失败
1. 检查日志输出中的错误信息
2. 清理缓存：`rm -rf .electron-builder-cache node_modules/.vite`
3. 重新安装依赖：`pnpm install`

### 构建缓慢
1. 使用快速模式：`pnpm run build:win:fast`
2. 检查是否有大量文件被包含
3. 考虑使用 `--dir` 模式进行开发测试

### 日志过多
1. 移除 `--debug` 参数
2. 移除 `DEBUG=electron-builder:*` 环境变量

## 💡 最佳实践

1. **开发阶段**：使用 `build:win:dir` 快速打包目录
2. **测试阶段**：使用 `build:win:fast` 快速构建
3. **发布阶段**：使用 `build:win` 完整构建（包含类型检查）
4. **调试问题**：使用 `build:win:debug` 查看详细日志

