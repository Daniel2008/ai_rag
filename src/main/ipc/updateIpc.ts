import { ipcMain } from 'electron'
import {
    checkForUpdates,
    downloadUpdate,
    installUpdateAndQuit,
    getUpdateStatus,
    forceCheckUpdate,
    setUpdateWindow
} from '../utils/updateService'

export function registerUpdateIpc(mainWindow: Electron.BrowserWindow): void {
    // 设置更新窗口以接收通知
    setUpdateWindow(mainWindow)

    ipcMain.handle('update:check', async () => {
        try {
            await checkForUpdates(true)
            return { success: true }
        } catch (error) {
            return { success: false, error: String(error) }
        }
    })

    ipcMain.handle('update:download', async () => {
        try {
            await downloadUpdate()
            return { success: true }
        } catch (error) {
            return { success: false, error: String(error) }
        }
    })

    ipcMain.handle('update:install', async () => {
        try {
            installUpdateAndQuit()
            return { success: true }
        } catch (error) {
            return { success: false, error: String(error) }
        }
    })

    ipcMain.handle('update:getStatus', async () => {
        return getUpdateStatus()
    })

    ipcMain.handle('update:forceCheckDev', async () => {
        try {
            await forceCheckUpdate()
            return { success: true }
        } catch (error) {
            return { success: false, message: String(error) }
        }
    })
}
