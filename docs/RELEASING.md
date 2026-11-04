# Release procedure

1. Update package version, lockfile version, addon manifest and changelog together.
2. Run `npm ci`, `npm run typecheck`, and `npm run build`.
3. Review actual Zotero validation status and limitations. Record only checks that were performed.
4. Use an alpha/beta version and GitHub prerelease flag until the stable-release roadmap is satisfied.
5. Tag `v<version>` and publish the XPI, `SHA256SUMS` and `updates.json` from `dist/`.
6. Keep community post drafts and README consistent with the release state.

The GitHub Actions workflow builds/type-checks pull requests and tag pushes. Tag releases are
created as prereleases when the tag contains `alpha` or `beta`; stable tags publish normal releases.
The workflow does not run a Zotero UI test and does not claim runtime coverage.

The add-on's update URL points to `releases/latest/download/updates.json`, which GitHub resolves
only for a stable release. Early alpha users install newer prereleases manually. Once a stable
release exists, Zotero can follow its update manifest. Never replace a stable release with an
unvalidated prerelease solely to enable auto-updates.

## Community distribution

GitHub provides source, issues and downloadable artifacts. The forum drafts in `docs/` can be
posted to a chosen community after review. This release does not claim inclusion in Zotero's
official plugin directory or endorsement by the Zotero project.
