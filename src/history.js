// Recently opened schematics, kept only in this browser (IndexedDB). Nothing is uploaded.
// Entry: {id, name, dims, author, viewed, thumb (JPEG data URL), data (ArrayBuffer)}
const DB='litematica-viewer', STORE='files', LIMIT=20;
let dbp=null;
function db(){
  if(!dbp)dbp=new Promise((res,rej)=>{
    const rq=indexedDB.open(DB,1);
    rq.onupgradeneeded=()=>rq.result.createObjectStore(STORE,{keyPath:'id'});
    rq.onsuccess=()=>res(rq.result);rq.onerror=()=>rej(rq.error);
  });
  return dbp;
}
async function tx(mode,fn){
  const d=await db();
  return new Promise((res,rej)=>{
    const t=d.transaction(STORE,mode),out=fn(t.objectStore(STORE));
    t.oncomplete=()=>res(out?.result);t.onerror=t.onabort=()=>rej(t.error);
  });
}
// same file → same id, so re-opening it moves it to the top instead of duplicating
export async function fileId(buf){
  try{const h=new Uint8Array(await crypto.subtle.digest('SHA-256',buf));return Array.from(h.slice(0,12),b=>b.toString(16).padStart(2,'0')).join('');}
  catch{return 'f'+buf.byteLength+'-'+Date.now();}
}
export async function list(){
  const all=await tx('readonly',s=>s.getAll());
  return (all||[]).sort((a,b)=>b.viewed-a.viewed);
}
export const get=id=>tx('readonly',s=>s.get(id));
export const remove=id=>tx('readwrite',s=>{s.delete(id);});
export async function save(entry){
  const old=await get(entry.id);
  await tx('readwrite',s=>{s.put({...old,...entry,viewed:Date.now()});});
  const all=await list();
  if(all.length>LIMIT)await tx('readwrite',s=>{for(const e of all.slice(LIMIT))s.delete(e.id);});
}
