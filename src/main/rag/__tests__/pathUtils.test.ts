import { describe, it, expect } from 'vitest'
import { normalizePath, isUrlPath } from '../pathUtils'

describe('normalizePath', () => {
  it('normalizes backslashes to slashes and lowercases', () => {
    const p = 'C:\\Users\\Test\\File.TXT'
    expect(normalizePath(p)).toBe('c:/users/test/file.txt')
  })

  it('keeps slashes and lowercases', () => {
    const p = 'C:/Users/Test/File.TXT'
    expect(normalizePath(p)).toBe('c:/users/test/file.txt')
  })

  it('normalizes urls by lowercasing and preserving protocol slashes', () => {
    const p = 'HTTPS://Example.COM/Path/To/FILE'
    expect(normalizePath(p)).toBe('https://example.com/path/to/file')
  })
})

describe('isUrlPath', () => {
  it('detects http and https urls', () => {
    expect(isUrlPath('http://example.com')).toBe(true)
    expect(isUrlPath('https://example.com')).toBe(true)
    expect(isUrlPath('ftp://example.com')).toBe(false)
    expect(isUrlPath('C:/path/to/file')).toBe(false)
  })
})
