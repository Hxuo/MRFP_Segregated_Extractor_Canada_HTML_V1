/* Cross-issuer financial semantics. "TER" always means TOTAL Expense Ratio,
   never Trading Expense Ratio. Issuer adapters establish actual table columns. */
function validTotalExpenseEvidence(hit,index,value){
 if(!hit || !Number.isInteger(hit.page) || hit.page<1 || !hit.box ||
  ![hit.box.x,hit.box.y,hit.box.w,hit.box.h].every(Number.isFinite) ||
  hit.box.w<=0 || hit.box.h<=0)return false;
 if(/trading[\s-]*expense/i.test(String(hit.kind||'')))return false;
 const heading=UTIL.clean(hit.headingText);
 // A bare "TER" abbreviation is ambiguous; only an explicit expanded heading qualifies.
 if(!/^total expense ratio(?:\s*(?:\([^)]*\)|%|:))*$/i.test(heading))return false;
 const page=index.find(p=>p.page===hit.page);
 if(!page || !UTIL.clean((page.lines||[]).join(' ')+' '+(page.text||'')).toLowerCase()
   .includes('total expense ratio'))return false;
 const printed=UTIL.readMetric(hit.sourceText??hit.source);
 if(value===null)return printed===null && hit.isMissing===true &&
   /^(?:[-–—−]|n\/a|na|nil|not available)$/i.test(String(hit.sourceText??hit.source??'').trim());
 return printed===value && hit.isMissing!==true;
}
function enforceTotalExpenseRatio(out,index){
 out.warnings ||= [];
 for(const row of out.results){
  const hit=row.evidence?.TER;
  if((row.TER===null || row.TER===undefined) && !hit){row.TER=null;continue;}
  if(!validTotalExpenseEvidence(hit,index,row.TER)){
   const value=row.TER;
   row.TER=null;
   if(row.evidence)row.evidence.TER=null;
   if(value!==null || hit)out.warnings.push(`${row.fund_name} / ${row.class_name}: TER omitted — no validated Total Expense Ratio source cell/heading (Trading Expense Ratio is not TER).`);
  }
 }
}
function extractSegregated(pages){
 const index=indexDocument(pages),matched=REGISTRY.filter(a=>a.detect(index));
 if(matched.length!==1)throw Error(matched.length?'Ambiguous issuer: '+matched.map(a=>a.key).join(', '):'Unsupported issuer/layout. No values guessed.');
 const adapter=matched[0];const out=adapter.extract(index);
 if(!out?.results?.length)throw Error('No validated fund classes extracted.');
 // Validate meaning + source provenance before generating the evidence index.
 enforceTotalExpenseRatio(out,index);
 for(const row of out.results){row.fmc_key=adapter.key;row.issuer=out.issuer||adapter.name;
  for(const k of UTIL.metricKeys)if(!Number.isFinite(row[k]))row[k]=null;}
 return {...out,fmc_key:adapter.key,evidenceMap:sourceEvidence(out.results)};
}
