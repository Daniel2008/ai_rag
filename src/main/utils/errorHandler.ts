/**
 * 统一的错误处理工具
 */

export interface ErrorInfo {
  message: string
  code?: string
  details?: unknown
  userFriendly?: string
}

/**
 * 将未知错误转换为标准错误对象
 */
export function normalizeError(error: unknown): ErrorInfo {
  if (error instanceof Error) {
    return {
      message: error.message,
      details: error.stack,
      userFriendly: getUserFriendlyMessage(error.message)
    }
  }
  
  if (typeof error === 'object' && error && 'message' in error) {
    const errObj = error as { message?: unknown; code?: string }
    return {
      message: String(errObj.message || '未知错误'),
      code: errObj.code,
      userFriendly: getUserFriendlyMessage(String(errObj.message || ''))
    }
  }
  
  if (typeof error === 'string') {
    return {
      message: error,
      userFriendly: getUserFriendlyMessage(error)
    }
  }
  
  return {
    message: '未知错误',
    userFriendly: '发生未知错误，请稍后重试'
  }
}

/**
 * 将技术错误消息转换为用户友好的消息
 */
function getUserFriendlyMessage(message: string): string {
  const lowerMessage = message.toLowerCase()
  
  if (lowerMessage.includes('api key') || lowerMessage.includes('authentication')) {
    return 'API 密钥配置错误，请检查设置中的 API 密钥'
  }
  
  if (lowerMessage.includes('network') || lowerMessage.includes('timeout') || lowerMessage.includes('fetch')) {
    return '网络连接失败，请检查网络设置或稍后重试'
  }
  
  if (lowerMessage.includes('model') || lowerMessage.includes('provider')) {
    return '模型配置错误，请检查设置中的模型配置'
  }
  
  if (lowerMessage.includes('not found') || lowerMessage.includes('404')) {
    return '请求的资源不存在，请检查文件路径或 URL'
  }
  
  if (lowerMessage.includes('permission') || lowerMessage.includes('access')) {
    return '权限不足，请检查文件或目录的访问权限'
  }
  
  if (lowerMessage.includes('schema') || lowerMessage.includes('field not in schema')) {
    return '数据库结构不匹配，可能需要重建索引'
  }
  
  // 默认返回原始消息，但截断过长内容
  return message.length > 100 ? message.slice(0, 100) + '...' : message
}

/**
 * 错误包装器：为异步函数添加错误处理
 */
export function withErrorHandling<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  context?: string
): T {
  return (async (...args: any[]) => {
    try {
      return await fn(...args)
    } catch (error) {
      const errorInfo = normalizeError(error)
      console.error(`[${context || 'Error'}]`, errorInfo.message, errorInfo.details)
      throw new Error(errorInfo.userFriendly || errorInfo.message)
    }
  }) as T
}

/**
 * 检查是否是特定类型的错误
 */
export function isSchemaMismatchError(error: unknown): boolean {
  const errorInfo = normalizeError(error)
  return errorInfo.message.includes('Found field not in schema') || 
         errorInfo.message.includes('schema')
}

