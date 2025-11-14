export function kebabCase(input: string) {
  return input
    .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
    .replace(/^[-_]+/, '')
    .replace(/[-_]+$/, '')
    .replace(/[-_]+/g, '-')
}
