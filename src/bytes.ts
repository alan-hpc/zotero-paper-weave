export type ByteSource=Uint8Array|ArrayBuffer;
export type ByteClone=(value:ByteSource,target:object)=>ByteSource;

/** Clone across Gecko compartments before inspecting or copying binary data.
 * Waiving Xrays is not a substitute for owning the ArrayBuffer in this realm.
 */
export function copyBytes(value:ByteSource,clone?:ByteClone):Uint8Array {
  const local=clone?clone(value,globalThis):value;
  const view=ArrayBuffer.isView(local)?new Uint8Array(local.buffer,local.byteOffset,local.byteLength):new Uint8Array(local);
  return new Uint8Array(view);
}
