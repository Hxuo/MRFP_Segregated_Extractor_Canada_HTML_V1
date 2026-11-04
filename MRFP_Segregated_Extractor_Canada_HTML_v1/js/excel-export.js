/* XLSX/CSV exporter without any libraries: writes ISO OpenXML ZIP (STORE method). */
(function(global){
'use strict';
const enc=new TextEncoder();
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const fullName=r=>{
 const fund=String(r.fund_name||'').trim(),cls=String(r.class_name||'').trim();
 if(!fund||cls.toLowerCase()===fund.toLowerCase())return cls||fund;
 return cls.toLowerCase().startsWith(fund.toLowerCase()+' ')?cls:fund+' '+cls;
};
function cols(docs){
 const main=[['Fund Name','Class / Fund','Year','Reporting Date','MER','TER','PTR','MER Source','MER Page','TER Page','PTR Page','Verification','Filename']];
 const lipper=[['Lipper ID','Class / Fund','MER','TER','PTR','Reporting Date (MM/DD/YYYY)']];
 for(const doc of docs){
  for(const r of doc.results||[]){
   const ev=r.evidence||{};
   main.push([r.fund_name||'',fullName(r),r.year??null,r.report_date||null,r.MER??null,r.TER??null,r.PTR??null,ev.MER?.source||'',ev.MER?.page??null,ev.TER?.page??null,ev.PTR?.page??null,doc.verified?'Verified':'Unverified',doc.filename||'']);
   lipper.push([null,fullName(r),r.MER??null,r.TER??null,r.PTR??null,r.report_date||null]);
  }
 }
 return [main,lipper];
}
function toSerial(date){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return null;
 const time=Date.parse(date+'T00:00:00Z');
 return Number.isFinite(time)?(time-Date.UTC(1899,11,30))/86400000:null;
}
function cellRef(c,r){let a='';let n=c+1;while(n){n--;a=String.fromCharCode(65+(n%26))+a;n=Math.floor(n/26);}return a+r;}

function worksheet(table,dateIndex,plain=false){
  let rows='';

  table.forEach((row,ri)=>{
    const rownum=ri+1;

    const cells=row.map((val,ci)=>{
      if(val===null||val===undefined||val==='')return '';

      const ref=cellRef(ci,rownum);
      const style=ri===0&&!plain?1:2;

      if(ri>0&&ci===dateIndex){
        const serial=toSerial(val);
        return serial===null?'':`<c r="${ref}" s="3"><v>${serial}</v></c>`;
      }

      if(typeof val==='number'&&Number.isFinite(val)){
        return `<c r="${ref}" s="${style}"><v>${val}</v></c>`;
      }

      return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(val)}</t></is></c>`;
    }).join('');

    rows+=`<row r="${rownum}">${cells}</row>`;
  });

  const sheetView=plain
    ? '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';

  const autoFilter=plain
    ? ''
    : `<autoFilter ref="A1:${cellRef(table[0].length-1,Math.max(1,table.length))}"/>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
${sheetView}
<sheetFormatPr defaultRowHeight="16"/>
<sheetData>${rows}</sheetData>
${autoFilter}
</worksheet>`;
}

const files=table=>{
 const sheets=cols(table);
 return [
 ['[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
 ['_rels/.rels',`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
 ['xl/workbook.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Extraction Results" sheetId="1" r:id="rId1"/><sheet name="Lipper Format" sheetId="2" r:id="rId2"/></sheets></workbook>`],
 ['xl/_rels/workbook.xml.rels',`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
 ['xl/styles.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="mm/dd/yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF24476B"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
 ['xl/worksheets/sheet1.xml',worksheet(sheets[0],3)],
 ['xl/worksheets/sheet2.xml',worksheet(sheets[1],5,true)],

 ];
};
const table=(()=>{const a=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;a[i]=c>>>0;}return a;})();
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function u16(v){return [v&255,(v>>>8)&255];}function u32(v){return [v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255];}
function zip(entries){
 const chunks=[],central=[];let offset=0;
 const add=(b)=>{chunks.push(b);offset+=b.length;};
 for(const [name,content] of entries){
  const filename=enc.encode(name),bytes=enc.encode(content),checksum=crc32(bytes),fileOffset=offset;
  add(Uint8Array.from([...u32(0x04034b50),...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),...u32(checksum),...u32(bytes.length),...u32(bytes.length),...u16(filename.length),...u16(0)]));
  add(filename);add(bytes);
  central.push(Uint8Array.from([...u32(0x02014b50),...u16(20),...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),...u32(checksum),...u32(bytes.length),...u32(bytes.length),...u16(filename.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(fileOffset),...filename]));
 }
 const centralStart=offset;
 for(const b of central)add(b);
 add(Uint8Array.from([...u32(0x06054b50),...u16(0),...u16(0),...u16(entries.length),...u16(entries.length),...u32(offset-centralStart),...u32(centralStart),...u16(0)]));
 return new Blob(chunks,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
function excel(docs){return zip(files(docs));}
function csv(docs){
 const sheets=cols(docs);
 const output=[['Fund Name','Class / Fund','Year','Reporting Date','MER','TER','PTR','Verification','Filename']];
 for(const doc of docs)for(const r of doc.results||[])
  output.push([r.fund_name,fullName(r),r.year,r.report_date,r.MER,r.TER,r.PTR,doc.verified?'Verified':'Unverified',doc.filename]);
 const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
 return new Blob(['\ufeff'+output.map(r=>r.map(q).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
}
global.MRFP_EXPORT={excel,csv,fullName};
})(globalThis);
