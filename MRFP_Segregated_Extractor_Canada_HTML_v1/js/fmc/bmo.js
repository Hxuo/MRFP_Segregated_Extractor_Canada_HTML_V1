/* BMO Life Assurance Company — BMO Guaranteed Investment Funds, Fund Facts.
   Independent issuer adapter. Each fund's Quick Facts page supplies the fund,
   class/guarantee-series MER and fund-wide PTR. Its own Ongoing fund expenses
   page independently confirms every MER cell. Management Fee / Insurance Fee
   summaries are not MER; there is no disclosed TOTAL Expense Ratio in this
   supported Fund Facts template, so TER remains null. No fund-name/count lists.

   PDF.js splits BMO decimal glyphs into multiple text items (e.g. "0", "�",
   "94*"). Values and boxes are rebuilt ONLY from text fragments within a
   verified row/column intersection; never by searching the page for a number. */
registerFMC({
 key:'bmo',
 name:'BMO Life Assurance Company — Guaranteed Investment Funds',
 detect(index){
  return index.some(p=>{
   const i=p.items||[],has=re=>i.some(x=>re.test(UTIL.clean(x.str)));
   return has(/^BMO Life Assurance Company$/i)&&has(/^FUND FACTS\s*[–-]\s*BMO/i)&&
    has(/^Quick Facts:$/i)&&has(/^Management Expense Ratio \(MER\) \(%\)$/i)&&
    has(/^BMO\s+.+\s+GIF$/i);
  });
 },
 extract(index){
  const clean=UTIL.clean,warnings=[],funds=[],results=[];
  const months={january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',july:'07',august:'08',september:'09',october:'10',november:'11',december:'12'};
  const text=i=>clean(i?.str),cx=i=>i.x+(i.w||0)/2;
  const between=(n,low,high)=>n>=low&&n<=high;
  const sameY=(a,b)=>Math.abs(a.y-b.y)<1.8;
  const numericPiece=s=>/^(?:\d[\d,]*(?:\.\d+)?%?\*{0,4}|[�.]{1,3}|\*{1,4}|n\/a|N\/A|[-–—−])$/.test(s);
  const isCover=p=>{
   const items=p.items||[];
   return items.some(i=>/^BMO Life Assurance Company$/i.test(text(i)))&&
    items.some(i=>/^Quick Facts:$/i.test(text(i)))&&
    items.some(i=>/^Management Expense Ratio \(MER\) \(%\)$/i.test(text(i)))&&
    items.some(i=>/^BMO\s+.+\s+GIF$/i.test(text(i))&&between(i.y,670,723)&&i.x<85);
  };
  const coverPages=index.filter(isCover);
  if(!coverPages.length)throw Error('BMO: no verified Fund Facts Quick Facts / MER pages.');
  const asOf=p=>{
   const matches=(p.items||[]).filter(i=>/^All information as at (\w+ \d{1,2}, 20\d{2}) \(unless otherwise noted\)/i.test(text(i)));
   if(matches.length!==1)return null;
   const match=text(matches[0]).match(/^(?:All information as at )([A-Za-z]+) (\d{1,2}), (20\d{2})/i);
   return match&&months[match[1].toLowerCase()]?`${match[3]}-${months[match[1].toLowerCase()]}-${String(match[2]).padStart(2,'0')}`:null;
  };
  // Return text reconstructed from the *original* PDF.js items and a union of
  // their actual glyph bounding boxes (including the split decimal separator).
  const cellFrom=(page,rowY,left,right)=>{
   const pieces=(page.items||[]).filter(i=>Math.abs(i.y-rowY)<1.9&&
    cx(i)>left&&cx(i)<right&&numericPiece(text(i)))
    .sort((a,b)=>a.x-b.x);
   if(!pieces.length)return null;
   const raw=pieces.map(i=>text(i).replace(/[�]/g,'.')).join('');
   if(!/^(?:\d+(?:\.\d+)?\*{0,4}|n\/a|N\/A|\*{1,4}|[-–—−])$/.test(raw))return null;
   const x=Math.min(...pieces.map(i=>i.x)),end=Math.max(...pieces.map(i=>i.x+(i.w||0)));
   const y=Math.min(...pieces.map(i=>i.y)),h=Math.max(...pieces.map(i=>i.h||6));
   return {raw,parts:pieces,box:UTIL.box({x,y,w:end-x,h}),page:page.page};
  };
  const metric=cell=>{
   if(!cell)return null;
   return UTIL.readMetric(cell.raw.replace(/\*+$/,''));
  };
  const evidence=(cell,kind,scope)=>cell?{
   page:cell.page,box:cell.box,sourceText:cell.raw,source:cell.raw,
   isMissing:metric(cell)===null,kind,scope
  }:null;
  const primaryTable=page=>{
   const items=page.items||[],mer=items.filter(i=>/^Management Expense Ratio \(MER\) \(%\)$/i.test(text(i))),
    nav=items.filter(i=>/^Net Asset Value per Unit \(\$\)$/i.test(text(i))),
    uos=items.filter(i=>/^Number of Units Outstanding\b/i.test(text(i)));
   if(mer.length!==1||nav.length!==1||uos.length!==1||!(cx(mer[0])<cx(nav[0])&&cx(nav[0])<cx(uos[0])))return null;
   const hdr=mer[0],limit=items.find(i=>/^Minimum Investment$/i.test(text(i))&&i.y<hdr.y);
   if(!limit)return null;
   const classItems=items.filter(i=>/^Class [A-Z](?: Prestige)?$/i.test(text(i))&&
    i.y<hdr.y-4&&i.y>limit.y+3&&cx(i)>cx(mer[0])&&cx(i)<cx(uos[0]))
    .sort((a,b)=>b.y-a.y);
   const labels=items.filter(i=>/^Series (?:75\/75|75\/100|100\/100)$/i.test(text(i))&&
    i.x<105&&i.y<hdr.y-4&&i.y>limit.y+3).sort((a,b)=>b.y-a.y);
   if(!classItems.length||!labels.length)return null;
   const merLeft=Math.max(106,mer[0].x-40),merRight=(cx(mer[0])+cx(nav[0]))/2-8;
   const uosLeft=(cx(nav[0])+cx(uos[0]))/2+8,uosRight=page.width||612;
   const rows=labels.map(label=>{
    const owner=classItems.filter(c=>c.y>label.y).sort((a,b)=>a.y-b.y)[0];
    return {name:owner?text(owner)+' '+text(label):null,label,
     mer:cellFrom(page,label.y,merLeft,merRight),
     uos:cellFrom(page,label.y,uosLeft,uosRight)};
   });
   return {page,rows,header:hdr,limit};
  };
  const secondaryTable=page=>{
   const i=page.items||[];
   if(!i.some(x=>/^Ongoing fund expenses$/i.test(text(x))))return null;
   const headers=i.filter(x=>/^MER(?:\s*%)?\s*[–-]\s*Class [A-Z](?: Prestige)?$/i.test(text(x)))
    .sort((a,b)=>cx(a)-cx(b));
   if(!(headers.length>=1&&headers.length<=8))return null;
   if(headers.some(h=>Math.abs(h.y-headers[0].y)>2))return null;
   const labels=i.filter(x=>/^Series (?:75\/75|75\/100|100\/100)$/i.test(text(x))&&
    x.x<135&&x.y<headers[0].y-4&&x.y>headers[0].y-85).sort((a,b)=>b.y-a.y);
   const found=new Map();
   for(const label of labels){
    for(let col=0;col<headers.length;col++){
     const h=headers[col],center=cx(h),
      left=col?((cx(headers[col-1])+center)/2):Math.max(135,center-(headers.length===2?80:55)),
      right=col<headers.length-1?(center+cx(headers[col+1]))/2:Math.min(610,center+65);
     const cell=cellFrom(page,label.y,left,right);
     found.set(text(h).replace(/^MER(?:\s*%)?\s*[–-]\s*/i,'')+' '+text(label),cell);
    }
   }
   return {page,found,headers,labels};
  };
  const estimateNotes=(page)=>{
   const notes=new Map();
   for(const i of page.items||[]){
    const s=text(i);
    if(!/\bMER is an estimate\b/i.test(s))continue;
    // Handle multiple footnotes sharing one PDF text item, if encountered.
    const chunks=s.split(/(?=\s+\*{1,4}\s+(?:The fund|This series)\b)/i);
    for(const part of chunks){
     const match=part.trim().match(/^(\*{1,4})\s+((?:The fund|This series)\s+was launched\s+\w+\s+\d{1,2},\s+20\d{2}\s+and\s+the\s+MER\s+is\s+an\s+estimate)/i);
     if(match)notes.set(match[1],{page:page.page,box:UTIL.box(i),sourceText:part.trim(),
      reason:match[2],marker:match[1]});
    }
   }
   return notes;
  };
  const turnover=page=>{
   const labels=(page.items||[]).filter(i=>/^Portfolio Turnover Rate:$/i.test(text(i)));
   if(labels.length!==1)return {value:null,evidence:null,warning:'Portfolio Turnover Rate label missing/ambiguous'};
   const label=labels[0],pieces=(page.items||[]).filter(i=>sameY(i,label)&&i.x>label.x+label.w&&
    i.x<page.width&&numericPiece(text(i))&&text(i).length<8).sort((a,b)=>a.x-b.x);
   // A leader of repeated unreadable glyphs is NOT a decimal separator.
   const numeric=pieces.filter(i=>text(i)!=='�'||i.w<4);
   if(!numeric.length)return {value:null,evidence:null,warning:'PTR printed cell missing'};
   const x=Math.min(...numeric.map(i=>i.x)),end=Math.max(...numeric.map(i=>i.x+(i.w||0)));
   const c={raw:numeric.map(i=>text(i).replace(/�/g,'.')).join(''),box:UTIL.box({x,y:label.y,w:end-x,h:7}),page:page.page};
   if(!/^(?:\d+\.\d+%|n\/a|N\/A|\*{1,4})$/.test(c.raw))return {value:null,evidence:null,warning:'PTR cell could not be validated'};
   return {value:metric(c),evidence:evidence(c,'bmo-fund-facts-portfolio-turnover-rate','fund-level')};
  };
  const rowSeen=new Set();
  for(let ix=0;ix<coverPages.length;ix++){
   const cover=coverPages[ix],end=ix+1<coverPages.length?coverPages[ix+1].page-1:index[index.length-1].page;
   const titles=(cover.items||[]).filter(i=>/^BMO\s+.+\s+GIF$/i.test(text(i))&&
    i.x<85&&between(i.y,670,723)).sort((a,b)=>b.y-a.y);
   const name=titles.length===1?text(titles[0]):null,reportDate=asOf(cover);
   if(!name||!reportDate){warnings.push(`PDF page ${cover.page}: missing/ambiguous primary fund heading or as-of date.`);continue;}
   const pages=index.filter(p=>p.page>=cover.page&&p.page<=end),primary=primaryTable(cover);
   const second=pages.map(secondaryTable).find(Boolean)||null;
   const fund={name,startPage:cover.page,endPage:end,tablePages:primary?[cover.page]:[],documentType:'Fund Facts',report_date:reportDate};
   funds.push(fund);
   if(!primary||!second){warnings.push(`${name}: primary ${primary?"OK":"MISSING"} / secondary ${second?"OK":"MISSING"}.`);continue;}
   const notes=estimateNotes(cover),ptr=turnover(cover);
   if(ptr.warning)warnings.push(`${name}: ${ptr.warning}`);
   fund.secondaryMERValidation={status:'matched',page:second.page.page,matched:0,mismatches:0};
   for(const rec of primary.rows){
    if(!rec.name){warnings.push(`${name}: Series ${text(rec.label)} has no class heading.`);continue;}
    const id=UTIL.key(name,rec.name,reportDate);
    if(rowSeen.has(id)){warnings.push(`${name} / ${rec.name}: duplicate source row ignored.`);continue;}
    rowSeen.add(id);
    const other=second.found.get(rec.name);
    if(!rec.mer||!other){warnings.push(`${name} / ${rec.name}: unverified/missing MER cell in one of the independent tables.`);continue;}
    const primaryValue=metric(rec.mer),otherValue=metric(other);
    const sameValue=primaryValue!==null&&primaryValue===otherValue;
    if(!sameValue){fund.secondaryMERValidation.mismatches++;
     warnings.push(`${name} / ${rec.name}: MER Quick Facts vs Ongoing fund expenses does not agree; value omitted.`);
    }else fund.secondaryMERValidation.matched++;
    const primaryMarker=(rec.mer.raw.match(/(\*{1,4})$/)||[])[1]||'';
    const supportedNote=primaryMarker?notes.get(primaryMarker):null;
    const independentlySupported=!!(supportedNote&&/MER is an estimate/i.test(supportedNote.sourceText));
    const isEstimated=!!(sameValue&&independentlySupported);
    const status=(primaryMarker&&!independentlySupported)?'unverified':isEstimated?'estimated':'not estimated';
    if(primaryMarker&&!independentlySupported)
     warnings.push(`${name} / ${rec.name}: MER estimate marker lacks matching primary Quick Facts footnote; est. not asserted.`);
    const merEvidence=sameValue?evidence(rec.mer,'bmo-fund-facts-quick-facts-mer','class-series'):null;
    if(merEvidence)merEvidence.estimated=isEstimated;
    results.push({row_id:id,fund_name:name,class_name:rec.name,report_date:reportDate,
     year:Number(reportDate.slice(0,4)),MER:sameValue?primaryValue:null,TER:null,PTR:ptr.value,
     metricStatus:{MER:status},
     ...(isEstimated?{metricStatusEvidence:{MER:{reason:supportedNote.reason,marker:primaryMarker,
       footnote:supportedNote,merCell:{page:cover.page,box:rec.mer.box,sourceText:rec.mer.raw},
       sourceReportingDate:reportDate,qualifierDate:supportedNote.reason.match(/(?:November|May) \d{1,2}, 20\d{2}/)?.[0]||null}}}:{}),
     evidence:{MER:merEvidence,TER:null,PTR:ptr.evidence},source_page:cover.page,
     ptr_scope:'fund-level',document_type:'Fund Facts',
     confidence:sameValue?'two-source-mer-table-match':'unverified-mer-table-mismatch'});
   }
   if(fund.secondaryMERValidation.mismatches)fund.secondaryMERValidation.status='mismatch';
  }
  if(!results.length)throw Error('BMO: no independently validated MER/class rows.');
  return {issuer:'BMO Life Assurance Company',document_type:'Fund Facts',
   report_date:results.map(r=>r.report_date).sort().at(-1),
   year:Number(results[0].report_date.slice(0,4)),funds,results,warnings};
 }
});
