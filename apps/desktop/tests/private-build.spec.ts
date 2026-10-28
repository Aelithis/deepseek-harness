import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { localMacOSPackageEnvironment } from '../scripts/desktop-package-environment.mjs'
import { resolveDesktopPaths } from '../src/paths.ts'

const source = (name: string): string => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')

describe('private desktop distribution', () => {
  it('isolates the application identity and strips inherited release policy', () => {
    const environment = localMacOSPackageEnvironment({ DSH_DESKTOP_APP_ID: 'official', DSH_DESKTOP_MANDATORY_UPDATE_CONFIG: 'old', DSH_HOME: '/custom/home' })
    expect(environment.DSH_DESKTOP_APP_ID).toBe('org.aelith.dsh-private')
    expect(environment.DSH_HOME).toBe('/custom/home')
    expect(environment.DSH_DESKTOP_MANDATORY_UPDATE_CONFIG).toBeUndefined()
    expect(source('src/main.ts')).toContain("app.setPath('userData', join(app.getPath('appData'), 'DSH Private'))")
    expect(source('src/main.ts')).toContain("process.env.DSH_HOME ??= join(app.getPath('home'), '.dsh-private')")
    expect(resolveDesktopPaths('/custom/home').profile).toBe('/custom/home/profiles/desktop')
  })

  it('launches the workspace without account and updater services', () => {
    const main = source('src/main.ts')
    expect(main).toContain('await enterWorkspace()')
    for (const removed of ['connectDesktopWelcome', 'DesktopUpdateCoordinator', 'DesktopMandatoryUpdatePolicy', 'DesktopPlatformView', 'desktop_app_launch']) {
      expect(main).not.toContain(removed)
    }
    const manifest = JSON.parse(source('package.json'))
    for (const removed of ['electron-updater', '@deepseek-ai/dsh-deepseek-account', '@deepseek-ai/dsh-client-product-analytics']) {
      expect(manifest.dependencies).not.toHaveProperty(removed)
      expect(manifest.devDependencies).not.toHaveProperty(removed)
    }
  })
})
