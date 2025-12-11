/**
 * 结构化日志系统
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

interface LogEntry {
  level: LogLevel
  message: string
  timestamp: number
  context?: string
  metadata?: Record<string, unknown>
  error?: Error
}

class Logger {
  private level: LogLevel = LogLevel.INFO
  private entries: LogEntry[] = []
  private maxEntries = 1000 // 最多保留1000条日志
  private fileSinkEnabled = true
  private lastFlushedIndex = 0
  private flushTimer: NodeJS.Timeout | null = null
  private filePath: string | null = null

  constructor() {
    // 根据环境设置日志级别
    if (process.env.NODE_ENV === 'development') {
      this.level = LogLevel.DEBUG
    } else {
      this.level = LogLevel.INFO
    }
    try {
      const base = app?.getPath ? app.getPath('userData') : process.cwd()
      this.filePath = path.join(base, 'metrics.log')
    } catch {
      this.filePath = path.join(process.cwd(), 'metrics.log')
    }
    this.flushTimer = setInterval(() => this.flushToFile(), 5000)
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.level
  }

  private log(level: LogLevel, message: string, context?: string, metadata?: Record<string, unknown>, error?: Error): void {
    if (!this.shouldLog(level)) return

    const entry: LogEntry = {
      level,
      message,
      timestamp: Date.now(),
      context,
      metadata,
      error
    }

    // 添加到内存缓冲区
    this.entries.push(entry)
    if (this.entries.length > this.maxEntries) {
      this.entries.shift() // 删除最旧的条目
    }

    // 输出到控制台
    const prefix = `[${LogLevel[level]}]${context ? ` [${context}]` : ''}`
    const timestamp = new Date(entry.timestamp).toISOString()
    
    switch (level) {
      case LogLevel.DEBUG:
        console.debug(`${timestamp} ${prefix}`, message, metadata || '')
        break
      case LogLevel.INFO:
        console.log(`${timestamp} ${prefix}`, message, metadata || '')
        break
      case LogLevel.WARN:
        console.warn(`${timestamp} ${prefix}`, message, metadata || '')
        if (error) console.warn(error)
        break
      case LogLevel.ERROR:
        console.error(`${timestamp} ${prefix}`, message, metadata || '')
        if (error) console.error(error)
        break
    }
    this.flushToFile()
  }

  debug(message: string, context?: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, context, metadata)
  }

  info(message: string, context?: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, context, metadata)
  }

  warn(message: string, context?: string, metadata?: Record<string, unknown>, error?: Error): void {
    this.log(LogLevel.WARN, message, context, metadata, error)
  }

  error(message: string, context?: string, metadata?: Record<string, unknown>, error?: Error): void {
    this.log(LogLevel.ERROR, message, context, metadata, error)
  }

  /**
   * 获取最近的日志条目
   */
  getRecentEntries(count: number = 100, level?: LogLevel): LogEntry[] {
    let filtered = this.entries
    if (level !== undefined) {
      filtered = this.entries.filter(entry => entry.level >= level)
    }
    return filtered.slice(-count)
  }

  /**
   * 清除所有日志
   */
  clear(): void {
    this.entries = []
  }

  /**
   * 设置日志级别
   */
  setLevel(level: LogLevel): void {
    this.level = level
  }

  /**
   * 获取当前日志级别
   */
  getLevel(): LogLevel {
    return this.level
  }

  setFileSinkEnabled(enabled: boolean): void {
    this.fileSinkEnabled = enabled
  }

  private flushToFile(): void {
    if (!this.fileSinkEnabled || !this.filePath) return
    if (this.lastFlushedIndex >= this.entries.length) return
    const slice = this.entries.slice(this.lastFlushedIndex)
    if (slice.length === 0) return
    const lines = slice.map((e) =>
      JSON.stringify({
        level: LogLevel[e.level],
        message: e.message,
        timestamp: e.timestamp,
        context: e.context,
        metadata: e.metadata,
        error: e.error ? { message: e.error.message, stack: e.error.stack } : undefined
      })
    ).join('\n') + '\n'
    try {
      fs.appendFile(this.filePath, lines, () => {})
      this.lastFlushedIndex = this.entries.length
    } catch {
      // ignore
    }
  }
}

// 导出单例实例
export const logger = new Logger()

// 导出便捷函数
export function logDebug(message: string, context?: string, metadata?: Record<string, unknown>): void {
  logger.debug(message, context, metadata)
}

export function logInfo(message: string, context?: string, metadata?: Record<string, unknown>): void {
  logger.info(message, context, metadata)
}

export function logWarn(message: string, context?: string, metadata?: Record<string, unknown>, error?: Error): void {
  logger.warn(message, context, metadata, error)
}

export function logError(message: string, context?: string, metadata?: Record<string, unknown>, error?: Error): void {
  logger.error(message, context, metadata, error)
}

