/* Generic Data Needed Only matching. FMC-independent; never changes extracted PDF rows. */
(function(global){
'use strict';
function normalize(value){
 return String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  .replace(/\b([a-z])\s*\.\s*([a-z])\.?/g,'$1$2') // U.S. and US. mean the same thing.
  .replace(/[‐‑‒–—]/g,'-').replace(/&/g,' and ')
  .replace(/[^a-z0-9\/-]+/g,' ').replace(/\s*-\s*/g,'-')
  .replace(/\s*\/\s*/g,'/').replace(/\s+/g,' ').trim();
}
function parseLine(line,lineNumber,index){
 const original=String(line??'').trim();if(!original)return null;
 let id='',name=original,m;
 m=original.match(/^(\d+)\t+(.+)$/);
 if(!m)m=original.match(/^(\d{4,}) {2,}(.+)$/);
 if(!m)m=original.match(/^(\d{5,})\s+(.+)$/);
 if(m){id=m[1];name=m[2].trim();}
 else if(/^\d+$/.test(original)){id=original;name='';}
 return {id,name,original,lineNumber,index};
}
function parseEntries(text){return String(text??'').split(/\r?\n/).map((line,i)=>parseLine(line,i+1,i)).filter(Boolean);}
function canonicalSuffix(value){return normalize(value).replace(/([a-z])-(?=\d)/g,'$1');}
function classDescriptor(value){
 const n=normalize(value);let m;
 if((m=n.match(/^series\s+(.+)$/)))return {kind:'series',suffix:canonicalSuffix(m[1])};
 if((m=n.match(/^(.+?)\s+series$/)))return {kind:'series',suffix:canonicalSuffix(m[1])};
 if((m=n.match(/^(.+?)-series$/)))return {kind:'series',suffix:canonicalSuffix(m[1])};
 if((m=n.match(/^class\s+(.+)$/)))return {kind:'class',suffix:canonicalSuffix(m[1])};
 if((m=n.match(/^(.+?)\s+class$/)))return {kind:'class',suffix:canonicalSuffix(m[1])};
 if((m=n.match(/^(.+?)-class$/)))return {kind:'class',suffix:canonicalSuffix(m[1])};
 if(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)?$/.test(n))return {kind:'any',suffix:canonicalSuffix(n)};
 return {kind:'other',value:n};
}
function canonicalClass(value){const d=classDescriptor(value);return d.kind==='other'?d.value:d.kind+' '+d.suffix;}
function classParts(value){
 const raw=String(value??'').trim();if(!raw)return [];
 const markers=raw.match(/(?:series|class)\s+[a-z0-9]+(?:-[a-z0-9]+)?(?:\/[a-z0-9]+)?/gi)||[];
 const hasCombinedSeparator=/,|;|\s+and\s+|\s*&\s*|\s+\/\s+/i.test(raw);
 if(markers.length<2&&!hasCombinedSeparator)return [raw];
 const parts=raw.split(/\s*(?:,|;|\s+and\s+|\s*&\s*|\s+\/\s+)\s*/i).map(x=>x.trim()).filter(Boolean);
 const out=[...parts],firstDescriptor=classDescriptor(parts[0]||'');
 const inheritedType=['series','class'].includes(firstDescriptor.kind)?firstDescriptor.kind:null;
 if(inheritedType)for(const part of parts.slice(1))if(!['series','class'].includes(classDescriptor(part).kind))out.push(inheritedType+' '+part);
 for(const part of parts){
  const embedded=part.match(/(?:series|class)\s+[a-z0-9]+(?:-[a-z0-9]+)?(?:\/[a-z0-9]+)?/gi)||[];
  if(embedded.length>1)out.push(...embedded);
 }
 return [...new Set(out)];
}
/* BMO-like guarantee matrices publish a *combination*, not independent labels.
   Treat Class A Prestige as a distinct class; only an explicit Class A request
   expands to A Prestige, and only for the very same guarantee series. */
function classSeries(value){
 const n=normalize(value);
 let m=n.match(/^class\s+([a-z][a-z0-9-]*(?:\s+prestige)?)\s+(?:series\s+)?(\d+\/\d+)$/);
 if(!m)m=n.match(/^([a-z][a-z0-9-]*(?:\s+prestige)?)\s+series\s+(\d+\/\d+)$/);
 return m?{className:canonicalSuffix(m[1]),series:m[2]}:null;
}
function rowClassSeries(value){
 const m=normalize(value).match(/^class\s+([a-z][a-z0-9-]*(?:\s+prestige)?)\s+series\s+(\d+\/\d+)$/);
 return m?{className:canonicalSuffix(m[1]),series:m[2]}:null;
}
function sameClassOrRequestedPrestige(query,candidate){
 return query===candidate||(query==='a'&&candidate==='a prestige');
}
function classMatchKinds(queryClass,rowClass){
 const combination=classSeries(queryClass),rowCombination=rowClassSeries(rowClass);
 if(combination){
  return rowCombination&&combination.series===rowCombination.series&&
   sameClassOrRequestedPrestige(combination.className,rowCombination.className)?['class-series']:[];
 }
 const query=classDescriptor(queryClass);
 if(rowCombination){
  if(query.kind==='class')return sameClassOrRequestedPrestige(query.suffix,rowCombination.className)?['class']:[];
  if(query.kind==='series')return query.suffix===rowCombination.series?['series']:[];
  if(query.kind==='any'){
   const kinds=[];
   if(query.suffix===rowCombination.className)kinds.push('class');
   if(query.suffix===rowCombination.series)kinds.push('series');
   return kinds;
  }
  return canonicalClass(rowClass)===query.value?['other']:[];
 }
 const parts=classParts(rowClass);
 if(query.kind==='other')return parts.some(part=>canonicalClass(part)===query.value)||canonicalClass(rowClass)===query.value?['other']:[];
 const kinds=[];
 for(const part of parts){
  const candidate=classDescriptor(part);
  if(candidate.suffix!==query.suffix)continue;
  if(query.kind==='any'&&['class','series'].includes(candidate.kind))kinds.push(candidate.kind);
  else if(candidate.kind===query.kind)kinds.push(candidate.kind);
 }
 return [...new Set(kinds)];
}
function classMatches(queryClass,rowClass){return classMatchKinds(queryClass,rowClass).length>0;}
/* Split the *last* class/series qualifier only after a full published fund-name
   match has failed. This permits a safely truncated fund prefix while keeping
   its original class/guarantee restrictions. */
function trailingQualifier(query){
 const patterns=[
  /^(.*?)\s+(class\s+[a-z][a-z0-9-]*(?:\s+prestige)?(?:\s+series)?\s+\d+\/\d+)$/,
  /^(.*?)\s+([a-z][a-z0-9-]*(?:\s+prestige)?\s+series\s+\d+\/\d+)$/,
  /^(.*?)\s+(series\s+[a-z0-9]+(?:-[a-z0-9]+)?(?:\/[a-z0-9]+)?)$/,
  /^(.*?)\s+([a-z0-9-]+\s+series)$/,
  /^(.*?)\s+(class\s+[a-z][a-z0-9-]*(?:\s+prestige)?)$/,
  /^(.*?)\s+([a-z]{1,2}\d{0,2}(?:-\d{1,2})?)$/
 ];
 for(const pattern of patterns){
  const m=query.match(pattern);
  if(m&&m[1]&&m[2])return {fundQuery:m[1],classQuery:m[2]};
 }
 return {fundQuery:query,classQuery:null};
}
function fundMatchForEntry(entry,fundNames){
 const query=normalize(entry.name);if(!query)return null;
 const byKey=new Map();
 for(const name of (fundNames||[]).filter(Boolean)){
  const key=normalize(name);if(!byKey.has(key))byKey.set(key,new Set());byKey.get(key).add(String(name).trim());
 }
 const candidates=[...byKey.entries()].map(([key,names])=>({key,names:[...names]}));
 const full=candidates.filter(x=>query===x.key||query.startsWith(x.key+' ')).sort((a,b)=>b.key.length-a.key.length);
 if(full.length){
  const best=full[0];
  if(best.names.length!==1)return {ambiguous:true,fundKey:best.key};
  return {fundName:best.names[0],fundKey:best.key,classQuery:query.slice(best.key.length).trim()||null,ambiguous:false};
 }
 const {fundQuery,classQuery}=trailingQualifier(query);
 // No loose substring/fuzzy matching. Require a meaningful, unique *leading*
 // prefix of a published fund name; incomplete/ambiguous prefixes stay unmatched.
 if(fundQuery.length<12||fundQuery.split(' ').length<2)return null;
 const prefixes=candidates.filter(x=>x.key.startsWith(fundQuery)&&x.key!==fundQuery);
 if(prefixes.length!==1)return prefixes.length>1?{ambiguous:true,fundKey:fundQuery}:null;
 const best=prefixes[0];
 if(best.names.length!==1)return {ambiguous:true,fundKey:best.key};
 return {fundName:best.names[0],fundKey:best.key,classQuery,ambiguous:false,truncated:true};
}
function matchEntries(entries,documents){
 const matchesByRow=new Map(),matchedIndexes=new Set();
 const allNames=[...new Set((documents||[]).flatMap(doc=>(doc.results||[]).map(r=>r.fund_name).filter(Boolean)))];
 for(const entry of entries||[]){
  if(!entry.name)continue;
  const found=fundMatchForEntry(entry,allNames);if(!found||found.ambiguous)continue;
  let entryMatched=false;
  for(const doc of documents||[]){
   const rows=Array.isArray(doc.results)?doc.results:[];
   const docRows=rows.filter(r=>normalize(r.fund_name)===found.fundKey);
   if(!docRows.length)continue;
   let selected=docRows;
   if(found.classQuery){
    const queryDescriptor=classDescriptor(found.classQuery);
    const candidates=docRows.map(row=>({row,kinds:classMatchKinds(found.classQuery,row.class_name)})).filter(x=>x.kinds.length);
    if(queryDescriptor.kind==='any'){
     const matchedKinds=new Set(candidates.flatMap(x=>x.kinds));
     selected=matchedKinds.size>1&&candidates.length>1?[]:candidates.map(x=>x.row);
    }else selected=candidates.map(x=>x.row);
   }
   for(const row of selected){
    const rowId=String(row.row_id??`${row.fund_name}::${row.class_name}::${row.report_date}::${rows.indexOf(row)}`);
    const docHash=String(doc.hash??doc.filename??'');if(!docHash)continue;
    const key=docHash+'\u0000'+rowId;let item=matchesByRow.get(key);
    if(!item){item={docHash,rowId,lipperId:entry.id||'',idConflict:false,entryIndexes:[],fundName:row.fund_name,className:row.class_name};matchesByRow.set(key,item);}
    else if(entry.id){
     if(item.lipperId&&item.lipperId!==entry.id){item.lipperId='';item.idConflict=true;}
     else if(!item.idConflict&&!item.lipperId)item.lipperId=entry.id;
    }
    item.entryIndexes.push(entry.index);entryMatched=true;
   }
  }
  if(entryMatched)matchedIndexes.add(entry.index);
 }
 const matches=[...matchesByRow.values()];
 return {matches,matchedEntries:matchedIndexes.size,unmatchedEntries:(entries||[]).filter(e=>!matchedIndexes.has(e.index)),idConflicts:matches.filter(m=>m.idConflict).length};
}
global.MRFP_FILTER={normalize,parseEntries,canonicalClass,classParts,classMatches,fundMatchForEntry,matchEntries};
})(globalThis);
