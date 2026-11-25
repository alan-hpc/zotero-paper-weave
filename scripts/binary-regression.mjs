import assert from 'node:assert/strict';
import vm from 'node:vm';
import {binaryBoundaryFixture} from './binary-fixture.mjs';

export async function verifyBinaryBoundaries(moduleFor){
  const {copyBytes}=await moduleFor('src/bytes.ts');
  const fixture=binaryBoundaryFixture();
  const backing=new Uint8Array([99,1,2,3,88]),wrapped=fixture.wrap(backing.subarray(1,4));
  assert.throws(()=>new Uint8Array(wrapped),/Xrays/,'reproduce the pre-fix constructor failure');
  assert.throws(()=>copyBytes(wrapped),/Xrays/,'binary wrappers must not be inspected before cloning');
  const copied=copyBytes(wrapped,fixture.cloneInto);
  assert.deepEqual([...copied],[1,2,3]);backing[2]=55;assert.deepEqual([...copied],[1,2,3],'the new realm owns an independent copy');
  assert.equal(fixture.targets[0],globalThis,'clone into the consuming realm before inspecting the view');
  const foreign=vm.runInNewContext('new Uint8Array([7,8,9,10]).subarray(1,3)');
  assert.deepEqual([...copyBytes(foreign,fixture.cloneInto)],[8,9],'real cross-context view offsets are preserved');
  const buffer=fixture.wrap(new Uint8Array([4,5,6]).buffer);
  assert.deepEqual([...copyBytes(buffer,fixture.cloneInto)],[4,5,6]);
  assert.deepEqual([...copyBytes(new Uint8Array(0),fixture.cloneInto)],[]);
  assert.deepEqual([...copyBytes(new Uint8Array([0,255,128]).buffer,fixture.cloneInto)],[0,255,128]);
  const {readAsset}=await moduleFor('src/assets.ts');
  class XrayFont {
    status=0;response=fixture.wrap(new Uint8Array([0,255,128]).buffer);
    open(){}send(){this.onload();}
  }
  assert.deepEqual([...await readAsset(XrayFont,'jar:file:///addon.xpi!/font.ttf',fixture.cloneInto)],[0,255,128]);
  await assert.rejects(readAsset(XrayFont,'jar:file:///addon.xpi!/font.ttf'),/字体.*Xrays/,'a rejected asset copy settles instead of leaving its promise pending');
  console.log('PASS binary realm boundaries: reproduced Xray constructor failure, clone-before-read, view offsets, independent buffers, real VM contexts and packaged-font rejection');
}
