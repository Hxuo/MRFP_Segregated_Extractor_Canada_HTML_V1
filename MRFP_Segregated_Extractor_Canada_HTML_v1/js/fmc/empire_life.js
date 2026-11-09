/* Empire Life Fund Facts adapter.
   Reads each Fund Facts cover/Quick Facts section for fund identity, as-of date,
   and fund-level portfolio turnover; reads the Ongoing Fund Expenses table for
   class-level MER. In the supplied template, TER is Trading Expense Ratio and FER
   is Fund Expense Ratio, so both are excluded. A future explicit, expanded Total
   Expense Ratio column is eligible; an abbreviation-only TER column is not.
   Coordinates are derived from the actual page's table headings and source cells. */
registerFMC({
 key:'empire_life',
 name:'The Empire Life Insurance Company — Guaranteed Investment Funds',
 detect(index){
  return index.some(page=>{
   const text=UTIL.clean(page.text);
   return /Fund Facts/i.test(text)&&
    /The Empire Life Insurance Company/i.test(text)&&
    /Empire Life Guaranteed Investment Funds/i.test(text)&&
    page.items?.some(item=>/^Empire Life .+ GIF\*?$/i.test(UTIL.clean(item.str))&&item.x>200&&item.y>700&&item.y<745);
  });
 },
 extract(index){
  const warnings=[],funds=[],results=[];
  const monthMap={january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',july:'07',august:'08',september:'09',october:'10',november:'11',december:'12'};
  const clean=UTIL.clean;
  const itemCenter=item=>item.x+(item.w||0)/2;
  const itemText=item=>clean(item?.str);
  const isMissingText=text=>/^(?:[-–—−]|n\/a|na|nil|not available)$/i.test(clean(text));
  const metricText=text=>{
   const raw=clean(text).replace(/(?:\*|†|‡)+$/,'');
   return UTIL.isNumber(raw)||isMissingText(raw)?raw:null;
  };
  const parseDate=page=>{
   const item=(page.items||[]).find(i=>/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+20\d{2}$/i.test(itemText(i))&&i.x>350&&i.y>690&&i.y<725);
   const raw=itemText(item);
   const match=raw.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(20\d{2})$/i);
   if(!match)return null;
   const month=monthMap[match[1].toLowerCase()],day=String(Number(match[2])).padStart(2,'0');
   return {date:`${match[3]}-${month}-${day}`,item};
  };
  const isCover=page=>{
   const text=clean(page.text);
   return /\bFund Facts\b/i.test(text)&&
    /The Empire Life Insurance Company/i.test(text)&&
    /Empire Life Guaranteed Investment Funds/i.test(text)&&!!parseDate(page);
  };
  const coverPages=index.filter(isCover);
  if(!coverPages.length)throw Error('Empire Life: no supported Fund Facts cover page found.');
  const titleFromCover=page=>{
   const candidates=(page.items||[]).filter(i=>/^Empire Life .+ GIF\*?$/i.test(itemText(i))&&i.x>200&&i.y>700&&i.y<745)
    .sort((a,b)=>b.y-a.y||a.x-b.x);
   return candidates.length?itemText(candidates[0]).replace(/\*+$/,'').trim():null;
  };
  const findPTR=page=>{
   const labels=(page.items||[]).filter(i=>/^Fund Portfolio Turnover Rate$/i.test(itemText(i)));
   if(labels.length!==1)return {value:null,evidence:null,warning:labels.length?'ambiguous Portfolio Turnover labels':'Portfolio Turnover Rate label not found'};
   const label=labels[0];
   const candidates=(page.items||[]).filter(i=>Math.abs(i.y-label.y)<2.5&&i.x>=label.x+label.w-1)
    .sort((a,b)=>a.x-b.x).filter(i=>metricText(i.str)!==null);
   if(candidates.length!==1)return {value:null,evidence:null,warning:candidates.length?'ambiguous Portfolio Turnover value':'Portfolio Turnover value not found'};
   const cell=candidates[0],parsed=UTIL.readMetric(metricText(cell.str));
   return {value:parsed,evidence:{page:page.page,box:UTIL.box(cell),sourceText:itemText(cell),source:itemText(cell),
    isMissing:parsed===null,kind:'empire-life-fund-facts-portfolio-turnover',scope:'fund-level'}};
  };
  const findExpenseTable=pages=>{
   for(const page of pages){
    const text=clean(page.text);
    if(!/2\.\s*Ongoing Fund Expenses/i.test(text)||
       !/management expense ratio\s*\(MER\)/i.test(text))continue;
    const items=page.items||[];
    const classHeaders=items.filter(i=>/^Fund Class$/i.test(itemText(i)));
    const merHeaders=items.filter(i=>/^MER\s*\(%\)$/i.test(itemText(i)));
    const tradingHeaders=items.filter(i=>/^TER\s*\(%\)$/i.test(itemText(i)));
    const ferHeaders=items.filter(i=>/^FER\s*\(%\)$/i.test(itemText(i)));
    // Only a fully expanded Total Expense Ratio table heading can populate
    // system TER. The bare TER (%) heading in the supplied Empire documents
    // is explicitly Trading Expense Ratio and is deliberately not accepted.
    const totalTerHeaders=items.filter(i=>/^Total Expense Ratio\s*(?:\(%\))?$/i.test(itemText(i)));
    const header=classHeaders.find(c=>{
     const near=list=>list.find(i=>Math.abs(i.y-c.y)<2.2);
     return !!near(merHeaders);
    });
    if(!header)continue;
    const sameY=list=>list.find(i=>Math.abs(i.y-header.y)<2.2);
    const merHeader=sameY(merHeaders),tradingHeader=sameY(tradingHeaders),ferHeader=sameY(ferHeaders),totalTerHeader=sameY(totalTerHeaders);
    const classCenter=itemCenter(header),merCenter=itemCenter(merHeader);
    const numericHeaders=[merHeader,tradingHeader,ferHeader,totalTerHeader].filter(Boolean).sort((a,b)=>itemCenter(a)-itemCenter(b));
    if(!(classCenter<merCenter)||numericHeaders.length<1)continue;
    const boundsFor=target=>{
     const idx=numericHeaders.indexOf(target);if(idx<0)return null;
     const center=itemCenter(target),previous=idx>0?itemCenter(numericHeaders[idx-1]):classCenter;
     const next=idx<numericHeaders.length-1?itemCenter(numericHeaders[idx+1]):null;
     return [(previous+center)/2,next===null?center+(center-previous)/2:(center+next)/2];
    };
    const merBounds=boundsFor(merHeader),totalTerBounds=totalTerHeader?boundsFor(totalTerHeader):null;
    if(!merBounds)continue;
    const trailer=(items.filter(i=>/^3\.\s*Trailer Commissions$/i.test(itemText(i))).sort((a,b)=>b.y-a.y)[0]);
    const bottomY=trailer?.y??(header.y-220);
    const labels=items.filter(i=>{
     const text=itemText(i),center=itemCenter(i);
     return center>=classCenter-25&&center<=classCenter+25&&
      i.y<header.y-3&&i.y>bottomY+2&&
      /^(?:[A-Z][A-Z0-9-]{0,7}|(?:Class|Series)\s+[A-Z0-9][A-Z0-9-]*)$/i.test(text);
    }).sort((a,b)=>b.y-a.y||a.x-b.x);
    const rows=[],seen=new Set();
    for(const label of labels){
     const rawClass=itemText(label),className=/^(?:Class|Series)\s+/i.test(rawClass)?rawClass:`Class ${rawClass}`;
     const identity=className.toLowerCase();if(seen.has(identity))continue;seen.add(identity);
     const sameLine=items.filter(i=>Math.abs(i.y-label.y)<2.2);
     const inColumn=(bounds)=>sameLine.filter(i=>{
      const center=itemCenter(i);return center>bounds[0]&&center<bounds[1]&&metricText(i.str)!==null;
     });
     const cells=inColumn(merBounds),totalCells=totalTerBounds?inColumn(totalTerBounds):[];
     rows.push({className,label,cell:cells.length===1?cells[0]:null,
      terCell:totalTerBounds&&totalCells.length===1?totalCells[0]:null,
      warning:cells.length!==1?(cells.length?'ambiguous MER cell':'MER cell not found'):null,
      terWarning:totalTerBounds&&totalCells.length!==1?(totalCells.length?'ambiguous Total Expense Ratio cell':'Total Expense Ratio cell not found'):null});
    }
    return {page,rows,totalTerHeader};
   }
   return null;
  };
  for(let i=0;i<coverPages.length;i++){
   const cover=coverPages[i],next=coverPages[i+1];
   const endPage=next?next.page-1:index[index.length-1].page;
   const name=titleFromCover(cover),dateInfo=parseDate(cover);
   if(!name||!dateInfo){warnings.push(`PDF page ${cover.page}: Empire Life fund name or Fund Facts date could not be validated.`);continue;}
   const sectionPages=index.filter(p=>p.page>=cover.page&&p.page<=endPage);
   const expense=findExpenseTable(sectionPages);
   const fund={name,startPage:cover.page,endPage,tablePages:expense?[expense.page.page]:[],documentType:'Fund Facts',report_date:dateInfo.date};
   funds.push(fund);
   if(!expense){warnings.push(`${name}: Ongoing Fund Expenses table not found or its MER column headings were not validated.`);continue;}
   const ptr=findPTR(cover);
   if(ptr.warning)warnings.push(`${name}: ${ptr.warning}. PTR left blank.`);
   const estimated=/\bMER\s*,\s*TER\s*(?:and|&)\s*FER\s+are\s+estimates\b/i.test(expense.page.text)||
    /\bMER\b.{0,100}\b(?:is|are)\s+estimated\b/i.test(expense.page.text);
   if(!expense.rows.length){warnings.push(`${name}: no class rows were validated in the MER table.`);continue;}
   for(const entry of expense.rows){
    let MER=null,merEvidence=null;
    if(entry.cell){
     const source=metricText(entry.cell.str);MER=UTIL.readMetric(source);
     merEvidence={page:expense.page.page,box:UTIL.box(entry.cell),sourceText:itemText(entry.cell),source:itemText(entry.cell),
      isMissing:MER===null,kind:'empire-life-fund-facts-management-expense-ratio',
      headingText:'Management Expense Ratio (MER)',...(estimated?{estimated:true}:{})};
    }else warnings.push(`${name} / ${entry.className}: ${entry.warning}; MER left blank.`);
    let TER=null,terEvidence=null;
    if(expense.totalTerHeader){
     if(entry.terCell){
      const totalSource=metricText(entry.terCell.str);TER=UTIL.readMetric(totalSource);
      terEvidence={page:expense.page.page,box:UTIL.box(entry.terCell),sourceText:itemText(entry.terCell),source:itemText(entry.terCell),
       isMissing:TER===null,kind:'empire-life-fund-facts-total-expense-ratio',headingText:itemText(expense.totalTerHeader)};
     }else if(entry.terWarning)warnings.push(`${name} / ${entry.className}: ${entry.terWarning}; Total TER left blank.`);
    }
    const row={row_id:UTIL.key(name,entry.className,dateInfo.date),fund_name:name,class_name:entry.className,
     report_date:dateInfo.date,year:Number(dateInfo.date.slice(0,4)),MER,TER,PTR:ptr.value,
     confidence:'validated-fund-facts-table-and-column',verified:false,document_type:'Fund Facts',
     metricStatus:estimated?{MER:'estimated'}:{},
     evidence:{MER:merEvidence,TER:terEvidence,PTR:ptr.evidence},source_page:expense.page.page,
     ptr_scope:'fund-level'};
    results.push(row);
   }
  }
  if(!funds.length)throw Error('Empire Life: Fund Facts documents were detected, but no fund names/dates could be validated.');
  if(!results.length)throw Error('Empire Life: no class/MER rows could be extracted from validated Ongoing Fund Expenses tables.');
  const dates=funds.map(f=>f.report_date).sort();
  const report_date=dates[dates.length-1];
  return {issuer:'The Empire Life Insurance Company',document_type:'Fund Facts',report_date,
   year:Number(report_date.slice(0,4)),funds,results,warnings};
 }
});
