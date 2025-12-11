/**
 * 应用配置常量
 */

export const RAG_CONFIG = {
  // 检索配置
  SEARCH: {
    DEFAULT_K: 6,
    MAX_K: 30,
    RELEVANCE_THRESHOLD: 0.30, // 降低阈值提高召回率
    RELEVANCE_THRESHOLD_LOW: 0.10, // 宽松阈值，用于保底
    MIN_FETCH_K: 80,
    MAX_FETCH_K: 300,
    GLOBAL_SEARCH_MULTIPLIER: 40,
    FILTERED_SEARCH_MULTIPLIER: 15,
    GLOBAL_SEARCH_RATIO: 0.10 // 库的 10%
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
    EMBEDDING_CONCURRENCY: 4 // 查询向量并发上限
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

  // 指标日志
  METRICS: {
    ENABLED: true,
    LOG_SLOW_QUERY_MS: 600,
    LOG_SLOW_INDEX_MS: 2000,
    LOG_TOP_K: 8
  },

  // LanceDB 相关配置
  LANCEDB: {
    INDEX: {
      ENABLED: true,
      TYPE: 'HNSW', // 可选 HNSW / IVF_PQ
      METRIC: 'cosine',
      EF_CONSTRUCTION: 128,
      M: 32,
      NUM_PARTITIONS: 256,
      NUM_SUB_VECTORS: 64
    },
    VACUUM_ON_REBUILD: true
  },

  // 跨语言检索配置
  CROSS_LANGUAGE: {
    MAX_VARIANTS: 4,
    MERGE_LIMIT: 500,
    ENABLE_QUERY_EXPANSION: true // 启用查询扩展
  },

  // 查询向量缓存
  EMBEDDING: {
    QUERY_CACHE_SIZE: 256
  },

  // 后端配置占位，默认 LanceDB
  VECTOR_BACKEND: {
    TYPE: 'lancedb'
  },
} as const

export type RagConfig = typeof RAG_CONFIG

