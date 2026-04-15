/*
 * shared-db.js v7 FINAL — 현대약품 AI 워크플로우 실시간 공유 저장소
 *
 * ★ KEY에 jsonbin.io API Key 입력
 *
 * v7 설계 원칙 (단순·확실):
 *   - save: 로컬 데이터를 서버에 그대로 덮어쓰기 (머지 없음)
 *   - sync: save 후 20초간 정지 → 이후 서버 데이터로 UI 갱신
 *   - 삭제/취소 → save → 서버에 즉시 반영 → 되살아남 불가
 */
(function(){
var CFG={
  KEY:'$2a$10$zz/mxGfqMKbtNMOl24jrKO0dWvL5Y7HhIq4v06zQztZNiUXoMUV16',
  BIN_WF:'69df1513aaba882197fe3178',
  BIN_PRI:'69df15a4aaba882197fe33c6',
  URL:'https://api.jsonbin.io/v3/b',
  T:8000,
  COOLDOWN:20000
};

function on(){return CFG.KEY && CFG.KEY!=='YOUR_API_KEY_HERE'}

function gB(k){
  if(k==='wf_data') return CFG.BIN_WF||localStorage.getItem('_bid_wf')||'';
  if(k==='priority_items') return CFG.BIN_PRI||localStorage.getItem('_bid_pri')||'';
  return '';
}
function sB(k,id){
  if(k==='wf_data'){CFG.BIN_WF=id;localStorage.setItem('_bid_wf',id)}
  if(k==='priority_items'){CFG.BIN_PRI=id;localStorage.setItem('_bid_pri',id)}
}

/* ===== API (응답 파싱 확실하게) ===== */
async function cR(b){
  var r=await fetch(CFG.URL+'/'+b+'/latest',{
    headers:{'X-Master-Key':CFG.KEY}
  });
  if(!r.ok) throw new Error('READ '+r.status);
  var j=await r.json();
  // jsonbin v3: {record: ..., metadata: ...}
  return j.record!==undefined ? j.record : j;
}

async function cW(b,d){
  var r=await fetch(CFG.URL+'/'+b,{
    method:'PUT',
    headers:{'Content-Type':'application/json','X-Master-Key':CFG.KEY},
    body:JSON.stringify(d)
  });
  if(!r.ok) throw new Error('WRITE '+r.status);
}

async function cC(k,d){
  var r=await fetch(CFG.URL,{
    method:'POST',
    headers:{'Content-Type':'application/json','X-Master-Key':CFG.KEY,'X-Bin-Private':'false','X-Bin-Name':'hyundai-'+k},
    body:JSON.stringify(d)
  });
  var j=await r.json();
  if(j.metadata&&j.metadata.id){
    sB(k,j.metadata.id);
    console.log('✅ Bin created ('+k+'): '+j.metadata.id);
    return j.metadata.id;
  }
  return '';
}

/* ===== STATE ===== */
var st={}, cb={}, lastSaveTime={}, lastSaveHash={};

/* ===== SYNC ===== */
function sync(k){
  if(st[k]||!on()) return;
  st[k]=setInterval(async function(){
    // save 후 쿨다운
    if(lastSaveTime[k] && (Date.now()-lastSaveTime[k] < CFG.COOLDOWN)) return;
    var b=gB(k);
    if(!b) return;
    try{
      var c=await cR(b);
      if(!c) return;
      var serverHash=JSON.stringify(c);
      var localHash=localStorage.getItem(k);
      // 서버와 로컬이 다를 때만 갱신
      if(serverHash!==localHash){
        // 내가 방금 저장한 것과 같으면 무시 (CDN 지연 대응)
        if(serverHash===lastSaveHash[k]) return;
        localStorage.setItem(k,serverHash);
        if(cb[k]) cb[k](c);
      }
    }catch(e){}
  }, CFG.T);
}

/* ===== SAVE (단순 덮어쓰기 — 머지 없음) ===== */
window.sharedSave=async function(k,d){
  var dataStr=JSON.stringify(d);
  localStorage.setItem(k,dataStr);
  lastSaveHash[k]=dataStr;
  lastSaveTime[k]=Date.now();

  if(!on()) return;
  var b=gB(k);
  if(!b){
    await cC(k,d);
    return;
  }
  try{
    await cW(b,d);
    // write 완료 후 쿨다운 갱신
    lastSaveTime[k]=Date.now();
  }catch(e){
    console.warn('[SharedDB] SAVE 실패:', e.message);
  }
};

/* ===== LOAD ===== */
window.sharedLoad=async function(k,df){
  if(on()){
    var b=gB(k);
    if(b){
      try{
        var c=await cR(b);
        if(c){
          localStorage.setItem(k,JSON.stringify(c));
          sync(k);
          return c;
        }
      }catch(e){}
    }
  }
  var l=localStorage.getItem(k);
  if(l){try{sync(k);return JSON.parse(l)}catch(e){}}
  sync(k);
  return JSON.parse(JSON.stringify(df));
};

window.sharedOnSync=function(k,c){cb[k]=c};
window.sharedIsOnline=on;
console.log('[SharedDB] '+(on()?'✅ Cloud ON (v7 final)':'❌ Offline'));
})();
