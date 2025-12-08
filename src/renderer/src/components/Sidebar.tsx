
import type { JSX } from 'react'
import { FolderOpen, FileText, Plus, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { IndexedFile } from '../types/files'

interface SidebarProps {
  onUpload: () => void
  files: IndexedFile[]
}

function renderStatusIcon(status: IndexedFile['status']): JSX.Element {
  if (status === 'processing') {
    return <Loader2 className="h-4 w-4 animate-spin text-primary" />
  }
  if (status === 'ready') {
    return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
  }
  return <AlertTriangle className="h-4 w-4 text-destructive" />
}

function renderStatusLabel(status: IndexedFile['status']): string {
  switch (status) {
    case 'processing':
      return '索引中'
    case 'ready':
      return '已就绪'
    case 'error':
      return '失败'
    default:
      return ''
  }
}

export function Sidebar({ onUpload, files }: SidebarProps): JSX.Element {
  return (
    <div className="flex h-full w-72 flex-col border-r border-border bg-card text-card-foreground">
      <div className="border-b border-border p-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <FolderOpen className="h-5 w-5" />
            Documents
          </h2>
          <span className="text-xs text-muted-foreground">{files.length} files</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3">
        {files.length === 0 ? (
          <div className="mt-8 rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            No documents loaded. Click “Add Document” to index your first file.
          </div>
        ) : (
          <ul className="space-y-2">
            {files.map((file) => (
              <li
                key={file.path}
                className="rounded-md border border-border bg-background/60 p-3 text-sm shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-1 items-start gap-2">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <p className="truncate font-medium" title={file.path}>
                        {file.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {file.status === 'ready'
                          ? `${file.chunkCount ?? 0} chunks`
                          : file.status === 'processing'
                            ? '正在分块并写入向量库'
                            : '处理失败，请检查日志'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {renderStatusIcon(file.status)}
                    <span>{renderStatusLabel(file.status)}</span>
                  </div>
                </div>

                {file.preview && file.status === 'ready' && (
                  <p className="mt-2 line-clamp-2 text-xs italic text-muted-foreground">
                    “{file.preview}”
                  </p>
                )}

                {file.status === 'error' && file.error && (
                  <p className="mt-2 text-xs text-destructive">{file.error}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border p-4">
        <button
          onClick={onUpload}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-primary-foreground transition hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Add Document
        </button>
      </div>
    </div>
  )
}
