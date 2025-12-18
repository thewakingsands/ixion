import { join } from 'node:path'
import {
  type DefinitionProvider,
  SaintcoinachDefinitionProvider,
} from '@ffcafe/ixion-exd'
import { type Language, languageMap } from '@ffcafe/ixion-utils'
import { getWorkingDir } from './root'

export function parseInputLanguages(input?: string[]): Language[] {
  const languages: Language[] = []
  if (input && input.length > 0) {
    for (const lang of input) {
      if (lang in languageMap) {
        languages.push(languageMap[lang as keyof typeof languageMap])
      } else {
        console.error(`❌ Unknown language: ${lang}`)
        console.log(
          `Available languages: ${Object.keys(languageMap).join(', ')}`,
        )
        process.exit(1)
      }
    }
  }

  return languages
}

export function parseInputDefinitions(
  saintcoinach?: string,
): DefinitionProvider {
  return new SaintcoinachDefinitionProvider(
    saintcoinach ||
      join(getWorkingDir(), 'lib/SaintCoinach/SaintCoinach/Definitions'),
  )
}
