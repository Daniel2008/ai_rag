# 向量库删除修复说明

## 🐛 问题描述

删除文档或文档集时，向量库中的索引没有被正确清理，导致全库检索时仍然能检索到已删除的文档。

## ✅ 修复内容

### 1. 改进 `removeSourceFromStore` 函数

**问题**:
- 路径匹配不准确（缺少路径标准化）
- 只尝试一次删除操作，失败后没有重试
- 路径格式不一致（Windows 路径分隔符等）

**修复**:
- ✅ 添加路径标准化函数 `normalizePath()`，与搜索时保持一致
- ✅ 尝试多种路径格式变体（原始路径、标准化路径、统一斜杠、规范化路径）
- ✅ 尝试多种字段名和谓词格式（source, metadata.source, path, url）
- ✅ 如果直接删除失败，使用查询+删除的方式作为备选
- ✅ 添加详细的日志记录，便于调试
- ✅ 返回删除操作的结果统计

**位置**: `src/main/rag/store.ts:908-1045`

### 2. 添加批量删除函数

**新增**: `removeSourcesFromStore(sources: string[])`

用于批量删除多个文件的向量索引，在删除文档集时使用。

**位置**: `src/main/rag/store.ts:1046-1051`

### 3. 修复文档集删除逻辑

**问题**:
- `deleteDocumentCollection` 只删除集合本身，没有删除集合中文件的向量索引

**修复**:
- ✅ 将函数改为 `async`，支持异步删除操作
- ✅ 删除集合前，先删除集合中所有文件的向量索引
- ✅ 使用批量删除函数提高效率
- ✅ 添加错误处理和日志

**位置**: `src/main/rag/knowledgeBase.ts:212-232`

### 4. 改进文件删除逻辑

**改进**:
- ✅ 添加详细的日志记录
- ✅ 改进错误处理，即使向量删除失败也继续执行
- ✅ 确保文件记录和向量索引同步删除

**位置**: `src/main/rag/knowledgeBase.ts:100-115`

### 5. 更新 IPC 处理器

**修复**:
- ✅ `collections:delete` 处理器支持异步操作

**位置**: `src/main/index.ts:625-627`

## 🔍 技术细节

### 路径标准化

```typescript
function normalizePath(p: string): string {
  return p.toLowerCase().replace(/\\/g, '/').trim()
}
```

这确保了：
- Windows 路径 (`C:\Users\file.pdf`) 和 Unix 路径 (`/home/user/file.pdf`) 统一处理
- 大小写不敏感匹配
- 去除前后空格

### 多重匹配策略

删除操作尝试以下方式：

1. **路径变体匹配**:
   - 原始路径
   - 标准化路径
   - 统一斜杠路径
   - 规范化路径（使用 path.normalize）

2. **字段名匹配**:
   - `source == "path"`
   - `metadata.source == "path"`
   - `path == "path"`
   - `url == "path"`

3. **模糊匹配**（备选）:
   - `source LIKE "%path%"`
   - `metadata.source LIKE "%path%"`

4. **查询后删除**（最终备选）:
   - 如果所有谓词都失败，先查询所有记录
   - 找到匹配的记录后，使用更精确的谓词删除

### 日志记录

所有删除操作都有详细的日志记录：

- `logInfo`: 删除开始、成功完成
- `logDebug`: 每个谓词的尝试结果
- `logWarn`: 删除失败但不影响整体流程
- `logError`: 严重错误

## 📋 使用示例

### 删除单个文件

```typescript
// 自动调用 removeSourceFromStore
await removeIndexedFileRecord(filePath)
```

### 删除文档集

```typescript
// 会自动删除集合中所有文件的向量索引
await deleteDocumentCollection(collectionId)
```

### 手动删除向量索引

```typescript
// 删除单个来源
await removeSourceFromStore(filePath)

// 批量删除
await removeSourcesFromStore([file1, file2, file3])
```

## ✅ 验证方法

1. **添加文档** → 检查向量库中是否有索引
2. **删除文档** → 检查向量库中索引是否被删除
3. **全库检索** → 确认已删除的文档不再出现在结果中
4. **删除文档集** → 确认集合中所有文件的索引都被删除

## 🎯 预期效果

修复后：
- ✅ 删除文档时，向量索引会被正确清理
- ✅ 删除文档集时，集合中所有文件的向量索引都会被清理
- ✅ 全库检索不会返回已删除的文档
- ✅ 路径格式不一致的问题已解决
- ✅ 删除操作的可靠性大幅提升

## 📝 注意事项

1. **删除操作是异步的**，确保使用 `await` 等待完成
2. **即使向量删除失败**，文件记录仍会被删除（避免数据不一致）
3. **日志会记录所有操作**，如果删除失败可以查看日志定位问题
4. **路径标准化**确保了不同操作系统和路径格式的一致性

