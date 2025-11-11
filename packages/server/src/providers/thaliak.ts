import type { Language } from '@ffcafe/ixion-utils'
import $debug from 'debug'
import type { GameVersions, PatchEntry } from '../interface'
import { AbstractPatchProvider } from './abstract'

const debug = $debug('ixion:providers:thaliak')

/**
 * Thaliak GraphQL response types
 */
interface ThaliakPatch {
  url: string
  size: number
}

interface ThaliakPrerequisiteVersion {
  versionString: string
}

interface ThaliakVersion {
  versionString: string
  isActive: boolean
  prerequisiteVersions: ThaliakPrerequisiteVersion[]
  patches: ThaliakPatch[]
}

interface ThaliakRepository {
  latestVersion: {
    versionString: string
  }
  versions: ThaliakVersion[]
}

interface ThaliakResponse {
  data: {
    repository: ThaliakRepository
  }
}

const apiUrl = 'https://thaliak.xiv.dev/graphql/'
const graphqlQuery = `
query RepositoryQuery($repository: String!) {
  repository(slug: $repository) {
    latestVersion {
      versionString
    }
    versions {
      versionString
      isActive
      prerequisiteVersions {
        versionString
      }
      patches {
        url
        size
      }
    }
  }
}
`

/**
 * Thaliak provider for patch information
 */
export class ThaliakProvider extends AbstractPatchProvider {
  name = 'thaliak'
  displayName = 'Thaliak'

  constructor(
    private repository: string,
    public languages: Language[],
  ) {
    super()
  }

  /**
   * Convert Thaliak version to PatchEntry format
   */
  private convertToPatchEntry(version: ThaliakVersion): PatchEntry[] {
    const patches: PatchEntry[] = []

    for (const patch of version.patches) {
      // We're requesting ffxiv repository - so we always use ffxiv expansion
      const expansion = 'ffxiv'

      patches.push({
        patchSize: patch.size,
        version: version.versionString,
        hash: null, // Thaliak doesn't provide hash info
        url: patch.url,
        expansion,
        repository: this.repository,
      })
    }

    return patches
  }

  /**
   * Build dependency tree and return patches in correct order (oldest to newest)
   */
  private buildDependencyTree(
    versions: ThaliakVersion[],
    currentVersion: string,
  ): PatchEntry[] {
    // Filter only active versions
    const activeVersions = versions.filter((v) => v.isActive)

    // Create a map for quick lookup
    const versionMap = new Map<string, ThaliakVersion>()
    for (const version of activeVersions) {
      versionMap.set(version.versionString, version)
    }

    // Find all versions that need to be applied (newer than current version)
    const versionsToApply = this.findVersionsToApply(
      activeVersions,
      currentVersion,
    )

    // If no versions to apply, return empty array
    if (versionsToApply.length === 0) {
      return []
    }

    // Build dependency tree using topological sort
    const orderedVersions = this.topologicalSort(versionsToApply, versionMap)

    // Convert to patch entries
    const allPatches: PatchEntry[] = []
    for (const version of orderedVersions) {
      const patches = this.convertToPatchEntry(version)
      allPatches.push(...patches)
    }

    return allPatches
  }

  /**
   * Find all versions that need to be applied (newer than current version)
   */
  private findVersionsToApply(
    versions: ThaliakVersion[],
    currentVersion: string,
  ): ThaliakVersion[] {
    const versionsToApply: ThaliakVersion[] = []

    for (const version of versions) {
      if (this.isVersionNewer(version.versionString, currentVersion)) {
        versionsToApply.push(version)
      }
    }

    return versionsToApply
  }

  /**
   * Check if version1 is newer than version2
   */
  private isVersionNewer(version1: string, version2: string): boolean {
    // Simple version comparison - assumes format like "2025.07.28.0000.0000"
    // This is a basic implementation and might need refinement
    const v1Parts = version1.split('.').map(Number)
    const v2Parts = version2.split('.').map(Number)

    for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
      const v1Part = v1Parts[i] || 0
      const v2Part = v2Parts[i] || 0

      if (v1Part > v2Part) return true
      if (v1Part < v2Part) return false
    }

    return false
  }

  /**
   * Topological sort to order versions by dependencies
   */
  private topologicalSort(
    versions: ThaliakVersion[],
    versionMap: Map<string, ThaliakVersion>,
  ): ThaliakVersion[] {
    const visited = new Set<string>()
    const visiting = new Set<string>()
    const result: ThaliakVersion[] = []

    const visit = (version: ThaliakVersion) => {
      if (visiting.has(version.versionString)) {
        // Circular dependency detected - skip this version
        return
      }

      if (visited.has(version.versionString)) {
        return
      }

      visiting.add(version.versionString)

      // Visit prerequisites first (only if they're in the versions to apply)
      for (const prereq of version.prerequisiteVersions) {
        const prereqVersion = versionMap.get(prereq.versionString)
        if (prereqVersion && versions.includes(prereqVersion)) {
          visit(prereqVersion)
        }
      }

      visiting.delete(version.versionString)
      visited.add(version.versionString)
      result.push(version)
    }

    // Visit all versions that need to be applied
    for (const version of versions) {
      if (!visited.has(version.versionString)) {
        visit(version)
      }
    }

    return result
  }

  async request(versions: GameVersions): Promise<PatchEntry[]> {
    const repository = this.repository
    debug('requesting repository %s from thaliak', repository)

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'FFXIV PATCH CLIENT',
        },
        body: JSON.stringify({
          query: graphqlQuery,
          variables: { repository },
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = (await response.json()) as ThaliakResponse

      if (result.data?.repository?.versions) {
        // Build dependency tree and get ordered patches
        const orderedPatches = this.buildDependencyTree(
          result.data.repository.versions,
          versions.ffxiv,
        )

        debug('received %d ordered patches from thaliak', orderedPatches.length)
        return orderedPatches
      } else {
        throw new Error('Invalid response format from Thaliak API')
      }
    } catch (error) {
      debug('thaliak request failed: %s', error)
      throw new Error(`Failed to request patches from Thaliak: ${error}`)
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: 'query { __schema { types { name } } }',
        }),
        signal: AbortSignal.timeout(5000),
      })

      return response.ok
    } catch {
      return false
    }
  }
}
