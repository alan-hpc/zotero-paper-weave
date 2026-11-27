# Contributing

Issues, design feedback, documentation and pull requests are welcome.

## Development

Use Node 20.10 or later, `npm ci`, `npm run typecheck`, then `npm run build`.
Install the resulting XPI into a separate Zotero development profile when validating changes.
Use disposable source/output copies. Never overwrite original PDFs or edit the live Zotero database
or project cache directly; exercise generated-output replacement through the host APIs.

Keep host integration, extraction, model access and rendering in their separate modules. Preserve
manual edits. Version stored data explicitly and document migrations. Add optional features behind
clear UI controls rather than changing saved-project semantics silently.

## Reports

Include plugin/Zotero/OS versions, expected behavior and reproduction steps. If permitted, attach
a public minimal PDF or a screenshot with sensitive details removed. Never post API keys, credential
store files, private papers or an unredacted project export.

## Review

Describe what changed, why, and the actual validation performed. Build/typecheck success does not
establish Zotero runtime correctness. A stable release requires the real application checks listed
in the roadmap. Run `npm test` for the offline regression suite, including real PDF generation, formula recovery,
source isolation, output replacement and injected persistence failures. Host mocks do not replace
native Zotero acceptance checks.

## Licensing

Contributions must be compatible with the MIT license. Preserve third-party notices. Do not copy
proprietary add-on engines, closed-source plugin code, restricted fonts, or paper content into the
repository. Calling a host API does not require copying the host implementation.
