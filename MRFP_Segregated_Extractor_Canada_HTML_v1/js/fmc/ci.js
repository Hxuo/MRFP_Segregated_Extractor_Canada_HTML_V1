/* CI Guaranteed Investment Funds: document-specific header and column geometry.
   No named list of CI funds. Every fund is discovered from report headings. */
registerFMC({
 key:'ci',name:'CI Investments Inc. — Guaranteed Investment Funds',
 detect(index){
  const cover=UTIL.clean(index.slice(0,2).map(p=>p.text).join(' '));
  return /FINANCIAL STATEMENTS/i.test(cover)&&/CI/i.test(cover)&&
   index.some(page=>/^CI\s+.+Guaranteed Investment Fund/i.test(UTIL.clean(page.header))&&
    /Financial Statements|Financial Information/i.test(page.header));
 },
 extract(index){
  const cover=UTIL.clean(index.slice(0,2).map(p=>p.text).join(' '));
  let m=cover.match(/(December|June)\s+(\d{1,2}),?\s+(20\d{2})/i);
  if(!m)throw Error('CI: Cannot validate reporting date from cover.');
  const month=m[1].toLowerCase()==='june'?'06':'12';
  const report_date=`${m[3]}-${month}-${String(m[2]).padStart(2,'0')}`;
  const periodYear=m[3];
  const warnings=[];
  // Real fund section headers only; never recognize fund names in holdings, TOC or investment narrative.
  const headerName=(page)=>{
   const rows=(page.lines||[]).slice(0,5).map(UTIL.clean);
   if(!rows.some(s=>/^(?:Financial Statements|Schedule of Investment Portfolio|Fund Specific Notes|Financial Information)/i.test(s)))return null;
   const title=rows.find(s=>/^CI\s+.+\s+Guaranteed Investment Fund\s*$/i.test(s));
   return title||null;
  };
  const funds=segmentFunds(index,headerName);
  if(!funds.length)throw Error('CI: No fund boundaries validated.');
  const result=[];
  for(const fund of funds){
   const tablePages=index.filter(p=>p.page>=fund.startPage&&p.page<=fund.endPage&&
      /Financial Highlights/i.test(p.text)&&/Management Expense Ratio/i.test(p.text)&&
      /ratio after/i.test(p.text)&&/Portfolio/i.test(p.text)&&/turnover/i.test(p.text));
   fund.tablePages=tablePages.map(p=>p.page);
   if(!tablePages.length){warnings.push(`${fund.name}: Financial Highlights table not found`);continue;}
   const seen=new Set();
   for(const page of tablePages){
    const items=(page.items||[]).filter(i=>i?.str?.trim()).sort((a,b)=>b.y-a.y||a.x-b.x);
    let active=null;
    for(const item of items){
     const txt=UTIL.clean(item.str);
     if(item.x<120&&/^Class\s+[A-Z][A-Z0-9-]*$/i.test(txt)){
      active=txt.replace(/\s+/g,' ');continue;
     }
     if(!active||item.x>80||txt!==periodYear||seen.has(active))continue;
     const sameLine=items.filter(i=>Math.abs(i.y-item.y)<1.6&&i.x>110&&i.str.trim());
     const pick=(min,max)=>sameLine.filter(i=>{
      const x=i.x/(page.width||612);return x>=min&&x<=max;
     }).filter(i=>UTIL.isNumber(i.str)||/^(?:[-–—−]|n\/a)$/i.test(i.str.trim()));
     // CI Financial Highlights: PTR is the Portfolio turnover rate column;
     // MER comes from 'Management expense ratio AFTER taxes', not the neighbouring
     // before-taxes or before-waivers columns. Coordinates are CI-adapter-only.
     const ptrCandidates=pick(.49,.57),merCandidates=pick(.76,.83);
     const before=pick(.62,.69)[0],hst=pick(.69,.75)[0];
     const ptr=ptrCandidates.length===1?ptrCandidates[0]:null;
     const mer=merCandidates.length===1?merCandidates[0]:null;
     if(!ptr||!mer){warnings.push(`${fund.name} / ${active}: ambiguous cells at PDF page ${page.page}`);continue;}
     const MER=UTIL.readMetric(mer.str),PTR=UTIL.readMetric(ptr.str);
     if(MER===null&&UTIL.isNumber(mer.str)){warnings.push(`${fund.name} / ${active}: invalid MER at ${page.page}`);continue;}
     const b=UTIL.readMetric(before?.str),h=UTIL.readMetric(hst?.str);
     if(b!==null&&h!==null&&MER!==null&&Math.abs(b+h-MER)>.035){
      warnings.push(`${fund.name} / ${active}: MER after-tax validation failed on page ${page.page}`);continue;
     }
     const ev=(source,metric)=>({page:page.page,sourceText:source.str.trim(),source:source.str.trim(),
       box:UTIL.box(source),isMissing:UTIL.readMetric(source.str)===null,
       kind:metric==='MER'?'ci-financial-highlights-mer-after-taxes':'ci-financial-highlights-portfolio-turnover'});
     const row={row_id:UTIL.key(fund.name,active,report_date),fund_name:fund.name,class_name:active,
      report_date,year:Number(periodYear),MER,TER:null,PTR,
      confidence:'validated-table-and-column',verified:false,
      evidence:{MER:ev(mer,'MER'),TER:null,PTR:ev(ptr,'PTR')},source_page:page.page};
     result.push(row);seen.add(active);
    }
   }
  }
  return {issuer:'CI Investments Inc.',report_date,year:Number(periodYear),funds,results:result,warnings};
 }
});
