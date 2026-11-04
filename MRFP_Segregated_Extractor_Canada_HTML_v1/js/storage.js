/* Browser-only persistence: IndexedDB, never a server. */
(function(global){
'use strict';
const DBNAME='mrfp_segregated_extractor_canada_browser_v1',DBVERSION=1;
let connection=null, unavailable=false;const volatileDocs=new Map(),volatileMeta=new Map();
function req(r){return new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error||Error('IndexedDB request failed'));});}
async function db(){
 if(connection)return connection;
 if(unavailable)return null;
 try{connection=await new Promise((resolve,reject)=>{
  if(!('indexedDB' in global))return reject(Error('IndexedDB is unavailable in this browser'));
  const r=indexedDB.open(DBNAME,DBVERSION);
  r.onupgradeneeded=()=>{
   const d=r.result;
   if(!d.objectStoreNames.contains('docs'))d.createObjectStore('docs',{keyPath:'hash'});
   if(!d.objectStoreNames.contains('meta'))d.createObjectStore('meta',{keyPath:'key'});
  };
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||Error('Browser database unavailable'));
 });
 return connection;
 }catch(e){unavailable=true;console.warn('Persistent storage blocked; temporary memory used:',e.message);return null;}
}
async function transaction(store,mode,action){
 const database=await db();
 if(!database){const map=store==='docs'?volatileDocs:volatileMeta;const s={get:key=>({result:map.get(key)}),getAll:()=>({result:[...map.values()]}),put:value=>{map.set(value[store==='docs'?'hash':'key'],value);return {result:value};},delete:key=>{map.delete(key);return {result:undefined};}};return action(s)?.result;}
 return new Promise((resolve,reject)=>{
  const tx=database.transaction(store,mode),s=tx.objectStore(store);
  let output;
  try {output=action(s);}catch(e){tx.abort();return reject(e);}
  tx.oncomplete=()=>resolve(output?.result);
  tx.onerror=()=>reject(tx.error||Error('Database transaction failed'));
  tx.onabort=()=>reject(tx.error||Error('Database transaction aborted'));
 });
}
async function get(hash){return await transaction('docs','readonly',s=>s.get(hash))||null;}
async function put(doc){doc.updated=Date.now();await transaction('docs','readwrite',s=>s.put(doc));return doc;}
async function importDoc(doc){await transaction('docs','readwrite',s=>s.put(doc));return doc;}
async function remove(hash){await transaction('docs','readwrite',s=>s.delete(hash));const ws=await workspace();if(ws.includes(hash))await saveWorkspace(ws.filter(h=>h!==hash));}
async function all(){const docs=await transaction('docs','readonly',s=>s.getAll())||[];return docs.sort((a,b)=>b.updated-a.updated);}
async function workspace(){const m=await transaction('meta','readonly',s=>s.get('workspace'));return m?.hashes||[];}
async function saveWorkspace(hashes){await transaction('meta','readwrite',s=>s.put({key:'workspace',hashes}));}
async function addToWorkspace(hash){const ws=await workspace();await saveWorkspace([hash,...ws.filter(x=>x!==hash)]);}
async function clearWorkspace(){await saveWorkspace([]);}
async function listed(){const hashes=await workspace(),docs=await all(),map=new Map(docs.map(x=>[x.hash,x]));return hashes.map(x=>map.get(x)).filter(Boolean);}
async function fingerprint(file){
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(global.crypto?.subtle){
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
 }
 let hash=2166136261;for(const ch of bytes)hash=Math.imul(hash^ch,16777619)>>>0;
 return hash.toString(16).padStart(8,'0')+'-'+bytes.length; // file:// compatibility fallback
}
// Clear only locally retained original PDFs; keep extraction records,
// verification, corrections, dates, ordering, and document identity intact.
async function clearStoredPDFs(){
 const database=await db();
 if(!database){let count=0;for(const doc of volatileDocs.values()){
  if(doc.blob){delete doc.blob;count++;}
 }return count;}
 return new Promise((resolve,reject)=>{
  let count=0;const tx=database.transaction('docs','readwrite');
  const cursor=tx.objectStore('docs').openCursor();
  cursor.onsuccess=()=>{
   const c=cursor.result;if(!c)return;
   if(c.value.blob){const doc={...c.value};delete doc.blob;c.update(doc);count++;}
   c.continue();
  };
  cursor.onerror=()=>tx.abort();
  tx.oncomplete=()=>resolve(count);
  tx.onerror=()=>reject(tx.error||Error('PDF removal failed'));
  tx.onabort=()=>reject(tx.error||Error('PDF removal aborted'));
 });
}
// Clear docs and metadata atomically. No database schema change and no
// deletion of the user's original files on disk or unrelated site data.
async function resetAllSavedData(){
 const database=await db();
 if(!database){const count=volatileDocs.size;volatileDocs.clear();volatileMeta.clear();return count;}
 return new Promise((resolve,reject)=>{
  let count=0;const tx=database.transaction(['docs','meta'],'readwrite');
  const docs=tx.objectStore('docs');const result=docs.count();
  result.onsuccess=()=>{count=result.result;docs.clear();tx.objectStore('meta').clear();};
  result.onerror=()=>tx.abort();
  tx.oncomplete=()=>{volatileDocs.clear();volatileMeta.clear();resolve(count);};
  tx.onerror=()=>reject(tx.error||Error('Data reset failed'));
  tx.onabort=()=>reject(tx.error||Error('Data reset aborted'));
 });
}
function slim(doc){const {blob,...rest}=doc;return rest;}
global.MRFP_STORAGE={db,get,put,importDoc,remove,all,workspace,addToWorkspace,clearWorkspace,listed,fingerprint,slim,clearStoredPDFs,resetAllSavedData,isTemporary:()=>unavailable};
})(globalThis);
