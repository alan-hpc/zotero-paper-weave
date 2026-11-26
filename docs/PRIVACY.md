# Privacy and data flow

PaperWeave has no telemetry and operates without a plugin-author server.

## Local operations

Zotero extracts structure locally. Original PDF bytes and bundled fonts are used locally to
build a new PDF. The local project stores source text, translations, glossary, source identity,
and layout metadata in the Zotero data directory. Exported JSON contains that same paper data.
The project folder is not automatically synced by PaperWeave.

## Model requests

Clicking terminology extraction sends translatable text in bounded chunks to the configured API.
Clicking translation sends individual paragraphs, protected term data, and the paper title.
Custom prompt preferences are included in translation requests. PDF binaries are not sent.
By default, terminology and translation send text only. Optional image recognition sends PNG crops
to the currently selected provider/model according to the enabled, complete service priority list.
If text translation has switched providers after a quota error in that task, subsequent recognition
uses that selected provider. The default-off vision option permits these requests for flagged,
unedited paragraphs during the primary PDF workflow or selective review repair. A failed image
request is never forwarded to another provider. Recognition uses the chosen account's quota and
data policies; selecting a text-only model can fail without recognition results.
Local screenshot caches are stored under `paperweave/vision/` with private file permissions. Project
exports contain recognized English, LaTeX, provenance, edits and recent recognition history, but do
not embed those PNG files. Source text and previous translations are not replaced by recognition;
adoption and successful translation are separate steps.
Detected author metadata is excluded from terminology and translation requests by default and
remains on the original PDF page. Users can explicitly classify a region as body text to translate it.
The selected provider controls retention, billing and use of those requests. PaperWeave cannot
change provider policies. Users must select an appropriate endpoint for their documents.

When the user enables Codex quota fallback, a failed terminology batch or paragraph is sent to
the separately configured DeepSeek endpoint after an explicit Codex quota error. Subsequent model
requests in that task also use DeepSeek and are billed by that API account. Cached translations
are retained. Temporary rate limits, local queueing, network and authentication failures do not
initiate fallback. Disabling the checkbox prevents automatic cross-provider requests.

API credentials are stored in Zotero Login Manager, scoped to the exact endpoint. They are read
only for API requests, sent as an Authorization header, and are never placed in project exports,
PDFs, normal error messages or logs by PaperWeave. Login Manager protection depends on the user's
Zotero/OS setup; this project does not promise an additional encryption layer.

## Optional local Codex proxy

The optional helper listens on 127.0.0.1 and forwards translation, terminology and paragraph-image transcription tasks to
the official Codex CLI. Codex manages its saved ChatGPT authentication; PaperWeave does not read,
copy or export the authentication file. API-key environment overrides are removed from the child
process and the helper requires ChatGPT login. Account plan limits and Codex workspace policies
apply. This does not reuse a current chat's history or custom-GPT knowledge. Image requests accept
bounded embedded PNG data only, never external URLs or user-supplied file paths. Private temporary
image attachments are passed directly to the CLI and removed after completion, failure or cancellation.

The helper does not log request bodies or credentials. It creates a temporary output-schema file,
uses ephemeral CLI sessions with translation-unneeded tools disabled, and removes its temporary
directory afterward. Codex's own authentication/runtime state and provider data handling remain
controlled by Codex and the selected account. The helper is not designed as a public service.

## Other network activity

Zotero may check the configured GitHub update URL for plugin updates. Zotero's own attachment sync,
SDT resource loading and application behavior are controlled by Zotero. PaperWeave imports outputs
as ordinary attachments, which may then sync under the library's settings.

## Removal

Delete the current endpoint's Key in the workbench before uninstalling, or remove its entry through
Zotero's saved-password management. Backup and delete the `paperweave` folder in the Zotero data
directory to remove local projects. Removing the add-on does not delete user-authored projects,
existing PDF attachments, or credentials automatically.
