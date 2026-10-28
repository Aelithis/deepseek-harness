/** Install an unsigned NSIS artifact and check the real Private Electron window with an empty home. */
import { execFile, spawn } from 'node:child_process'
import { promisify, parseArgs } from 'node:util'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const { values } = parseArgs({ options: {
  installer: { type: 'string' }, output: { type: 'string' },
} })
if (process.platform !== 'win32') throw new Error('Private Windows smoke requires Windows')
if (!values.installer || !values.output) throw new Error('Use --installer <NSIS.exe> --output <evidence-directory>')
const execute = promisify(execFile)
const output = resolve(values.output)
await mkdir(output, { recursive: true })
const scratch = await mkdtemp(join(tmpdir(), 'dsh-private-windows-'))
const application = join(scratch, 'application')
const home = join(scratch, 'home')
await mkdir(home)
const report = { success: false, installer: resolve(values.installer), scratch,
  checks: { installed: false, overwritten: false, uninstalled: false, electronWindow: false, emptyModelCatalog: false, noLoginButton: false, noAnonymousId: false },
  installationUiVerified: false }
let child
let socket
try {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/(?:API_KEY|TOKEN|SECRET|PASSWORD)/iu.test(name)
    && !/^(?:DSH_|DEEPSEEK_|OPENAI_|ANTHROPIC_|ELECTRON_RUN_AS_NODE|NODE_OPTIONS|NODE_PATH)/u.test(name)))
  Object.assign(environment, { DSH_HOME: home, APPDATA: join(scratch, 'appdata'), LOCALAPPDATA: join(scratch, 'localappdata') })
  const install = () => execute(report.installer, ['/S', `/D=${application}`], { env: environment, timeout: 180_000 })
  await install()
  await access(join(application, 'DSH Private.exe'))
  report.checks.installed = true
  child = spawn(join(application, 'DSH Private.exe'), ['--remote-debugging-port=0'],
    { env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
  let launchError
  const closed = new Promise(resolveClose => child.once('close', resolveClose))
  child.once('error', error => { launchError = error })
  let logs = ''
  let debugPort
  child.stdout.on('data', chunk => { logs += chunk })
  child.stderr.on('data', chunk => {
    logs += chunk
    debugPort ??= /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//u.exec(logs)?.[1]
  })
  let commandId = 0
  const pending = new Map()
  const request = (method, params = {}) => new Promise((resolveResponse, reject) => {
    const id = ++commandId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timed out`)) }, 15_000)
    pending.set(id, { resolve: result => { clearTimeout(timer); resolveResponse(result) },
      reject: error => { clearTimeout(timer); reject(error) } })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const deadline = Date.now() + 120_000
  let page
  try {
    while (Date.now() < deadline) {
      if (launchError) throw launchError
      if (child.exitCode !== null) throw new Error(`Electron exited with ${child.exitCode}`)
      if (!socket && debugPort) {
        let response
        try { response = await fetch(`http://127.0.0.1:${debugPort}/json/list`) }
        catch (error) { if (error.cause?.code !== 'ECONNREFUSED') throw error }
        if (response) {
          const targets = await response.json()
          const target = targets.find(entry => entry.type === 'page' && entry.url.startsWith('dsh-app://app/'))
          if (target) {
            socket = new WebSocket(target.webSocketDebuggerUrl)
            await new Promise((resolveOpen, reject) => { socket.addEventListener('open', resolveOpen, { once: true }); socket.addEventListener('error', reject, { once: true }) })
            socket.addEventListener('message', event => {
              const message = JSON.parse(event.data)
              const callback = pending.get(message.id)
              if (!callback) return
              pending.delete(message.id)
              if (message.error) callback.reject(new Error(JSON.stringify(message.error)))
              else callback.resolve(message.result)
            })
          }
        }
      }
      if (socket) {
        const result = await request('Runtime.evaluate', { expression: `(() => {
          const trigger = [...document.querySelectorAll('button')].find(button => /^(请选择模型|Select model)$/u.test(button.getAttribute('aria-label') || ''));
          if (trigger && trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
          return { url: location.href, text: document.body.innerText, emptyCatalog: /暂无可用模型|No models available\\./u.test(document.body.innerText) };
        })()`, returnByValue: true })
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
        page = result.result.value
        if (page.emptyCatalog) break
      }
      await new Promise(resolveDelay => setTimeout(resolveDelay, 500))
    }
    if (!page?.emptyCatalog) throw new Error(`Empty model catalog did not appear: ${JSON.stringify(page)}`)
    if (/登录|登入|Sign in|Log in/iu.test(page.text)) throw new Error('Login control appeared in the Private workspace')
    report.checks.noLoginButton = true
    try { await access(join(home, '.anonymous-user-id')); throw new Error('Anonymous identity file was created') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    report.checks.noAnonymousId = true
    report.checks.electronWindow = true
    report.checks.emptyModelCatalog = true
    await writeFile(join(output, 'window.json'), JSON.stringify(page, null, 2))
    const screenshot = await request('Page.captureScreenshot', { format: 'png' })
    await writeFile(join(output, 'window.png'), Buffer.from(screenshot.data, 'base64'))
    socket.close()
    socket = undefined
    await execute('taskkill', ['/PID', String(child.pid), '/T', '/F'])
    await closed
    await install()
    report.checks.overwritten = true
    const uninstaller = join(application, 'Uninstall DSH Private.exe')
    // _?= disables NSIS's detached temporary uninstaller so process exit confirms cleanup.
    await execute(uninstaller, ['/S', `_?=${application}`], { env: environment, timeout: 120_000 })
    try { await access(join(application, 'DSH Private.exe')); throw new Error('Uninstall retained the application executable') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    report.checks.uninstalled = true
    report.success = true
  } finally { await writeFile(join(output, 'electron.log'), logs) }
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error)
  throw error
} finally {
  socket?.close()
  await writeFile(join(output, 'acceptance.json'), `${JSON.stringify(report, null, 2)}\n`)
  if (child?.pid && child.exitCode === null) {
    const closed = new Promise(resolveClose => child.once('close', resolveClose))
    await execute('taskkill', ['/PID', String(child.pid), '/T', '/F'])
    await closed
  }
  if (report.success) await rm(scratch, { recursive: true, force: true })
}
