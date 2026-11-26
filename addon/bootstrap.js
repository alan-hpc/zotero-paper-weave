/* PaperWeave bootstrap. Copyright (c) 2026 PaperWeave contributors. MIT. */
var chromeHandle;
var controller;
async function startup({ id, version, rootURI }) {
  await Zotero.initializationPromise;
  // Zotero supplies IOUtils and PathUtils to the bootstrap sandbox.
  const { classes: Cc, interfaces: Ci, utils: Cu } = Components;
  chromeHandle = Cc["@mozilla.org/addons/addon-manager-startup;1"]
    .getService(Ci.amIAddonManagerStartup)
    .registerChrome(Services.io.newURI(rootURI + "manifest.json"),
      [["content", "paperweave", "chrome/content/"]]);
  const { setTimeout, clearTimeout } = ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
  // The library window can close while a workbench remains alive. Keep DOM
  // constructors in the application realm rather than looking up that window.
  const { AbortController, XMLHttpRequest } = Services.appShell.hiddenDOMWindow;
  const scope = { Zotero, Services, Cc, Ci, Cu, ChromeUtils, IOUtils, PathUtils, URL, setTimeout, clearTimeout, AbortController, XMLHttpRequest };
  Services.scriptloader.loadSubScript(rootURI + "controller.js", scope);
  controller = scope.PaperWeaveController;
  await controller.start({ id, version, rootURI });
  for (const window of Zotero.getMainWindows()) controller.attach(window);
}
function onMainWindowLoad({ window }) { controller?.attach(window); }
function onMainWindowUnload({ window }) { controller?.detach(window); }
async function shutdown() {
  try { await controller?.stop(); }
  finally {
    controller = null;
    try { chromeHandle?.destruct(); } finally { chromeHandle = null; }
  }
}
function install() {}
function uninstall() {}
