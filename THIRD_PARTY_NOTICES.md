# Third-party software

PaperWeave's own source code is MIT licensed. Bundled dependencies retain their licenses:

| Component | Version | License | Source |
|---|---|---|---|
| pdf-lib | 1.17.1 | MIT | https://github.com/Hopding/pdf-lib |
| @pdf-lib/fontkit | 1.1.1 | MIT | https://github.com/Hopding/fontkit |
| @pdf-lib/standard-fonts | see package-lock.json | MIT | https://github.com/Hopding/standard-fonts |
| @pdf-lib/upng | see package-lock.json | MIT | https://github.com/Hopding/upng |
| pako (transitive) | see package-lock.json | MIT | https://github.com/nodeca/pako |
| tslib (transitive) | see package-lock.json | 0BSD | https://github.com/microsoft/tslib |
| Noto Sans SC | bundled font | SIL Open Font License 1.1 | https://github.com/google/fonts/tree/main/ofl/notosanssc |

Dependency license texts are included in the XPI under `licenses/`. The font license is at
`chrome/content/fonts/OFL.txt`. Font provenance and any changes are recorded beside the font.
Build tools (esbuild, TypeScript) are development dependencies; their code is not a plugin runtime dependency.

The @pdf-lib/fontkit fork by Andrew Dillon declares MIT in its package metadata and README, but
its npm archive omits a license file. We include the original fontkit MIT text from
https://github.com/foliojs/fontkit/blob/master/LICENSE (Devon Govett), preserve bundled notices,
and identify the fork at https://github.com/Hopding/fontkit.

PaperWeave calls Zotero's installed SDT API. No Zotero source code, proprietary translation
engine, HJFY code, paper content, user API keys, or operating-system fonts are redistributed.
