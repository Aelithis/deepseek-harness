import { afterEach, expect, it, vi } from 'vitest'

const harness = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const windows: Array<{ show: ReturnType<typeof vi.fn>; loadURL: ReturnType<typeof vi.fn> }> = []
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true, name: 'DSH Private', setName: vi.fn(), setPath: vi.fn(), setAppLogsPath: vi.fn(),
    getPath: (name: string) => `/private-test/${name}`, getLocale: () => 'zh-CN',
    getPreferredSystemLanguages: () => ['zh-CN'], getVersion: () => '0.2.1-rc.3', getAppPath: () => '/application',
    whenReady: () => Promise.resolve(), setAboutPanelOptions: vi.fn(), setAsDefaultProtocolClient: vi.fn(),
    isInApplicationsFolder: () => true, quit: vi.fn(), exit: vi.fn(), relaunch: vi.fn(),
  })
  class Window extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn(), getURL: () => 'dsh-app://app/',
      mainFrame: { url: 'dsh-app://app/' }, send: vi.fn(), isDestroyed: () => false })
    show = vi.fn()
    loadURL = vi.fn(async () => {})
    constructor() { super(); windows.push(this) }
    isDestroyed() { return false }
    isFullScreen() { return false }
    hide = vi.fn()
    static getAllWindows() { return windows }
  }
  return { app, Window, windows, handles: new Map<string, unknown>(), hostStart: vi.fn(), applyRelease: vi.fn() }
})
vi.mock('electron', () => ({ app: harness.app, BrowserWindow: harness.Window,
  dialog: { showMessageBox: vi.fn() }, ipcMain: { handle: (name: string, fn: unknown) => harness.handles.set(name, fn), on: vi.fn() },
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu: vi.fn() },
  powerMonitor: { on: vi.fn() }, nativeImage: {}, nativeTheme: { shouldUseDarkColors: false },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  session: { defaultSession: { webRequest: { onBeforeSendHeaders: vi.fn() } } }, shell: { openExternal: vi.fn() },
}))
vi.mock('../src/project-manager.ts', () => ({ DesktopProjectManager: class { applyRelease = harness.applyRelease } }))
vi.mock('../src/host-process.ts', () => ({ DesktopHostFatalError: class extends Error {}, DesktopHostProcess: class {
  start = async () => { harness.hostStart(); return { url: 'http://127.0.0.1:52341', injections: [] } }
  stop = vi.fn()
  inspectQuit = vi.fn()
} }))
vi.mock('../src/single-instance.ts', () => ({ claimDesktopSingleInstance: () => true }))
vi.mock('../src/paths.ts', () => ({ resolveDesktopPaths: () => ({ profile: '/private-test/home/profiles/desktop', lock: '/private-test/lock' }) }))
vi.mock('../src/command-management.ts', () => ({ DesktopCommandManager: vi.fn() }))
vi.mock('../src/directory-picker.ts', () => ({ installDesktopDirectoryPicker: vi.fn() }))
vi.mock('../src/microphone-permissions.ts', () => ({ installMicrophonePermissions: vi.fn() }))
vi.mock('../src/web-document.ts', () => ({ authenticateWebHost: async () => 'private-cookie', serveWebDocument: vi.fn(), forwardWebRequest: vi.fn() }))
vi.mock('../src/fatal-recovery.ts', () => ({ DesktopFatalRecovery: class { active = false; report = vi.fn() } }))
vi.mock('../src/crash-report.ts', () => ({ RendererConsoleTail: vi.fn(), pruneCrashReports: vi.fn(), writeCrashReport: vi.fn() }))
vi.mock('../src/login-shell-environment.ts', () => ({ resolveDesktopLoginShellConfig: vi.fn(), readDesktopLoginShellEnvironment: async (env: NodeJS.ProcessEnv) => ({ environment: env, failures: [] }) }))
vi.mock('../src/update-dialog.ts', () => ({ DesktopUpdateDialog: vi.fn() }))
vi.mock('../src/update-overlay.ts', () => ({ DesktopUpdateOverlays: vi.fn() }))
vi.mock('../src/browser-guests.ts', () => ({ DesktopBrowserGuests: class { bind = vi.fn() } }))
vi.mock('../src/keyboard.ts', () => ({ installDesktopShortcuts: () => ({ attach: vi.fn(), fileMenu: () => ({ label: '文件' }) }) }))
vi.mock('../src/quit-confirmation.ts', () => ({ DesktopQuitConfirmation: vi.fn() }))

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

it('opens a fresh private workspace directly without account or update IPC', async () => {
  vi.stubGlobal('process', { ...process, resourcesPath: '/resources' })
  vi.stubEnv('DSH_HOME', '/custom-private-home')
  await import('../src/main.ts')
  await vi.waitFor(() => expect(harness.windows[0]?.show).toHaveBeenCalledOnce())
  expect(harness.hostStart).toHaveBeenCalledOnce()
  expect(harness.applyRelease).toHaveBeenCalledOnce()
  expect(harness.windows).toHaveLength(1)
  expect(harness.windows[0]?.loadURL).toHaveBeenCalledWith('dsh-app://app/')
  expect(harness.app.setPath).toHaveBeenCalledWith('userData', '/private-test/appData/DSH Private')
  expect(process.env.DSH_HOME).toBe('/custom-private-home')
  expect([...harness.handles.keys()].some(name => /welcome|platform|onboarding|updates|mandatory/.test(name))).toBe(false)
})
