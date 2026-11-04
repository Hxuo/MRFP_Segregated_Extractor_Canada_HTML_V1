/* Uses PDF.js 3.11 in the browser. No backend uploads. */
(function(global) {
'use strict';
const JS_URL='./vendor/pdfjs/pdf.min.js';
const WORKER_URL='./vendor/pdfjs/pdf.worker.min.js';
let ocrScript;
function ready(){return typeof global.pdfjsLib!=='undefined';}
function loadScript(url) {
  return new Promise((resolve,reject)=>{
    let s=document.createElement('script');s.src=url;s.async=true;
    s.onload=resolve;s.onerror=()=>reject(Error('Unable to download '+url));
    document.head.appendChild(s);
  });
}
async function ensurePdf(){
  if(!ready())await loadScript(JS_URL);
  if(!ready())throw Error('PDF.js unavailable. Bundled PDF.js was unavailable. You may use the text-paste fallback.');
  global.pdfjsLib.GlobalWorkerOptions.workerSrc=WORKER_URL;
  return global.pdfjsLib;
}
function groupLines(items) {
 const groups=[];
 for(const it of items){
  let row=groups.find(g=>Math.abs(g.y-it.y)<Math.max(2,Math.min(3,it.h*.28)));
  if(!row){row={y:it.y,items:[]};groups.push(row);}
  row.items.push(it);
 }
 groups.sort((a,b)=>b.y-a.y);
 return groups.map(group=>{
  const pieces=group.items.sort((a,b)=>a.x-b.x);let text='',right=0;
  for(const part of pieces){
   const gap=part.x-right;
   if(text&&gap>Math.max(1.5,part.h*.20))
     text+=' '.repeat(Math.max(1,Math.min(12,Math.round(gap/Math.max(3,part.h*.32)))));
   text+=part.str;right=Math.max(right,part.x+part.w);
  }
  return text.trimEnd();
 });
}
async function getOCRWorker(){
  if(!global.Tesseract){
    if(!ocrScript)ocrScript=loadScript('./vendor/tesseract/tesseract.min.js');
    await ocrScript;
  }
  if(!global.Tesseract?.createWorker)throw Error('Tesseract OCR library unavailable');
  return global.Tesseract.createWorker('eng');
}
async function ocrPage(page){
 const viewport=page.getViewport({scale:1.65});
 const canvas=document.createElement('canvas');
 canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
 await page.render({canvasContext:canvas.getContext('2d',{willReadFrequently:true}),viewport}).promise;
 const worker=await getOCRWorker();
 try{
  const result=await worker.recognize(canvas);
  return result?.data?.text||'';
 } finally{await worker.terminate();}
}
async function readFile(file,{onProgress=()=>{},ocrEnabled=true}={}){
 const pdfjs=await ensurePdf();
 const data=new Uint8Array(await file.arrayBuffer());
 const pdf=await pdfjs.getDocument({data,useSystemFonts:true,disableFontFace:true,isEvalSupported:false}).promise;
 const pages=[];const notes=[];
 try{
  for(let i=1;i<=pdf.numPages;i++){
   const page=await pdf.getPage(i);
   const content=await page.getTextContent({disableCombineTextItems:false});
   const items=content.items.filter(it=>typeof it.str==='string'&&it.str.trim()).map(it=>({
     str:it.str,x:it.transform[4],y:it.transform[5],w:it.width||0,h:Math.max(6,Math.abs(it.transform[3]||0))
   }));
   let lines=groupLines(items),text=lines.join('\n'),ocrUsed=false;
   if(ocrEnabled&&text.trim().length<40){
    try{
     onProgress(i,pdf.numPages,`OCR page ${i}…`);
     const ocr=await ocrPage(page);
     if(ocr.trim()){text=ocr;lines=ocr.split(/\r?\n/);ocrUsed=true;}
    }catch(e){notes.push(`Page ${i}: OCR unavailable (${e.message})`);}
   }
   const w=page.getViewport({scale:1}).width,mid=w/2;
   const leftText=groupLines(items.filter(it=>it.x<mid-12)).join('\n');
   const rightText=groupLines(items.filter(it=>it.x>=mid-12)).join('\n');
   // Retain positions for narrowly scoped, layout-specific fallback parsing.
   // They are transient (not persisted in IndexedDB), and only from local PDFs.
   pages.push({page:i,text,lines,leftText,rightText,ocrUsed,width:w,items});
   onProgress(i,pdf.numPages,`Read page ${i} of ${pdf.numPages}`);
   page.cleanup();
   await new Promise(resolve=>setTimeout(resolve,0));
  }
 }finally{await pdf.destroy();}
 return {pages,notes};
}
function fromPastedText(text) {
 const chunks=text.split(/\[PAGE\]|\f/g).filter(s=>s.trim());
 return chunks.map((t,i)=>({page:i+1,text:t,lines:t.split(/\r?\n/),leftText:t,rightText:t,ocrUsed:false,width:0}));
}
global.MRFP_PDF={ensurePdf,ready,readFile,fromPastedText,groupLines};
})(globalThis);
