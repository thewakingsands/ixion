import { SDOProvider } from './providers/sdo'
import { ThaliakProvider } from './providers/thaliak'

export { GameVersions, PatchEntry } from './interface'

export const servers = {
  sdo: new SDOProvider(),
  sdoThaliak: new ThaliakProvider('c38effbc'),
  squareEnix: new ThaliakProvider('4e9a232b'),
  actoz: new ThaliakProvider('de199059'),
}
