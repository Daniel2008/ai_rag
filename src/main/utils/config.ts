/**
 * 应用配置常量
 */

export const RAG_CONFIG = {
  // 检索配置
  SEARCH: {
    DEFAULT_K: 4,
    MAX_K: 20,
    RELEVANCE_THRESHOLD: 0.4,
    MIN_FETCH_K: 100,
    MAX_FETCH_K: 500,
    GLOBAL_SEARCH_MULTIPLIER: 50,
    FILTERED_SEARCH_MULTIPLIER: 20,
    GLOBAL_SEARCH_RATIO: 0.1, // 库的10%
  },
  
  // 文档数量缓存
  DOC_COUNT_CACHE: {
    TTL: 60000, // 60秒
  },
  
  // 批量处理配置
  BATCH: {
    EMBEDDING_BATCH_SIZE: 64,
    MAX_CONCURRENT_FILES: 3, // 最多同时处理3个文件
    PROGRESS_UPDATE_INTERVAL: 10, // 每处理10个文档更新一次进度
  },
  
  // 输入验证
  VALIDATION: {
    MAX_QUERY_LENGTH: 2000,
    MIN_QUERY_LENGTH: 1,
    MAX_SOURCES: 100,
  },
  
  // 日志配置
  LOG: {
    DEBUG_LOG_FLUSH_INTERVAL: 5000, // 5秒
    MAX_DEBUG_LOG_BUFFER: 100,
  },
  
  // 内存限制（MB）
  MEMORY: {
    MAX_RESULTS_IN_MEMORY: 500,
    WARNING_THRESHOLD_MB: 500,
  },
} as const

export type RagConfig = typeof RAG_CONFIG

