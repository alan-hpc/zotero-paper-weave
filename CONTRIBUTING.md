# Contributing

Issues, design feedback, documentation and pull requests are welcome.

## Development

Use Node 20.10 or later, `npm ci`, `npm run typecheck`, then `npm run build`.
Install the resulting XPI into a separate Zotero development profile when validating changes.
Do not develop against irreplaceable papers or overwrite existing attachments.

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
in the roadmap. Tests may be introduced in a dedicated contribution; no automated test suite is
claimed by this alpha.

## Licensing

Contributions must be compatible with the MIT license. Preserve third-party notices. Do not copy
proprietary add-on engines, closed-source plugin code, restricted fonts, or paper content into the
repository. Calling a host API does not require copying the host implementation.
