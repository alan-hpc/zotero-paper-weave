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
Custom prompt preferences are included in translation requests. No PDF binary or images are sent.
The selected provider controls retention, billing and use of those requests. PaperWeave cannot
change provider policies. Users must select an appropriate endpoint for their documents.

API credentials are stored in Zotero Login Manager, scoped to the exact endpoint. They are read
only for API requests, sent as an Authorization header, and are never placed in project exports,
PDFs, normal error messages or logs by PaperWeave. Login Manager protection depends on the user's
Zotero/OS setup; this project does not promise an additional encryption layer.

## Other network activity

Zotero may check the configured GitHub update URL for plugin updates. Zotero's own attachment sync,
SDT resource loading and application behavior are controlled by Zotero. PaperWeave imports outputs
as ordinary attachments, which may then sync under the library's settings.

## Removal

Delete the current endpoint's Key in the workbench before uninstalling, or remove its entry through
Zotero's saved-password management. Backup and delete the `paperweave` folder in the Zotero data
directory to remove local projects. Removing the add-on does not delete user-authored projects,
existing PDF attachments, or credentials automatically.
