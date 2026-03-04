export function draftFolder(tags: string[] | undefined): string {
  return tags?.[0] ?? "_unsorted"
}
