import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { configExists, getDefaultConfigPath } from '../../utils/config'

const configTemplatePath = '.ixion-config.ci.json'

/**
 * Create config file from template with secrets
 */
export function createConfigFromTemplate(): void {
  if (configExists()) {
    console.log('📝 Config file already exists, skipping creation')
    return
  }

  if (!existsSync(configTemplatePath)) {
    throw new Error(`Template file not found: ${configTemplatePath}`)
  }

  const template = readFileSync(configTemplatePath, 'utf-8')
  const config = template.replace(/\{\{\s*(.*?)\s*\}\}/g, (_, p1) => {
    const value = process.env[p1]
    if (!value) {
      throw new Error(`Environment variable ${p1} not found`)
    }
    return value
  })

  writeFileSync(getDefaultConfigPath(), config, 'utf-8')
  console.log('✅ Created config file from template')
}
