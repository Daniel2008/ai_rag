import type { JSX } from 'react'
import { useState, useEffect } from 'react'
import { X, Settings, Save } from 'lucide-react'

export interface AppSettings {
    ollamaUrl: string
    chatModel: string
    embeddingModel: string
}

interface SettingsDialogProps {
    isOpen: boolean
    onClose: () => void
    onSaved?: (settings: AppSettings) => void
}

export function SettingsDialog({ isOpen, onClose, onSaved }: SettingsDialogProps): JSX.Element | null {
    const [settings, setSettings] = useState<AppSettings>({
        ollamaUrl: 'http://localhost:11434',
        chatModel: 'qwen2.5:7b',
        embeddingModel: 'nomic-embed-text'
    })
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)

    useEffect(() => {
        if (isOpen) {
            void loadSettings()
        }
    }, [isOpen])

    const loadSettings = async (): Promise<void> => {
        try {
            const loaded = await window.api.getSettings()
            setSettings(loaded)
        } catch (error) {
            console.error('Failed to load settings:', error)
        }
    }

    const handleSave = async (): Promise<void> => {
        setSaving(true)
        try {
            await window.api.saveSettings(settings)
            setSaved(true)
            setTimeout(() => setSaved(false), 2000)
            onSaved?.(settings)
        } catch (error) {
            console.error('Failed to save settings:', error)
        } finally {
            setSaving(false)
        }
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-full max-w-md rounded-lg bg-card p-6 shadow-xl">
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="flex items-center gap-2 text-lg font-semibold">
                        <Settings className="h-5 w-5" />
                        Settings
                    </h2>
                    <button
                        onClick={onClose}
                        className="rounded-md p-1 hover:bg-accent"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="mb-1 block text-sm font-medium">Ollama URL</label>
                        <input
                            type="text"
                            value={settings.ollamaUrl}
                            onChange={(e) => setSettings({ ...settings, ollamaUrl: e.target.value })}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            placeholder="http://localhost:11434"
                        />
                    </div>

                    <div>
                        <label className="mb-1 block text-sm font-medium">Chat Model</label>
                        <input
                            type="text"
                            value={settings.chatModel}
                            onChange={(e) => setSettings({ ...settings, chatModel: e.target.value })}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            placeholder="qwen2.5:7b"
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                            The model used for chat responses
                        </p>
                    </div>

                    <div>
                        <label className="mb-1 block text-sm font-medium">Embedding Model</label>
                        <input
                            type="text"
                            value={settings.embeddingModel}
                            onChange={(e) => setSettings({ ...settings, embeddingModel: e.target.value })}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            placeholder="nomic-embed-text"
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                            The model used for document embeddings
                        </p>
                    </div>
                </div>

                <div className="mt-6 flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="rounded-md px-4 py-2 text-sm hover:bg-accent"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                        <Save className="h-4 w-4" />
                        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    )
}
