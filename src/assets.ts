/** Read a packaged resource without passing jar: URIs through the HTTP-only host helper. */
export function readAsset(XHR: any, uri: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const request = new XHR();
    request.open('GET', uri, true);
    request.responseType = 'arraybuffer';
    request.onload = () => {
      if ((request.status === 0 || request.status === 200) && request.response?.byteLength) resolve(new Uint8Array(request.response));
      else reject(new Error('无法读取插件内置字体，请重新安装 PaperWeave。'));
    };
    request.onerror = () => reject(new Error('插件内置字体加载失败，请重新安装 PaperWeave。'));
    request.send();
  });
}
