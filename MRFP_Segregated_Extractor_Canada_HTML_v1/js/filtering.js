/* Generic Data Needed Only matching. FMC-agnostic; operates on saved fund/class rows. */
(function(global){
'use strict';
function normalize(value){
 return String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  .replace(/[‐‑‒–—]/g,'-').replace(/&/g,' and ')
  .replace(/[^a-z0-9\/-]+/g,' ').replace(/\s*-\s*/g,'-')
  .replace(/\s*\/\s*/g,'/').replace(/\s+/g,' ').trim();
}
function parseLine(line,lineNumber,index){
 const original=String(line??'').trim();if(!original)return null;
 let id='',name=original,m;
 // Spreadsheet/tab paste: allow any numeric ID length because the delimiter is explicit.
 m=original.match(/^(\d+)\t+(.+)$/);
 if(!m)m=original.match(/^(\d{4,}) {2,}(.+)$/);
 // Single-space form is accepted for conventional 5+ digit Lipper identifiers.
 if(!m)m=original.match(/^(\d{5,})\s+(.+)$/);
 if(m){id=m[1];name=m[2].trim();}
 else if(/^\d+$/.test(original)){id=original;name='';}
 return {id,name,original,lineNumber,index};
}
function parseEntries(text){
 return String(text??'').split(/\r?\n/).map((line,i)=>parseLine(line,i+1,i)).filter(Boolean);
}
function canonicalSuffix(value){
 // Hyphen/no-hyphen variants such as K-2 and K2 are equivalent, but the
 // complete suffix remains exact (K2 does not match K20).
 return normalize(value).replace(/([a-z])-(?=\d)/g,'$1');
}
function classDescriptor(value){
 const n=normalize(value);let m;
 if((m=n.match(/^series\s+(.+)$/)))return {kind:'series',suffix:canonicalSuffix(m[1])};
 if((m=n.match(/^(.+?)\s+series$/)))return {kind:'series',suffix:canonicalSuffix(m[1])};
 if((m=n.match(/^(.+?)-series$/)))return {kind:'series',suffix:canonicalSuffix(m[1])};
 if((m=n.match(/^class\s+(.+)$/)))return {kind:'class',suffix:canonicalSuffix(m[1])};
 if((m=n.match(/^(.+?)\s+class$/)))return {kind:'class',suffix:canonicalSuffix(m[1])};
 if((m=n.match(/^(.+?)-class$/)))return {kind:'class',suffix:canonicalSuffix(m[1])};
 // A bare suffix is intentionally type-neutral. It can match a Class or a
 // Series only when that suffix is unambiguous within the document.
 if(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)?$/.test(n))return {kind:'any',suffix:canonicalSuffix(n)};
 return {kind:'other',value:n};
}
function canonicalClass(value){
 const d=classDescriptor(value);
 return d.kind==='other'?d.value:d.kind+' '+d.suffix;
}
function classParts(value){
 const raw=String(value??'').trim();if(!raw)return [];
 const markers=raw.match(/(?:series|class)\s+[a-z0-9]+(?:-[a-z0-9]+)?(?:\/[a-z0-9]+)?/gi)||[];
 const hasCombinedSeparator=/,|;|\s+and\s+|\s*&\s*|\s+\/\s+/i.test(raw);
 // A single descriptor such as "Standard Series 75/75" stays whole. Split explicit
 // compound headings, or abbreviated continuations such as "Series F and F-2".
 if(markers.length<2&&!hasCombinedSeparator)return [raw];
 const parts=raw.split(/\s*(?:,|;|\s+and\s+|\s*&\s*|\s+\/\s+)\s*/i).map(x=>x.trim()).filter(Boolean);
 const out=[...parts];
 const first=parts[0]||'';
 const firstDescriptor=classDescriptor(first);
 const inheritedType=['series','class'].includes(firstDescriptor.kind)?firstDescriptor.kind:null;
 if(inheritedType){for(const part of parts.slice(1))if(!['series','class'].includes(classDescriptor(part).kind))out.push(inheritedType+' '+part);}
 // Expand embedded labels within each compound component (e.g. "Class A Series F"),
 // but do not strip meaningful prefixes from a single descriptor such as "Standard Series 75/75".
 for(const part of parts){
  const embedded=part.match(/(?:series|class)\s+[a-z0-9]+(?:-[a-z0-9]+)?(?:\/[a-z0-9]+)?/gi)||[];
  if(embedded.length>1)out.push(...embedded);
 }
 return [...new Set(out)];
}
function classMatchKinds(queryClass,rowClass){
 const query=classDescriptor(queryClass);const parts=classParts(rowClass);
 if(query.kind==='other'){
  return parts.some(part=>canonicalClass(part)===query.value)||canonicalClass(rowClass)===query.value?['other']:[];
 }
 const kinds=[];
 for(const part of parts){
  const candidate=classDescriptor(part);
  if(candidate.suffix!==query.suffix)continue;
  if(query.kind==='any'&&['class','series'].includes(candidate.kind))kinds.push(candidate.kind);
  else if(candidate.kind===query.kind)kinds.push(candidate.kind);
 }
 return [...new Set(kinds)];
}
function classMatches(queryClass,rowClass){
 return classMatchKinds(queryClass,rowClass).length>0;
}
function fundMatchForEntry(entry,fundNames){
 const query=normalize(entry.name);if(!query)return null;
 const byKey=new Map();
 for(const name of fundNames.filter(Boolean)){
  const key=normalize(name);if(!byKey.has(key))byKey.set(key,new Set());byKey.get(key).add(String(name).trim());
 }
 const candidates=[...byKey.entries()].map(([key,names])=>({key,names:[...names]}))
  .filter(x=>query===x.key||query.startsWith(x.key+' ')).sort((a,b)=>b.key.length-a.key.length);
 if(!candidates.length)return null;
 const best=candidates[0];
 // If punctuation/case normalization collapses two distinct published fund names,
 // do not guess which fund the request intended.
 if(best.names.length!==1)return {ambiguous:true,fundKey:best.key};
 const suffix=query===best.key?'':query.slice(best.key.length).trim();
 return {fundName:best.names[0],fundKey:best.key,classQuery:suffix||null,ambiguous:false};
}
function matchEntries(entries,documents){
 const matchesByRow=new Map(),matchedIndexes=new Set();
 for(const entry of entries||[]){
  if(!entry.name)continue;
  let entryMatched=false;
  for(const doc of documents||[]){
   const rows=Array.isArray(doc.results)?doc.results:[];
   if(!rows.length)continue;
   const fundNames=[...new Set(rows.map(r=>String(r.fund_name||'').trim()).filter(Boolean))];
   const found=fundMatchForEntry(entry,fundNames);if(!found||found.ambiguous)continue;
   const docRows=rows.filter(r=>normalize(r.fund_name)===found.fundKey);
   let selected=docRows;
   if(found.classQuery){
    const queryDescriptor=classDescriptor(found.classQuery);
    const candidates=docRows.map(row=>({row,kinds:classMatchKinds(found.classQuery,row.class_name)})).filter(x=>x.kinds.length);
    // Bare suffixes may stand for either Class or Series. If both types exist
    // as separate matching rows in the same document, the request is ambiguous:
    // do not guess which row the supplied Lipper ID belongs to.
    if(queryDescriptor.kind==='any'){
     const matchedKinds=new Set(candidates.flatMap(x=>x.kinds));
     selected=matchedKinds.size>1&&candidates.length>1?[]:candidates.map(x=>x.row);
    }else selected=candidates.map(x=>x.row);
   }
   for(let i=0;i<selected.length;i++){
    const row=selected[i],rowId=String(row.row_id??`${row.fund_name}::${row.class_name}::${row.report_date}::${rows.indexOf(row)}`);
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
 const unmatchedEntries=(entries||[]).filter(e=>!matchedIndexes.has(e.index));
 return {matches,matchedEntries:matchedIndexes.size,unmatchedEntries,idConflicts:matches.filter(m=>m.idConflict).length};
}
global.MRFP_FILTER={normalize,parseEntries,canonicalClass,classParts,classMatches,fundMatchForEntry,matchEntries};
})(globalThis);
