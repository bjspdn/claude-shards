const OFM_NOTE = (date: string) => `---
type: pattern
tags:
  - obsidian
  - markdown
  - formatting
created: ${date}
updated: ${date}
---

# Obsidian Flavored Markdown Conventions

Follow these conventions when writing vault notes to ensure compatibility with Obsidian.

## Links

Use wikilinks, not markdown links:

\`\`\`markdown
[[Note Name]]
[[Note Name|Display Text]]
[[Note Name#Heading]]
[[Note Name#^block-id]]
\`\`\`

## Embeds

\`\`\`markdown
![[Note Name]]
![[Note Name#Heading]]
![[image.png|300]]
\`\`\`

## Callouts

Use callouts for important information:

\`\`\`markdown
> [!note]
> General information.

> [!warning] Watch Out
> Something to be careful about.

> [!tip]- Collapsed by default
> Hidden until expanded.
\`\`\`

Common types: \`note\`, \`tip\`, \`warning\`, \`danger\`, \`info\`, \`example\`, \`quote\`, \`bug\`, \`todo\`

## Highlights

Use \`==double equals==\` for emphasis instead of bold when marking key terms.

## Tags

Use \`#tag\` or \`#nested/tag\` inline. In frontmatter, use a YAML list under \`tags:\`.

## Block References

Add \`^block-id\` at the end of a paragraph to make it linkable:

\`\`\`markdown
This paragraph can be referenced elsewhere. ^my-block

Then link to it: [[Note Name#^my-block]]
\`\`\`

## Comments

Use \`%%\` for content hidden in reading view:

\`\`\`markdown
Visible text %%hidden comment%% more visible text.
\`\`\`

## Properties

Frontmatter uses YAML. Common fields:

\`\`\`yaml
---
title: Note Title
tags:
  - tag1
  - tag2
aliases:
  - Alternative Name
---
\`\`\`
`

const NOTE_TEMPLATE = `---
type:
tags:
  -
projects:
  -
created:
updated:
---

# Title

Body content here.
`

export type SeedNote = {
  relativePath: string
  content: string
}

export function buildSeedNotes(dateStr: string): SeedNote[] {
  return [
    { relativePath: "patterns/obsidian-flavored-markdown.md", content: OFM_NOTE(dateStr) },
    { relativePath: "_templates/note.md", content: NOTE_TEMPLATE },
  ]
}
