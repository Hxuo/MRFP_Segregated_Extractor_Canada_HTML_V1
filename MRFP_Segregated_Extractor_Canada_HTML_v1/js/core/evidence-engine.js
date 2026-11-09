const EVIDENCE_VERSION=1;
function sourceEvidence(rows){
 const map={version:EVIDENCE_VERSION,rows:{}};
 for(const row of rows){
  const metrics={};
  for(const name of UTIL.metricKeys){
   const hit=row.evidence?.[name];
   if(hit?.page&&hit?.box)metrics[name]={page:hit.page,box:hit.box,sourceText:hit.sourceText??hit.source??null,
     isMissing:hit.isMissing===true,metric:name,value:row[name],kind:hit.kind||'validated-cell',scope:hit.scope||'class-level',estimated:hit.estimated===true,
     ...(name==='TER'?{headingText:hit.headingText||null}:{} )};
  }
  map.rows[row.row_id]={fund:row.fund_name,className:row.class_name,reportDate:row.report_date,
   values:Object.fromEntries(UTIL.metricKeys.map(m=>[m,row[m]])),pages:[...new Set(Object.values(metrics).map(e=>e.page))],metrics};
 }
 return map;
}
