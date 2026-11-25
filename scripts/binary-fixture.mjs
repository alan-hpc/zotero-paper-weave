/** Model Gecko's binary wrapper: only structured cloning may inspect its bytes. */
export function binaryBoundaryFixture(){
  const wrapped=new WeakMap(),copies=new WeakSet(),targets=[];
  return{
    targets,
    wrap(value){
      const proxy=new Proxy(value,{get(_value,key){
        if(key==='then')return undefined;
        throw new Error('Accessing TypedArray data over Xrays is forbidden. Use Components.utils.cloneInto().');
      }});
      wrapped.set(proxy,value);return proxy;
    },
    cloneInto(value,target){
      targets.push(target);
      const copy=structuredClone(wrapped.get(value)||value);
      if(copy&&typeof copy==='object')copies.add(copy);
      return copy;
    },
    wasCloned:value=>copies.has(value)
  };
}
