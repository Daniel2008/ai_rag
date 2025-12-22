/**
 * 应用配置常量
 */

export const RAG_CONFIG = {
  // 检索配置
  SEARCH: {
    DEFAULT_K: 8, // 从6增加到8，提高召回
    MAX_K: 25, // 从30降低，减少性能开销
    RELEVANCE_THRESHOLD: 0.15, // 从0.25降低，减少误杀
    RELEVANCE_THRESHOLD_LOW: 0.05, // 更宽松的阈值
    MIN_FETCH_K: 80,
    MAX_FETCH_K: 300, // 降低上限
    GLOBAL_SEARCH_MULTIPLIER: 30, // 从50降低
    FILTERED_SEARCH_MULTIPLIER: 15, // 从20降低
    GLOBAL_SEARCH_RATIO: 0.1, // 从0.15降低
    // MMR 多样性参数
    MMR_LAMBDA: 0.7, // 从0.75调整，增加多样性
    MMR_ENABLED: true,
    // 混合搜索权重
    HYBRID_SEARCH_ENABLED: true,
    BM25_WEIGHT: 0.5, // 调整为更平衡
    VECTOR_WEIGHT: 0.5 // 调整为更平衡
  },

  // 重排序配置 - 启用并优化
  RERANK: {
    ENABLED: true, // 改为true（如果有可用模型）
    MODEL: 'bge-reranker-base', // 默认重排序模型
    TOP_K: 6, // 从5增加
    BATCH_SIZE: 16,
    SCORE_THRESHOLD: 0.1, // 从0.3降低，更宽松
    PROVIDER: 'local' // 可选 local / api
  },

  // 文档数量缓存 - 延长TTL
  DOC_COUNT_CACHE: {
    TTL: 120000 // 从60秒延长到120秒
  },

  // 批量处理 - 优化并发
  BATCH: {
    EMBEDDING_BATCH_SIZE: 64,
    DOCUMENT_BATCH_SIZE: 300, // 从500降低，减少内存压力
    MAX_CONCURRENT_FILES: 3,
    PROGRESS_UPDATE_INTERVAL: 20, // 从10增加，减少UI更新频率
    EMBEDDING_CONCURRENCY: 4 // 保持不变
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

  // LanceDB 配置 - 优化索引
  LANCEDB: {
    INDEX: {
      ENABLED: true,
      TYPE: 'HNSW',
      METRIC: 'cosine',
      EF_CONSTRUCTION: 128,
      M: 32,
      NUM_PARTITIONS: 128, // 从256降低
      NUM_SUB_VECTORS: 64
    },
    VACUUM_ON_REBUILD: true
  },

  // 跨语言检索 - 优化
  CROSS_LANGUAGE: {
    MAX_VARIANTS: 4,
    MERGE_LIMIT: 300, // 从500降低
    ENABLE_QUERY_EXPANSION: true,
    RRF_K: 50 // 从60微调
  },

  // 查询向量缓存 - 扩大并优化
  EMBEDDING: {
    QUERY_CACHE_SIZE: 512, // 从256扩大
    QUERY_CACHE_TTL: 600000, // 从300000延长到600000(10分钟)
    SIMILAR_QUERY_THRESHOLD: 0.92, // 从0.95降低，更宽松
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
  },

  // 新增：性能调优参数
  PERFORMANCE: {
    MAX_CONCURRENT_QUERIES: 5, // 限制并发查询数
    ENABLE_EMBEDDING_BATCH: true, // 启用批量嵌入
    CACHE_WARMUP_ENABLED: true, // 启用预热
    LAZY_LOADING_ENABLED: true // 延迟加载大文档
  }
} as const

export type RagConfig = typeof RAG_CONFIG
