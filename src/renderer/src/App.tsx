import { useState, useEffect, useRef } from 'react'
import type { JSX } from 'react'
import { Sidebar } from './components/Sidebar'
import { SettingsDialog } from './components/SettingsDialog'
import type { AppSettings } from './components/SettingsDialog'
import type { IndexedFile } from './types/files'
import { Send, Loader2, User, Bot, FileText, ChevronDown, ChevronUp, Sun, Moon, Settings } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTheme } from './components/ThemeProvider'

interface ChatSource {
  content: string
  fileName: string
  pageNumber?: number
}

interface Message {
  role: 'user' | 'ai'
  content: string
  sources?: ChatSource[]
}

function SourceCard({ source, index }: { source: ChatSource; index: number }): JSX.Element {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-md border border-border bg-card p-2 text-xs">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <div className="flex items-center gap-2">
          <FileText className="h-3 w-3 text-primary" />
          <span className="font-medium">[{index + 1}] {source.fileName}</span>
          {source.pageNumber && <span className="text-muted-foreground">p.{source.pageNumber}</span>}
        </div>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {expanded && (
        <div className="mt-2 border-t border-border pt-2 text-muted-foreground">{source.content}</div>
      )}
    </div>
  )
}

function App(): JSX.Element {
  const { theme, toggleTheme } = useTheme()
  const [input, setInput] = useState('')
  const [files, setFiles] = useState<IndexedFile[]>([])
  const [messages, setMessages] = useState<Message[]>([
    { role: 'ai', content: "Hello! I'm your local RAG assistant. Load some documents to get started." }
  ])
  const [isTyping, setIsTyping] = useState(false)
  const [currentSettings, setCurrentSettings] = useState<AppSettings | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const pendingSourcesRef = useRef<ChatSource[]>([])

  const scrollToBottom = (): void => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    const fetchSettings = async (): Promise<void> => {
      try {
        const loaded = await window.api.getSettings()
        setCurrentSettings(loaded)
      } catch (error) {
        console.error('Failed to load settings:', error)
      }
    }

    void fetchSettings()
  }, [])

  useEffect(() => {
    const handleToken = (token: string): void => {
      setMessages((prev) => {
        if (prev.length === 0) return prev
        const lastIndex = prev.length - 1
        const lastMessage = prev[lastIndex]
        if (lastMessage.role !== 'ai') {
          return prev
        }
        const updated = [...prev]
        updated[lastIndex] = {
          ...lastMessage,
          content: lastMessage.content + token
        }
        return updated
      })
    }

    const handleSources = (sources: ChatSource[]): void => {
      pendingSourcesRef.current = sources
    }

    const handleDone = (): void => {
      setMessages((prev) => {
        if (prev.length === 0) return prev
        const updated = [...prev]
        const lastIndex = updated.length - 1
        if (updated[lastIndex].role === 'ai') {
          updated[lastIndex] = {
            ...updated[lastIndex],
            sources: pendingSourcesRef.current
          }
        }
        return updated
      })
      pendingSourcesRef.current = []
      setIsTyping(false)
    }

    const handleError = (error: string): void => {
      setMessages((prev) => [...prev, { role: 'ai', content: `Error: ${error}` }])
      pendingSourcesRef.current = []
      setIsTyping(false)
    }

    window.api.onChatToken(handleToken)
    window.api.onChatSources(handleSources)
    window.api.onChatDone(handleDone)
    window.api.onChatError(handleError)

    return () => {
      window.api.removeAllChatListeners()
    }
  }, [])

  const extractFileName = (filePath: string): string => filePath.split(/[\\/]/).pop() ?? filePath

  const trackFileProcessing = (filePath: string): void => {
    setFiles((prev) => {
      const existing = prev.find((file) => file.path === filePath)
      if (existing) {
        return prev.map((file) =>
          file.path === filePath
            ? { ...file, status: 'processing', error: undefined, updatedAt: Date.now() }
            : file
        )
      }

      return [
        ...prev,
        {
          path: filePath,
          name: extractFileName(filePath),
          status: 'processing',
          updatedAt: Date.now()
        }
      ]
    })
  }

  const patchFile = (filePath: string, patch: Partial<IndexedFile>): void => {
    setFiles((prev) =>
      prev.map((file) =>
        file.path === filePath ? { ...file, ...patch, updatedAt: Date.now() } : file
      )
    )
  }

  const handleUpload = async (): Promise<void> => {
    const filePath = await window.api.selectFile()
    if (!filePath) return

    trackFileProcessing(filePath)
    try {
      const result = await window.api.processFile(filePath)
      if (result.success) {
        patchFile(filePath, {
          status: 'ready',
          chunkCount: result.count,
          preview: typeof result.preview === 'string' ? result.preview : undefined,
          error: undefined
        })
        console.log('File processed:', result)
      } else {
        patchFile(filePath, {
          status: 'error',
          error: typeof result.error === 'string' ? result.error : 'Unknown error'
        })
        console.error('File processing failed:', result.error)
      }
    } catch (error) {
      patchFile(filePath, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error)
      })
      console.error(error)
    }
  }

  const handleSend = (): void => {
    if (!input.trim() || isTyping) return

    const question = input
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: question }])
    setIsTyping(true)

    setMessages((prev) => [...prev, { role: 'ai', content: '' }])

    window.api.chat(question)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const processingFiles = files.filter((file) => file.status === 'processing')
  const processingPreview = processingFiles
    .slice(0, 2)
    .map((file) => file.name)
    .join(', ')

  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar files={files} onUpload={handleUpload} />

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border bg-card p-4">
          <div>
            <h1 className="text-xl font-bold">RAG Desktop</h1>
            <p className="hidden text-xs text-muted-foreground sm:block">Local knowledge-base assistant</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden flex-col text-right text-xs text-muted-foreground sm:flex">
              <span>Chat: {currentSettings?.chatModel ?? '加载中…'}</span>
              <span>Embed: {currentSettings?.embeddingModel ?? '加载中…'}</span>
            </div>
            <button
              onClick={toggleTheme}
              className="rounded-md p-2 hover:bg-accent"
              title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            >
              {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
            </button>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="hidden items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent sm:flex"
            >
              <Settings className="h-4 w-4" />
              Settings
            </button>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="sm:hidden"
              aria-label="Open settings"
            >
              <Settings className="h-5 w-5" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-auto bg-background p-4">
          <div className="mx-auto max-w-3xl space-y-6">
            {messages.map((msg, index) => (
              <div
                key={index}
                className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'ai' && (
                  <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Bot className="h-5 w-5 text-primary" />
                  </div>
                )}

                <div className="flex max-w-[80%] flex-col gap-2">
                  <div
                    className={`rounded-lg p-4 ${msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                      }`}
                  >
                    {msg.role === 'ai' ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.content || (isTyping && index === messages.length - 1 ? '...' : '')}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    )}
                  </div>

                  {msg.sources && msg.sources.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">📚 Sources ({msg.sources.length})</p>
                      <div className="space-y-1">
                        {msg.sources.map((source, i) => (
                          <SourceCard key={`${source.fileName}-${i}`} source={source} index={i} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {msg.role === 'user' && (
                  <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent">
                    <User className="h-5 w-5" />
                  </div>
                )}
              </div>
            ))}

            {processingFiles.length > 0 && (
              <div className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-center text-sm text-muted-foreground">
                <div className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>正在索引 {processingFiles.length} 个文档…</span>
                </div>
                <p className="mt-1 truncate text-xs" title={processingFiles.map((file) => file.name).join(', ')}>
                  {processingPreview}
                  {processingFiles.length > 2 ? ' 等' : ''}
                </p>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </main>

        <footer className="border-t border-border bg-card p-4">
          <div className="mx-auto flex max-w-3xl gap-2">
            <input
              type="text"
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Type your question..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isTyping}
            />
            <button
              onClick={handleSend}
              disabled={isTyping || !input.trim()}
              className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </footer>
      </div>

      <SettingsDialog
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSaved={(updated) => setCurrentSettings(updated)}
      />
    </div>
  )
}

export default App
