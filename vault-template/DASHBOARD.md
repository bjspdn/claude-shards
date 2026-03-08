# Vault Dashboard

> [!info] Requires the [Dataview](https://github.com/blacksmithgu/obsidian-dataview) community plugin. Queries auto-update when files change.

## Recent Activity

```dataview
TABLE WITHOUT ID
  file.link AS "Note",
  type AS "Type",
  dateformat(updated, "yyyy-MM-dd") AS "Updated",
  choice(status = "stale", "🔴 stale", "🟢 active") AS "Status"
FROM ""
WHERE type
SORT updated DESC
LIMIT 15
```

## By Project

```dataview
TABLE WITHOUT ID
  Project AS "Project",
  length(rows) AS "Notes"
FROM ""
WHERE type
GROUP BY split(file.folder, "/")[1] AS Project
SORT length(rows) DESC
```

## By Type

```dataview
TABLE WITHOUT ID
  type AS "Type",
  length(rows) AS "Count"
FROM ""
WHERE type
GROUP BY type
SORT length(rows) DESC
```

## Stale Notes

```dataview
TABLE WITHOUT ID
  file.link AS "Note",
  dateformat(updated, "yyyy-MM-dd") AS "Last Updated",
  dateformat(staleAt, "yyyy-MM-dd") AS "Stale Since"
FROM ""
WHERE status = "stale" OR (updated AND date(now) - updated > dur(30 days))
SORT updated ASC
```

## Orphans

Notes with no outgoing wikilinks to other knowledge notes.

```dataview
TABLE WITHOUT ID
  file.link AS "Note",
  type AS "Type",
  dateformat(updated, "yyyy-MM-dd") AS "Updated"
FROM ""
WHERE type AND length(decisions) = 0 AND length(patterns) = 0 AND length(gotchas) = 0 AND length(references) = 0
SORT updated DESC
```

## Tag Cloud

```dataview
TABLE WITHOUT ID
  tag AS "Tag",
  length(rows) AS "Notes"
FROM ""
WHERE type
FLATTEN tags AS tag
GROUP BY tag
SORT length(rows) DESC
```
