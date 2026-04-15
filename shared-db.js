/*
 * shared-db.js v8 FINAL — 현대약품 AI 워크플로우 실시간 공유 저장소
 *
 * ★ KEY에 jsonbin.io API Key 입력
 *
 * v8 핵심:
 *   - 삭제 이력(_del_) 추적 → 삭제한 항목은 절대 부활 안 함
 *   - save시 서버 신규 항목 머지 → 다른 사람이 추가한 건 보존
 *   - sync시 신규 항목/신규 신청자만 추가 → 로컬 삭제/취소 유지
 */
(function(){
var CFG={
  KEY:'$2a$10$zz/mxGfqMKbtNMOl24jrKO0dWvL5Y7HhIq4v06zQztZNiUXoMUV16',
  BIN_WF:'69df1513aaba882197fe3178',
  BIN_PRI:'69df15a4aaba882197fe33c6',
  URL:'https://api.jsonbin.io/v3/b',
  T:8000,
  COOLDOWN:15000
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

/* ===== 삭제 이력 ===== */
function getDelSet(k){
  try{var a=JSON.parse(localStorage.getItem('_del_'+k)||'[]');var s={};a.forEach(function(id){s[id]=true});return s}catch(e){return{}}
}
function addDel(k,id){
  try{var a=JSON.parse(localStorage.getItem('_del_'+k)||'[]')}catch(e){var a=[]}
  if(a.indexOf(id)<0) a.push(id);
  localStorage.setItem('_del_'+k,JSON.stringify(a));
}

/* ===== API ===== */
async function cR(b){
  var r=await fetch(CFG.URL+'/'+b+'/latest',{headers:{'X-Master-Key':CFG.KEY}});
  if(!r.ok) throw new Error(r.status);
  var j=await r.json();
  return j.record!==undefined ? j.record : j;
}
async function cW(b,d){
  var r=await fetch(CFG.URL+'/'+b,{method:'PUT',headers:{'Content-Type':'application/json','X-Master-Key':CFG.KEY},body:JSON.stringify(d)});
  if(!r.ok) throw new Error(r.status);
}
async function cC(k,d){
  var r=await fetch(CFG.URL,{method:'POST',headers:{'Content-Type':'application/json','X-Master-Key':CFG.KEY,'X-Bin-Private':'false','X-Bin-Name':'hyundai-'+k},body:JSON.stringify(d)});
  var j=await r.json();
  if(j.metadata&&j.metadata.id){sB(k,j.metadata.id);console.log('Bin created ('+k+'): '+j.metadata.id);return j.metadata.id}
  return '';
}

/* ===== saveMerge: 로컬 + 서버 신규(삭제이력에 없는 것만) ===== */
function saveMerge(k, local, remote){
  if(!Array.isArray(local)||!Array.isArray(remote)) return local;
  var localIds={};
  local.forEach(function(w){localIds[w.id]=true});
  var ds=getDelSet(k);
  var result=local.map(function(w){return JSON.parse(JSON.stringify(w))});
  remote.forEach(function(w){
    if(!localIds[w.id] && !ds[w.id]){
      result.push(JSON.parse(JSON.stringify(w)));
    }
  });
  return result;
}

/* ===== STATE ===== */
var st={}, cb={}, lastSaveTime={}, lastSaveHash={};

/* ===== SYNC ===== */
function sync(k){
  if(st[k]||!on()) return;
  st[k]=setInterval(async function(){
    if(lastSaveTime[k] && (Date.now()-lastSaveTime[k] < CFG.COOLDOWN)) return;
    var b=gB(k);
    if(!b) return;
    try{
      var remote=await cR(b);
      if(!remote||!Array.isArray(remote)) return;
      var localStr=localStorage.getItem(k);
      var serverStr=JSON.stringify(remote);
      if(serverStr===localStr) return;
      if(serverStr===lastSaveHash[k]) return;

      var local;
      try{local=JSON.parse(localStr)}catch(e){return}
      if(!Array.isArray(local)) return;

      var localIds={};
      local.forEach(function(w){localIds[w.id]=true});
      var ds=getDelSet(k);
      var changed=false;

      // 기존 항목: applicants 새 신청자만 추가
      var result=local.map(function(w){
        var ri=null;
        for(var i=0;i<remote.length;i++){if(remote[i].id===w.id){ri=remote[i];break}}
        if(!ri) return w;
        var la=w.applicants||[];
        var ra=ri.applicants||[];
        var laSet={};
        la.forEach(function(a){laSet[a]=true});
        var nw=[];
        ra.forEach(function(a){if(!laSet[a]) nw.push(a)});
        if(nw.length>0){
          var copy=JSON.parse(JSON.stringify(w));
          copy.applicants=la.concat(nw);
          changed=true;
          return copy;
        }
        return w;
      });

      // 서버에만 있는 신규 항목 (삭제 이력 없으면 추가)
      remote.forEach(function(w){
        if(!localIds[w.id] && !ds[w.id]){
          result.push(JSON.parse(JSON.stringify(w)));
          changed=true;
        }
      });

      if(changed){
        localStorage.setItem(k,JSON.stringify(result));
        if(cb[k]) cb[k](result);
      }
    }catch(e){}
  }, CFG.T);
}

/* ===== SAVE ===== */
window.sharedSave=async function(k,d){
  var ds=JSON.stringify(d);
  localStorage.setItem(k,ds);
  lastSaveHash[k]=ds;
  lastSaveTime[k]=Date.now();
  if(!on()) return;
  var b=gB(k);
  if(!b){await cC(k,d);return}
  try{
    var remote=await cR(b);
    var merged=saveMerge(k,d,remote);
    await cW(b,merged);
    var ms=JSON.stringify(merged);
    localStorage.setItem(k,ms);
    lastSaveHash[k]=ms;
    lastSaveTime[k]=Date.now();
    if(ms!==ds && cb[k]) cb[k](merged);
  }catch(e){
    try{await cW(b,d);lastSaveTime[k]=Date.now()}catch(e2){}
  }
};

/* ===== LOAD ===== */
window.sharedLoad=async function(k,df){
  if(on()){
    var b=gB(k);
    if(b){
      try{var c=await cR(b);if(c){localStorage.setItem(k,JSON.stringify(c));sync(k);return c}}catch(e){}
    }
  }
  var l=localStorage.getItem(k);
  if(l){try{sync(k);return JSON.parse(l)}catch(e){}}
  sync(k);
  return JSON.parse(JSON.stringify(df));
};

window.sharedMarkDeleted=function(k,id){addDel(k,id)};
window.sharedOnSync=function(k,c){cb[k]=c};
window.sharedIsOnline=on;
console.log('[SharedDB] '+(on()?'✅ Cloud ON (v8)':'❌ Offline'));
})();
