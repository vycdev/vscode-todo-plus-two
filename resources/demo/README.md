# README screenshots and audit

The gallery was captured on November 1, 2026 on the Mac mini (Apple silicon),
using VS Code 1.144.0 and the development bundle built from `4be6f1d`.
All images show actual extension UI. Dark Modern, 16 px editor text, 25 px line
height, and a 1440 px viewport are shared throughout. Editor/sidebar captures
are 900 px tall; timer captures use 400 px and image paste uses 650 px to avoid
unnecessary empty space. No task labels, decorations, or controls were composited.

## Reproduce

On a Mac desktop with Node.js 22+ and Swift available:

```sh
npm ci
npm run compile
# Optional: reuse an installed, current VS Code instead of downloading stable.
export VSCODE_EXECUTABLE_PATH='/Applications/Visual Studio Code.app/Contents/MacOS/Code'
export TODO_SCREENSHOT_DIR='/absolute/path/to/captures'
node scripts/capture-readme.js
```

Omit `VSCODE_EXECUTABLE_PATH` to download VS Code through `@vscode/test-electron`.
The runner creates an isolated workspace, user profile, and extensions folder.
It uses the bundled sample at [resources/readme.todo](../readme.todo), plus
generated Markdown and TypeScript examples. Dates deliberately match the capture
day; update the sample dates when producing a later gallery.

The companion suite drives actual commands, clicks, folding, native image paste,
and embedded drag-and-drop. It asserts that dragging changes row order and that
paste inserts an attachment link. The PNG clipboard helper restores the original
clipboard when finished, provided another application has not changed it.
Temporary paths are resolved to their real filesystem paths so macOS aliases
do not interfere with the default symlink policy.

`capture-report.json` records the VS Code version, theme, bundle SHA-256, time,
captured files, and outcome. Inspect every image before copying it into this
directory. Failed runs can leave a diagnostic `failure.png`; do not publish it.

## Gallery coverage

| Asset                    | Verified content                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `syntax.png`             | Project/file statistics, estimates, dependency links, tag styles, paused markers, fenced TypeScript, numbered notes, archive |
| `activity_bar_views.png` | Markdown mode, headings, nested checkboxes, Files hierarchy, Due date groups, current checklist icon                         |
| `sidebar-actions.png`    | Real Edit Task input opened with the row pencil; source tags remain visible in the prompt                                    |
| `tag-groups.png`         | Selected tag groups, counts, original project context, Other group                                                           |
| `tag-focus.png`          | Matching high-priority tasks, preserved ancestors, inserted focus header                                                     |
| `regions.png`            | Explicit region collapsed while other projects stay visible                                                                  |
| `embedded-ordering.png`  | Embedded moved into Explorer; sibling order differs from source after a real drag                                            |
| `timer-running.png`      | Started style and remaining estimate in the status bar                                                                       |
| `timer-paused.png`       | Actual pause command adds `@toggle` and `@paused`, removes active status bar timer                                           |
| `image-attachment.png`   | Native PNG paste saves an attachment and inserts a relative link; pasted image opened beside the source                      |

Reviewed all seven prior gallery assets. Replaced `syntax.png` and
`activity_bar_views.png`; removed the old embedded and timer GIFs and the three
statistics images/animations. The new editor and timer captures cover those
behaviors with current commands, styles, and readable samples.

Capture limitation: renderer screenshots do not include native macOS context
menus. The gallery shows the real Edit Task prompt and the result of embedded
drag-and-drop instead. Static PNGs show the resulting state rather than an
animated gesture. Image paste was exercised with PNG; JPEG support was checked
against the provider and existing tests, not separately illustrated.

## Audit boundary and implementation checks

`git log --follow -- README.md` identifies `dd3b5c6` (May 25, 2018, major
refactoring) as the last broad README restructuring. The 2025 fork updates
branding, compatibility wording, and symbols; subsequent edits append or correct
individual features. Neither those changes nor the November 1 incremental
sections were used as the audit boundary. Reviewed subsequent first-parent
history, README/image history, merged PR metadata, the changelog, and current
implementation through `4be6f1d`, including every November 1 commit.

| Change group                                                       | Documentation / implementation cross-check                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Markdown tasks (#274)                                              | Source discovery, section boundaries, marker preservation, commands, archive; `markdown-tasks`, `task-source`, Markdown archive utilities                                                                                                                                                                                                                                |
| Numbering (#282), folding/focus (#291), fenced notes (#289)        | Enter binding and renumber limits; folding provider/tag focus; literal fences and installed grammar loading                                                                                                                                                                                                                                                              |
| Tag groups (#279), task styles (#281), row actions (#285)          | Files/tag group builders, tag-style resolver, view commands, menus, paused-marker timing helpers                                                                                                                                                                                                                                                                         |
| Attachments (#292), global files (#286)                            | Paste API version gate, file links, symlink policy, archive rebasing; literal absolute-path discovery and polling                                                                                                                                                                                                                                                        |
| Embedded ordering (#283), Explorer placement (#293), icon (#294)   | Drag API gate, sibling ranks and persistence, real moved view, checklist SVG and badge                                                                                                                                                                                                                                                                                   |
| Date/path/regex fixes (#275, #276, #278, #288, #290), cache (#280) | Strict due parsing/local dates, workspace alias deduplication, regex reset advice, incremental decoration/statistics behavior                                                                                                                                                                                                                                            |
| Favicon (#287)                                                     | Project tooling asset; no extension workflow to document                                                                                                                                                                                                                                                                                                                 |
| Earlier 5.3 / fork work                                            | Dependencies, archive/unarchive and storage modes, HTML/Markdown export, relative links, timestamp/tag completions, automatic boxes/parent completion, timer pause/auto-toggle, duration formats, tag statistics, due colors/view, Files filters/visibility, embedded context/Problems/Liquid providers, theme colors/minimap, discovery/exclusions/symlinks and batches |
| Earlier inherited work                                             | Files/Embedded views, view filtering/grouping, global discovery, theme overrides, estimates and statistics, timer, folding and inline formatting                                                                                                                                                                                                                         |

Command labels, Command Palette visibility, shortcuts and compatibility gates were
checked against `package.json`, `src/commands.ts`, and API adapters. Settings
examples were checked against the configuration schema and `src/config.ts`.
The README now uses copyable JSON examples rather than a partial defaults object
containing ellipses. Full defaults remain discoverable in VS Code Settings.
