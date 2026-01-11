import { ipcMain, dialog } from 'electron'

export function registerDialogIpc(): void {
    ipcMain.handle('dialog:openFile', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            properties: ['openFile', 'multiSelections'],
            filters: [
                {
                    name: 'Documents',
                    extensions: ['pdf', 'docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods', 'txt', 'md']
                }
            ]
        })
        if (canceled) return []
        return filePaths
    })
}
