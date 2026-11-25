import {copyBytes,ByteClone} from './bytes';

/** Read a packaged resource without passing jar: URIs through the HTTP-only host helper. */
export function readAsset(XHR: any, uri: string,clone?:ByteClone): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const request = new XHR();
    request.open('GET', uri, true);
    request.responseType = 'arraybuffer';
    request.onload = () => {
      try{
        if(request.status!==0&&request.status!==200)throw new Error('字体资源不可用');
        const bytes=copyBytes(request.response,clone);
        if(!bytes.length)throw new Error('字体资源为空');
        resolve(bytes);
      }catch(error){reject(new Error(`无法读取插件内置字体：${error instanceof Error?error.message:'二进制数据不可用'}。`));}
    };
    request.onerror = () => reject(new Error('插件内置字体加载失败，请重新安装 PaperWeave。'));
    request.send();
  });
}
