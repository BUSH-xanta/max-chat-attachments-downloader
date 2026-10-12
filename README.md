# MAX Chat Attachments Downloader

Firefox extension prototype for sequentially downloading attachments visible in a MAX Web chat.

## Features

- Inclusive start and end dates (dates are read from the attachment message text as `DD.MM.YYYY`).
- Filename exclusion, defaulting to `ЗАЛ` (case-insensitive).
- Sequential downloads, configurable delay, and a cooldown after a configurable number of successful files.
- Uses the site's own download button when MAX does not expose a direct file URL, then waits for Firefox to report completion.
- Progress checkpoint in Firefox extension storage; cooldown expiry reloads the tab and continues from unprocessed message keys.
- Failed downloads and skipped filenames are kept in the run state and can be exported as JSON from the popup.

## Install for local development

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Choose **Load Temporary Add-on…** and select `manifest.json`.
3. Open a MAX Web chat, open the extension popup, set the date range, then start.

Temporary add-ons are removed when Firefox closes; install again to resume. The saved extension state remains in the profile. The page must remain logged in and accessible.

## Save location

The folder field is a subfolder under Firefox's configured Downloads directory for direct URL downloads. Firefox WebExtensions reject absolute save paths. Select the desired base Downloads folder in Firefox settings first. When MAX only exposes its own click-to-download control, Firefox saves that site-initiated download according to Firefox's current download settings. Choosing any arbitrary system folder from the extension requires a separately installed native helper.

## Important prototype limitation

MAX's chat interface can change its DOM and can virtualize older messages. This prototype discovers download controls and dates from rendered message text and uses a message identifier when MAX exposes one, otherwise date plus filename. It is intended for adapter validation against the actual signed-in MAX page. Duplicate filenames on the same date can be ambiguous, and a site change can prevent discovery or direct download. Before a long run, validate on a short date range and inspect the popup's live status. Cooldown resumes after a page reload; expired login or missing history stops reliable continuation.

## Log

The current run state is stored in the extension's local storage (`runState`): successful keys, excluded keys, skipped count, and failures. Use **Журнал** in the popup to save a JSON copy in `MAX/run-log.json` under Firefox's configured Downloads folder.

## Permissions

The extension accesses `web.max.ru` to inspect the active chat and uses Firefox's downloads API to save attachments. It does not send chat content to an external service.

