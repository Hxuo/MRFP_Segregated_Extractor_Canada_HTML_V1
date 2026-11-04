/* Shared structures only. No issuer-specific names, coordinates, or table rules. */
const UTIL={
 clean:s=>String(s??'').replace(/\s+/g,' ').trim(),
 isNumber:s=>/^-?(?:\d+(?:,\d{3})*|\d+)(?:\.\d+)?%?$/.test(String(s??'').trim()),
 readMetric:s=>{let t=String(s??'').trim();return /^(?:[-–—−]|n\/a|na|nil|not available)$/i.test(t)||!t?null:(/^-?(?:\d+(?:,\d{3})*|\d+)(?:\.\d+)?%?$/.test(t)?Number(t.replace(/[,%]/g,'')):null);},
 box:i=>i?{x:i.x-.75,y:i.y-1.2,w:Math.max(2,i.w+1.5),h:Math.max(6,i.h+2.0)}:null,
 key:(fund,cls,period)=>[fund,cls,period].map(s=>String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-')).join('|'),
 metricKeys:['MER','TER','PTR'],
 escape:s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))
};
