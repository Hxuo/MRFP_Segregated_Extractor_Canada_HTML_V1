function extractSegregated(pages){
 const index=indexDocument(pages),matched=REGISTRY.filter(a=>a.detect(index));
 if(matched.length!==1)throw Error(matched.length?'Ambiguous issuer: '+matched.map(a=>a.key).join(', '):'Unsupported issuer/layout. No values guessed.');
 const adapter=matched[0];const out=adapter.extract(index);
 if(!out?.results?.length)throw Error('No validated fund classes extracted.');
 for(const row of out.results){row.fmc_key=adapter.key;row.issuer=out.issuer||adapter.name;
  for(const k of UTIL.metricKeys)if(!Number.isFinite(row[k]))row[k]=null;}
 return {...out,fmc_key:adapter.key,evidenceMap:sourceEvidence(out.results)};
}
