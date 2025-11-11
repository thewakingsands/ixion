import { Language } from '@ffcafe/ixion-utils'
import { SDOProvider } from './providers/sdo'
import { ThaliakProvider } from './providers/thaliak'

export { GameVersions, PatchEntry } from './interface'

export const servers = {
  sdo: new SDOProvider(),
  sdoThaliak: new ThaliakProvider('c38effbc', [Language.ChineseSimplified]),
  squareEnix: new ThaliakProvider('4e9a232b', [
    Language.English,
    Language.French,
    Language.German,
    Language.Japanese,
  ]),
  actoz: new ThaliakProvider('de199059', [Language.Korean]),
}
