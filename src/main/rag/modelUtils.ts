/**
 * 模型文件相关工具函数
 */

/**
 * 从文件路径或URL中提取基本文件名
 */
export function extractFileBaseName(input: string): string {
  const noQuery = input.split('?')[0] || input
  const normalized = noQuery.replace(/\\/g, '/')
  const last = normalized.split('/').pop() || normalized
  return last.trim()
}

/**
 * 判断文件名是否为不透明的哈希名（如 Hugging Face 的分片文件）
 */
export function isOpaqueFileName(fileBaseName: string): boolean {
  const name = fileBaseName.trim()
  if (!name) return true
  if (name.length >= 24 && !name.includes('.')) {
    if (/^[a-f0-9]+$/i.test(name)) return true
  }
  if (/^[a-f0-9]{32,}$/i.test(name)) return true
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(name)) return true
  return false
}

/**
 * 获取模型文件的描述性名称
 */
export function describeModelArtifact(fileBaseName: string): string {
  const lower = fileBaseName.toLowerCase()

  if (lower.includes('tokenizer')) return '分词器'
  if (lower.includes('vocab')) return '词表'
  if (lower.includes('merges')) return '分词规则'
  if (lower.includes('special') && lower.includes('token')) return '特殊符号表'
  if (lower.includes('config')) return '配置'

  if (lower.endsWith('.onnx')) return '模型权重'
  if (lower.endsWith('.safetensors')) return '模型权重'
  if (lower.endsWith('.bin')) return '模型权重'
  if (lower.endsWith('.pt') || lower.endsWith('.pth')) return '模型权重'

  if (lower.endsWith('.json')) return '配置文件'
  if (lower.endsWith('.txt')) return '词表文件'
  if (lower.endsWith('.model')) return '模型文件'

  if (lower.includes('model')) return '模型文件'
  return '模型文件'
}

/**
 * 获取用于显示的文件名
 */
export function getDisplayFileName(file: string): string {
  const base = extractFileBaseName(file)
  if (isOpaqueFileName(base)) return '模型分片'
  return describeModelArtifact(base)
}
