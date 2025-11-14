import { join } from 'node:path'
import { SqPackReader } from '@ffcafe/ixion-sqpack'
import { Language } from '@ffcafe/ixion-utils'
import { beforeAll, describe, expect, it } from 'vitest'
import { readExhHeaderFromReader } from '../src'
import { CSVExporter } from '../src/csv'

describe('exdSheetToCSV', () => {
  let reader: SqPackReader
  let csvExporter: CSVExporter

  beforeAll(async () => {
    reader = await SqPackReader.open({
      prefix: join(__dirname, '../../../outputs/7.35/0a0000.win32'),
    })
    csvExporter = new CSVExporter({
      definitionDir: join(
        __dirname,
        '../../../lib/SaintCoinach/SaintCoinach/Definitions',
      ),
    })
  })

  it('should format AchievementHideCondition correctly', async () => {
    const exh = await readExhHeaderFromReader(
      reader,
      'AchievementHideCondition',
    )
    const csv = await csvExporter.exportSheet(
      reader,
      'AchievementHideCondition',
      exh,
      Language.None,
    )
    expect(csv).toEqual(`key,0,1,2
#,HideAchievement,HideName,HideConditions
int32,bit&01,bit&02,bit&04
0,False,False,False
1,True,False,False
2,False,False,True
3,False,True,True
`)
  })
})
