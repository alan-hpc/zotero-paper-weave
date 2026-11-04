import { build } from 'esbuild';
import { readFile, writeFile, readdir, mkdir, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { join, relative } from 'node:path';

const pkg = JSON.parse(await readFile('package.json','utf8'));
const manifest = JSON.parse(await readFile('addon/manifest.json','utf8'));
if (pkg.version !== manifest.version) throw new Error('package.json and manifest versions must match');
const stage = 'dist/addon';
await rm(stage,{ recursive:true, force:true });
await mkdir(stage,{ recursive:true });
await cp('addon',stage,{ recursive:true });
await build({ entryPoints:['src/controller.ts'], outfile:join(stage,'controller.js'), bundle:true,
  format:'iife', globalName:'PaperWeaveController', target:'firefox128', legalComments:'eof' });
await build({ entryPoints:['src/workbench.ts'], outfile:join(stage,'chrome/content/workbench.js'), bundle:true,
  format:'iife', target:'firefox128', legalComments:'eof' });
await cp('LICENSE',join(stage,'LICENSE'));
await cp('THIRD_PARTY_NOTICES.md',join(stage,'THIRD_PARTY_NOTICES.md'));
// Include exact dependency licenses for every bundled runtime package.
for (const name of ['pdf-lib','@pdf-lib/fontkit','@pdf-lib/standard-fonts','@pdf-lib/upng','pako','tslib']) {
  const dir=join('node_modules',name);
  const license=(await readdir(dir)).find(n=>/^licen[sc]e(?:\.|$)/i.test(n));
  const dest=join(stage,'licenses',name.replaceAll('/','-')+'.txt');
  await mkdir(join(stage,'licenses'),{ recursive:true });
  if (license) await cp(join(dir,license),dest);
  else await readFile(dest); // Upstream license bundled in addon/licenses if npm omitted it.
}
// Self-contained ZIP writer: no Python, shell zip, or runtime install required.
function crc32(bytes) {
  let n=0xffffffff;
  for (const b of bytes) { n^=b; for(let i=0;i<8;i++) n=(n>>>1)^((n&1)?0xedb88320:0); }
  return (n^0xffffffff)>>>0;
}
async function files(dir) {
  const out=[];
  for(const entry of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
    const path=join(dir,entry.name);
    out.push(...(entry.isDirectory()?await files(path):[path]));
  }
  return out;
}
const local=[], central=[]; let offset=0;
for(const file of await files(stage)) {
  const name=Buffer.from(relative(stage,file).replaceAll('\\','/'));
  const raw=await readFile(file), data=deflateRawSync(raw), crc=crc32(raw);
  const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);
  h.writeUInt16LE(0x800,6);h.writeUInt16LE(8,8);h.writeUInt16LE(0x2821,12);
  h.writeUInt32LE(crc,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(raw.length,22);h.writeUInt16LE(name.length,26);
  local.push(h,name,data);
  const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);
  c.writeUInt16LE(0x800,8);c.writeUInt16LE(8,10);c.writeUInt16LE(0x2821,14);
  c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(raw.length,24);c.writeUInt16LE(name.length,28);
  c.writeUInt32LE(offset,42);central.push(c,name);offset+=h.length+name.length+data.length;
}
const cd=Buffer.concat(central), end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);
end.writeUInt16LE(central.length/2,8);end.writeUInt16LE(central.length/2,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
const archive=Buffer.concat([...local,cd,end]);
const name=`paperweave-${pkg.version}.xpi`;
await writeFile(join('dist',name),archive);
await writeFile('dist/SHA256SUMS',`${createHash('sha256').update(archive).digest('hex')}  ${name}\n`);
const update={ addons:{ [manifest.applications.zotero.id]:{ updates:[{
  version:pkg.version,update_link:`https://github.com/alan-hpc/zotero-paper-weave/releases/download/v${pkg.version}/${name}`,
  applications:{ zotero:{ strict_min_version:'10.0',strict_max_version:'10.*' } }
}] } } };
await writeFile('dist/updates.json',JSON.stringify(update,null,2)+'\n');
console.log(`Built dist/${name} (${(archive.length/1024/1024).toFixed(1)} MiB)`);
