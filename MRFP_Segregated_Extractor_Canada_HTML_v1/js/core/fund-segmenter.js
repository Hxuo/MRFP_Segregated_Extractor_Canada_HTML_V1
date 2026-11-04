/* Issuer supplies its own header recognition; generic segmenter only enforces boundaries. */
function segmentFunds(index,headerFn){
 const sections=[];let last=null;
 for(const page of index){
  const entry=headerFn(page);
  if(!entry)continue;
  const name=typeof entry==='string'?entry:entry.name;
  if(!name)continue;
  if(!last||last.name!==name){
   if(last)last.endPage=page.page-1;
   last={name,startPage:page.page,endPage:index.length,confidence:'validated-header',tablePages:[]};
   sections.push(last);
  }
 }
 return sections;
}
