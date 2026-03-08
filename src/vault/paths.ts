export function draftFolder(type: string, project?: string): string {
  const root = project ?? "GLOBAL"
  return `${root}/${type}`
}
