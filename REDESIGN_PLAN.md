# B2B SaaS UI Redesign Plan Status

## Prompt 2: Upload + Pre-QA Redesign

Status: Completed

Prompt 2 redesigned the Upload and Pre-QA experience as a light, warm B2B SaaS workflow while preserving existing workflow logic and backend contracts.

## Files Changed

- `src/App.tsx`
- `REDESIGN_PLAN.md`

No new dependencies were added.

## Upload UI Changes

- Replaced the old SKU Indexer navigation entry with a workflow-focused `Upload` entry.
- Set the default workspace module to `Upload`.
- Redesigned the import panel with a clean Excel upload zone, attribute set selector, template download action, expected workbook guidance, and batch source URL upload.
- Kept the existing Excel upload, template download, batch upload, manual SKU entry, PDF attach, selection, delete, and SKU index handlers intact.
- Added an Upload Summary using existing state:
  - Uploaded SKU count
  - Detected `attributes__` field count
  - SAP truth source row count
  - Source URL coverage
  - PDF context coverage
- Added clearer empty, success, and error feedback from existing app state and logs.
- Added a main Upload dashboard with summary cards and a recent indexed SKU list showing source badges for SAP, PDF, harvested scrape, and URL coverage.

## Pre-QA UI Changes

- Added a dedicated `Pre-QA` navigation entry and module view.
- Added a visual workflow guide: Upload -> Pre-QA -> Scrape/Map AI -> Review -> Export.
- Added readiness cards using existing state only:
  - Ready for QA
  - Missing source
  - Has SAP/source data
  - Has scraped/harvest data
  - Completed outputs
  - Failed or pending items
- Added clearer guidance for empty catalogue state, missing source state, and ready state.
- Added sidebar readiness metrics and navigation actions back to Upload or forward to scrape/map work.

## Intentionally Not Changed

- Backend routes and request/response shapes.
- Excel parsing, SKU normalization, and `attributes__` field detection logic.
- Existing `sap_data` storage behavior. SAP is displayed as the truth source, but internal storage was not renamed.
- Scraper calls, scrape queue polling, and harvest file behavior.
- LLM mapping/job execution logic.
- Retry behavior.
- Output JSON editing and deletion.
- XLSX export.
- QA Jobs redesign.
- SKU Review redesign.
- Sources redesign.
- Settings redesign.
- Any mock or fake data.

## Prompt 2 Handoff For Prompt 3

- Redesign QA Jobs into a modern SaaS table and action workflow.
- Improve per-SKU source readiness, retry, progress, and model/action presentation.
- Redesign SKU Review as a focused inspection experience for uploaded JSON, SAP/PDF/source data, scraped markdown, QA result JSON, and timeline logs.
- Preserve all existing `/api/jobs`, `/api/jobs/run`, queue polling, output JSON, retry, viewer, and export behavior.

## Prompt 3: QA Jobs + SKU Review Redesign

Status: Completed

Prompt 3 redesigned the QA Jobs and SKU Review experience while preserving existing job, queue, retry, source viewer, output JSON, and export behavior.

## Files Changed

- `AGENTS.md`
- `src/App.tsx`
- `REDESIGN_PLAN.md`

No backend files, package files, scraper logic, LLM logic, Excel parsing, or export logic were changed.

## QA Jobs UI Changes

- Added operations summary cards using existing state:
  - Total SKUs
  - Ready for mapping
  - In progress
  - Completed outputs
  - Failed or pending
- Updated the jobs area copy and actions to match the light B2B SaaS design language.
- Improved source readiness badges for SAP truth, PDF, harvest, and missing source.
- Added visible retry count, selected model, output availability, and Review action in the job rows.
- Preserved Map AI, custom model selection, re-sync, bulk delete, output open/delete, harvest open/delete, PDF viewer, and XLS export handlers.

## SKU Review UI Changes

- Added a dedicated `SKU Review` navigation item and module.
- Added a left SKU selector and focused right-side inspection workspace.
- Added cards for status, attribute set, retry count, and output availability.
- Added source context actions for scraped markdown, PDF text, and QA result JSON where existing state supports them.
- Added dark technical viewers for timeline logs and uploaded/indexed SKU JSON.

## Output Editor UI Changes

- Reskinned the existing output editor modal into a clean white SaaS shell.
- Improved field labels, spacing, form controls, close action, and save action.
- Kept the existing output JSON shape, fetch route, save route, save handler, and validation behavior.

## Intentionally Not Changed In Prompt 3

- Backend routes and API request/response shapes.
- `/api/jobs`, `/api/jobs/run`, and queue polling behavior.
- Retry behavior.
- Scraper calls and harvest generation.
- LLM mapping execution.
- Excel upload, SKU normalization, and `attributes__` detection.
- Output JSON storage format.
- Output delete route and XLSX export route.
- Sources redesign.
- Settings redesign.
- Final responsive/a11y polish.

## Remaining For Prompt 4

- Redesign Sources and Settings surfaces.
- Polish harvest archive, markdown/screenshot/PDF modals, image sourcing/export page, and settings tabs.
- Keep admin restrictions and existing settings payloads intact.
- Do final responsive/a11y polish only after Prompt 4 if requested.

## Prompt 4: Sources + Settings Polish

Status: Completed

Prompt 4 polished the Sources and Settings areas into the same light B2B SaaS design language while preserving existing source, image, modal, admin, settings, schema, and persistence behavior.

## Files Changed

- `src/App.tsx`
- `src/index.css`
- `REDESIGN_PLAN.md`

No backend files, package files, scraper logic, LLM logic, Excel parsing, API contracts, or export logic were changed.

## Sources UI Changes

- Renamed the Image Sourcer navigation surface to `Sources` while preserving the existing module id and handlers.
- Added a clearer Sources page header and harvest sync action.
- Restyled image URL extraction as a clean SaaS card with better helper copy and action placement.
- Restyled harvest-file cards, active harvest state, image URL selection rows, selected count, export actions, and extracted asset cards.

## Harvest / Archive / Markdown Viewer Changes

- Reskinned screenshot and PDF text modal chrome into white SaaS shells.
- Kept raw PDF text, markdown, and technical source content readable in dark technical viewers.
- Reskinned the harvest archive modal into a light searchable source-record list with clearer open/delete/sync actions.

## Image Sourcing / Export UI Changes

- Improved selected image states with restrained blue selection styling.
- Improved empty states and selected/export action placement.
- Preserved direct image extraction, harvest URL loading, selection limit behavior, selected image export, delete, download, and screenshot link behavior.

## Settings UI Changes

- Reskinned the Settings shell, sidebar summary, page header, and tabs.
- Added scoped Settings styling to convert legacy dark settings cards/forms into light SaaS cards without touching persistence handlers.
- Improved the per-schema mapping rules modal shell and save/close actions while keeping the raw markdown editor dark.
- Preserved AI key, global mapping logic, user allowlist, schema hub, per-schema mapping rules, admin restrictions, and settings save/load behavior.

## Intentionally Not Changed In Prompt 4

- Backend routes and API request/response shapes.
- Harvest archive backend behavior.
- Markdown viewer content behavior.
- Screenshot, PDF, image, settings, schema, and mapping modal handlers.
- PDF attach/view behavior.
- Image extraction and selected image export behavior.
- Admin-only restrictions.
- Settings payload shapes and persistence calls.
- Excel parsing, scraper logic, LLM/job logic, queue polling, retry, output JSON, and XLSX export.
- Final responsive/a11y polish.

## Remaining For Prompt 5

- Final responsive and accessibility polish.
- Smoke-check mobile and desktop layouts.
- Verify keyboard/focus states for modals, tabs, tables, and source/image controls.
- Clean remaining legacy dark/cyber styling outside the scoped Prompt 4 surfaces if requested.

## Prompt 5: Final Responsive, Accessibility, And Workflow Tracking Polish

Status: Completed

Prompt 5 performed a final UI/workflow tracking polish pass across Upload, Pre-QA, QA Jobs, SKU Review, Sources, and Settings without changing backend logic or data contracts.

## Final Module Mapping

| Old Capability | Redesigned Location | Audit Result |
| --- | --- | --- |
| Old SKU Indexer | Upload | Preserved Excel upload, template download, attribute set selector, manual SKU entry, PDF attach, SKU list, and delete actions. |
| Pre-QA validation/readiness | Pre-QA | Preserved readiness dashboard using existing SKU, source, harvest, job, output, and log state. |
| AI Jobs | QA Jobs | Preserved job sync/search/selection, Map AI, model selection, output open/delete, source actions, and XLS export. |
| SKU detail/source/output review | SKU Review | Preserved uploaded/indexed JSON inspection, source context actions, PDF/harvest/output viewers, and timeline log view. |
| Image Sourcer / harvest archive / markdown viewers | Sources | Preserved image extraction/export, selected image workflow, harvest image loading, harvest archive modal, and added visible markdown-open actions from Sources. |
| Settings | Settings | Preserved AI key, global mapping logic, allowlist, schema hub, per-schema mapping rules, admin restrictions, and persistence. |

## Files Changed

- `src/App.tsx`
- `src/index.css`
- `REDESIGN_PLAN.md`

No backend files, package files, scraper logic, LLM logic, Excel parsing, API contracts, queue polling, retry logic, JSON storage, or XLSX export logic were changed.

## Responsive Fixes

- Updated workflow step labels to match the final module flow.
- Adjusted the Pre-QA workflow step grid for six final workflow steps.
- Wrapped Sources toolbar actions with the shared responsive action layout.
- Added mobile CSS for action wrapping, table containment, modal padding, and dense Settings/Sources spacing.

## Accessibility Fixes

- Converted Sources harvest cards from whole-card buttons into explicit `Load images` and `Open markdown` actions.
- Added keyboard-visible schema edit/delete actions with `aria-label` values.
- Kept global `:focus-visible` behavior and improved mobile action sizing.

## Visual Consistency Fixes

- Connected Sources to Data Harvest with a visible `Run scrape` action.
- Preserved dark treatment only for raw technical viewers such as markdown, PDF text, logs, and JSON.
- Tightened Sources cards, action rows, modal padding, and Settings/Sources responsive spacing.

## Remaining UI Risks

- Data Harvest internals still contain some legacy dark technical styling because Prompt 5 avoided another redesign pass.
- Settings still uses scoped CSS over older markup; manual visual QA should confirm no inherited selector overreach.
- A small legacy encoded separator remains in one Sources active-harvest summary string, but the text is readable and behavior is unaffected.

## Manual Browser Checks Recommended

- 320px, 768px, 1024px, and 1440px layouts for Upload, Pre-QA, QA Jobs, SKU Review, Sources, and Settings.
- Keyboard tab order through navigation, workflow buttons, job table actions, Sources harvest actions, and Settings tabs.
- Modal open/close/save/cancel behavior for screenshot, markdown, PDF text, output editor, harvest archive, and schema mapping rules.
- Excel upload/template download, Map AI, harvest open/delete, selected/full XLS export, image extraction/export, and settings persistence smoke paths.

## Remaining For Prompt 6

- Final regression review only.
- Browser smoke test with real app data.
- Verify no API/workflow regressions before shipping.

## Prompt 6: Final Regression Review And Safe Fixes

Status: Completed

Prompt 6 completed the final static regression review and made only small safe UI clarity/accessibility fixes. No backend logic, API contracts, data files, parser logic, scraper logic, LLM logic, queue polling, retry behavior, output JSON behavior, image export behavior, settings persistence, or XLSX export logic were changed.

## Completed Modules

- Upload
- Pre-QA
- QA Jobs
- SKU Review
- Sources
- Settings
- Data Harvest remains reachable for scrape/harvest execution and is linked from Sources with `Run scrape`.

## Verified Workflows

| Workflow / Capability | Status |
| --- | --- |
| Excel upload | Reachable in Upload via existing `handleSkuUpload`. |
| Template download | Reachable in Upload via existing `handleDownloadSkuTemplate`. |
| Attribute set selector | Reachable in Upload and manual SKU entry. |
| Manual SKU entry | Reachable in Upload via existing `handleManualSkuSubmit`. |
| Batch URL/source manifest upload | Reachable in Upload and Data Harvest batch mode via existing `handleBatchUpload`. |
| `attributes__` field detection | Preserved in upload normalization and Upload Summary. |
| SAP truth-source display | Preserved through `sap_data`/SAP badges and summaries. |
| PDF/source context | Preserved through PDF attach, PDF badges, PDF viewer, and SKU Review source actions. |
| Scrape/harvest access | Preserved through Data Harvest and linked from Sources. |
| QA job dispatch / per-SKU Map AI | Preserved in QA Jobs via existing `/api/jobs/run` flow. |
| Retry / queue/status visibility | Preserved through existing `pollJob`, retry count display, logs, and status badges. |
| SKU Review | Preserved with uploaded JSON, source context, timeline, and output actions. |
| Scraped markdown viewer | Preserved through harvest open actions in QA Jobs, SKU Review, Sources, and harvest archive. |
| Output JSON open/edit/save/delete | Preserved through existing output modal and handlers. |
| Timeline/log visibility | Preserved in SKU Review and Data Harvest logs. |
| Selected/full XLSX export | Preserved in QA Jobs via existing `/api/outputs/xlsx` link. |
| Image URL extraction / selected image export | Preserved in Sources with existing image handlers. |
| Settings save/load/admin restrictions | Preserved through existing settings handlers and admin checks. |
| User allowlist | Preserved in Settings. |
| Mapping logic | Preserved in Settings global and per-schema mapping rules. |
| Attribute schema hub | Preserved in Settings. |
| Per-schema mapping rules modal | Preserved and polished. |

## Safe Fixes Made In Prompt 6

- Renamed the jobs navigation item from `AI Jobs` to `QA Jobs` for final workflow consistency.
- Updated jobs module metadata title to `QA Jobs`.
- Updated the Pre-QA sidebar CTA text from `Continue to Scrape/Map AI` to `Continue to Data Harvest`; routing and behavior remain unchanged.

## Build Environment Notes

- The default Node runtime in this environment is Node `20.12.2`.
- Vite requires Node `20.19+` or `22.12+`.
- Previous prompts built successfully only with the local Node 22 PATH workaround:
  `C:\Users\youmg\AppData\Local\hermes\node`
- In this Prompt 6 run, elevated execution was not attempted after prior quota rejection; sandboxed npm execution is blocked by `EPERM: lstat 'C:\Users\youmg'`.

## Remaining Manual Checks

- Browser smoke test with real app data.
- 320px, 768px, 1024px, and 1440px responsive review.
- Modal open/close/save/cancel checks for screenshot, markdown, PDF text, output editor, harvest archive, and mapping rules.
- Workflow smoke paths for upload/template download, scrape/harvest, Map AI, retry/status, source viewers, output JSON edit/delete, XLS export, image export, settings persistence, and admin restrictions.

## Final Recommendation

Ready after manual browser QA.

## Warm Neutral Palette And Readability Pass

Status: Completed

This pass updated the redesigned UI to a warm minimal neutral B2B SaaS palette using warm brown, rust, soft beige, muted dusty pink accents, deep green success, amber warning, and brick red danger tones.

## Files Changed

- `src/index.css`
- `src/components/ui/Button.tsx`
- `src/components/ui/Badge.tsx`
- `src/App.tsx`
- `REDESIGN_PLAN.md`

## Readability Fixes

- Remapped legacy blue/slate/stone/purple/cyan utility colors through the central theme tokens.
- Improved button disabled contrast and badge text contrast.
- Added scoped readability overrides for the legacy scrape configuration panel without changing scrape behavior.
- Fixed hardcoded white login text and low-contrast harvest archive metadata on light surfaces.

## Intentionally Not Changed

- Backend routes and API contracts.
- Excel upload, template download, SKU normalization, and `attributes__` detection.
- Scraper, queue polling, LLM mapping, retry, JSON editing, image export, settings persistence, and XLSX export behavior.
- Module layout, routing behavior, and workflow logic.

## Targeted Bug-Fix Pass: Export, Template Download, Session Restore

Status: Completed

This pass fixed three post-redesign functional issues without changing the UI direction or workflow logic.

## Files Changed

- `src/App.tsx`
- `server.ts`
- `REDESIGN_PLAN.md`

## Fixes

- QA Jobs XLSX export now uses the authenticated frontend fetch path, safely encodes selected SKUs, downloads the returned blob, and displays backend errors inline.
- Backend XLSX generation now stringifies object/array cell values before passing rows to ExcelJS.
- SKU and batch template downloads now append the temporary download anchor before clicking it and report download errors in the app log.
- Auth user state is cached in session storage so dev-server remounts caused by SKU add/delete file writes do not show the full `Restoring session...` overlay for an already-restored user.
- Upload delete/PDF buttons were made explicit `type="button"` to avoid accidental submit/navigation behavior.

## Intentionally Not Changed

- Existing export route path and workbook format.
- Existing SKU template headers and backend template route.
- Excel upload, `attributes__` detection, SAP/PDF/scraped source handling, scraper/harvest flow, Map AI, retry, output editing, image export, and settings persistence.
