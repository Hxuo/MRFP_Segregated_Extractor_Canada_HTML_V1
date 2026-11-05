/* Multi-fund browser controller. No insurer-specific parsing or source heuristics. */
(function(global){'use strict';
const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STORE=global.MRFP_STORAGE,PDF=global.MRFP_PDF,ENG=global.SEGREGATED_ENGINE,VIEW=global.MRFP_EVIDENCE_VIEWER,EXP=global.MRFP_EXPORT;
const st={queue:[],docs:[],active:null,filter:'all',search:'',page:0,historyPage:0,historySize:10,processing:false,cancel:false,failed:0,editKey:null,rescanResult:null,confirmation:null};
const fmt=n=>n===null||n===undefined?'—':Number(n).toFixed(2);
const rowOf=(doc,key)=>doc?.results?.find(r=>r.row_id===key);
const source=(r,k)=>r.evidence?.[k]?.page?'PDF p. '+r.evidence[k].page:'No source coordinates';
const notify=t=>{$('status').textContent=t;};
const sleep=()=>new Promise(r=>setTimeout(r,0));
function getListed(){const m=new Map(st.docs.map(d=>[d.hash,d]));return st.listedHashes?.map(h=>m.get(h)).filter(Boolean)||[];}
function setProgress(n){$('progressBar').style.width=Math.max(0,Math.min(100,n))+'%';}
function showPage(name){
 for(const b of document.querySelectorAll('[data-page]')){b.classList.toggle('is-active',b.dataset.page===name);if(b.dataset.page===name)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
 for(const key of ['extract','history','reports','settings'])$(key+'Page').classList.toggle('hidden',key!==name);
 if(name==='history')renderHistory();if(name==='reports')renderReports();if(name==='settings')storageOverview();
}
function pick(files){
 if(st.processing)return;
 const pdfs=[...files].filter(f=>f.type==='application/pdf'||/\.pdf$/i.test(f.name)).slice(0,5);
 st.queue=pdfs;st.failed=0;$('pdf').value='';$('filename').textContent=pdfs.length?pdfs.map(f=>f.name).join(', '):'Choose or drop PDFs to begin';
 $('batchCount').textContent=pdfs.length+' / 5 files selected';renderBatch();setProgress(0);renderStats();
}
function renderBatch(){
 const el=$('batchList');el.replaceChildren();if(!st.queue.length){el.innerHTML='<span class="muted">No files queued.</span>';return;}
 for(const f of st.queue){const div=document.createElement('div');div.className='seg-batch-entry';
  div.innerHTML='<span class="seg-batch-name">'+esc(f.name)+'</span><span class="muted">'+(f.size/1048576).toFixed(2)+' MB · '+esc(f._segStatus||'Queued')+'</span>';el.appendChild(div);}
}
function counts(docs){
 const rows=docs.flatMap(d=>d.results||[]);return {
  completed:docs.length,funds:docs.reduce((n,d)=>n+(d.funds?.length||0),0),classes:rows.length,
  MER:rows.filter(r=>r.MER!==null).length,TER:rows.filter(r=>r.TER!==null).length,PTR:rows.filter(r=>r.PTR!==null).length,
  missing:rows.reduce((n,r)=>n+['MER','TER','PTR'].filter(k=>r[k]===null).length,0),failed:st.failed};
}
function renderStats(){const c=counts(getListed()),labels=[['completed','PDFs completed'],['funds','Funds detected'],['classes','Classes / Series'],['MER','MER values'],['TER','TER values'],['PTR','PTR values'],['missing','Missing cells'],['failed','Failed PDFs']];
 $('segStats').innerHTML=labels.map(([key,label])=>`<div class="seg-stat"><b>${c[key]}</b><small>${label}</small></div>`).join('');}
async function reloadDocs(){st.docs=await STORE.all();st.listedHashes=await STORE.workspace();renderRecent();renderStats();}
async function processFile(file,{silent=false}={}){
 const hash=await STORE.fingerprint(file),started=performance.now();
 const data=await PDF.readFile(file,{ocrEnabled:$('prefOCR').checked,onProgress:(page,total,message)=>{
   if(!silent){notify(`${file.name}: ${message}`);setProgress(Math.round(page/total*95));}
 }});
 const extracted=ENG.extract(data.pages);
 // Persist only compact extraction, source locations and the original blob; never all PDF text geometry.
 const doc={hash,filename:file.name,size:file.size,blob:file,fmc_key:extracted.fmc_key,issuer:extracted.issuer,
  report_date:extracted.report_date,year:extracted.year,funds:extracted.funds,results:extracted.results,
  evidenceMap:extracted.evidenceMap,warnings:[...extracted.warnings,...data.notes],verified:false,
  extracted:Date.now(),updated:Date.now(),pages:data.pages.length,durationMs:Math.round(performance.now()-started)};
 return doc;
}
async function persist(doc){
 try{await STORE.put(doc);}catch(e){
  const original=doc.blob;delete doc.blob;
  try{await STORE.put(doc);doc.blob=original;notify('Results saved; PDF copy exceeded browser storage. Keep the original for Search/Re-scan.');}
  catch{doc.blob=original;throw e;}
 }
 await STORE.addToWorkspace(doc.hash);
}
async function runBatch(){
 if(st.processing||!st.queue.length){if(!st.queue.length)notify('Choose one or more PDF files first.');return;}
 st.processing=true;st.cancel=false;st.failed=0;$('extract').disabled=true;$('cancelBatch').disabled=false;
 try{
  for(let i=0;i<st.queue.length;i++){
   if(st.cancel)break;const file=st.queue[i];file._segStatus='Reading';renderBatch();setProgress(0);
   try{const doc=await processFile(file);await persist(doc);file._segStatus=`Completed · ${doc.funds.length} funds · ${doc.results.length} classes`;
    await reloadDocs();await activate(doc);notify(`Completed ${file.name}: ${doc.funds.length} funds, ${doc.results.length} classes.`);
   }catch(e){file._segStatus='Failed: '+e.message;st.failed++;console.error('Segregated extraction failed',file.name,e);notify(`${file.name}: ${e.message}`);}
   renderBatch();renderStats();setProgress(100);await sleep();
  }
 }finally{st.processing=false;$('extract').disabled=false;$('cancelBatch').disabled=true;renderStats();}
}
async function activate(doc){
 st.active=doc;st.filter='all';st.search='';st.page=0;$('fundSearch').value='';
 $('fundSelect').innerHTML='<option value="all">All funds</option>'+doc.funds.map((f,i)=>`<option value="${i}">${esc(f.name)}</option>`).join('');
 $('overview').classList.add('hidden');$('actions').classList.remove('hidden');
 $('docNotes').textContent=`${doc.issuer} · ${doc.report_date} · ${doc.verified?'Verified':'Unverified'} · ${doc.warnings?.length||0} extraction note(s). Blank metrics (—) mean undisclosed or printed as a dash, not zero. `+(doc.warnings?.length?'Notes: '+doc.warnings.slice(0,3).join(' | '):'');
 $('verify').textContent=doc.verified?'✓ Verified · Mark unverified':'Mark document as verified';
 $('pdfUnavailable').classList.add('hidden');renderGroups();showPage('extract');
 await VIEW.open(doc.blob||null,doc);
}
// Shared, FMC-independent PDF navigation used by both fund names and the dropdown.
// A fund-name click only opens its accordion and navigates; it does NOT filter the list.
function navigateToFund(index,section){
 if(!st.active||!Number.isInteger(index)||index<0||index>=st.active.funds.length)return;
 if(section)section.open=true;
 Promise.resolve(VIEW.focusFund(st.active.funds[index],st.active)).catch(e=>notify('Fund navigation failed: '+e.message));
}
// Only an explicit Fund selector change filters the grouped results.
function selectFund(value){
 if(!st.active)return;
 const isAll=value==='all',index=isAll?-1:Number(value);
 if(!isAll&&(!Number.isInteger(index)||index<0||index>=st.active.funds.length))return;
 st.filter=isAll?'all':String(index);st.page=0;
 $('fundSelect').value=st.filter;
 if(!isAll){st.search='';$('fundSearch').value='';}
 renderGroups();
 if(!isAll)navigateToFund(index,$('result').querySelector('button[data-fund-index="'+index+'"]')?.closest('details'));
}
function groupRows(){
 if(!st.active)return [];
 const text=st.search.toLowerCase().trim();
 return st.active.funds.map((fund,i)=>({...fund,idx:i,rows:st.active.results.filter(r=>r.fund_name===fund.name&&(!text||(r.fund_name+' '+r.class_name).toLowerCase().includes(text)))}))
 .filter(f=>(st.filter==='all'||String(f.idx)===st.filter)&&f.rows.length);
}
function renderGroups(){
 const doc=st.active,root=$('result');root.replaceChildren();
 $('exportSelected').disabled=!doc||st.filter==='all';$('exportDocument').disabled=!doc;
 if(!doc){$('overview').classList.remove('hidden');$('docNotes').textContent='';$('resultPager').classList.add('hidden');return;}
 const list=groupRows(),size=8,pages=Math.max(1,Math.ceil(list.length/size));st.page=Math.min(Math.max(0,st.page),pages-1);
 const chunk=list.slice(st.page*size,(st.page+1)*size);
 for(const f of chunk){const section=document.createElement('details');section.className='seg-group';section.open=st.filter!=='all'||list.length<5;
  const summary=document.createElement('summary');summary.innerHTML=`<button type="button" class="seg-fund-name" data-fund-index="${f.idx}" title="Select this fund and open its source in the PDF viewer">${esc(f.name)}</button><span class="seg-small">${f.rows.length} classes · PDF pp. ${f.startPage}–${f.endPage}</span>`;
  const wrap=document.createElement('div');wrap.className='scroller';
  const table=document.createElement('table');table.innerHTML='<thead><tr><th>Class / Series</th><th>MER (%)</th><th>TER (%)</th><th>PTR (%)</th><th>Reporting date</th><th>Source</th><th>Actions</th></tr></thead>';
  const body=document.createElement('tbody');for(const r of f.rows){const tr=document.createElement('tr');
   tr.innerHTML=`<td>${esc(r.class_name)}${r.originalValues?'<small class="seg-page"> · edited</small>':''}</td>${['MER','TER','PTR'].map(k=>`<td class="number ${r[k]===null?'seg-missing':''}" title="${esc(source(r,k))}">${fmt(r[k])}</td>`).join('')}<td>${esc(r.report_date)}</td><td><small class="seg-page">p. ${r.source_page||'—'}</small></td><td><span class="result-actions"><button class="ghost seg-btn locate" type="button" data-key="${esc(r.row_id)}" title="Find original PDF cells">⌕</button><button class="ghost seg-btn edit" type="button" data-key="${esc(r.row_id)}">Edit</button></span></td>`;
   body.appendChild(tr);
  }table.appendChild(body);wrap.appendChild(table);section.append(summary,wrap);root.appendChild(section);
 }
 if(!chunk.length)root.innerHTML='<div class="empty">No matching funds or classes.</div>';
 $('resultPager').classList.toggle('hidden',pages<2);$('groupPageLabel').textContent=`Funds page ${st.page+1} / ${pages} · ${list.length} matching funds`;
 $('prevGroup').disabled=st.page<=0;$('nextGroup').disabled=st.page>=pages-1;
}
function editRow(key){
 const row=rowOf(st.active,key);if(!row)return;st.editKey=key;$('editSubject').textContent=row.fund_name+' · '+row.class_name+' · '+row.report_date;
 for(const k of ['MER','TER','PTR'])$('edit'+k).value=row[k]===null?'':String(row[k]);$('editDialog').showModal();
}
async function saveEdit(){const row=rowOf(st.active,st.editKey);if(!row)return;
 const values={};for(const k of ['MER','TER','PTR']){
  const t=$('edit'+k).value.trim();if(t!==''&&!/^(?:\d+|\d*\.\d+)$/.test(t)){alert(`${k}: Enter a nonnegative decimal or leave blank.`);$('edit'+k).focus();return;}values[k]=t===''?null:Number(t);
 }
 const changes=['MER','TER','PTR'].some(k=>row[k]!==values[k]);if(changes){
  row.originalValues ||= Object.fromEntries(['MER','TER','PTR'].map(k=>[k,row[k]]));
  Object.assign(row,values);st.active.verified=false;await STORE.put(st.active);await reloadDocs();
  VIEW.updateDoc(st.active);$('verify').textContent='Mark document as verified';renderGroups();notify('Correction saved · verification reset. Source evidence remains the original PDF cell.');
 }$('editDialog').close();
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),20000);}
function exportDocs(docs,name){if(!docs.length){notify('No records available for that export.');return;}
 const format=$('exportFormat').value;const blob=EXP[format==='csv'?'csv':'excel'](docs);download(blob,name+'.'+(format==='csv'?'csv':'xlsx'));
}
function exportScope(scope){
 const doc=st.active,all=getListed();
 if(scope==='selected'){if(!doc||st.filter==='all')return;const f=doc.funds[Number(st.filter)];if(!f)return;
  exportDocs([{...doc,funds:[f],results:doc.results.filter(r=>r.fund_name===f.name)}],'segregated_selected_fund');}
 if(scope==='document'&&doc)exportDocs([doc],'segregated_current_document');
 if(scope==='listed')exportDocs(all,'segregated_listed_documents');
 if(scope==='saved')exportDocs(st.docs,'segregated_all_saved');
}
async function renderRecent(){const listed=getListed();$('history').replaceChildren();
 if(!listed.length){$('history').innerHTML='<p class="muted">No recent documents. Your extraction appears here after processing.</p>';return;}
 for(const doc of listed.slice(0,12)){
  const item=document.createElement('div');item.className='seg-batch-entry';
  item.innerHTML=`<span class="seg-batch-name"><b>${esc(doc.filename)}</b><br><small class="muted">${doc.funds?.length||0} funds · ${doc.results?.length||0} classes · ${doc.report_date||'—'} · ${doc.verified?'Verified':'Unverified'}</small></span><button type="button" class="ghost seg-btn" data-open="${esc(doc.hash)}">Open</button>`;
  $('history').appendChild(item);
 }
}
function filteredHistory(){const q=$('historySearch').value.toLowerCase().trim(),p=$('historyPeriod').value;
 return st.docs.filter(d=>(!q||(`${d.filename} ${d.issuer} ${(d.funds||[]).map(f=>f.name).join(' ')}`).toLowerCase().includes(q))&&(p==='all'||d.updated>Date.now()-Number(p)*86400000));}
function renderHistory(){const list=filteredHistory(),pageCount=Math.max(1,Math.ceil(list.length/st.historySize));st.historyPage=Math.min(st.historyPage,pageCount-1);
 $('historyRows').innerHTML=list.slice(st.historyPage*st.historySize,(st.historyPage+1)*st.historySize).map(d=>`<tr><td>${new Date(d.updated).toLocaleString()}</td><td>${esc(d.filename)}<small class="seg-page">${esc(d.issuer)}</small></td><td>${d.funds?.length||0}</td><td>${d.results?.length||0}</td><td>${esc(d.report_date||'—')}</td><td>${d.verified?'Verified':'Unverified'}</td><td class="history-actions"><button class="ghost seg-btn" type="button" data-open="${esc(d.hash)}">Restore</button><button class="ghost seg-btn" type="button" data-download="${esc(d.hash)}">Export</button><button class="ghost seg-btn" type="button" data-delete="${esc(d.hash)}">Delete</button></td></tr>`).join('')||'<tr><td colspan="7" class="empty-results">No matching saved PDFs.</td></tr>';
 $('historyTotal').textContent=list.length+' saved document(s)';$('historyPageNumber').textContent=(st.historyPage+1)+' of '+pageCount;
 $('historyPrevious').disabled=st.historyPage===0;$('historyNext').disabled=st.historyPage>=pageCount-1;
}
function renderReports(){const docs=st.docs,c=counts(docs);$('reportStats').innerHTML=[['completed','PDF documents'],['funds','Fund sections'],['classes','Class records'],['MER','MER populated'],['TER','TER populated'],['PTR','PTR populated'],['missing','Missing cells']].map(([k,v])=>`<div class="report-stat"><b>${c[k]}</b><small>${v}</small></div>`).join('');
 $('reportRows').innerHTML=docs.map(d=>{const c=counts([d]);return `<tr><td>${esc(d.filename)}</td><td>${c.funds}</td><td>${c.classes}</td><td>${c.MER}</td><td>${c.TER}</td><td>${c.PTR}</td><td>${c.missing}</td><td>${d.verified?'Yes':'No'}</td></tr>`;}).join('')||'<tr><td colspan="8">No saved documents.</td></tr>';
}
async function storageOverview(){$('storageOverview').textContent=`${st.docs.length} saved PDF records · ${st.docs.filter(d=>d.blob).length} local PDF copies · ${STORE.isTemporary()?'Temporary memory mode (IndexedDB unavailable)':'IndexedDB persistent browser storage'}.`}
function confirmAction(title,message,callback){st.confirmation=callback;$('confirmTitle').textContent=title;$('confirmMessage').textContent=message;$('confirmDialog').showModal();}
async function reScan(){
 const doc=st.active;if(!doc?.blob){notify('Original PDF not stored; re-upload the original to re-scan.');return;}
 $('rescan').disabled=true;notify('Re-scanning document…');
 try{const proposed=await processFile(doc.blob,{silent:true});st.rescanResult=proposed;
  const old=new Map(doc.results.map(r=>[r.row_id,r]));let changes=0;
  const diffs=proposed.results.filter(r=>{const prior=old.get(r.row_id);return !prior||['MER','TER','PTR'].some(k=>prior[k]!==r[k]);});changes=diffs.length;
  $('rescanSummary').textContent=`Existing: ${doc.funds.length} funds / ${doc.results.length} rows; Proposed: ${proposed.funds.length} funds / ${proposed.results.length} rows. ${changes} changed or new class rows. Replacement resets verification and manual corrections.`;
  $('rescanComparison').innerHTML='<table><thead><tr><th>Fund / class</th><th>Saved (MER / TER / PTR)</th><th>New (MER / TER / PTR)</th></tr></thead><tbody>'+diffs.slice(0,200).map(r=>{const o=old.get(r.row_id);return `<tr><td>${esc(r.fund_name)} · ${esc(r.class_name)}</td><td>${o?['MER','TER','PTR'].map(k=>fmt(o[k])).join(' / '):'Not present'}</td><td>${['MER','TER','PTR'].map(k=>fmt(r[k])).join(' / ')}</td></tr>`;}).join('')+'</tbody></table>';
  $('rescanDialog').showModal();
 }catch(e){notify('Re-scan failed: '+e.message);}finally{$('rescan').disabled=false;}
}
async function backup(){const json=JSON.stringify({format:'segregated-browser-v1',created:new Date().toISOString(),documents:st.docs.map(STORE.slim)},null,2);download(new Blob([json],{type:'application/json'}),'segregated_results_backup.json')}
async function importBackup(file){const raw=JSON.parse(await file.text());if(raw.format!=='segregated-browser-v1'||!Array.isArray(raw.documents))throw Error('Unsupported backup format');let count=0;
 const known=new Set(st.docs.map(d=>d.hash));for(const d of raw.documents){if(!d.hash||!Array.isArray(d.results)||known.has(d.hash))continue;
  const copy={...d,blob:undefined};await STORE.importDoc(copy);known.add(d.hash);count++;}
 await reloadDocs();notify('Imported '+count+' new saved documents (results only, no PDF copies).');
}
function bind(){
 for(const b of document.querySelectorAll('[data-page]'))b.addEventListener('click',()=>showPage(b.dataset.page));
 $('pdf').addEventListener('change',e=>pick(e.target.files));$('extract').addEventListener('click',runBatch);
 $('cancelBatch').addEventListener('click',()=>{st.cancel=true;notify('Cancellation requested: current PDF will finish safely.');});
 $('clearBatch').addEventListener('click',()=>pick([]));
 for(const e of ['dragenter','dragover'])$('uploadZone').addEventListener(e,ev=>{ev.preventDefault();ev.dataTransfer.dropEffect='copy';});
 $('uploadZone').addEventListener('drop',ev=>{ev.preventDefault();pick(ev.dataTransfer.files);});
 $('fundSelect').addEventListener('change',e=>selectFund(e.target.value));
 $('fundSearch').addEventListener('input',e=>{st.search=e.target.value;st.page=0;renderGroups();});
 $('prevGroup').addEventListener('click',()=>{st.page--;renderGroups();});$('nextGroup').addEventListener('click',()=>{st.page++;renderGroups();});
 $('result').addEventListener('click',e=>{
  const fundButton=e.target.closest('button[data-fund-index]');
  if(fundButton){
   // Don't trigger the native summary toggle or change the Fund selector filter.
   e.preventDefault();e.stopPropagation();
   navigateToFund(Number(fundButton.dataset.fundIndex),fundButton.closest('details.seg-group'));return;
  }
  const b=e.target.closest('button[data-key]');if(!b)return;const row=rowOf(st.active,b.dataset.key);if(!row)return;
  if(b.classList.contains('locate'))VIEW.focusRow(row);else if(b.classList.contains('edit'))editRow(b.dataset.key);});
 $('editClose').onclick=$('editCancel').onclick=()=>$('editDialog').close();
 $('editForm').addEventListener('submit',e=>{e.preventDefault();saveEdit().catch(err=>notify('Edit failed: '+err.message));});
 $('verify').addEventListener('click',async()=>{if(!st.active)return;st.active.verified=!st.active.verified;await STORE.put(st.active);await reloadDocs();$('verify').textContent=st.active.verified?'✓ Verified · Mark unverified':'Mark document as verified';$('docNotes').textContent=$('docNotes').textContent.replace(/Unverified|Verified/,st.active.verified?'Verified':'Unverified');notify('Verification status updated.');});
 $('rescan').addEventListener('click',reScan);$('rescanCancel').onclick=$('rescanClose').onclick=()=>$('rescanDialog').close();
 $('rescanReplace').addEventListener('click',async()=>{if(!st.active||!st.rescanResult)return;const old=st.active,proposed=st.rescanResult;
  Object.assign(old,proposed,{hash:old.hash,blob:old.blob,verified:false,extracted:Date.now()});await STORE.put(old);await reloadDocs();$('rescanDialog').close();await activate(old);notify('Re-scan replacement saved; verification reset.');});
 for(const type of ['Selected','Document','Listed','Saved'])$('export'+type).addEventListener('click',()=>exportScope(type.toLowerCase()));
 $('history').addEventListener('click',async e=>{const b=e.target.closest('[data-open]');if(!b)return;const doc=st.docs.find(d=>d.hash===b.dataset.open);if(doc)await activate(doc);});
 const doOpen=async hash=>{const doc=st.docs.find(d=>d.hash===hash);if(doc){await STORE.addToWorkspace(hash);await reloadDocs();await activate(doc);}};
 $('historyRows').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
  if(b.dataset.open)doOpen(b.dataset.open);
  if(b.dataset.download){const d=st.docs.find(x=>x.hash===b.dataset.download);if(d)exportDocs([d],'segregated_'+(d.report_date||'saved'));}
  if(b.dataset.delete){const d=st.docs.find(x=>x.hash===b.dataset.delete);confirmAction('Delete saved document?',`Remove ${d?.filename||'this PDF'} and all saved results, edits and any stored PDF copy?`,async()=>{await STORE.remove(b.dataset.delete);if(st.active?.hash===b.dataset.delete){st.active=null;VIEW.reset();renderGroups();$('actions').classList.add('hidden');}await reloadDocs();renderHistory();});}
 });
 $('historyRefresh').onclick=$('reloadHistory').onclick=()=>reloadDocs().then(renderHistory);$('viewAllHistory').onclick=()=>showPage('history');
 $('clearList').onclick=()=>confirmAction('Clear Recent Documents?', 'Clear recent list only; all saved document data remains in History.',async()=>{await STORE.clearWorkspace();await reloadDocs();});
 $('historySearch').addEventListener('input',()=>{st.historyPage=0;renderHistory();});$('historyPeriod').addEventListener('change',()=>{st.historyPage=0;renderHistory();});
 $('historyPageSize').addEventListener('change',e=>{st.historySize=Number(e.target.value);st.historyPage=0;renderHistory();});
 $('historyPrevious').addEventListener('click',()=>{st.historyPage--;renderHistory();});$('historyNext').addEventListener('click',()=>{st.historyPage++;renderHistory();});
 $('reportExport').onclick=()=>download(new Blob(['Document,Funds,Classes,MER,TER,PTR,Missing,Verified\r\n'+st.docs.map(d=>{let c=counts([d]);return [JSON.stringify(d.filename),c.funds,c.classes,c.MER,c.TER,c.PTR,c.missing,d.verified?'Yes':'No'].join(',');}).join('\r\n')],{type:'text/csv;charset=utf-8'}),'segregated_coverage.csv');
 $('prefTheme').addEventListener('change',e=>{document.documentElement.dataset.theme=e.target.value;try{localStorage.setItem('seg-theme',e.target.value);}catch{}});
 $('prefOCR').addEventListener('change',e=>{try{localStorage.setItem('seg-ocr',String(e.target.checked));}catch{}});
 $('backupHistory').onclick=backup;
 $('importHistory').addEventListener('change',async e=>{if(e.target.files[0])try{await importBackup(e.target.files[0]);}catch(err){notify('Import failed: '+err.message);}e.target.value='';});
 $('settingsClearPdfs').onclick=()=>confirmAction('Clear Stored PDFs?', 'Delete only local PDF copies; keep results, edits, and verification. PDF evidence Search/Re-scan will require re-upload.',async()=>{const c=await STORE.clearStoredPDFs();if(st.active)delete st.active.blob;await reloadDocs();if(st.active)await VIEW.open(null,st.active);await storageOverview();notify(`Deleted ${c} stored PDF copies.`);});
 $('settingsResetAll').onclick=()=>confirmAction('Reset All Saved Data?', 'Delete all segregated extractor records, stored PDFs, edits and verification. Original files on your computer are unaffected.',async()=>{await STORE.resetAllSavedData();st.active=null;st.queue=[];st.failed=0;VIEW.reset();renderGroups();$('actions').classList.add('hidden');renderBatch();await reloadDocs();await storageOverview();notify('Segregated extractor saved data reset.');});
 $('confirmClose').onclick=$('confirmCancel').onclick=()=>$('confirmDialog').close();
 $('confirmProceed').addEventListener('click',async()=>{const fn=st.confirmation;st.confirmation=null;$('confirmDialog').close();if(fn)try{await fn();}catch(e){notify('Action failed: '+e.message);}});
}
async function start(){bind();try{$('prefTheme').value=localStorage.getItem('seg-theme')||'light';$('prefOCR').checked=localStorage.getItem('seg-ocr')==='true';}catch{}
 document.documentElement.dataset.theme=$('prefTheme').value;
 try{await PDF.ensurePdf();$('libnotice').textContent='PDF.js ready · Offline local extraction · '+ENG.registry.length+' FMC adapter(s)';}catch(e){$('libnotice').textContent='Local PDF.js unavailable: '+e.message;}
 await reloadDocs();renderGroups();$('pdfUnavailable').classList.remove('hidden');}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>start().catch(e=>notify(e.message)));else start().catch(e=>notify(e.message));
})(globalThis);
