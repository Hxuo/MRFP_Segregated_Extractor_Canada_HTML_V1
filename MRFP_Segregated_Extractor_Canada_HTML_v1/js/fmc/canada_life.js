/* Canada Life Segregated Funds Fund Facts adapter.
   The class matrix is formed from vertical series rows × horizontal guarantee-policy
   columns. Page 1 is the primary source for MER, UOS, estimate status and PTR. The
   page-2 Ongoing Expenses MER table is used only as a secondary cross-check. The
   printed TER is Trading Expense Ratio and FER is Fund Expense Ratio; neither may
   populate the system's Total TER. */
registerFMC({
 key:'canada_life',
 name:'The Canada Life Assurance Company — Segregated Funds Fund Facts',
 detect(index){
  return index.some(page=>{
   const text=UTIL.clean(page.text);
   return /The Canada Life Assurance Company/i.test(text)&&
    /FUND FACTS/i.test(text)&&
    /Canada Life Segregated Funds Policy/i.test(text)&&
    /Quick facts/i.test(text)&&
    /Portfolio turnover rate/i.test(text);
  });
 },
 extract(index){
  const warnings=[],funds=[],results=[];
  const clean=UTIL.clean;
  const textOf=item=>clean(item?.str);
  const cx=item=>item.x+(item.w||0)/2;
  const numericOrDash=value=>{
   const raw=clean(value).replace(/[†‡*]+$/,'');
   return UTIL.isNumber(raw)||/^(?:[-–—−]|n\/a|na|nil|not available)$/i.test(raw)?raw:null;
  };
  const monthMap={january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',july:'07',august:'08',september:'09',october:'10',november:'11',december:'12'};
  const parseDate=page=>{
   const match=clean(page.text).match(/All information as at\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(20\d{2})/i);
   if(!match)return null;
   return `${match[3]}-${monthMap[match[1].toLowerCase()]}-${String(Number(match[2])).padStart(2,'0')}`;
  };
  const isCover=page=>{
   const text=clean(page.text);
   return /The Canada Life Assurance Company/i.test(text)&&
    /FUND FACTS/i.test(text)&&/Canada Life Segregated Funds Policy/i.test(text)&&
    /Quick facts/i.test(text)&&/Portfolio turnover rate/i.test(text)&&!!parseDate(page);
  };
  const fundTitle=page=>{
   const candidates=(page.items||[]).filter(item=>item.x<200&&item.y>710&&item.y<745&&
    textOf(item)&&!/(?:FUND FACTS|Canada Life|Assurance Company|All information)/i.test(textOf(item)))
    .sort((a,b)=>b.y-a.y||a.x-b.x);
   return candidates.length===1?textOf(candidates[0]):null;
  };
  const parseSeriesName=raw=>{
   const text=clean(raw).replace(/[¹²³]/g,'').replace(/\s+/g,' ');
   let head=text.split(':')[0].trim();
   if(!/\bseries\b/i.test(head)){
    const match=text.match(/^(.+?\bseries(?:\s+\d+)?)(?:\s|$)/i);
    if(!match)return null;
    head=match[1].trim();
   }
   if(!head||head.length>70)return null;
   return head.split(/\s+/).map(word=>word.charAt(0).toUpperCase()+word.slice(1).toLowerCase()).join(' ');
  };
  const isEstimateNote=page=>/if there are zero units outstanding,\s*the MER shown is an estimate/i.test(clean(page.text));
  const findNoteItem=page=>(page.items||[]).find(item=>/if there are zero units outstanding/i.test(textOf(item))&&/MER shown is an estimate/i.test(textOf(item)))||null;
  const parsePTR=page=>{
   const labels=(page.items||[]).filter(item=>/^Portfolio turnover rate:?$/i.test(textOf(item)));
   if(labels.length!==1)return {value:null,evidence:null,warning:labels.length?'ambiguous Portfolio Turnover Rate label':'Portfolio Turnover Rate label not found'};
   const label=labels[0];
   const cells=(page.items||[]).filter(item=>Math.abs(item.y-label.y)<2.5&&item.x>=label.x+label.w-2&&numericOrDash(item.str)!==null);
   if(cells.length!==1)return {value:null,evidence:null,warning:cells.length?'ambiguous Portfolio Turnover Rate value':'Portfolio Turnover Rate value not found'};
   const cell=cells[0],value=UTIL.readMetric(numericOrDash(cell.str));
   return {value,evidence:{page:page.page,box:UTIL.box(cell),sourceText:textOf(cell),source:textOf(cell),isMissing:value===null,
    kind:'canada-life-fund-facts-portfolio-turnover-rate',scope:'fund-level'}};
  };
  const lineGroups=(items,maxX,minY,maxY)=>{
   const lines=[];
   for(const item of (items||[]).filter(i=>i.x<maxX&&i.y<=maxY&&i.y>=minY&&textOf(i)).sort((a,b)=>b.y-a.y||a.x-b.x)){
    let line=lines.find(g=>Math.abs(g.y-item.y)<2.2);
    if(!line){line={y:item.y,items:[]};lines.push(line);}
    line.items.push(item);
   }
   for(const line of lines){line.items.sort((a,b)=>a.x-b.x);line.text=line.items.map(textOf).join(' ').replace(/\s+/g,' ').trim();}
   return lines.sort((a,b)=>b.y-a.y);
  };
  const findSeriesBlocks=(page,policyY)=>{
   const lines=lineGroups(page.items,118,policyY-145,policyY-7);
   const blocks=[];
   for(const line of lines){
    let block=blocks[blocks.length-1];
    if(!block||block.topY-line.y>10.5){block={topY:line.y,bottomY:line.y,lines:[]};blocks.push(block);}
    block.bottomY=Math.min(block.bottomY,line.y);block.lines.push(line);
   }
   return blocks.map(block=>{
    const raw=block.lines.map(line=>line.text).join(' ').replace(/\s+/g,' ').trim();
    return {...block,raw,seriesName:parseSeriesName(raw)};
   }).filter(block=>block.seriesName);
  };
  // Primary MER source: the Quick Facts matrix on page 1. Each guarantee-policy
  // heading spans a horizontal MER/NAV/UOS group; MER is aligned by its own header,
  // not by the centre of the wider guarantee group.
  const findCoverMERTable=page=>{
   const text=clean(page.text),items=page.items||[];
   if(!/guarantee policy/i.test(text)||!/quick facts/i.test(text)||!/portfolio turnover rate/i.test(text))return null;
   const merHeaders=items.filter(i=>/^MER\s*\(%\)$/i.test(textOf(i))).sort((a,b)=>cx(a)-cx(b));
   const uosHeaders=items.filter(i=>/^UOS$/i.test(textOf(i))&&merHeaders.length&&Math.abs(i.y-merHeaders[0].y)<2.5).sort((a,b)=>cx(a)-cx(b));
   if(!merHeaders.length||uosHeaders.length!==merHeaders.length)return null;
   const headerY=merHeaders.reduce((n,i)=>n+i.y,0)/merHeaders.length;
   if(merHeaders.some(i=>Math.abs(i.y-headerY)>2.5))return null;
   const policyItems=items.filter(i=>/^\d{2,3}\s*\/\s*\d{2,3}$/.test(textOf(i))&&i.y>headerY+4&&i.y<headerY+28)
    .sort((a,b)=>cx(a)-cx(b));
   if(policyItems.length!==merHeaders.length)return null;
   const policyLevels=policyItems.map(item=>({level:textOf(item).replace(/\s+/g,''),item,center:cx(item)}));
   if(new Set(policyLevels.map(p=>p.level)).size!==policyLevels.length)return null;
   const policyY=policyLevels.reduce((n,p)=>n+p.item.y,0)/policyLevels.length;
   const lines=lineGroups(items,210,policyY-115,headerY-5);
   const parsedRows=[],seen=new Set();
   for(const line of lines){
    const seriesName=parseSeriesName(line.text);
    if(!seriesName)continue;
    if(seen.has(seriesName)){parsedRows.push({seriesName,warning:'duplicate series label'});continue;}
    seen.add(seriesName);
    const cells=merHeaders.map(header=>{
     const matches=items.filter(item=>Math.abs(item.y-line.y)<2.5&&numericOrDash(item.str)!==null&&Math.abs(cx(item)-cx(header))<20);
     return matches.length===1?matches[0]:null;
    });
    if(cells.some(cell=>!cell))parsedRows.push({seriesName,warning:'MER cells could not be aligned to every guarantee-policy heading'});
    else parsedRows.push({seriesName,cells,line});
   }
   if(!parsedRows.length)return null;
   return {page,policyLevels,policyY,rows:parsedRows,merHeaders,uosHeaders,headerY,kind:'quick-facts-primary'};
  };
  // Secondary-only source: the Ongoing Expenses matrix on page 2. It may confirm
  // page-1 MER values, but it never supplies the production value or evidence cell.
  const findOngoingExpensesMERTable=pages=>{
   for(const page of pages){
    const text=clean(page.text),items=page.items||[];
    if(!/2\.\s*Ongoing expenses/i.test(text)||
       !/management expense ratio\s*\(MER\)/i.test(text)||
       !/trading expense ratio\s*\(TER\)/i.test(text)||
       !/fund expense ratio\s*\(FER\)/i.test(text))continue;
    const merHeaders=items.filter(i=>/^MER\s*\(%\)$/i.test(textOf(i)));
    const tradingHeaders=items.filter(i=>/^TER\s*\(%\)$/i.test(textOf(i)));
    const ferHeaders=items.filter(i=>/^FER\s*\(%\)$/i.test(textOf(i)));
    if(merHeaders.length!==1||tradingHeaders.length!==1||ferHeaders.length!==1)continue;
    const merHeader=merHeaders[0],tradingHeader=tradingHeaders[0],ferHeader=ferHeaders[0];
    const policyItems=items.filter(i=>/^\d{2,3}\s*\/\s*\d{2,3}$/.test(textOf(i))&&
      i.y<merHeader.y&&i.y>merHeader.y-38&&Math.abs(i.y-merHeader.y)>8&&cx(i)<cx(tradingHeader)-20)
      .sort((a,b)=>cx(a)-cx(b));
    const policyLevels=[];
    for(const item of policyItems){
     const level=textOf(item).replace(/\s+/g,'');
     if(!policyLevels.some(p=>p.level===level))policyLevels.push({level,item,center:cx(item)});
    }
    if(!policyLevels.length||policyLevels.length!==policyItems.length)continue;
    const policyY=policyLevels.reduce((sum,p)=>sum+p.item.y,0)/policyLevels.length;
    const blocks=findSeriesBlocks(page,policyY);
    if(!blocks.length)continue;
    const parsedRows=[],seen=new Set();
    for(const block of blocks){
     if(seen.has(block.seriesName)){parsedRows.push({seriesName:block.seriesName,warning:'duplicate series label'});continue;}
     seen.add(block.seriesName);
     const candidateYs=[];
     for(const item of items){
      if(numericOrDash(item.str)===null||item.x<Math.min(...policyLevels.map(p=>p.center))-25||item.x>Math.max(...policyLevels.map(p=>p.center))+25)continue;
      if(item.y>=block.bottomY-2.2&&item.y<=block.topY+2.2&&!candidateYs.some(y=>Math.abs(y-item.y)<2.0))candidateYs.push(item.y);
     }
     const complete=[];
     for(const y of candidateYs){
      const cells=policyLevels.map(policy=>{
       const matches=items.filter(item=>Math.abs(item.y-y)<2.0&&numericOrDash(item.str)!==null&&Math.abs(cx(item)-policy.center)<25);
       return matches.length===1?matches[0]:null;
      });
      if(cells.every(Boolean))complete.push({y,cells});
     }
     if(complete.length!==1){parsedRows.push({seriesName:block.seriesName,warning:complete.length?'ambiguous secondary MER row':'secondary MER cells could not be aligned'});continue;}
     parsedRows.push({seriesName:block.seriesName,cells:complete[0].cells,block});
    }
    return {page,policyLevels,policyY,rows:parsedRows,merHeader,tradingHeader,ferHeader};
   }
   return null;
  };
  const crossCheckPage2=(primary,secondary,fundName)=>{
   if(!secondary)return {status:'unavailable',page:null,matched:0,mismatches:0};
   const secondaryRows=new Map(secondary.rows.filter(r=>r.cells).map(r=>[r.seriesName,r]));
   const secondaryLevels=new Map(secondary.policyLevels.map((p,i)=>[p.level,i]));
   let matched=0,mismatches=0;
   for(const row of primary.rows.filter(r=>r.cells)){
    const other=secondaryRows.get(row.seriesName);if(!other)continue;
    for(let col=0;col<primary.policyLevels.length;col++){
     const level=primary.policyLevels[col].level,otherCol=secondaryLevels.get(level);
     if(otherCol===undefined||!other.cells[otherCol])continue;
     const a=UTIL.readMetric(numericOrDash(row.cells[col].str));
     const b=UTIL.readMetric(numericOrDash(other.cells[otherCol].str));
     matched++;
     if(a!==b){mismatches++;warnings.push(`${fundName}: Page 2 secondary MER cross-check differs for ${row.seriesName} ${level}; Page 1 remains the primary source.`);}
    }
   }
   return {status:mismatches?'mismatch':matched?'matched':'unavailable',page:secondary.page.page,matched,mismatches};
  };
  const findUOSRows=(cover,seriesNames,guaranteeCount)=>{
   const items=cover.items||[];
   const headers=items.filter(i=>/^UOS$/i.test(textOf(i))&&i.y>635&&i.y<675).sort((a,b)=>cx(a)-cx(b));
   if(headers.length!==guaranteeCount)return {rows:new Map(),warning:`expected ${guaranteeCount} UOS columns but found ${headers.length}`};
   const labels=items.filter(i=>i.x<210&&i.y>590&&i.y<650&&/\bseries\b/i.test(textOf(i)));
   const rows=new Map();let warning=null;
   for(const seriesName of seriesNames){
    const matching=labels.filter(item=>parseSeriesName(textOf(item))===seriesName);
    if(matching.length!==1){warning=`${seriesName}: expected one matching Quick Facts series row, found ${matching.length}`;continue;}
    const label=matching[0],sameLine=items.filter(item=>Math.abs(item.y-label.y)<2.5&&numericOrDash(item.str)!==null);
    const values=headers.map(header=>{
     const matches=sameLine.filter(item=>Math.abs(cx(item)-cx(header))<19);
     if(matches.length!==1)return null;
     const raw=clean(matches[0].str).replace(/,/g,'');
     return /^\d+$/.test(raw)?{value:Number(raw),item:matches[0]}:null;
    });
    if(values.some(value=>!value)){warning=`${seriesName}: UOS values could not be aligned to every guarantee-policy column`;continue;}
    rows.set(seriesName,values);
   }
   return {rows,warning};
  };

  const coverPages=index.filter(isCover);
  if(!coverPages.length)throw Error('Canada Life: no supported Segregated Funds Fund Facts cover page found.');
  for(let i=0;i<coverPages.length;i++){
   const cover=coverPages[i],next=coverPages[i+1],endPage=next?next.page-1:index[index.length-1].page;
   const name=fundTitle(cover),reportDate=parseDate(cover);
   if(!name||!reportDate){warnings.push(`PDF page ${cover.page}: fund title or Fund Facts as-of date could not be validated.`);continue;}
   const sectionPages=index.filter(page=>page.page>=cover.page&&page.page<=endPage);
   const table=findCoverMERTable(cover);
   const secondaryTable=findOngoingExpensesMERTable(sectionPages);
   const fund={name,startPage:cover.page,endPage,tablePages:table?[table.page.page]:[],documentType:'Fund Facts',report_date:reportDate};
   funds.push(fund);
   if(!table){warnings.push(`${name}: Quick Facts page-1 MER matrix not found or its guarantee-policy headings were not validated.`);continue;}
   fund.secondaryMERValidation=crossCheckPage2(table,secondaryTable,name);
   const seriesNames=table.rows.map(row=>row.seriesName);
   if(new Set(seriesNames).size!==seriesNames.length)warnings.push(`${name}: duplicate series labels detected in the MER matrix.`);
   const uos=findUOSRows(cover,seriesNames,table.policyLevels.length);
   if(uos.warning)warnings.push(`${name}: ${uos.warning}. Affected MER estimate status left unverified.`);
   const notePage=sectionPages.find(isEstimateNote)||null;
   const noteItem=notePage?findNoteItem(notePage):null;
   const hasEstimateNote=!!notePage;
   if(!hasEstimateNote)warnings.push(`${name}: zero-UOS MER estimate footnote not found; no MER values will be marked estimated.`);
   const ptr=parsePTR(cover);
   if(ptr.warning)warnings.push(`${name}: ${ptr.warning}; PTR left blank.`);
   for(const seriesRow of table.rows){
    if(seriesRow.warning){warnings.push(`${name} / ${seriesRow.seriesName}: ${seriesRow.warning}.`);continue;}
    const uosValues=uos.rows.get(seriesRow.seriesName)||null;
    for(let col=0;col<table.policyLevels.length;col++){
     const policy=table.policyLevels[col],cell=seriesRow.cells[col];
     const raw=numericOrDash(cell.str),MER=UTIL.readMetric(raw);
     const uosCell=uosValues?.[col]||null;
     const estimated=!!(uosCell&&uosCell.value===0&&hasEstimateNote);
     if(uosCell?.value===0&&!hasEstimateNote)warnings.push(`${name} / ${seriesRow.seriesName} ${policy.level}: zero UOS found but estimate footnote is absent; MER estimate status not asserted.`);
     const className=`${seriesRow.seriesName} ${policy.level}`;
     const merEvidence={page:cover.page,box:UTIL.box(cell),sourceText:textOf(cell),source:textOf(cell),isMissing:MER===null,
      kind:'canada-life-fund-facts-management-expense-ratio',headingText:'Management Expense Ratio (MER)',...(estimated?{estimated:true}:{})};
     const row={row_id:UTIL.key(name,className,reportDate),fund_name:name,class_name:className,
      report_date:reportDate,year:Number(reportDate.slice(0,4)),MER,TER:null,PTR:ptr.value,
      confidence:'validated-series-by-guarantee-matrix',verified:false,document_type:'Fund Facts',
      metricStatus:estimated?{MER:'estimated'}:{},
      ...(estimated?{metricStatusEvidence:{MER:{reason:'Corresponding Units Outstanding is zero and the source footnote states that MER is an estimate.',
       uos:{page:cover.page,box:UTIL.box(uosCell.item),sourceText:textOf(uosCell.item),guaranteeLevel:policy.level},
       footnote:{page:notePage.page,box:noteItem?UTIL.box(noteItem):null,sourceText:noteItem?textOf(noteItem):'If there are zero units outstanding, the MER shown is an estimate.'}}}}:{}),
      evidence:{MER:merEvidence,TER:null,PTR:ptr.evidence},source_page:cover.page,ptr_scope:'fund-level',
      series_name:seriesRow.seriesName,guarantee_policy:policy.level};
     results.push(row);
    }
   }
   if(!uos.rows.size)warnings.push(`${name}: no validated UOS series rows; MER estimate flags were not applied.`);
  }
  if(!funds.length)throw Error('Canada Life: Fund Facts documents were detected, but no fund title/date could be validated.');
  if(!results.length)throw Error('Canada Life: no series/guarantee MER records could be extracted from a validated Quick Facts matrix.');
  const dates=funds.map(f=>f.report_date).sort();
  const report_date=dates[dates.length-1];
  return {issuer:'The Canada Life Assurance Company',document_type:'Fund Facts',report_date,
   year:Number(report_date.slice(0,4)),funds,results,warnings};
 }
});
