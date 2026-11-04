/* One pass: create searchable page descriptors; keeps source PDF.js items in RAM only for extraction. */
function indexDocument(pages){
 return pages.map(p=>({page:p.page,text:p.text||'',lines:p.lines||[],items:p.items||[],
  header:(p.lines||[]).slice(0,8).join(' '),ocrUsed:!!p.ocrUsed,width:p.width||0}));
}
