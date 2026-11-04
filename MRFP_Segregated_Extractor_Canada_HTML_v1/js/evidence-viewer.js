/* Browser v5 PDF.js evidence viewer: lazy page rendering, exact-origin PDF coordinate overlay.
   Rendering and evidence location are separate from the existing financial parsers. */
(function(global){
'use strict';
const $=id=>document.getElementById(id), locator=global.MRFP_EVIDENCE;
const state={pdf:null,loading:null,blob:null,doc:null,token:0,scale:1.15,observer:null,visible:new Set(),cache:new Map(),renders:new Map(),current:1,overlay:[],focusKey:null,refreshPromise:null,refreshDoc:null,userNavigated:false,navPromise:null,fallbackUrl:null};
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
// A PDF.js canvas must contain enough physical pixels for small MRFP table fonts.
// Use supersampling on standard-DPI displays, respect HiDPI displays, and cap
// the backing buffer so large pages/zooms do not exhaust browser memory.
const MAX_RENDER_PIXELS=6000000,MAX_CANVAS_SIDE=8192;
function outputScale(viewport){
 const pixelRatio=Number(global.devicePixelRatio)||1;
 const preferred=clamp(pixelRatio*1.25,2,3);
 return Math.min(preferred,
  Math.sqrt(MAX_RENDER_PIXELS/Math.max(1,viewport.width*viewport.height)),
  MAX_CANVAS_SIDE/Math.max(1,viewport.width,viewport.height));
}
const notice=s=>{$('evidenceStatus').textContent=s||'';};
function cleanupNative(){if(state.fallbackUrl){URL.revokeObjectURL(state.fallbackUrl);state.fallbackUrl=null;}}
function reset(){
 ++state.token;state.observer?.disconnect();state.observer=null;
 for(const task of state.renders.values()){try{task.cancel();}catch{}}
 state.renders.clear();state.visible.clear();state.cache.clear();state.overlay=[];state.focusKey=null;state.refreshPromise=null;state.refreshDoc=null;state.userNavigated=false;
 const pdf=state.pdf,loading=state.loading;
 state.pdf=null;state.loading=null;state.blob=null;state.doc=null;state.current=1;
 if(loading&&!pdf)loading.destroy().catch(()=>{});
 if(pdf)pdf.destroy().catch(()=>{});
 $('evidencePages').replaceChildren();$('pdfEvidence').classList.add('hidden');$('viewer').classList.add('hidden');
 cleanupNative();notice('');
}
function fallback(blob,message){
 if(!blob)return;
 cleanupNative();state.fallbackUrl=URL.createObjectURL(blob);
 $('viewer').src=state.fallbackUrl;$('viewer').classList.remove('hidden');
 $('pdfEvidence').classList.add('hidden');
 notice(message||'Source coordinates unavailable; using original PDF preview.');
}
function placeholder(i,width,height){
 const outer=document.createElement('section');outer.className='evidence-sheet';outer.dataset.page=String(i);
 outer.style.width=width+'px';outer.style.height=height+'px';
 const label=document.createElement('span');label.className='sheet-number';label.textContent='Page '+i;
 const layer=document.createElement('div');layer.className='evidence-layer';
 const focusLayer=document.createElement('div');focusLayer.className='evidence-focus-layer';
 outer.append(label,layer,focusLayer);
 return outer;
}
function updateCounters(){
 $('evidencePage').textContent=`${state.current} / ${state.pdf?.numPages||0}`;
 $('evidencePrev').disabled=state.current<=1;
 $('evidenceNext').disabled=!state.pdf||state.current>=state.pdf.numPages;
 $('evidenceZoom').textContent=Math.round(state.scale*100)+'%';
}
function getShell(n){return $('evidencePages').querySelector(`[data-page="${n}"]`);}
function showOverlay(n){
 const shell=getShell(n);if(!shell)return;
 const layer=shell.querySelector('.evidence-layer');layer.replaceChildren();
 const focusLayer=shell.querySelector('.evidence-focus-layer');focusLayer?.replaceChildren();
 const cached=state.cache.get(n);if(!cached?.viewport)return;
 for(const e of state.overlay.filter(x=>x.page===n)){
  const rect=cached.viewport.convertToViewportRectangle([e.box.x,e.box.y,e.box.x+e.box.w,e.box.y+e.box.h]);
  const x=Math.min(rect[0],rect[2]),y=Math.min(rect[1],rect[3]),width=Math.abs(rect[2]-rect[0]),height=Math.abs(rect[3]-rect[1]);
  if(!(width>1&&height>1))continue;
  const mark=document.createElement('div');mark.className='pdf-evidence-mark';
  const isFocused=!!(state.focusKey&&e.rowKey===state.focusKey);
  if(isFocused)mark.classList.add('is-focused');
  mark.style.left=x+'px';mark.style.top=y+'px';mark.style.width=width+'px';mark.style.height=height+'px';
  mark.title=`${e.className||'Class/Series'} · ${e.metric} — original PDF: ${e.isMissing?'missing ('+(e.sourceText||'—')+')':(e.sourceText??e.value)}`;
  if(isFocused&&focusLayer){
   // Keep the orange box visible on the normal overlay layer while the second
   // screen-blended layer recolors only the PDF glyphs inside that same cell.
   const box=document.createElement('div');box.className='pdf-evidence-focus-box';
   box.style.left=x+'px';box.style.top=y+'px';box.style.width=width+'px';box.style.height=height+'px';
   layer.appendChild(box);focusLayer.appendChild(mark);
  }else layer.appendChild(mark);
 }
}
async function render(n){
 const token=state.token,pdf=state.pdf;if(!pdf||!Number.isInteger(n)||n<1||n>pdf.numPages)return;
 const shell=getShell(n);if(!shell)return;
 const cache=state.cache.get(n);
 if(cache?.canvas&&cache.scale===state.scale){showOverlay(n);return;}
 if(state.renders.has(n))return;
 let task;
 try{
  const page=await pdf.getPage(n);
  if(token!==state.token)return;
  const viewport=page.getViewport({scale:state.scale});
  shell.style.width=viewport.width+'px';shell.style.height=viewport.height+'px';
  const canvas=document.createElement('canvas');canvas.className='evidence-canvas';
  const dpr=outputScale(viewport);
  canvas.width=Math.max(1,Math.floor(viewport.width*dpr));canvas.height=Math.max(1,Math.floor(viewport.height*dpr));
  canvas.dataset.renderScale=dpr.toFixed(3);
  canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';
  const ctx=canvas.getContext('2d',{alpha:false});
  if(!ctx)throw Error('PDF canvas unavailable');
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
  task=page.render({canvasContext:ctx,viewport,transform:dpr!==1?[dpr,0,0,dpr,0,0]:undefined});
  state.renders.set(n,task);await task.promise;
  if(token!==state.token||state.scale!==viewport.scale)return;
  shell.querySelector('canvas')?.remove();shell.prepend(canvas);
  state.cache.set(n,{page,viewport,canvas,scale:state.scale});showOverlay(n);
 }catch(e){if(e?.name!=='RenderingCancelledException')console.warn('PDF rendering failed on page '+n,e);}
 finally{if(task&&state.renders.get(n)===task)state.renders.delete(n);}
}
function trim(){
 // Keep nearby pages, release old large canvas surfaces. No full-document rendering.
 for(const [n,c] of state.cache){
  if(state.visible.has(n)||Math.abs(state.current-n)<=2)continue;
  const shell=getShell(n);shell?.querySelector('canvas')?.remove();
  state.cache.delete(n);c.page.cleanup();
 }
}
function renderVisible(){
 if(!state.pdf)return;
 for(const n of state.visible)render(n);
 render(state.current);trim();
}
async function jump(n,{highlight=false}={}){
 if(!state.pdf)return;
 const page=clamp(Math.round(Number(n)||1),1,state.pdf.numPages);
 state.current=page;updateCounters();
 const shell=getShell(page);if(!shell)return;
 shell.scrollIntoView({block:'start',behavior:'instant'});
 await render(page);if(highlight){
  showOverlay(page);
  // Scroll to the actual displayed mark rather than adding a PDF-coordinate
  // offset to a scroll position that may have changed during lazy rendering.
  // This prevents correct Fidelity source cells from landing off-screen.
  const mark=shell.querySelector('.pdf-evidence-mark.is-focused')||shell.querySelector('.pdf-evidence-mark');
  if(mark){const area=$('evidenceScroll');area.scrollTop+=mark.getBoundingClientRect().top-area.getBoundingClientRect().top-140;}
 }
}
function changeZoom(factor){
 if(!state.pdf)return;
 const page=state.current;state.scale=clamp(Math.round(state.scale*factor*100)/100,.6,2.4);
 for(const [n,c] of state.cache){getShell(n)?.querySelector('canvas')?.remove();
  if(!state.renders.has(n))c.page.cleanup();
 }state.cache.clear();
 for(const task of state.renders.values()){try{task.cancel();}catch{}}state.renders.clear();
 for(const shell of $('evidencePages').children){
  const w=Number(shell.dataset.baseWidth)||612,h=Number(shell.dataset.baseHeight)||792;
  shell.style.width=w*state.scale+'px';shell.style.height=h*state.scale+'px';
  shell.querySelector('.evidence-layer').replaceChildren();
  shell.querySelector('.evidence-focus-layer')?.replaceChildren();
 }
 updateCounters();jump(page).then(renderVisible);
}
// Evidence validity is an adapter/core contract. The viewer only renders
// coordinates that the locator declares current, regardless of FMC or layout.
function rowKey(row){return row.row_id||row.class_name;}
const needsRefresh=(row,record)=>locator.needsRefresh(row,record);
function collectOverlays(doc){
 const marks=[],seen=new Set();
 for(const row of doc?.results||[]){
  const key=rowKey(row),record=doc.evidenceMap?.rows?.[key];
  // Never auto-display stale or unverified geometry from old History entries.
  if(needsRefresh(row,record))continue;
  for(const metric of ['MER','TER','PTR']){
   const hit=record.metrics?.[metric],b=hit?.box;
   if(!Number.isInteger(hit?.page)||hit.page<1||!b||
      ![b.x,b.y,b.w,b.h].every(Number.isFinite)||b.w<=0||b.h<=0)continue;
   const sig=[key,metric,hit.page,b.x,b.y,b.w,b.h].join('|');
   if(seen.has(sig))continue;seen.add(sig);
   marks.push({rowKey:key,className:row.class_name,metric,...hit});
  }
 }
 return marks;
}
function repaint(){
 state.overlay=collectOverlays(state.doc);
 for(const n of state.cache.keys())showOverlay(n);
}
function summary(){
 const rows=state.doc?.results?.length||0,marks=state.overlay.length;
 if(!state.doc)return 'PDF preview ready.';
 return marks?`${marks} original source cells highlighted across ${rows} class/series rows. Select Search to focus a series.`:
  'Exact source location unavailable. Select Search to inspect a specific series.';
}
// Read a stale History PDF once and locate ALL rows together. This preserves
// FMC-specific document context and avoids re-reading every page per series.
async function refreshOldEvidence(){
 const doc=state.doc,pdf=state.pdf,token=state.token;
 if(!doc||!pdf||!(doc.results||[]).some(row=>needsRefresh(row,doc.evidenceMap?.rows?.[rowKey(row)])))return;
 const pages=[];
 for(let n=1;n<=pdf.numPages;n++){
  if(token!==state.token||state.pdf!==pdf||state.doc!==doc)return;
  const page=await pdf.getPage(n),data=await page.getTextContent({disableCombineTextItems:false});
  const items=data.items.filter(i=>typeof i.str==='string'&&i.str.trim()).map(i=>({str:i.str,x:i.transform[4],y:i.transform[5],w:i.width||0,h:Math.max(6,Math.abs(i.transform[3]||0))}));
  const width=page.getViewport({scale:1}).width;
  const lines=global.MRFP_PDF.groupLines(items);
  pages.push({page:n,items,width,lines,text:lines.join('\n'),
   leftText:global.MRFP_PDF.groupLines(items.filter(i=>i.x<width/2-12)).join('\n'),
   rightText:global.MRFP_PDF.groupLines(items.filter(i=>i.x>=width/2-12)).join('\n'),ocrUsed:false});
  if(n%10===0)await new Promise(resolve=>setTimeout(resolve,0));
 }
 if(token!==state.token||state.pdf!==pdf||state.doc!==doc)return;
 const rebuilt=locator.locate(pages,doc.results||[]);
 if(token!==state.token||state.pdf!==pdf||state.doc!==doc)return;
 const oldRows=doc.evidenceMap?.rows||{};
 const nextRows={...oldRows};
 for(const row of doc.results||[]){
  const key=rowKey(row);
  if(needsRefresh(row,oldRows[key]))nextRows[key]=rebuilt.rows?.[key]||locator.emptyRecord(row);
 }
 doc.evidenceMap={...doc.evidenceMap,version:locator.LOCATOR_VERSION,rows:nextRows};
 repaint();
 if(!state.userNavigated){
  const first=locator.initialPage(doc);
  if(first&&first!==state.current)await jump(first);
 }
 if(token===state.token&&state.doc===doc)notice(summary());
}
function ensureEvidence(){
 if(state.refreshPromise&&state.refreshDoc===state.doc)return state.refreshPromise;
 if(!state.pdf||!state.doc)return Promise.resolve();
 const task=refreshOldEvidence().catch(e=>{
  if(state.pdf)console.warn('Automatic evidence revalidation unavailable',e);
  if(state.doc)notice('Some saved evidence could not be refreshed. Search remains available.');
 });
 state.refreshPromise=task;state.refreshDoc=state.doc;
 task.finally(()=>{if(state.refreshPromise===task){state.refreshPromise=null;state.refreshDoc=null;}});
 return task;
}
async function open(blob,doc){
 // Previewing another uploaded file must never show the prior document's source cells.
 if(doc&&doc.blob!==blob)doc=null;
 if(!blob){reset();$('pdfUnavailable').classList.remove('hidden');$('pdfUnavailable').textContent=doc?'History loaded — original PDF not available.':'No PDF selected — choose or open a saved document to preview.';return;}
 $('pdfUnavailable').classList.add('hidden');
 if(state.blob===blob&&state.pdf){
  state.doc=doc||null;state.focusKey=null;state.userNavigated=false;
  repaint();
  const page=doc&&locator.initialPage(doc);
  if(page)await jump(page);
  notice(summary());
  if(doc)ensureEvidence();
  return;
 }
 reset();state.blob=blob;state.doc=doc||null;const token=state.token;
 $('pdfEvidence').classList.remove('hidden');$('viewer').classList.add('hidden');
 notice('Opening PDF locally…');
 try{
  const pdfjs=await global.MRFP_PDF.ensurePdf();
  const data=new Uint8Array(await blob.arrayBuffer());
  // Preserve the high-resolution PDF renderer and embedded font handling.
  const task=pdfjs.getDocument({data,useSystemFonts:true,disableFontFace:false,isEvalSupported:false});
  state.loading=task;const pdf=await task.promise;
  if(token!==state.token){await pdf.destroy();return;}
  state.pdf=pdf;
  const container=$('evidencePages');container.replaceChildren();
  const first=await pdf.getPage(1),v=first.getViewport({scale:1});first.cleanup();
  if(token!==state.token)return;
  for(let i=1;i<=pdf.numPages;i++){
   const node=placeholder(i,v.width*state.scale,v.height*state.scale);
   node.dataset.baseWidth=v.width;node.dataset.baseHeight=v.height;container.appendChild(node);
  }
  const area=$('evidenceScroll');
  state.observer=new IntersectionObserver(entries=>{
   if(token!==state.token)return;
   for(const e of entries){const n=Number(e.target.dataset.page);if(e.isIntersecting)state.visible.add(n);else state.visible.delete(n);}
   const top=area.getBoundingClientRect().top;
   const near=[...container.children].filter(node=>node.getBoundingClientRect().bottom>top+2).sort((a,b)=>Math.abs(a.getBoundingClientRect().top-top)-Math.abs(b.getBoundingClientRect().top-top))[0];
   if(near){state.current=Number(near.dataset.page);updateCounters();}
   renderVisible();
  },{root:area,rootMargin:'600px 0px',threshold:0});
  for(const el of container.children)state.observer.observe(el);
  repaint();
  const firstEvidence=doc&&locator.initialPage(doc);
  updateCounters();await jump(firstEvidence||1);
  notice(summary());
  if(doc)ensureEvidence();
 }catch(e){if(token!==state.token)return;console.warn('PDF.js evidence viewer unavailable',e);fallback(blob,'PDF.js rendering unavailable. Original browser PDF preview is shown; highlights are disabled.');}
}
function updateDoc(doc){
 if(!doc||state.doc?.hash!==doc.hash)return;
 state.doc=doc;
 repaint();
 // An edited value does not replace original evidence; keep focus when editing.
 if(state.pdf)ensureEvidence();
}
async function focusRow(row){
 const doc=state.doc,pdf=state.pdf,token=state.token;
 if(!state.blob||!pdf){notice('Original PDF not available — Search disabled.');return;}
 if(!row){notice('Select a class/series to locate.');return;}
 const key=rowKey(row);
 if(needsRefresh(row,doc.evidenceMap?.rows?.[key])){
  notice('Revalidating original PDF source columns…');
  await ensureEvidence();
  if(token!==state.token||doc!==state.doc)return;
 }
 const record=doc.evidenceMap?.rows?.[key]||{pages:[],metrics:{}};
 const evidence=Object.entries(record.metrics||{}).filter(([metric,v])=>v&&v.box&&Number.isInteger(v.page)).map(([metric,v])=>({metric,...v}));
 const pageList=[...new Set([...evidence.map(e=>e.page),...(record.pages||[])])].sort((a,b)=>a-b);
 state.focusKey=key;repaint();
 if(pageList.length)await jump(pageList[0],{highlight:true});else await jump(state.current);
 if(token!==state.token||doc!==state.doc)return;
 const correction=!!row.originalValues||['MER','TER','PTR'].some(k=>row.evidence?.[k]?.method==='manual');
 const ratioCount=3;
 const details=pageList.length>1?' Source pages: '+pageList.join(', ')+'. Use page navigation for other pages.':'';
 if(evidence.length){
  const dashes=evidence.filter(e=>e.isMissing).length;
  const note=dashes?` Includes ${dashes} printed missing-value marker${dashes===1?'':'s'} (n/a, —, or --), not zero.`:'';
  notice(`${row.class_name}: ${evidence.length}/${ratioCount} original PDF cells focused.${note} Other series remain highlighted.${correction?' Manually corrected values may differ from the PDF.':''}${details}${evidence.length<ratioCount?' Exact source location unavailable for remaining cells.':''}`);
 }
 else notice(`${row.class_name}: Exact source location unavailable.${pageList.length?' Opened known source page '+pageList[0]+'.':''}${correction?' The current values include manual corrections.':''} Other available series remain highlighted.`);
}
function bind(){
 $('evidenceScroll').addEventListener('wheel',()=>{state.userNavigated=true;},{passive:true});
 $('evidenceScroll').addEventListener('touchstart',()=>{state.userNavigated=true;},{passive:true});
 $('evidencePrev').onclick=()=>{state.userNavigated=true;jump(state.current-1);};
 $('evidenceNext').onclick=()=>{state.userNavigated=true;jump(state.current+1);};
 $('evidenceZoomIn').onclick=()=>{state.userNavigated=true;changeZoom(1.2);};
 $('evidenceZoomOut').onclick=()=>{state.userNavigated=true;changeZoom(1/1.2);};
 $('evidencePageInput').onchange=e=>{const n=parseInt(e.target.value,10);if(Number.isInteger(n)){state.userNavigated=true;jump(n);}e.target.value='';};
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
global.MRFP_EVIDENCE_VIEWER={open,focusRow,updateDoc,reset,jump};
})(globalThis);
