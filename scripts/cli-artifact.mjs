import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

// Runtime data is checked out separately by consumers. Everything else is a
// build input, including the workflow, packaging scripts and native toolchain.
export function artifactName(tree) {
  const inputs = tree.split('\0').filter(entry => {
    if (!entry) return false
    const path = entry.slice(entry.indexOf('\t') + 1)
    return !(
      path.startsWith('.ci/') || path.startsWith('lib/') ||
      path.startsWith('docs/') || path === 'README.md' ||
      path === '.ixion-config.ci.json' || path === '.ixion-config.json.example'
    )
  })
  return `ixion-cli-${createHash('sha256').update(inputs.join('\0')).digest('hex')}`
}

export async function findArtifact(github, repo, name) {
  for await (const { data: artifacts } of github.paginate.iterator(
    github.rest.actions.listArtifactsForRepo, { ...repo, name, per_page: 100 },
  )) {
    for (const artifact of artifacts) {
      const source = artifact.workflow_run
      if (artifact.name !== name || artifact.expired || !source ||
          source.head_branch !== 'main' || source.head_repository_id !== source.repository_id)
        continue
      const { data: run } = await github.rest.actions.getWorkflowRun({
        ...repo, run_id: source.id,
      })
      if (run.conclusion === 'success' && run.head_branch === 'main' &&
          ['push', 'schedule', 'workflow_dispatch'].includes(run.event) &&
          ['.github/workflows/build.yml', '.github/workflows/ci.yml'].includes(run.path))
        return String(source.id)
    }
  }
  return ''
}

export async function selectArtifact({ github, context, core, reuse }) {
  const name = artifactName(execFileSync('git', ['ls-tree', '-rz', 'HEAD'], { encoding: 'utf8' }))
  const runId = reuse ? await findArtifact(github, context.repo, name) : ''
  core.setOutput('name', name)
  core.setOutput('reused', String(Boolean(runId)))
  core.setOutput('run-id', runId || String(context.runId))
  core.info(runId ? `Reusing ${name} from run ${runId}` : `Building ${name}`)
}
