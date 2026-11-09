/* Multi-fund browser controller. No insurer-specific parsing or source heuristics. */
(function(global){'use strict';
const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STORE=global.MRFP_STORAGE,PDF=global.MRFP_PDF,ENG=global.SEGREGATED_ENGINE,VIEW=global.MRFP_EVIDENCE_VIEWER,EXP=global.MRFP_EXPORT,FILTER=global.MRFP_FILTER,FILTER_EXCEL=global.MRFP_FILTER_EXCEL;
const st={queue:[],queuePreviewFile:null,docs:[],active:null,filter:'all',search:'',page:0,historyPage:0,historySize:10,processing:false,cancel:false,failed:0,editKey:null,rescanResult:null,confirmation:null,neededFilter:{applied:false,input:'',entries:[],matches:[],matchedEntries:0,unmatchedEntries:[],idConflicts:0,docsSearched:0,previousActiveHash:null,source:null},filteredUpload:null,filteredUploadPage:1};
const EMPTY_OVERVIEW='<div class="emptyIcon">▤</div>Choose one or more segregated-fund PDFs and select <b>Extract</b>.<br><small>Each PDF remains a separate document; all funds and classes within it stay grouped.</small>'; 
const fmt=n=>n===null||n===undefined?'—':Number(n).toFixed(2);
const metricCell=(r,k)=>`${fmt(r[k])}${k==='MER'&&r.metricStatus?.MER==='estimated'&&r[k]!==null?'<small class="seg-estimated" title="Source document identifies this MER as an estimate">est.</small>':''}`;
const rowOf=(doc,key)=>doc?.results?.find(r=>r.row_id===key);
const source=(r,k)=>r.evidence?.[k]?.page?'PDF p. '+r.evidence[k].page:'No source coordinates';
const displayDate=value=>{const text=String(value??'').trim(),m=text.match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[2]}/${m[3]}/${m[1]}`:(text||'—');};
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
 const wasQueuePreview=!!st.queuePreviewFile;st.queuePreviewFile=null;
 const pdfs=[...files].filter(f=>f.type==='application/pdf'||/\.pdf$/i.test(f.name)).slice(0,5);
 st.queue=pdfs;st.failed=0;
 if(wasQueuePreview&&!st.active){VIEW.reset();$('pdfUnavailable').classList.remove('hidden');$('pdfUnavailable').textContent='No PDF selected — choose or open a saved document to preview.';renderGroups();}$('pdf').value='';$('filename').textContent=pdfs.length?pdfs.map(f=>f.name).join(', '):'Choose or drop PDFs to begin';
 $('batchCount').textContent=pdfs.length+' / 5 files selected';renderBatch();setProgress(0);renderStats();
}
function renderBatch(){
 const el=$('batchList');el.replaceChildren();if(!st.queue.length){el.innerHTML='<span class="muted">No files queued.</span>';return;}
 st.queue.forEach((f,index)=>{
  const status=f._segStatus||'Queued';
  const stateClass=status.startsWith('Completed')?'completed':status.startsWith('Failed')?'failed':status==='Reading'?'reading':'queued';
  const active=(!!st.active?.hash&&f._segHash===st.active.hash)||st.queuePreviewFile===f;
  const button=document.createElement('button');button.type='button';
  button.className='seg-batch-entry'+(active?' is-active':'');button.dataset.queueIndex=String(index);
  button.setAttribute('aria-pressed',String(active));button.disabled=st.processing;
  button.title=st.processing?'PDF preview switching is available after batch processing completes':'Open '+f.name+' in the PDF viewer';
  button.innerHTML=`<span class="seg-batch-file"><span class="seg-batch-type" aria-hidden="true">PDF</span><span class="seg-batch-name">${esc(f.name)}</span></span><span class="seg-batch-meta"><span class="seg-batch-size">${(f.size/1048576).toFixed(2)} MB</span><span class="seg-batch-status ${stateClass}">${esc(status)}</span><span class="seg-batch-view">View PDF ↗</span></span>`;
  el.appendChild(button);
 });
}
async function openQueuedPdf(index){
 const file=st.queue[index];if(!file)return;
 if(st.processing){notify('Wait until the current extraction batch finishes before switching PDF previews.');return;}
 let doc=null;
 if(file._segHash){doc=st.docs.find(d=>d.hash===file._segHash)||await STORE.get(file._segHash);}
 if(doc){
  // If the browser could save results but not the PDF blob, reuse the still-selected
  // original File object for viewing without re-extracting or duplicating storage.
  const viewDoc=doc.blob?doc:{...doc,blob:file};
  await activate(viewDoc);renderBatch();notify(`Viewing ${file.name} in the PDF viewer.`);return;
 }
 // A queued/failed PDF can still be previewed before successful extraction.
 // Keep prior document results out of view so their evidence cannot be confused
 // with this unextracted PDF.
 st.active=null;st.queuePreviewFile=file;st.filter='all';st.search='';st.page=0;$('fundSearch').value='';updateRemoveButton();
 $('fundSelect').innerHTML='<option value="all">All funds</option>';$('actions').classList.add('hidden');
 renderGroups();$('overview').innerHTML=`<div class="emptyIcon">▤</div><b>PDF preview only</b><br>${esc(file.name)}<br><small>This document has not been extracted yet. Select Extract to generate fund, class, and source-evidence results.</small>`;
 $('docNotes').textContent=`Preview only · ${file.name} · Not extracted`;
 showPage('extract');await VIEW.open(file,null);renderBatch();notify(`Previewing ${file.name}. Extract it to generate results and source evidence.`);
}
function counts(docs){
 const rows=docs.flatMap(d=>d.results||[]);return {
  completed:docs.length,funds:docs.reduce((n,d)=>n+(d.funds?.length||0),0),classes:rows.length,
  MER:rows.filter(r=>r.MER!==null).length,TER:rows.filter(r=>r.TER!==null).length,PTR:rows.filter(r=>r.PTR!==null).length,
  missing:rows.reduce((n,r)=>n+['MER','TER','PTR'].filter(k=>r[k]===null).length,0),failed:st.failed};
}
function renderStats(){const c=counts(getListed()),labels=[['completed','PDFs completed'],['funds','Funds detected'],['classes','Classes / Series'],['MER','MER values'],['TER','TER values'],['PTR','PTR values'],['missing','Missing cells'],['failed','Failed PDFs']];
 $('segStats').innerHTML=labels.map(([key,label])=>`<div class="seg-stat"${key==='TER'?' title="TER = Total Expense Ratio (not Trading Expense Ratio)"':''}><b>${c[key]}</b><small>${label}</small></div>`).join('');}
function updateRemoveButton(){
 const button=$('removeFromList');if(!button)return;
 const listed=!!st.active&&(st.listedHashes||[]).includes(st.active.hash);
 button.disabled=!listed;
 button.title=listed?'Remove the selected active document from Recent Documents only':'Open a document from Recent Documents to select it for removal';
}
function recomputeNeededFilter(){
 if(!st.neededFilter.applied)return;
 const docs=getListed(),result=FILTER.matchEntries(st.neededFilter.entries,docs);
 Object.assign(st.neededFilter,result,{docsSearched:docs.length});
}
async function reloadDocs(){st.docs=await STORE.all();st.listedHashes=await STORE.workspace();recomputeNeededFilter();renderRecent();renderStats();updateRemoveButton();if(st.neededFilter.applied)renderGroups();}
async function processFile(file,{silent=false}={}){
 const hash=await STORE.fingerprint(file),started=performance.now();file._segHash=hash;
 const data=await PDF.readFile(file,{ocrEnabled:$('prefOCR').checked,onProgress:(page,total,message)=>{
   if(!silent){notify(`${file.name}: ${message}`);setProgress(Math.round(page/total*95));}
 }});
 const extracted=ENG.extract(data.pages);
 // Persist only compact extraction, source locations and the original blob; never all PDF text geometry.
 const doc={hash,filename:file.name,size:file.size,blob:file,fmc_key:extracted.fmc_key,issuer:extracted.issuer,document_type:extracted.document_type||null,
  report_date:extracted.report_date,year:extracted.year,funds:extracted.funds,results:extracted.results,
  evidenceMap:extracted.evidenceMap,warnings:[...extracted.warnings,...data.notes],verified:false,
  terDefinition:STORE.TER_DEFINITION,
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
 }finally{st.processing=false;$('extract').disabled=false;$('cancelBatch').disabled=true;renderBatch();renderStats();}
}
async function activate(doc){
 st.active=doc;st.queuePreviewFile=null;st.filter='all';st.search='';st.page=0;$('fundSearch').value='';
 $('fundSelect').innerHTML='<option value="all">All funds</option>'+doc.funds.map((f,i)=>`<option value="${i}">${esc(f.name)}</option>`).join('');
 $('overview').classList.add('hidden');$('actions').classList.remove('hidden');
 $('docNotes').textContent=`${doc.issuer}${doc.document_type?' · '+doc.document_type:''} · ${doc.report_date} · ${doc.verified?'Verified':'Unverified'} · ${doc.warnings?.length||0} extraction/review note(s). Blank metrics (—) mean undisclosed or printed as a dash, not zero. `+(doc.warnings?.length?'Notes: '+doc.warnings.slice(0,3).join(' | '):'');
 $('verify').textContent=doc.verified?'✓ Verified · Mark unverified':'Mark document as verified';
 $('pdfUnavailable').classList.add('hidden');renderGroups();renderBatch();renderRecent();updateRemoveButton();showPage('extract');
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
function currentFilteredRecords(){
 return (st.neededFilter.matches||[]).map(match=>{
  const doc=st.docs.find(d=>d.hash===match.docHash),row=rowOf(doc,match.rowId);
  return doc&&row?{...match,doc,row}:null;
 }).filter(Boolean);
}
function renderFilteredGroups(){
 const root=$('result'),records=currentFilteredRecords();root.replaceChildren();
 $('overview').classList.add('hidden');$('resultPager').classList.add('hidden');
 $('fundSelect').disabled=true;$('fundSearch').disabled=true;
 $('exportSelected').disabled=!st.active||st.filter==='all';$('exportDocument').disabled=!st.active;
 $('exportFiltered').disabled=!records.length;$('clearNeededFilter').classList.remove('hidden');
 $('neededFilterSummary').classList.remove('hidden');
 const unmatched=st.neededFilter.unmatchedEntries||[];
 const unmatchedList=unmatched.length?`<section class="seg-filter-unmatched"><h3>Unmatched entries (${unmatched.length})</h3><p>These imported requests were not found among successfully extracted records in the PDFs currently listed in Recent Documents. They are retained here and are not treated as extracted results.</p><div class="seg-filter-unmatched-scroll"><table><thead><tr><th>Asset ID / Lipper ID</th><th>Fund Name</th><th>Status</th></tr></thead><tbody>${unmatched.map(e=>`<tr><td>${esc(e.id||'—')}</td><td>${esc(e.name||e.original||'Fund name missing')}</td><td>No matching extracted record</td></tr>`).join('')}</tbody></table></div></section>`:'';
 const conflictText=st.neededFilter.idConflicts?` · ${st.neededFilter.idConflicts} conflicting Lipper ID mapping(s) left blank`:'';
 const filterSource=st.neededFilter.source?.type==='excel'?`Uploaded: ${st.neededFilter.source.fileName||'workbook'} · ${st.neededFilter.source.sheetName||'worksheet'}`:'Manual pasted list';
 $('neededFilterSummary').innerHTML=`<div class="seg-filter-counts"><b>Matched entries: ${st.neededFilter.matchedEntries||0}</b><span>Displayed rows: ${records.length}</span><span>Unmatched entries: ${unmatched.length}</span><span>Recent Documents searched: ${st.neededFilter.docsSearched||0}</span>${conflictText?`<span class="seg-filter-warning">${esc(conflictText)}</span>`:''}</div><div class="seg-filter-source">${esc(filterSource)}</div>${unmatchedList}`;
 $('docNotes').textContent=`Data Needed Only · ${filterSource} · searched all successfully extracted fund/class records in ${st.neededFilter.docsSearched||0} PDF(s) currently listed in Recent Documents. Matching uses fund name and optional exact class/series. TER remains Total Expense Ratio only.`;
 if(!records.length){root.innerHTML='<div class="empty">No matching extracted funds or classes in the PDFs currently listed in Recent Documents.</div>';return;}

 // One flat, cross-document table keeps every matching row together. The source
 // document is carried on each row so Search/Edit always targets the right PDF.
 const wrap=document.createElement('div');
 wrap.className='seg-filter-results-wrap';
 wrap.setAttribute('role','region');
 wrap.setAttribute('aria-label','Filtered extraction results. Scroll horizontally to view the Actions column.');
 wrap.tabIndex=0;
 const table=document.createElement('table');
 table.className='seg-filter-results-table';
 table.innerHTML='<thead><tr><th>Source PDF</th><th>FMC</th><th>Class / Series and Fund</th><th>MER</th><th title="Total Expense Ratio only; never Trading Expense Ratio">TER</th><th>PTR</th><th>MRFP date</th><th class="seg-filter-actions-head">Actions</th></tr></thead>';
 const body=document.createElement('tbody');
 for(const item of records){
  const r=item.row,doc=item.doc,tr=document.createElement('tr');
  const sourcePdf=doc.filename||'—',issuer=doc.issuer||doc.fmc_name||'—';
  const fundName=r.fund_name||'—',className=r.class_name||'—';
  const rowDate=displayDate(r.report_date||doc.report_date);
  tr.innerHTML=`<td class="seg-filter-source-pdf" title="${esc(sourcePdf)}">${esc(sourcePdf)}</td><td class="seg-filter-fmc">${esc(issuer)}</td><td class="seg-filter-fund-cell"><div class="seg-filter-class-name">${esc(className)}${r.originalValues?'<small class="seg-page"> · edited</small>':''}</div><button type="button" class="seg-filter-fund-link" data-filter-fund-hash="${esc(doc.hash)}" data-filter-fund-name="${esc(fundName)}" title="Open this fund in its original source PDF">${esc(fundName)}</button></td>${['MER','TER','PTR'].map(k=>`<td class="number ${r[k]===null?'seg-missing':''}" title="${esc(source(r,k))}">${metricCell(r,k)}</td>`).join('')}<td class="seg-filter-date">${esc(rowDate)}</td><td class="seg-filter-actions"><span class="result-actions"><button class="ghost seg-btn locate" type="button" data-key="${esc(r.row_id)}" data-doc-hash="${esc(doc.hash)}" title="Open this source PDF and find original cells" aria-label="Search original PDF cells">⌕</button><button class="ghost seg-btn edit" type="button" data-key="${esc(r.row_id)}" data-doc-hash="${esc(doc.hash)}" title="Edit extracted values">Edit</button></span></td>`;
  body.appendChild(tr);
 }
 table.appendChild(body);wrap.appendChild(table);root.appendChild(wrap);
}
function renderGroups(){
 if(st.neededFilter.applied){renderFilteredGroups();return;}
 $('neededFilterSummary').classList.add('hidden');$('clearNeededFilter').classList.add('hidden');$('exportFiltered').disabled=true;
 $('fundSelect').disabled=false;$('fundSearch').disabled=false;
 const doc=st.active,root=$('result');root.replaceChildren();
 $('exportSelected').disabled=!doc||st.filter==='all';$('exportDocument').disabled=!doc;
 if(!doc){$('overview').classList.remove('hidden');if(!st.queuePreviewFile)$('overview').innerHTML=EMPTY_OVERVIEW;$('docNotes').textContent='';$('resultPager').classList.add('hidden');return;}
 const list=groupRows(),size=8,pages=Math.max(1,Math.ceil(list.length/size));st.page=Math.min(Math.max(0,st.page),pages-1);
 const chunk=list.slice(st.page*size,(st.page+1)*size);
 for(const f of chunk){const section=document.createElement('details');section.className='seg-group';section.open=st.filter!=='all'||list.length<5;
  const summary=document.createElement('summary');summary.innerHTML=`<button type="button" class="seg-fund-name" data-fund-index="${f.idx}" title="Select this fund and open its source in the PDF viewer">${esc(f.name)}</button><span class="seg-small">${f.rows.length} classes · PDF pp. ${f.startPage}–${f.endPage}</span>`;
  const wrap=document.createElement('div');wrap.className='scroller';
  const table=document.createElement('table');table.innerHTML='<thead><tr><th>Class / Series</th><th>MER (%)</th><th title="Total Expense Ratio only; never Trading Expense Ratio">TER (%)</th><th>PTR (%)</th><th>Reporting date</th><th>Source</th><th>Actions</th></tr></thead>';
  const body=document.createElement('tbody');for(const r of f.rows){const tr=document.createElement('tr');
   tr.innerHTML=`<td>${esc(r.class_name)}${r.originalValues?'<small class="seg-page"> · edited</small>':''}</td>${['MER','TER','PTR'].map(k=>`<td class="number ${r[k]===null?'seg-missing':''}" title="${esc(source(r,k))}">${metricCell(r,k)}</td>`).join('')}<td>${esc(r.report_date)}</td><td><small class="seg-page">p. ${r.source_page||'—'}</small></td><td><span class="result-actions"><button class="ghost seg-btn locate" type="button" data-key="${esc(r.row_id)}" title="Find original PDF cells">⌕</button><button class="ghost seg-btn edit" type="button" data-key="${esc(r.row_id)}">Edit</button></span></td>`;
   body.appendChild(tr);
  }table.appendChild(body);wrap.appendChild(table);section.append(summary,wrap);root.appendChild(section);
 }
 if(!chunk.length)root.innerHTML='<div class="empty">No matching funds or classes.</div>';
 $('resultPager').classList.toggle('hidden',pages<2);$('groupPageLabel').textContent=`Funds page ${st.page+1} / ${pages} · ${list.length} matching funds`;
 $('prevGroup').disabled=st.page<=0;$('nextGroup').disabled=st.page>=pages-1;
}
function applyNeededFilter(){
 const text=$('neededFilterInput').value,entries=FILTER.parseEntries(text);
 if(!entries.length){notify('Paste at least one fund entry before filtering.');return;}
 if(!st.neededFilter.applied)st.neededFilter.previousActiveHash=st.active?.hash||null;
 st.neededFilter.input=text;st.neededFilter.entries=entries;st.neededFilter.applied=true;st.neededFilter.source={type:'paste'};recomputeNeededFilter();
 $('neededFilterDialog').close();renderGroups();notify(`Data Needed Only applied: ${st.neededFilter.matchedEntries} matched entries, ${st.neededFilter.matches.length} displayed rows, ${st.neededFilter.unmatchedEntries.length} unmatched.`);
}
function uploadColumnPresence(sheet){
 const result={asset:false,fund:false};
 for(const row of (sheet?.rows||[]).slice(0,75)){
  for(const value of row.cells||[]){
   const kind=FILTER_EXCEL?.headerKind?.(value);
   if(kind==='asset')result.asset=true;
   if(kind==='fund')result.fund=true;
  }
  if(result.asset&&result.fund)break;
 }
 return result;
}
function renderFilteredUploadPreview(){
 const upload=st.filteredUpload;if(!upload)return;
 const sheet=upload.workbook.sheets[upload.selectedSheetIndex],analysis=sheet?.analysis||{valid:false,rowsRead:0,validRows:0,skipped:0,entries:[]};
 const found=uploadColumnPresence(sheet);
 $('filteredUploadFilename').textContent=`${upload.workbook.name} · ${sheet?.name||'No worksheet selected'}`;
 $('filteredUploadRowsRead').textContent=String(analysis.rowsRead||0);
 $('filteredUploadValidRows').textContent=String(analysis.validRows||0);
 $('filteredUploadSkippedRows').textContent=String(analysis.skipped||0);
 $('filteredUploadAssetStatus').textContent=`Asset ID · ${found.asset?'Found':'Not found'}`;
 $('filteredUploadFundStatus').textContent=`Fund Name · ${found.fund?'Found':'Not found'}`;
 $('filteredUploadAssetStatus').classList.toggle('is-found',found.asset);
 $('filteredUploadFundStatus').classList.toggle('is-found',found.fund);
 const error=$('filteredUploadError');
 if(!analysis.valid)error.textContent='The selected worksheet must contain both Asset ID (or Lipper ID) and Fund Name columns. Choose another worksheet or upload a corrected file.';
 else if(!analysis.validRows)error.textContent='Both required columns were found, but no usable Fund Name entries were detected.';
 else error.textContent='';
 error.classList.toggle('hidden',!error.textContent);
 const preview=$('filteredUploadPreview');preview.replaceChildren();
 const entries=analysis.entries||[],pageSize=10,totalPages=Math.max(1,Math.ceil(entries.length/pageSize));
 upload.page=Math.min(Math.max(1,Number(upload.page)||1),totalPages);
 const heading=$('filteredUploadPreviewHeading');
 if(heading){
  heading.innerHTML='';
  const label=document.createElement('strong');label.textContent='Sample imported entries';
  const pager=document.createElement('div');pager.className='filtered-upload-pager';pager.setAttribute('aria-label','Imported entry pages');
  const previous=document.createElement('button');previous.type='button';previous.className='filtered-upload-page-btn';previous.textContent='‹';previous.disabled=upload.page<=1;previous.setAttribute('aria-label','Previous page');
  const status=document.createElement('span');status.className='filtered-upload-page-status';status.textContent=`${upload.page} out of ${totalPages}`;
  const next=document.createElement('button');next.type='button';next.className='filtered-upload-page-btn';next.textContent='›';next.disabled=upload.page>=totalPages;next.setAttribute('aria-label','Next page');
  previous.addEventListener('click',()=>{if(upload.page>1){upload.page--;renderFilteredUploadPreview();}});
  next.addEventListener('click',()=>{if(upload.page<totalPages){upload.page++;renderFilteredUploadPreview();}});
  pager.append(previous,status,next);heading.append(label,pager);
 }
 if(analysis.valid&&entries.length){
  const table=document.createElement('table');table.innerHTML='<thead><tr><th>Asset ID / Lipper ID</th><th>Fund Name</th></tr></thead>';
  const body=document.createElement('tbody'),offset=(upload.page-1)*pageSize;
  for(const entry of entries.slice(offset,offset+pageSize)){
   const tr=document.createElement('tr'),id=document.createElement('td'),name=document.createElement('td');
   id.textContent=entry.lipperId||'—';name.textContent=entry.name;tr.append(id,name);body.appendChild(tr);
  }
  table.appendChild(body);preview.appendChild(table);
  const more=document.createElement('p');more.className='filtered-upload-more';more.textContent=`Showing ${offset+1}–${Math.min(offset+pageSize,entries.length)} of ${entries.length} valid entries.`;preview.appendChild(more);
 }else{
  const message=document.createElement('p');message.className='muted';message.textContent='No valid fund entries to preview.';preview.appendChild(message);
 }
 $('filteredUploadConfirm').disabled=!analysis.valid||!analysis.validRows;
}
async function readFilteredListFile(file){
 if(!file)return;
 try{
  if(!FILTER_EXCEL?.readWorkbook)throw Error('The local filter-excel.js reader is not loaded. Refresh the application or restore js/filter-excel.js.');
  notify(`Reading ${file.name} locally…`);
  const workbook=await FILTER_EXCEL.readWorkbook(file);
  const sheets=Array.isArray(workbook.sheets)?workbook.sheets:[];
  if(!sheets.length)throw Error('No readable worksheets were found in the uploaded file.');
  let selectedSheetIndex=sheets.findIndex(sheet=>sheet.analysis?.valid);
  if(selectedSheetIndex<0)selectedSheetIndex=0;
  st.filteredUpload={workbook,selectedSheetIndex,page:1};
  const select=$('filteredUploadSheet');select.replaceChildren();
  sheets.forEach((sheet,index)=>{
   const option=document.createElement('option');option.value=String(index);
   option.textContent=`${sheet.name}${sheet.analysis?.valid?` · ${sheet.analysis.validRows} valid entries`:' · required columns not found'}`;
   select.appendChild(option);
  });
  select.value=String(selectedSheetIndex);
  $('filteredUploadSheetWrap').classList.toggle('hidden',sheets.length<=1);
  renderFilteredUploadPreview();
  $('filteredUploadDialog').showModal();
  notify(`Read ${file.name}. Review the import summary before filtering.`);
 }catch(error){console.error('Filtered-list import failed',file.name,error);notify(`Could not read ${file.name}: ${error.message}`);}
 finally{$('filteredListFile').value='';}
}
function applyUploadedFilteredList(){
 const upload=st.filteredUpload;if(!upload)return;
 const sheet=upload.workbook.sheets[upload.selectedSheetIndex],analysis=sheet?.analysis;
 if(!analysis?.valid||!analysis.entries?.length){notify('Choose a worksheet with both required columns and at least one valid Fund Name.');return;}
 const entries=analysis.entries.map((entry,index)=>({
  id:String(entry.lipperId??'').trim(),
  name:String(entry.name??'').trim(),
  original:`${String(entry.lipperId??'').trim()}\t${String(entry.name??'').trim()}`,
  lineNumber:Number(entry.excelRow)||index+1,
  index
 })).filter(entry=>entry.name);
 if(!entries.length){notify('The selected worksheet contains no usable Fund Name entries.');return;}
 if(!st.neededFilter.applied)st.neededFilter.previousActiveHash=st.active?.hash||null;
 st.neededFilter.entries=entries;st.neededFilter.applied=true;
 st.neededFilter.source={type:'excel',fileName:upload.workbook.name,sheetName:sheet.name};
 recomputeNeededFilter();$('filteredUploadDialog').close();st.filteredUpload=null;
 renderGroups();
 notify(`Uploaded list applied: ${st.neededFilter.matchedEntries} matched entries, ${st.neededFilter.matches.length} displayed rows, ${st.neededFilter.unmatchedEntries.length} unmatched.`);
}
async function clearNeededFilter(){
 const previousHash=st.neededFilter.previousActiveHash;
 const restore=st.docs.find(d=>d.hash===previousHash)||st.active||getListed()[0]||null;
 Object.assign(st.neededFilter,{applied:false,matches:[],matchedEntries:0,unmatchedEntries:[],idConflicts:0,docsSearched:0,previousActiveHash:null,source:null});
 $('neededFilterSummary').classList.add('hidden');$('clearNeededFilter').classList.add('hidden');$('exportFiltered').disabled=true;
 if(restore)await activate(restore);
 else{st.active=null;VIEW.reset();$('pdfUnavailable').classList.remove('hidden');$('pdfUnavailable').textContent='No document selected.';$('actions').classList.add('hidden');renderGroups();updateRemoveButton();}
 notify('Data Needed Only filter cleared. Original extraction results restored without re-scanning.');
}
function filteredExportRecords(){
 return (st.neededFilter.matches||[]).map(match=>{const doc=st.docs.find(d=>d.hash===match.docHash),row=rowOf(doc,match.rowId);return doc&&row?{doc,row,lipperId:match.idConflict?'':match.lipperId}:null;}).filter(Boolean);
}
function exportFiltered(){
 const records=filteredExportRecords();if(!records.length){notify('No matching rows to export.');return;}
 download(EXP.filteredCsv(records),'segregated_data_needed_filtered.csv');
 notify(`Exported ${records.length} filtered row(s) to CSV.`);
}
function documentFundLabel(doc){
 if(st.filter!=='all'){
  const selected=doc.funds?.[Number(st.filter)];if(selected?.name)return selected.name;
 }
 const names=[...new Set((doc.funds||[]).map(f=>f.name).filter(Boolean))];
 if(names.length===1)return names[0];
 if(names.length>1)return `${names.length} funds: ${names.slice(0,2).join(' · ')}${names.length>2?` + ${names.length-2} more`:''}`;
 return doc.issuer||'Unnamed document';
}
function removeActiveFromList(){
 const doc=st.active;if(!doc||(st.listedHashes||[]).indexOf(doc.hash)<0){notify('Open a document from Recent Documents first to select which entry to remove.');return;}
 const message=`Document/Fund name: ${documentFundLabel(doc)}\nOriginal PDF filename: ${doc.filename}\n\nRemove only this PDF from Recent Documents? The original PDF, extracted results, edits, verification, and History will be preserved.`;
 confirmAction('Remove from Recent Documents?',message,async()=>{
  const removed=await STORE.removeFromWorkspace(doc.hash);await reloadDocs();
  notify(removed?'Removed from Recent Documents. Saved results and History were preserved.':'This document was no longer in Recent Documents.');
 },'Remove from List');
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
  Object.assign(row,values);if(values.MER!==row.originalValues?.MER&&row.originalValues?.MER!==undefined){row.metricStatus ||= {};row.metricStatus.MER='manual';}st.active.verified=false;await STORE.put(st.active);await reloadDocs();
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
 if(!listed.length){$('history').innerHTML='<p class="muted">No recent documents. Your extraction appears here after processing.</p>';updateRemoveButton();return;}
 for(const doc of listed.slice(0,12)){
  const item=document.createElement('div');item.className='seg-batch-entry seg-recent-entry'+(st.active?.hash===doc.hash?' is-selected':'');
  item.innerHTML=`<span class="seg-batch-name"><b>${esc(doc.filename)}</b><br><small class="muted">${doc.funds?.length||0} funds · ${doc.results?.length||0} classes · ${doc.report_date||'—'} · ${doc.verified?'Verified':'Unverified'}</small></span><button type="button" class="ghost seg-btn" data-open="${esc(doc.hash)}" aria-current="${st.active?.hash===doc.hash?'true':'false'}">Open</button>`;
  $('history').appendChild(item);
 }
 updateRemoveButton();
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
function confirmAction(title,message,callback,proceedLabel='Confirm'){st.confirmation=callback;$('confirmTitle').textContent=title;$('confirmMessage').textContent=message;$('confirmProceed').textContent=proceedLabel;$('confirmDialog').showModal();}
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
 const known=new Set(st.docs.map(d=>d.hash));let rechecked=0;for(const d of raw.documents){if(!d.hash||!Array.isArray(d.results)||known.has(d.hash))continue;
  const copy={...d,blob:undefined};await STORE.importDoc(copy);if(copy.results.some(r=>r.legacyTER))rechecked++;known.add(d.hash);count++;}
 await reloadDocs();notify('Imported '+count+' new saved documents (results only, no PDF copies).'+(rechecked?' '+rechecked+' document(s) had legacy TER evidence cleared pending review.':''));
}
async function activateFilteredDocument(doc){
 if(st.active?.hash!==doc.hash)await activate(doc);
 else{st.active=doc;VIEW.updateDoc(doc);renderRecent();updateRemoveButton();}
}
async function handleFilteredRowAction(docHash,rowId,action){
 const doc=st.docs.find(d=>d.hash===docHash);if(!doc){notify('The source document is no longer available in saved History.');return;}
 const row=rowOf(doc,rowId);if(!row){notify('The matching class row is no longer available.');return;}
 await activateFilteredDocument(doc);
 if(action==='locate')await VIEW.focusRow(row);else editRow(rowId);
}
async function openFilteredFund(docHash,fundName){
 const doc=st.docs.find(d=>d.hash===docHash);if(!doc){notify('The source document is no longer available.');return;}
 await activateFilteredDocument(doc);
 const fund=(doc.funds||[]).find(f=>f.name===fundName);
 if(fund)await VIEW.focusFund(fund,doc);
 else{const row=doc.results?.find(r=>r.fund_name===fundName);if(row)await VIEW.focusRow(row);}
}
function bind(){
 for(const b of document.querySelectorAll('[data-page]'))b.addEventListener('click',()=>showPage(b.dataset.page));
 $('pdf').addEventListener('change',e=>pick(e.target.files));$('extract').addEventListener('click',runBatch);
 $('cancelBatch').addEventListener('click',()=>{st.cancel=true;notify('Cancellation requested: current PDF will finish safely.');});
 $('clearBatch').addEventListener('click',()=>pick([]));
 $('batchList').addEventListener('click',e=>{const b=e.target.closest('button[data-queue-index]');if(!b)return;openQueuedPdf(Number(b.dataset.queueIndex)).catch(err=>notify('Could not open selected PDF: '+err.message));});
 $('filterNeededBtn').addEventListener('click',()=>{$('neededFilterInput').value=st.neededFilter.input||'';$('neededFilterDialog').showModal();});
  $('uploadFilteredBtn').addEventListener('click',()=>{$('filteredListFile').click();});
  $('filteredListFile').addEventListener('change',e=>readFilteredListFile(e.target.files?.[0]));
  $('filteredUploadSheet').addEventListener('change',e=>{if(st.filteredUpload){st.filteredUpload.selectedSheetIndex=Number(e.target.value);st.filteredUpload.page=1;renderFilteredUploadPreview();}});
  $('filteredUploadConfirm').addEventListener('click',applyUploadedFilteredList);
  const closeFilteredUpload=()=>{st.filteredUpload=null;if($('filteredUploadDialog').open)$('filteredUploadDialog').close();};
  $('filteredUploadClose').addEventListener('click',closeFilteredUpload);
  $('filteredUploadCancel').addEventListener('click',closeFilteredUpload);
  $('filteredUploadDialog').addEventListener('close',()=>{st.filteredUpload=null;});

 $('neededFilterInput').addEventListener('input',e=>{st.neededFilter.input=e.target.value;});
 $('neededFilterApply').addEventListener('click',applyNeededFilter);
 $('neededFilterClearList').addEventListener('click',()=>{$('neededFilterInput').value='';st.neededFilter.input='';notify('Pasted list cleared. Use Clear Filter to restore the original extraction results.');});
 $('neededFilterClose').onclick=$('neededFilterCloseBottom').onclick=()=>$('neededFilterDialog').close();
 $('clearNeededFilter').addEventListener('click',()=>clearNeededFilter().catch(err=>notify('Could not clear filter: '+err.message)));
 $('exportFiltered').addEventListener('click',exportFiltered);
 $('removeFromList').addEventListener('click',removeActiveFromList);
 for(const e of ['dragenter','dragover'])$('uploadZone').addEventListener(e,ev=>{ev.preventDefault();ev.dataTransfer.dropEffect='copy';});
 $('uploadZone').addEventListener('drop',ev=>{ev.preventDefault();pick(ev.dataTransfer.files);});
 $('fundSelect').addEventListener('change',e=>selectFund(e.target.value));
 $('fundSearch').addEventListener('input',e=>{st.search=e.target.value;st.page=0;renderGroups();});
 $('prevGroup').addEventListener('click',()=>{st.page--;renderGroups();});$('nextGroup').addEventListener('click',()=>{st.page++;renderGroups();});
 $('result').addEventListener('click',e=>{
  const filteredFund=e.target.closest('button[data-filter-fund-hash]');
  if(filteredFund){e.preventDefault();e.stopPropagation();openFilteredFund(filteredFund.dataset.filterFundHash,filteredFund.dataset.filterFundName).catch(err=>notify('Fund navigation failed: '+err.message));return;}
  const fundButton=e.target.closest('button[data-fund-index]');
  if(fundButton){e.preventDefault();e.stopPropagation();navigateToFund(Number(fundButton.dataset.fundIndex),fundButton.closest('details'));return;}
  const b=e.target.closest('button[data-key]');if(!b)return;
  if(b.dataset.docHash){handleFilteredRowAction(b.dataset.docHash,b.dataset.key,b.classList.contains('locate')?'locate':'edit').catch(err=>notify('Could not open filtered source: '+err.message));return;}
  const row=rowOf(st.active,b.dataset.key);if(!row)return;
  if(b.classList.contains('locate'))VIEW.focusRow(row);else if(b.classList.contains('edit'))editRow(b.dataset.key);
 });
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
 const closeConfirmation=()=>{st.confirmation=null;$('confirmProceed').textContent='Confirm';$('confirmDialog').close();};
 $('confirmDialog').addEventListener('close',()=>{st.confirmation=null;$('confirmProceed').textContent='Confirm';});
 $('confirmClose').onclick=$('confirmCancel').onclick=closeConfirmation;
 $('confirmProceed').addEventListener('click',async()=>{const fn=st.confirmation;st.confirmation=null;$('confirmProceed').textContent='Confirm';$('confirmDialog').close();if(fn)try{await fn();}catch(e){notify('Action failed: '+e.message);}});
}
async function start(){bind();try{$('prefTheme').value=localStorage.getItem('seg-theme')||'light';$('prefOCR').checked=localStorage.getItem('seg-ocr')==='true';}catch{}
 document.documentElement.dataset.theme=$('prefTheme').value;
 try{await PDF.ensurePdf();$('libnotice').textContent='PDF.js ready · Offline local extraction · '+ENG.registry.length+' FMC adapter(s)';}catch(e){$('libnotice').textContent='Local PDF.js unavailable: '+e.message;}
 await reloadDocs();renderGroups();$('pdfUnavailable').classList.remove('hidden');}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>start().catch(e=>notify(e.message)));else start().catch(e=>notify(e.message));
})(globalThis);
