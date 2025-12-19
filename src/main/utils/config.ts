/**
 * 应用配置常量
 */

export const RAG_CONFIG = {
  // 检索配置
  SEARCH: {
    DEFAULT_K: 6,
    MAX_K: 30,
    RELEVANCE_THRESHOLD: 0.25, // 降低相关性阈值，避免过滤掉有用结果
    RELEVANCE_THRESHOLD_LOW: 0.1, // 宽松阈值，配合语义验证
    MIN_FETCH_K: 100,
    MAX_FETCH_K: 500,
    GLOBAL_SEARCH_MULTIPLIER: 50,
    FILTERED_SEARCH_MULTIPLIER: 20,
    GLOBAL_SEARCH_RATIO: 0.15, // 库的 15%
    // MMR 多样性参数
    MMR_LAMBDA: 0.75, // 相关性与多样性平衡，0.75 偏向相关性
    MMR_ENABLED: true, // 启用 MMR 重排序
    // 混合搜索权重
    HYBRID_SEARCH_ENABLED: true, // 启用 BM25 混合搜索
    BM25_WEIGHT: 0.4, // BM25 在融合中的权重
    VECTOR_WEIGHT: 0.6 // 向量搜索在融合中的权重
  },

  // 文档数量缓存
  DOC_COUNT_CACHE: {
    TTL: 60000 // 60秒
  },

  // 批量处理配置
  BATCH: {
    EMBEDDING_BATCH_SIZE: 64,
    DOCUMENT_BATCH_SIZE: 500, // 每批最多处理500个文档块
    MAX_CONCURRENT_FILES: 3, // 最多同时处理3个文件
    PROGRESS_UPDATE_INTERVAL: 10, // 每处理10个文档更新一次进度
    EMBEDDING_CONCURRENCY: 4 // 查询向量并发上限
  },

  // 输入验证
  VALIDATION: {
    MAX_QUERY_LENGTH: 2000,
    MIN_QUERY_LENGTH: 1,
    MAX_SOURCES: 100
  },

  // 日志配置
  LOG: {
    DEBUG_LOG_FLUSH_INTERVAL: 5000, // 5秒
    MAX_DEBUG_LOG_BUFFER: 100
  },

  // 内存限制（MB）
  MEMORY: {
    MAX_RESULTS_IN_MEMORY: 500,
    WARNING_THRESHOLD_MB: 500
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
    ENABLE_QUERY_EXPANSION: true, // 启用查询扩展
    RRF_K: 60 // RRF 算法参数
  },

  // 查询向量缓存
  EMBEDDING: {
    QUERY_CACHE_SIZE: 256,
    QUERY_CACHE_TTL: 300000, // 5分钟过期
    SIMILAR_QUERY_THRESHOLD: 0.95, // 相似查询复用阈值
    // 推荐的多语言嵌入模型（按优先级排序）
    RECOMMENDED_MULTILINGUAL_MODELS: [
      'multilingual-e5-small', // 平衡性能和效果
      'multilingual-e5-base', // 更好效果
      'bge-m3', // 最强多语言
      'paraphrase-multilingual' // 兼容性好
    ],
    // 默认嵌入模型（推荐使用多语言模型）
    DEFAULT_MODEL: 'multilingual-e5-small'
  },

  // 后端配置占位，默认 LanceDB
  VECTOR_BACKEND: {
    TYPE: 'lancedb'
  }
} as const

export type RagConfig = typeof RAG_CONFIG
