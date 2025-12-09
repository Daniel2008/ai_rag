// ===== Electron Chat Provider =====
export { ElectronChatProvider } from './ElectronChatProvider'
export type { ElectronChatMessage, ElectronChatProviderConfig } from './ElectronChatProvider'

// 单例模式 API（备用，当前未使用）
export { getElectronChatProvider, resetElectronChatProvider } from './ElectronChatProvider'

// ===== Electron XRequest =====
export { ElectronXRequest, createElectronXRequest } from './ElectronXRequest'
export type { ElectronRequestInput, ElectronRequestOutput } from './ElectronXRequest'
