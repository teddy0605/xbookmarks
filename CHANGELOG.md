## 1.2.0 — 2026-03-31

- Fix delete bookmark failing with code 144 when the bookmark was already removed from X (note is now archived locally regardless)
- Fix delete request body missing `queryId` field required by X's GraphQL mutations
- All settings headings migrated to `Setting.setHeading()` (Obsidian API compliance)
- Settings UI text normalised to sentence case throughout
- Cookie setting names changed to "Auth token" and "CSRF token" for clarity
- Advanced queryId setting names changed to "Bookmarks query ID", "Delete bookmark query ID", "Article query ID"
- Command IDs no longer include the plugin ID prefix (`sync`, `tag-untagged`, etc.)
- Command and ribbon tooltip names no longer include the plugin name
- All notice messages stripped of `[X-Bookmarks]` prefix
- Unhandled promise warnings resolved (`void` operator, typed workspace cast)
- `console.log` replaced with `console.debug` in debug paths
- ESLint (`eslint-plugin-obsidianmd`) added as dev dependency with full config

## 1.1.0 — 2026-03-30

- Renamed plugin ID to `x-bookmarks` and name to `X-Bookmarks` (Obsidian marketplace compliance)
- Notes now organized into `YYYY-MM` date subfolders automatically
- New command: "Reorganize bookmarks into date folders" to migrate existing flat notes
- Custom ribbon icon (bookmark with X)
- Default vault folder renamed to `X-Bookmarks`

## 1.0.0 — 2026-03-30

Initial release.

- Sync X (Twitter) bookmarks into Obsidian as Markdown notes
- Incremental sync: only imports new bookmarks each run
- Delete bookmarks from X directly in Obsidian (inline button or command palette)
- AI-powered tagging via local LLMs (LM Studio, llama.cpp) with OpenAI-compatible API
- Dataview-ready YAML frontmatter
- Auto-sync on configurable schedule
- X Article support: fetches full article content
- Video support: inline `<video>` player in reading view
- Quoted tweet support
