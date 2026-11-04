/* PaperWeave bootstrap. Copyright (c) 2026 PaperWeave contributors. MIT. */
var chromeHandle;
var controller;
async function startup({ id, version, rootURI }) {
  await Zotero.initializationPromise;
  ChromeUtils.importGlobalProperties(["IOUtils", "PathUtils"]);
  chromeHandle = Cc["@mozilla.org/addons/addon-manager-startup;1"]
    .getService(Ci.amIAddonManagerStartup)
    .registerChrome(Services.io.newURI(rootURI + "manifest.json"),
      [["content", "paperweave", "chrome/content/"]]);
  const scope = { Zotero, Services, Cc, Ci, ChromeUtils, IOUtils, PathUtils, console };
  Services.scriptloader.loadSubScript(rootURI + "controller.js", scope);
  controller = scope.PaperWeaveController;
  controller.start({ id, version, rootURI });
  for (const window of Zotero.getMainWindows()) controller.attach(window);
}
function onMainWindowLoad({ window }) { controller?.attach(window); }
function onMainWindowUnload({ window }) { controller?.detach(window); }
async function shutdown() {
  await controller?.stop();
  controller = null;
  chromeHandle?.destruct();
  chromeHandle = null;
}
function install() {}
function uninstall() {}
