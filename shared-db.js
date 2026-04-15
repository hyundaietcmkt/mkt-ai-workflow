/*
 * shared-db.js — 현대약품 AI 워크플로우 실시간 공유 저장소
 *
 * ★ 세팅: jsonbin.io 가입 → API Keys에서 Master Key 복사 → 아래 붙여넣기
 * ★ API Key 미입력 시 기존 localStorage 방식으로 동작 (오프라인)
 */
(function(){
const CFG={
  KEY:'YOUR_API_KEY_HERE',
  BIN_WF:'',
  BIN_PRI:'',
  URL:'https://api.jsonbin.io/v3/b',
  T:12000
};
const on=()=>CFG.KEY&&CFG.KEY!=='YOUR_API_KEY_HERE';
function gB(k){if(k==='wf_data')return CFG.BIN_WF||localStorage.getItem('_bid_wf')||'';if(k==='priority_items')return CFG.BIN_PRI||localStorage.getItem('_bid_pri')||'';return''}
function sB(k,id){if(k==='wf_data'){CFG.BIN_WF=id;localStorage.setItem('_bid_wf',id)}if(k==='priority_items'){CFG.BIN_PRI=id;localStorage.setItem('_bid_pri',id)}}
async function cR(b){const r=await fetch(CFG.URL+'/'+b+'/latest',{headers:{'X-Master-Key':CFG.KEY}});if(!r.ok)throw new Error(r.status);return(await r.json()).record}
async function cW(b,d){await fetch(CFG.URL+'/'+b,{method:'PUT',headers:{'Content-Type':'application/json','X-Master-Key':CFG.KEY},body:JSON.stringify(d)})}
async function cC(k,d){const r=await fetch(CFG.URL,{method:'POST',headers:{'Content-Type':'application/json','X-Master-Key':CFG.KEY,'X-Bin-Private':'false','X-Bin-Name':'hyundai-'+k},body:JSON.stringify(d)});const j=await r.json();if(j.metadata&&j.metadata.id){sB(k,j.metadata.id);console.log('✅ Bin created ('+k+'): '+j.metadata.id+' ← shared-db.js에 입력하세요!');return j.metadata.id}return''}
const st={},cb={};
function sync(k){if(st[k]||!on())return;st[k]=setInterval(async()=>{const b=gB(k);if(!b)return;try{const c=await cR(b);if(!c)return;const l=localStorage.getItem(k);if(JSON.stringify(c)!==l){localStorage.setItem(k,JSON.stringify(c));if(cb[k])cb[k](c)}}catch(e){}},CFG.T)}
window.sharedSave=async function(k,d){localStorage.setItem(k,JSON.stringify(d));if(!on())return;let b=gB(k);if(!b)b=await cC(k,d);else try{await cW(b,d)}catch(e){}};
window.sharedLoad=async function(k,df){if(on()){let b=gB(k);if(b)try{const c=await cR(b);if(c){localStorage.setItem(k,JSON.stringify(c));sync(k);return c}}catch(e){}}const l=localStorage.getItem(k);if(l)try{sync(k);return JSON.parse(l)}catch(e){}sync(k);return JSON.parse(JSON.stringify(df))};
window.sharedOnSync=function(k,c){cb[k]=c};
window.sharedIsOnline=on;
console.log('[SharedDB] '+(on()?'✅ Cloud ON':'❌ Offline — shared-db.js에 API Key 입력 필요'));
})();
