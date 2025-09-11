import type { GameVersions, PatchEntry } from '../interface'

/**
 * Abstract base class for patch providers
 */
export abstract class AbstractPatchProvider {
  /**
   * Get the provider name
   */
  abstract name: string

  /**
   * Get the provider display name
   */
  abstract displayName: string

  /**
   * Request patch list from the provider
   */
  abstract request(versions: GameVersions): Promise<PatchEntry[]>

  /**
   * Check if the provider is available
   */
  abstract healthCheck(): Promise<boolean>
}
