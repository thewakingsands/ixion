import { mkdtemp, mkdir, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { GameSqPackReader, parseResourcePath, resolveSqPackPrefix } from '../src/game-reader'
import { SqPackWriter } from '../src/writer'

it('resolves actual chunks, base-game categories and index2-only expansions', async () => {
  const game = await mkdtemp(join(tmpdir(), 'ixion-game-'))
  const reader = new GameSqPackReader(game)
  try {
    const files = [
      ['ffxiv', '020000', 'bg/ffxiv/sea_s1/twn/s1t1/level/bg.lgb'],
      ['ffxiv', '020003', 'bg/ffxiv/other/level/bg.lgb'],
      ['ex2', '02020a', 'bg/ex2/other/level/bg.lgb'],
      ['ffxiv', '060000', 'ui/icon/test.tex'],
    ]
    for (const [repo, pack, path] of files) {
      const prefix = join(game, 'sqpack', repo, pack)
      await mkdir(join(game, 'sqpack', repo), { recursive: true })
      const writer = new SqPackWriter({ prefix: `${prefix}.win32` })
      await writer.addFile(path, Buffer.from(path))
      await writer.close()
      if (repo === 'ex2') await unlink(`${prefix}.win32.index`)
    }
    for (const [repo, pack, path] of files) {
      expect(await reader.resolvePrefix(path)).toBe(join(game, 'sqpack', repo, pack))
      expect((await reader.readFile(path.toUpperCase().replaceAll('/', '\\')))?.toString()).toBe(path)
    }
    expect(await resolveSqPackPrefix(game, files[0][2])).toBe(join(game, 'sqpack/ffxiv/020000'))
    expect(await reader.readFile('bg/ex9/missing.lgb')).toBeNull()
    expect(await reader.readFile('bg/ffxiv/missing.lgb')).toBeNull()
  } finally {
    await reader.close()
    await rm(game, { recursive: true, force: true })
  }
})

it.each(['bogus/file', '/bg/file', 'bg/../file', 'bg/', 'bg/ex256/file'])('rejects invalid resource %s', (path) => {
  expect(() => parseResourcePath(path)).toThrow()
})
