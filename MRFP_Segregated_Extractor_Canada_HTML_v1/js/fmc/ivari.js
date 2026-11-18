/* ivari / AIC Segregated Funds — individual three-page Fund Facts layout.
   The first page identifies the fund, reporting date, guarantee-option rows,
   first-page FER and fund-level PTR. The Ongoing fund expenses table on the
   corresponding later page is the *only* MER value source. In this template
   the issuer explicitly defines its printed TER as TRADING Expense Ratio:
   application TER always means TOTAL Expense Ratio, therefore stays null.
   No fund-name lists, option counts, PDF filenames or guessed coordinates. */
registerFMC({
 key:'ivari',
 name:'ivari — AIC Segregated Funds',
 detect(index){
  return index.some(p=>{
   const a=p.items||[],s=x=>UTIL.clean(x.str);
   return a.some(i=>/^Fund Facts$/i.test(s(i))&&i.y>715)&&
    a.some(i=>/^\s*[—–-]\s*AIC Segregated Funds$/i.test(s(i))&&i.y>715)&&
    a.some(i=>/^AIC\s+.+\s+SEGREGATED FUND$/i.test(s(i))&&i.y>695)&&
    a.some(i=>/^QUICK FACTS$/i.test(s(i)))&&
    a.some(i=>/^As at (?:[A-Za-z]+) \d{1,2},? 20\d{2}$/i.test(s(i)));
  })&&index.some(p=>/\btrading expense ratio\s*\(TER\)/i.test(p.text));
 },
 extract(index){
  const clean=UTIL.clean,warnings=[],funds=[],results=[];
  const months={january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',july:'07',august:'08',september:'09',october:'10',november:'11',december:'12'};
  const val=i=>clean(i?.str),cx=i=>i.x+(i.w||0)/2;
  const byY=(a,b)=>Math.abs(a.y-b.y)<2.2;
  const option=/^\d{2,3}\/\d{2,3}$/;
  const metricText=s=>/^(?:\d+(?:\.\d+)?%?|[-–—−]{1,2}|n\/?a|not available)$/i.test(s);
  const parsed=s=>/^[-–—−]{1,2}$/.test(s)?null:UTIL.readMetric(s);
  const hit=(p,item,kind,scope)=>item?{
   page:p.page,box:UTIL.box(item),sourceText:val(item),source:val(item),
   isMissing:parsed(val(item))===null,kind,scope
  }:null;
  const cover=p=>{
   const a=p.items||[];
   return a.some(i=>/^Fund Facts$/i.test(val(i))&&i.y>715)&&
    a.some(i=>/^[—–-]\s*AIC Segregated Funds$/i.test(val(i))&&i.y>715)&&
    a.some(i=>/^QUICK FACTS$/i.test(val(i))&&i.y>670)&&
    a.some(i=>/^AIC\s+.+\s+SEGREGATED FUND$/i.test(val(i))&&i.y>695&&i.x>200)&&
    a.some(i=>/^GUARANTEE OPTION$/i.test(val(i))&&i.y>590);
  };
  const covers=index.filter(cover).sort((a,b)=>a.page-b.page);
  if(!covers.length)throw Error('ivari: no independently identified AIC Fund Facts cover / Quick Facts pages.');
  const rowCell=(p,label,left,right)=>{
   const candidates=(p.items||[]).filter(i=>byY(i,label)&&cx(i)>left&&cx(i)<right&&metricText(val(i)));
   return candidates.length===1?candidates[0]:null;
  };
  const firstTable=p=>{
   const a=p.items||[];
   const guarantee=a.filter(i=>/^GUARANTEE OPTION$/i.test(val(i))&&i.y>580);
   const fer=a.filter(i=>/^FER\s*\(%\)$/i.test(val(i))&&i.y>580);
   const transfer=a.filter(i=>/^MINIMUM TRANSFER AMOUNT\s*\(\$\)$/i.test(val(i))&&i.y>580);
   const nav=a.filter(i=>/^NET ASSET VALUE PER UNIT$/i.test(val(i))&&i.y>580);
   if(guarantee.length!==1||transfer.length!==1||fer.length!==1||nav.length!==1||
      !(cx(guarantee[0])<cx(transfer[0])&&cx(transfer[0])<cx(fer[0])&&cx(fer[0])<cx(nav[0])))return null;
   const h=guarantee[0];
   const labels=a.filter(i=>option.test(val(i))&&i.y<h.y-3&&i.y>h.y-85&&
       cx(i)<(cx(guarantee[0])+cx(fer[0]))/2)
    .sort((x,y)=>y.y-x.y);
   const rows=new Map();
   for(const label of labels){
    const name=val(label),cell=rowCell(p,label,(cx(transfer[0])+cx(fer[0]))/2,(cx(fer[0])+cx(nav[0]))/2);
    if(rows.has(name))return null;
    rows.set(name,{label,fer:cell});
   }
   return rows.size?rows:null;
  };
  const expenseTable=p=>{
   const a=p.items||[],pageText=clean(p.text);
   // If a future AIC version discloses Total Expense Ratio independently,
   // flag it rather than silently claiming coverage without validated cells.
   if(/\btotal expense ratio\b/i.test(pageText))
    warnings.push(`ivari PDF page ${p.page}: Total Expense Ratio text requires separate column/source verification; not extracted.`);
   // Confirm the issuer's *expanded* definition, not merely the letters TER.
   if(!/\btrading expense ratio\s*\(TER\)/i.test(pageText)||
      !/\bfund expense ratio\s*\(FER\)/i.test(pageText))return null;
   const mer=a.filter(i=>/^MER\*?$/i.test(val(i))&&i.x>310&&i.y>400),
    ter=a.filter(i=>/^TER\*?$/i.test(val(i))&&i.x>310&&i.y>400),
    fer=a.filter(i=>/^FER\*?$/i.test(val(i))&&i.x>310&&i.y>400),
    opt=a.filter(i=>/^GUARANTEE$/i.test(val(i))&&i.x>310&&i.y>400),
    opt2=a.filter(i=>/^OPTION$/i.test(val(i))&&i.x>310&&i.y>400);
   if(mer.length!==1||ter.length!==1||fer.length!==1||opt.length!==1||opt2.length!==1)return null;
   if(!(cx(opt[0])<cx(mer[0])&&cx(mer[0])<cx(ter[0])&&cx(ter[0])<cx(fer[0]))||
      Math.abs(mer[0].y-ter[0].y)>2||Math.abs(mer[0].y-fer[0].y)>2||
      Math.abs(cx(opt[0])-cx(opt2[0]))>15)return null;
   const labels=a.filter(i=>option.test(val(i))&&
      i.y<mer[0].y-10&&i.y>mer[0].y-95&&cx(i)<(cx(opt[0])+cx(mer[0]))/2)
     .sort((x,y)=>y.y-x.y);
   const rows=new Map();
   for(const label of labels){
    const name=val(label),m=rowCell(p,label,(cx(opt[0])+cx(mer[0]))/2,(cx(mer[0])+cx(ter[0]))/2),
     f=rowCell(p,label,(cx(ter[0])+cx(fer[0]))/2,Math.min(p.width||612,cx(fer[0])+50));
    if(rows.has(name))return null;
    rows.set(name,{label,mer:m,fer:f});
   }
   return rows.size?{page:p,rows}:null;
  };
  const reportDate=p=>{
   const dates=(p.items||[]).filter(i=>/^As at\s+[A-Za-z]+\s+\d{1,2},?\s+20\d{2}$/i.test(val(i))&&i.y>660);
   if(dates.length!==1)return null;
   const match=val(dates[0]).match(/^As at\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d{2})$/i);
   if(!match||!months[match[1].toLowerCase()])return null;
   return `${match[3]}-${months[match[1].toLowerCase()]}-${match[2].padStart(2,'0')}`;
  };
  const turnover=p=>{
   const a=p.items||[],labels=a.filter(i=>/^Portfolio Turnover Rate:$/i.test(val(i))&&i.y>580);
   if(labels.length!==1)return {value:null,evidence:null,warning:'missing/ambiguous PTR label'};
   const l=labels[0],cells=a.filter(i=>byY(i,l)&&i.x>l.x+l.w&&
     i.x<(p.width||612)&&metricText(val(i)));
   if(cells.length!==1)return {value:null,evidence:null,warning:'missing/ambiguous PTR cell'};
   return {value:parsed(val(cells[0])),evidence:hit(p,cells[0],'ivari-fund-facts-turnover','fund-level')};
  };
  const seen=new Set();
  for(let n=0;n<covers.length;n++){
   const p=covers[n],end=n+1<covers.length?covers[n+1].page-1:index[index.length-1].page,
    a=p.items||[],titles=a.filter(i=>/^AIC\s+.+\s+SEGREGATED FUND$/i.test(val(i))&&i.y>695&&i.x>200),
    name=titles.length===1?val(titles[0]):null,date=reportDate(p);
   if(!name||!date){warnings.push(`PDF page ${p.page}: missing/ambiguous fund title or as-at date`);continue;}
   const f={name,startPage:p.page,endPage:end,tablePages:[],documentType:'Fund Facts',report_date:date};
   funds.push(f);
   const first=firstTable(p),tables=index.filter(x=>x.page>p.page&&x.page<=end).map(expenseTable).filter(Boolean);
   if(!first||tables.length!==1){warnings.push(`${name}: missing/ambiguous Quick Facts guarantee table or expense table`);continue;}
   const second=tables[0],ptr=turnover(p);
   if(ptr.warning)warnings.push(`${name}: ${ptr.warning}`);
   f.tablePages=[second.page.page];f.secondaryCheck={status:'matched',validated:0,mismatches:0};
   if(first.size!==second.rows.size||[...first.keys()].some(k=>!second.rows.has(k))){
    f.secondaryCheck.status='option-mismatch';warnings.push(`${name}: guarantee-option rows differ across PDF tables`);
   }
   for(const [optionName,record] of second.rows){
    const cls=`Guarantee Option ${optionName}`,id=UTIL.key(name,cls,date),firstRec=first.get(optionName);
    if(seen.has(id)){warnings.push(`${name} / ${cls}: repeated row ignored`);continue;}seen.add(id);
    if(!firstRec){warnings.push(`${name} / ${cls}: option not present in Quick Facts`);continue;}
    const merCell=record.mer,fer1=firstRec.fer,fer2=record.fer;
    const merValue=merCell?parsed(val(merCell)):null;
    const ferOK=!!(fer1&&fer2&&parsed(val(fer1))!==null&&parsed(val(fer1))===parsed(val(fer2)));
    if(!merCell||merValue===null||!ferOK){
     f.secondaryCheck.mismatches++;
     warnings.push(`${name} / ${cls}: MER or cross-page FER cannot be verified`);
    }else f.secondaryCheck.validated++;
    const verified=merCell&&merValue!==null&&ferOK;
    // An asterisk on the *header* means annual percentage, NOT estimated MER.
    // Do not infer estimates from age, UOS or unexplained cell markers.
    const marked=!!(merCell&&/[†‡*]/.test(val(merCell)));
    if(marked)warnings.push(`${name} / ${cls}: unexplained MER cell qualifier; status unverified`);
    results.push({row_id:id,fund_name:name,class_name:cls,report_date:date,year:Number(date.slice(0,4)),
     MER:verified?merValue:null,TER:null,PTR:ptr.value,metricStatus:{MER:marked?'unverified':'not estimated'},
     evidence:{MER:verified?hit(second.page,merCell,'ivari-ongoing-fund-expenses-mer','guarantee-option'):null,
      TER:null,PTR:ptr.evidence},source_page:second.page.page,ptr_scope:'fund-level',
     document_type:'Fund Facts',confidence:verified?'cross-page-fer-validated':'unverified-mer-or-fer'});
   }
   if(f.secondaryCheck.mismatches)f.secondaryCheck.status='mismatch';
  }
  if(!results.length)throw Error('ivari: no verified guarantee-option rows in source documents.');
  return {issuer:'ivari',document_type:'Fund Facts',
   report_date:results.map(r=>r.report_date).sort().at(-1),
   year:Number(results[0].report_date.slice(0,4)),funds,results,warnings};
 }
});
