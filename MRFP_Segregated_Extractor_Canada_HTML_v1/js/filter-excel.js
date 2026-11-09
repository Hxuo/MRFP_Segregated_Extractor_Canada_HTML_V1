/* Offline fund-list reader (.xlsx/.xlsm/.xls/.csv). No remote dependencies or macro execution. */
(function(global){
'use strict';
const MAX_FILE_BYTES=25*1024*1024;
const MAX_XML_BYTES=45*1024*1024;
const MAX_ROWS_PER_SHEET=120000;
const decoder=new TextDecoder('utf-8');
const nameKey=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g,'');
const headerKind=value=>{
 const key=nameKey(value);
 if(['assetid','lipperid'].includes(key))return 'asset';
 if(key==='fundname')return 'fund';
 return null;
};
function assert(condition,message){if(!condition)throw Error(message);}
function xmlParse(text,label){
 const document=new DOMParser().parseFromString(text,'application/xml');
 if(document.getElementsByTagName('parsererror').length)throw Error('Invalid Excel XML in '+label);
 return document;
}
const tags=(parent,name)=>Array.from(parent.getElementsByTagNameNS('*',name));
function children(element,name){return Array.from(element?.children||[]).filter(child=>child.localName===name);}
function child(element,name){return children(element,name)[0]||null;}
function excelColumnIndex(address){
 const m=/^([A-Z]+)\d+$/i.exec(address||'');if(!m)return -1;
 let index=0;for(const c of m[1].toUpperCase())index=index*26+c.charCodeAt(0)-64;
 return index-1;
}
function xmlPath(base,target){
 assert(target&&!/^https?:/i.test(target),'Unsupported external Excel worksheet reference');
 const path=target.startsWith('/')?target.slice(1):base.split('/').slice(0,-1).concat(target.split('/')).join('/');
 const result=[];
 for(const part of path.split('/')){
  if(!part||part==='.')continue;
  if(part==='..'){assert(result.length>0,'Invalid Excel worksheet path');result.pop();}else result.push(part);
 }
 return result.join('/');
}
function parseZipDirectory(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 let eocd=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--){if(view.getUint32(p,true)===0x06054b50){eocd=p;break;}}
 assert(eocd>=0,'Not a valid .xlsx Excel workbook');
 const total=view.getUint16(eocd+10,true),offset=view.getUint32(eocd+16,true);
 assert(total!==0xffff&&offset!==0xffffffff,'Very large Zip64 Excel workbooks are not supported');
 assert(total<=10000,'Excel workbook contains too many ZIP entries');
 const entries=new Map();let p=offset;
 for(let i=0;i<total;i++){
  assert(p+46<=bytes.length&&view.getUint32(p,true)===0x02014b50,'Excel ZIP directory is damaged');
  const method=view.getUint16(p+10,true),compressed=view.getUint32(p+20,true),uncompressed=view.getUint32(p+24,true);
  const len=view.getUint16(p+28,true),extra=view.getUint16(p+30,true),comment=view.getUint16(p+32,true),local=view.getUint32(p+42,true);
  assert(p+46+len+extra+comment<=bytes.length,'Invalid Excel ZIP directory');
  const filename=decoder.decode(bytes.subarray(p+46,p+46+len)).replace(/\\/g,'/');
  if(filename&&!filename.endsWith('/'))entries.set(filename,{method,compressed,uncompressed,local});
  p+=46+len+extra+comment;
 }
 async function readFile(filename,optional=false){
  const item=entries.get(filename);
  if(!item){if(optional)return '';throw Error('Excel workbook is missing '+filename);}
  assert(item.uncompressed<=MAX_XML_BYTES,'Excel worksheet is too large to import safely');
  const p=item.local;
  assert(p+30<=bytes.length&&view.getUint32(p,true)===0x04034b50,'Invalid Excel worksheet ZIP header');
  const start=p+30+view.getUint16(p+26,true)+view.getUint16(p+28,true);
  assert(start+item.compressed<=bytes.length,'Truncated Excel worksheet data');
  const raw=bytes.subarray(start,start+item.compressed);
  let decoded;
  if(item.method===0)decoded=raw;
  else if(item.method===8){
   assert(typeof DecompressionStream==='function','This browser cannot unzip Excel workbooks offline. Update Chrome or Edge.');
   const stream=new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
   decoded=new Uint8Array(await new Response(stream).arrayBuffer());
  }else throw Error('Unsupported Excel ZIP compression method');
  assert(decoded.byteLength<=MAX_XML_BYTES,'Excel worksheet exceeds the allowed size');
  return decoder.decode(decoded);
 }
 return {readFile,entries};
}
function getSharedStrings(doc){
 if(!doc)return [];
 return tags(doc,'si').map(si=>tags(si,'t').map(t=>t.textContent).join(''));
}
function getStyleFormats(doc){
 const formats=new Map();const cellXfs=tags(doc,'cellXfs')[0];
 for(const format of tags(doc,'numFmt'))formats.set(format.getAttribute('numFmtId'),format.getAttribute('formatCode')||'');
 const formatByStyle=[];
 for(const xf of children(cellXfs,'xf'))formatByStyle.push(formats.get(xf.getAttribute('numFmtId'))||'');
 return formatByStyle;
}
function formatNumericID(raw,style){
 let value=String(raw??'').trim();
 if(!value)return '';
 if(/^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(value)){
  const number=Number(value);
  if(Number.isSafeInteger(number))value=number.toLocaleString('fullwide',{useGrouping:false});
 }
 if(/^\d+\.0+$/.test(value))value=value.split('.')[0];
 // Explicit custom format "00000000" often stores zero-padded Asset IDs as numbers.
 if(/^0{2,18}$/.test(style||'')&&/^\d+$/.test(value))value=value.padStart(style.length,'0');
 return value;
}
function cellText(cellNode,strings,formats){
 const type=cellNode.getAttribute('t')||'';
 if(type==='inlineStr')return tags(cellNode,'t').map(node=>node.textContent).join('');
 const raw=child(cellNode,'v')?.textContent??'';
 if(type==='s')return strings[Number(raw)]??'';
 if(type==='str')return raw;
 if(type==='e')return '';
 if(type==='b')return raw==='1'?'TRUE':'FALSE';
 return formatNumericID(raw,formats[Number(cellNode.getAttribute('s'))]||'');
}
function parseWorksheet(doc,strings,formats){
 const sheetData=tags(doc,'sheetData')[0];
 if(!sheetData)return [];
 const rows=[];
 for(const rowNode of children(sheetData,'row')){
  assert(rows.length<MAX_ROWS_PER_SHEET,'Excel list exceeds the supported row limit');
  const columns=[];let sequential=0;
  for(const cellNode of children(rowNode,'c')){
   const idx=excelColumnIndex(cellNode.getAttribute('r'));
   const column=idx>=0?idx:sequential;
   assert(column<2000,'Excel worksheet has an unexpectedly large number of columns');
   columns[column]=String(cellText(cellNode,strings,formats)??'').trim();
   sequential=column+1;
  }
  if(columns.some(Boolean))rows.push({rowNumber:Number(rowNode.getAttribute('r'))||rows.length+1,cells:columns});
 }
 return rows;
}
function inspectSheet(sheet){
 const rows=sheet.rows||[];
 let best=null;
 for(let i=0;i<Math.min(rows.length,75);i++){
  const columns=rows[i].cells||[];let asset=-1,fund=-1;
  columns.forEach((value,idx)=>{
   const kind=headerKind(value);
   if(kind==='asset'&&asset<0)asset=idx;
   if(kind==='fund'&&fund<0)fund=idx;
  });
  if(fund>=0){best={headerRow:rows[i].rowNumber,headerIndex:i,assetColumn:asset,fundColumn:fund};if(asset>=0)break;}
 }
 if(!best||best.assetColumn<0||best.fundColumn<0)return {valid:false,validRows:0,rowsRead:0,entries:[],skipped:0,error:'The worksheet must have both Asset ID and Fund Name columns.'};
 const entries=[];let skipped=0;
 for(const row of rows.slice(best.headerIndex+1)){
  const name=String(row.cells[best.fundColumn]??'').trim().replace(/\s+/g,' ');
  const asset=String(row.cells[best.assetColumn]??'').trim();
  if(!name||nameKey(name)==='fundname'){skipped++;continue;}
  entries.push({lipperId:asset,name,excelRow:row.rowNumber});
 }
 return {valid:true,headerRow:best.headerRow,assetColumn:best.assetColumn,fundColumn:best.fundColumn,
  rowsRead:Math.max(0,rows.length-best.headerIndex-1),validRows:entries.length,skipped,entries};
}
async function readOpenXmlWorkbook(file){
 assert(file&&/\.(xlsx|xlsm)$/i.test(file.name||''),'Choose an .xlsx or .xlsm Excel workbook.');
 assert(file.size<=MAX_FILE_BYTES,'Excel file exceeds 25 MB');
 const bytes=new Uint8Array(await file.arrayBuffer()),zip=parseZipDirectory(bytes);
 const workbook=xmlParse(await zip.readFile('xl/workbook.xml'),'workbook.xml');
 const rels=xmlParse(await zip.readFile('xl/_rels/workbook.xml.rels'),'workbook relationships');
 const sharedText=await zip.readFile('xl/sharedStrings.xml',true);
 const styleText=await zip.readFile('xl/styles.xml',true);
 const shared=getSharedStrings(sharedText?xmlParse(sharedText,'sharedStrings.xml'):null);
 const formats=getStyleFormats(styleText?xmlParse(styleText,'styles.xml'):null);
 const relMap=new Map();
 for(const relationship of tags(rels,'Relationship'))relMap.set(relationship.getAttribute('Id'),relationship.getAttribute('Target'));
 const sheets=[];
 for(const definition of tags(workbook,'sheet')){
  const name=definition.getAttribute('name')||'Sheet '+(sheets.length+1);
  const rid=definition.getAttribute('r:id')||definition.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
  const target=relMap.get(rid);
  if(!target)continue;
  let part=xmlPath('xl/workbook.xml',target);
  if(!zip.entries.has(part)&&target.startsWith('xl/'))part=target;
  const xml=await zip.readFile(part);
  const rows=parseWorksheet(xmlParse(xml,name),shared,formats);
  const sheet={name,rows};
  sheets.push({...sheet,analysis:inspectSheet(sheet)});
 }
 assert(sheets.length>0,'No readable worksheets found in this Excel workbook');
 return {name:file.name,sheets};
}
// CSV and legacy Excel 97-2003 BIFF readers. Read-only. Never execute formulas or VBA macros.
const XLS_OLE_SIGNATURE=[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1];
const CFB_END=0xfffffffe, CFB_FREE=0xffffffff;
function decodePlainText(bytes,encoding='windows-1252'){
 return new TextDecoder(encoding).decode(bytes);
}
function readCSVBytes(bytes){
 let text;
 if(bytes.length>=2&&bytes[0]===0xff&&bytes[1]===0xfe)text=decodePlainText(bytes.subarray(2),'utf-16le');
 else if(bytes.length>=2&&bytes[0]===0xfe&&bytes[1]===0xff)text=decodePlainText(bytes.subarray(2),'utf-16be');
 else {
  const data=bytes.length>=3&&bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf?bytes.subarray(3):bytes;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{text=decodePlainText(data);}
 }
 assert(text.length<=MAX_XML_BYTES,'CSV file exceeds the supported size');
 // Count separators outside quotes in the first few physical rows. Do not split quoted fund names.
 const counts={',':0,';':0,'\t':0};let quoted=false,lines=0;
 for(let i=0;i<text.length&&lines<8;i++){
  const ch=text[i];
  if(ch==='"'){
   if(quoted&&text[i+1]==='"'){i++;continue;}
   quoted=!quoted;
  }else if(!quoted){
   if(ch==='\n')lines++;
   else if(ch in counts)counts[ch]++;
  }
 }
 const delimiter=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
 const rows=[];let cells=[],field='',insideQuote=false,rowIndex=1;
 function pushRow(){
  cells.push(field);field='';
  if(cells.some(v=>v.trim()!=='')){
   assert(rows.length<MAX_ROWS_PER_SHEET,'CSV file exceeds the supported row limit');
   assert(cells.length<=2000,'CSV file contains too many columns');
   rows.push({rowNumber:rowIndex,cells});
  }
  cells=[];rowIndex++;
 }
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(ch==='"'){
   if(insideQuote&&text[i+1]==='"'){field+='"';i++;}
   else insideQuote=!insideQuote;
  }else if(ch===delimiter&&!insideQuote){cells.push(field);field='';assert(cells.length<=2000,'CSV file contains too many columns');}
  else if((ch==='\n'||ch==='\r')&&!insideQuote){if(ch==='\r'&&text[i+1]==='\n')i++;pushRow();}
  else field+=ch;
 }
 assert(!insideQuote,'CSV file contains an unmatched quoted field');
 if(field!==''||cells.length)pushRow();
 return rows;
}
function readOleWorkbook(bytes){
 assert(bytes.length>=512&&XLS_OLE_SIGNATURE.every((v,i)=>bytes[i]===v),'Not a valid legacy .xls Excel workbook');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const u16=(offset)=>view.getUint16(offset,true), u32=(offset)=>view.getUint32(offset,true);
 const shift=u16(30),sectorSize=2**shift,miniSize=2**u16(32);
 assert((shift===9||shift===12)&&miniSize===64,'Unsupported Excel OLE sector layout');
 const fatCount=u32(44),directorySector=u32(48),miniCutoff=u32(56),miniFatStart=u32(60),miniFatCount=u32(64);
 const difatStart=u32(68),difatCount=u32(72);
 const totalSectors=Math.floor((bytes.length-sectorSize)/sectorSize);
 assert(totalSectors>0&&fatCount<=totalSectors&&difatCount<=totalSectors,'Excel OLE sector table is corrupt');
 const sector=(index)=>{
  assert(Number.isInteger(index)&&index>=0&&index<totalSectors,'Excel OLE sector index is out of range');
  const start=(index+1)*sectorSize;
  return bytes.subarray(start,start+sectorSize);
 };
 const fatSectors=[];
 for(let i=0;i<109;i++){const n=u32(76+4*i);if(n!==CFB_FREE)fatSectors.push(n);}
 let difat=difatStart;const seenDifat=new Set();
 for(let i=0;i<difatCount;i++){
  assert(difat!==CFB_END&&difat!==CFB_FREE&&!seenDifat.has(difat),'Invalid Excel OLE DIFAT chain');
  seenDifat.add(difat);const data=sector(difat),dv=new DataView(data.buffer,data.byteOffset,data.byteLength);
  for(let j=0;j<sectorSize/4-1;j++){const n=dv.getUint32(j*4,true);if(n!==CFB_FREE)fatSectors.push(n);}
  difat=dv.getUint32(sectorSize-4,true);
 }
 assert(fatSectors.length>=fatCount,'Excel OLE allocation table is incomplete');
 const fat=[];
 for(let i=0;i<fatCount;i++){
  const data=sector(fatSectors[i]),dv=new DataView(data.buffer,data.byteOffset,data.byteLength);
  for(let j=0;j<sectorSize;j+=4)fat.push(dv.getUint32(j,true));
 }
 function sectorChain(start,size,mini=false,rootData=null,miniFat=null){
  if(size===0)return new Uint8Array(0);
  assert(size<=MAX_XML_BYTES,'Excel workbook stream is too large');
  const unit=mini?miniSize:sectorSize;
  const expected=Math.ceil(size/unit);
  assert(expected<=totalSectors*(mini?sectorSize/miniSize:1),'Invalid Excel OLE stream size');
  const parts=new Uint8Array(size);let n=start,pos=0;
  const seen=new Set();
  for(let i=0;i<expected;i++){
   assert(n!==CFB_END&&n!==CFB_FREE&&!seen.has(n),'Excel OLE workbook stream is incomplete');
   seen.add(n);
   let part;
   if(mini){
    assert(rootData&&miniFat&&n>=0&&n<miniFat.length&&n*miniSize+miniSize<=rootData.length,'Excel OLE mini stream is corrupt');
    part=rootData.subarray(n*miniSize,n*miniSize+miniSize);
    n=miniFat[n];
   }else{
    part=sector(n);n=fat[n];
   }
   const len=Math.min(size-pos,part.length);parts.set(part.subarray(0,len),pos);pos+=len;
  }
  return parts;
 }
 const directory=[];let directoryData;
 {
  const chunks=[],visited=new Set();let n=directorySector;
  while(n!==CFB_END){
   assert(n!==CFB_FREE&&!visited.has(n)&&visited.size<=totalSectors,'Invalid Excel OLE directory chain');
   visited.add(n);chunks.push(sector(n));n=fat[n];
  }
  directoryData=new Uint8Array(chunks.length*sectorSize);
  chunks.forEach((chunk,i)=>directoryData.set(chunk,i*sectorSize));
 }
 for(let p=0;p+128<=directoryData.length;p+=128){
  const d=new DataView(directoryData.buffer,directoryData.byteOffset+p,128);
  const length=d.getUint16(64,true),type=directoryData[p+66];
  if(length<2||length>64||type===0)continue;
  const name=decodePlainText(directoryData.subarray(p,p+length-2),'utf-16le');
  directory.push({name,type,start:d.getUint32(116,true),size:d.getUint32(120,true)});
 }
 const root=directory.find(d=>d.type===5);
 const workbook=directory.find(d=>d.type===2&&/^(Workbook|Book)$/i.test(d.name));
 assert(root&&workbook,'Excel workbook stream was not found (encrypted or unsupported .xls file)');
 let rootData=null,miniFat=null;
 if(workbook.size<miniCutoff){
  assert(miniFatCount<=totalSectors,'Excel OLE mini allocation table is corrupt');
  rootData=sectorChain(root.start,root.size);
  const all=sectorChain(miniFatStart,miniFatCount*sectorSize);
  const dv=new DataView(all.buffer,all.byteOffset,all.byteLength);
  miniFat=[];for(let j=0;j<all.length;j+=4)miniFat.push(dv.getUint32(j,true));
 }
 return sectorChain(workbook.start,workbook.size,workbook.size<miniCutoff,rootData,miniFat);
}
function decodeBiffUnicode(record,offset=0,shortLength=false){
 const view=new DataView(record.buffer,record.byteOffset,record.byteLength);
 if(offset+(shortLength?2:3)>record.length)return '';
 const count=shortLength?record[offset]:view.getUint16(offset,true);
 const flag=record[offset+(shortLength?1:2)];
 const start=offset+(shortLength?2:3),width=flag&1?2:1;
 assert(count<=50000&&start+count*width<=record.length,'Excel text cell is truncated');
 const raw=record.subarray(start,start+count*width);
 return width===2?decodePlainText(raw,'utf-16le'):Array.from(raw,b=>String.fromCharCode(b)).join('');
}
function readBiffSST(chunks){
 const cursor={index:0,at:0};const strings=[];
 function move(){while(cursor.index<chunks.length&&cursor.at>=chunks[cursor.index].length){cursor.index++;cursor.at=0;}}
 function read(n){const out=new Uint8Array(n);let pos=0;
  while(pos<n){move();assert(cursor.index<chunks.length,'Excel shared string table is truncated');
   const chunk=chunks[cursor.index],len=Math.min(n-pos,chunk.length-cursor.at);
   out.set(chunk.subarray(cursor.at,cursor.at+len),pos);cursor.at+=len;pos+=len;}
  return out;
 }
 const take8=()=>read(1)[0],take16=()=>{const b=read(2);return b[0]|b[1]<<8;};
 const first=read(8),dv=new DataView(first.buffer);const count=dv.getUint32(4,true);
 assert(count<=400000,'Excel workbook contains too many shared strings');
 for(let k=0;k<count;k++){
  const n=take16(),flags=take8(),rich=flags&8?take16():0,phonetic=flags&4?new DataView(read(4).buffer).getUint32(0,true):0;
  assert(n<=50000&&phonetic<=MAX_XML_BYTES,'Invalid Excel shared string length');
  let width=flags&1?2:1,remaining=n,segments=[];
  while(remaining>0){
   move();assert(cursor.index<chunks.length,'Excel shared string characters are truncated');
   if(cursor.at===0&&cursor.index>0){width=take8()&1?2:1;move();}
   const chunk=chunks[cursor.index],available=Math.floor((chunk.length-cursor.at)/width);
   assert(available>0,'Invalid Excel split Unicode character');
   const chars=Math.min(available,remaining),part=read(chars*width);
   segments.push(width===2?decodePlainText(part,'utf-16le'):Array.from(part,b=>String.fromCharCode(b)).join(''));
   remaining-=chars;
  }
  strings.push(segments.join(''));
  if(rich)read(rich*4);
  if(phonetic)read(phonetic);
 }
 return strings;
}
function parseBiffWorkbook(data){
 const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
 const records=[];let p=0;
 while(p+4<=data.length){
  const id=view.getUint16(p,true),len=view.getUint16(p+2,true);
  assert(p+4+len<=data.length,'Excel BIFF record is truncated');
  records.push({id,at:p,data:data.subarray(p+4,p+4+len)});
  p+=4+len;
 }
 const sheets=[],formats=new Map(),styleFormats=[],strings=[];
 let biffVersion=0x0600,sstParts=null;
 for(let i=0;i<records.length;i++){
  const r=records[i],v=r.data;
  if(r.id===0x0809&&v.length>=4){const bv=v[0]|v[1]<<8;if(bv)biffVersion=bv;}
  if(r.id===0x002f)throw Error('Password-protected Excel .xls files are not supported. Please export an unprotected copy.');
  if(r.id===0x0085&&v.length>=8){
   const dv=new DataView(v.buffer,v.byteOffset,v.byteLength);const offset=dv.getUint32(0,true);
   let name='Sheet '+(sheets.length+1);
   if(biffVersion>=0x0600)name=decodeBiffUnicode(v,6,true);
   else {const n=v[6];name=decodePlainText(v.subarray(7,7+n));}
   sheets.push({name,offset});
  }else if(r.id===0x041e&&v.length>=4){
   const dv=new DataView(v.buffer,v.byteOffset,v.byteLength),formatIndex=dv.getUint16(0,true);
   if(biffVersion>=0x0600)formats.set(formatIndex,decodeBiffUnicode(v,2));
   else {const n=v[2];formats.set(formatIndex,decodePlainText(v.subarray(3,3+n)));}
  }else if(r.id===0x00e0&&v.length>=4){
   styleFormats.push(v[2]|v[3]<<8);
  }else if(r.id===0x00fc){
   sstParts=[v];while(records[i+1]?.id===0x003c)sstParts.push(records[++i].data);
  }
 }
 const shared=sstParts?readBiffSST(sstParts):strings;
 const output=[];
 for(const definition of sheets){
  const sheetRows=new Map(),offset=definition.offset;
  assert(offset<data.length,'Invalid Excel worksheet offset');
  let index=records.findIndex(r=>r.at===offset);
  assert(index>=0,'Excel worksheet record missing');
  let currentFormula=null;
  function setCell(row,column,value){
   if(!Number.isInteger(row)||!Number.isInteger(column)||row<0||column<0||column>=2000)return;
   assert(sheetRows.size<MAX_ROWS_PER_SHEET||sheetRows.has(row),'Excel worksheet exceeds the supported row limit');
   let cells=sheetRows.get(row);if(!cells){cells=[];sheetRows.set(row,cells);}
   cells[column]=String(value??'').trim();
  }
  function formatCell(raw,xf){const idx=styleFormats[xf]??0;return formatNumericID(raw,formats.get(idx)||'');}
  for(;index<records.length;index++){
   const r=records[index],v=r.data,dv=new DataView(v.buffer,v.byteOffset,v.byteLength);
   if(r.id===0x000a)break;
   if(r.id===0x0207&&currentFormula){
    try{setCell(currentFormula[0],currentFormula[1],decodeBiffUnicode(v));}catch{}
    currentFormula=null;continue;
   }
   if(r.id===0x0809)continue;
   currentFormula=null;
   if(v.length<6)continue;
   const row=dv.getUint16(0,true),col=dv.getUint16(2,true),xf=dv.getUint16(4,true);
   if(r.id===0x00fd&&v.length>=10){
    const n=dv.getUint32(6,true);setCell(row,col,shared[n]??'');
   }else if(r.id===0x0204&&v.length>=8){
    if(biffVersion>=0x0600)setCell(row,col,decodeBiffUnicode(v,6));
    else {const n=dv.getUint16(6,true);setCell(row,col,decodePlainText(v.subarray(8,8+n)));}
   }else if(r.id===0x0203&&v.length>=14){
    setCell(row,col,formatCell(String(dv.getFloat64(6,true)),xf));
   }else if(r.id===0x027e&&v.length>=10){
    setCell(row,col,formatCell(readRK(dv,6),xf));
   }else if(r.id===0x00bd&&v.length>=12){
    let column=col;
    for(let at=4;at+6<=v.length-2;at+=6){const style=dv.getUint16(at,true);setCell(row,column++,formatCell(readRK(dv,at+2),style));}
   }else if(r.id===0x0006&&v.length>=14){
    if(dv.getUint16(12,true)===0xffff){
     if(v[6]===0)currentFormula=[row,col];
    }else setCell(row,col,formatCell(String(dv.getFloat64(6,true)),xf));
   }
  }
  const rows=Array.from(sheetRows,([row,cells])=>({rowNumber:row+1,cells})).filter(r=>r.cells.some(Boolean)).sort((a,b)=>a.rowNumber-b.rowNumber);
  const sheet={name:definition.name,rows};output.push({...sheet,analysis:inspectSheet(sheet)});
 }
 assert(output.length>0,'No readable worksheets were found in this .xls workbook');
 return output;
}
function readRK(dv,offset){
 const raw=dv.getUint32(offset,true),isInteger=(raw&2)!==0,isHundredths=(raw&1)!==0;
 let number;
 if(isInteger)number=(raw|0)>>2;
 else {const bytes=new ArrayBuffer(8),out=new DataView(bytes);out.setUint32(4,raw&0xfffffffc,true);number=out.getFloat64(0,true);}
 return String(isHundredths?number/100:number);
}

async function readWorkbook(file){
 assert(file&&/\.(xlsx|xlsm|xls|csv)$/i.test(file.name||''),'Choose an .xlsx, .xls, .xlsm, or .csv file.');
 assert(file.size<=MAX_FILE_BYTES,'Fund-list file exceeds 25 MB');
 const extension=file.name.toLowerCase().split('.').pop();
 if(extension==='xlsx'||extension==='xlsm')return readOpenXmlWorkbook(file);
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(extension==='csv'){
  const rows=readCSVBytes(bytes),sheet={name:'CSV Data',rows};
  return {name:file.name,sheets:[{...sheet,analysis:inspectSheet(sheet)}]};
 }
 const workbook=readOleWorkbook(bytes);
 return {name:file.name,sheets:parseBiffWorkbook(workbook)};
}
global.MRFP_FILTER_EXCEL={readWorkbook,inspectSheet,headerKind};
})(globalThis);
