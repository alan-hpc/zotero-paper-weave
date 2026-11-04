/** Render protected source regions with Zotero's own PDF.js, without copying hidden text. */
export async function snippetRenderer(host: any, item: any, utilities: any) {
  let reader = await host.Reader.open(item.id, undefined, { openInBackground: true });
  let app: any;
  for (let n = 0; n < 300; n++) {
    reader ||= host.Reader.getByTabID(host.getMainWindow().Zotero_Tabs.getTabIDByItemID(item.id));
    app = reader?._iframeWindow?.wrappedJSObject?.PDFViewerApplication;
    if (app?.pdfDocument) break;
    await host.Promise.delay(50);
  }
  if (!app?.pdfDocument) throw new Error('原文阅读器未完成加载，请先打开原始 PDF 再重试。');
  const pdf = utilities.waiveXrays(app.pdfDocument);
  const targetWindow = utilities.waiveXrays(app.pdfViewer.container.ownerDocument.defaultView);
  const document = targetWindow.document;
  return async (pageIndex: number, box: {left:number;bottom:number;right:number;top:number}) => {
    const page = utilities.waiveXrays(await pdf.getPage(pageIndex + 1));
    const scale = Math.min(4, Math.sqrt(16000000 / ((box.right-box.left)*(box.top-box.bottom))));
    const viewport = utilities.waiveXrays(page.getViewport(utilities.cloneInto({ scale },targetWindow)));
    const rect = utilities.waiveXrays(viewport.convertToViewportRectangle(utilities.cloneInto([box.left,box.bottom,box.right,box.top],targetWindow)));
    const canvas = document.createElementNS('http://www.w3.org/1999/xhtml','canvas');
    canvas.width = Math.ceil(Math.abs(rect[2]-rect[0])); canvas.height = Math.ceil(Math.abs(rect[3]-rect[1]));
    const context = canvas.getContext('2d');
    try {
      const options = utilities.waiveXrays(utilities.cloneInto({ annotationMode:0,background:'#ffffff',
        transform:[1,0,0,1,-Math.min(rect[0],rect[2]),-Math.min(rect[1],rect[3])] },targetWindow));
      options.canvasContext = context; options.viewport = viewport;
      await page.render(options).promise;
      const blob: Blob = await new Promise((resolve,reject)=>canvas.toBlob((b: Blob|null)=>b?resolve(b):reject(new Error('原文区域渲染失败。')),'image/png'));
      return new Uint8Array(await blob.arrayBuffer());
    } finally { canvas.width = canvas.height = 0; }
  };
}
