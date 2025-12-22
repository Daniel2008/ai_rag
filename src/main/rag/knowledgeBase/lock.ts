/**
 * 知识库操作锁机制 - 防止并发操作导致的数据不一致
 */

import { EventEmitter } from 'events'

export interface LockOptions {
  timeout?: number
  maxWaitTime?: number
}

type LockHandle = { release: () => void; lockId: string }

interface PendingOperation {
  resolve: (value: LockHandle) => void
  reject: (error: Error) => void
  timestamp: number
  cleanup?: () => void
  timeoutId?: NodeJS.Timeout
  checkInterval?: NodeJS.Timeout
}

export class KnowledgeBaseLock extends EventEmitter {
  private static instance: KnowledgeBaseLock
  private locks: Map<string, { lockId: string; timestamp: number; operation: string }> = new Map()
  private pendingOperations: Map<string, PendingOperation[]> = new Map()

  private constructor() {
    super()
  }

  static getInstance(): KnowledgeBaseLock {
    if (!KnowledgeBaseLock.instance) {
      KnowledgeBaseLock.instance = new KnowledgeBaseLock()
    }
    return KnowledgeBaseLock.instance
  }

  /**
   * 获取操作锁
   */
  async acquireLock(
    operation: string,
    lockId: string = 'global',
    options: LockOptions = {}
  ): Promise<LockHandle> {
    const { maxWaitTime = 60000 } = options
    const startTime = Date.now()

    // 检查是否已有锁
    const existingLock = this.locks.get(lockId)
    if (!existingLock) {
      // 直接获取锁
      const newLock = { lockId, timestamp: Date.now(), operation }
      this.locks.set(lockId, newLock)
      this.emit('lock-acquired', { lockId, operation })

      return {
        release: () => this.releaseLock(lockId),
        lockId
      }
    }

    // 等待锁释放
    return new Promise<LockHandle>((resolve, reject) => {
      const waitInfo: PendingOperation = { resolve, reject, timestamp: Date.now() }

      if (!this.pendingOperations.has(lockId)) {
        this.pendingOperations.set(lockId, [])
      }
      this.pendingOperations.get(lockId)!.push(waitInfo)

      this.emit('lock-wait', { lockId, operation, waiting: true })

      // 超时检查
      const timeoutId = setTimeout(() => {
        const currentWait = Date.now() - startTime
        if (currentWait >= maxWaitTime) {
          // 清理等待队列
          const pending = this.pendingOperations.get(lockId)
          if (pending) {
            const index = pending.indexOf(waitInfo)
            if (index > -1) {
              pending.splice(index, 1)
            }
          }
          reject(new Error(`操作 ${operation} 获取锁超时，等待时间超过 ${maxWaitTime}ms`))
          this.emit('lock-timeout', { lockId, operation, waitTime: currentWait })
        }
      }, maxWaitTime)

      // 定期检查锁是否可用
      const checkInterval = setInterval(() => {
        if (!this.locks.has(lockId)) {
          clearInterval(checkInterval)
          clearTimeout(timeoutId)

          // 获取锁
          const newLock = { lockId, timestamp: Date.now(), operation }
          this.locks.set(lockId, newLock)
          this.emit('lock-acquired', { lockId, operation, waitTime: Date.now() - startTime })

          resolve({
            release: () => this.releaseLock(lockId),
            lockId
          })
        }
      }, 100)

      // 清理函数
      waitInfo.cleanup = () => {
        clearInterval(checkInterval)
        clearTimeout(timeoutId)
      }
      waitInfo.timeoutId = timeoutId
      waitInfo.checkInterval = checkInterval
    })
  }

  /**
   * 释放锁
   */
  private releaseLock(lockId: string): void {
    const existingLock = this.locks.get(lockId)
    if (!existingLock) {
      return
    }

    this.locks.delete(lockId)
    this.emit('lock-released', { lockId })

    // 检查是否有等待的操作
    const pending = this.pendingOperations.get(lockId)
    if (pending && pending.length > 0) {
      // 取出第一个等待的操作，让它获取锁
      const nextOperation = pending.shift()!
      if (nextOperation.cleanup) {
        nextOperation.cleanup()
      }

      // 立即获取锁
      const newLock = { lockId, timestamp: Date.now(), operation: 'pending' }
      this.locks.set(lockId, newLock)

      this.emit('lock-acquired', { lockId, operation: 'pending', fromWaitQueue: true })

      nextOperation.resolve({
        release: () => this.releaseLock(lockId),
        lockId
      })

      // 如果等待队列为空，清理
      if (pending.length === 0) {
        this.pendingOperations.delete(lockId)
      }
    }
  }

  /**
   * 检查锁状态
   */
  isLocked(lockId: string = 'global'): boolean {
    return this.locks.has(lockId)
  }

  /**
   * 强制释放锁（仅用于清理）
   */
  forceRelease(lockId: string): void {
    if (this.locks.has(lockId)) {
      this.locks.delete(lockId)
      this.emit('lock-force-released', { lockId })

      // 清理等待队列
      const pending = this.pendingOperations.get(lockId)
      if (pending) {
        pending.forEach((op) => {
          if (op.cleanup) op.cleanup()
          if (op.timeoutId) clearTimeout(op.timeoutId)
          if (op.checkInterval) clearInterval(op.checkInterval)
          op.reject(new Error(`锁被强制释放`))
        })
        this.pendingOperations.delete(lockId)
      }
    }
  }

  /**
   * 获取所有锁状态
   */
  getLockStatus(): Array<{
    lockId: string
    operation: string
    timestamp: number
    waitQueue: number
  }> {
    const status: Array<{
      lockId: string
      operation: string
      timestamp: number
      waitQueue: number
    }> = []

    this.locks.forEach((lock, lockId) => {
      const pending = this.pendingOperations.get(lockId)
      status.push({
        lockId,
        operation: lock.operation,
        timestamp: lock.timestamp,
        waitQueue: pending ? pending.length : 0
      })
    })

    return status
  }

  /**
   * 清理过期锁
   */
  cleanupExpiredLocks(maxAge: number = 300000): number {
    const now = Date.now()
    let cleaned = 0

    this.locks.forEach((lock, lockId) => {
      if (now - lock.timestamp > maxAge) {
        this.forceRelease(lockId)
        cleaned++
      }
    })

    return cleaned
  }

  /**
   * 等待锁释放（只等待，不获取）
   */
  waitForLockRelease(lockId: string = 'global', timeout: number = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.locks.has(lockId)) {
        resolve()
        return
      }

      const startTime = Date.now()
      const checkInterval = setInterval(() => {
        if (!this.locks.has(lockId)) {
          clearInterval(checkInterval)
          resolve()
        } else if (Date.now() - startTime > timeout) {
          clearInterval(checkInterval)
          reject(new Error(`等待锁释放超时: ${lockId}`))
        }
      }, 100)
    })
  }
}

/**
 * 简化的锁操作函数
 */
export async function withLock<T>(
  operation: string,
  fn: () => Promise<T>,
  lockId: string = 'global',
  options: LockOptions = {}
): Promise<T> {
  const lock = KnowledgeBaseLock.getInstance()
  const lockHandle = await lock.acquireLock(operation, lockId, options)

  try {
    return await fn()
  } finally {
    lockHandle.release()
  }
}

/**
 * 检查操作是否可以执行
 */
export function canPerformOperation(_operation: string, lockId: string = 'global'): boolean {
  const lock = KnowledgeBaseLock.getInstance()
  return !lock.isLocked(lockId)
}

/**
 * 获取操作队列长度
 */
export function getOperationQueueLength(lockId: string = 'global'): number {
  const lock = KnowledgeBaseLock.getInstance()
  const status = lock.getLockStatus()
  const lockInfo = status.find((s) => s.lockId === lockId)
  return lockInfo ? lockInfo.waitQueue : 0
}
