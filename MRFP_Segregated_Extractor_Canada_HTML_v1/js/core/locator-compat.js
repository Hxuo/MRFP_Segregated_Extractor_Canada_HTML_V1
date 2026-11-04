/* Evidence-viewer-compatible contract. Coordinates originate only from adapter-verified cells. */
(function(global){'use strict';
const LOCATOR_VERSION=1;
const metrics=['MER','TER','PTR'];
function rowKey(r){return r.row_id||r.class_name;}
function needsRefresh(row,rec){
 if(!rec)return true;
 if(rec.fund!==row.fund_name||rec.className!==row.class_name||rec.reportDate!==row.report_date)return true;
 // Manual edits preserve original PDF source: do not invalidate physically verified cells.
 return false;
}
function emptyRecord(row){return {fund:row.fund_name,className:row.class_name,reportDate:row.report_date,pages:[],metrics:{}};}
function locate(pages,rows){
 // History revalidation runs the complete registered issuer parser; never search by matching value alone.
 const result=global.SEGREGATED_ENGINE.extract(pages);
 const found=new Map((result.results||[]).map(r=>[rowKey(r),r]));
 const map={rows:{}};
 for(const row of rows){let source=found.get(rowKey(row));map.rows[rowKey(row)]=source?
  (result.evidenceMap?.rows?.[rowKey(source)]||emptyRecord(row)):emptyRecord(row);}
 return map;
}
function initialPage(doc){
 for(const r of doc?.results||[]){let entry=doc.evidenceMap?.rows?.[rowKey(r)];if(entry?.pages?.length)return entry.pages[0];}
 return doc?.funds?.[0]?.startPage||1;
}
global.MRFP_EVIDENCE={LOCATOR_VERSION,needsRefresh,emptyRecord,locate,initialPage};
})(globalThis);
