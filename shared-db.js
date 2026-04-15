/*
 * shared-db.js v6 (FINAL) — 현대약품 AI 워크플로우 실시간 공유 저장소
 *
 * ★ KEY에 jsonbin.io API Key 입력
 *
 * v6 완전 재설계:
 *   1. sync가 서버 데이터로 "덮어쓰기" 하지 않음
 *      → 서버에서 "새로 추가된 항목/신청자"만 로컬에 추가
 *   2. save 후 15초 쿨다운 — CDN 캐시가 갱신될 시간 확보
 *   3. 삭제/취소는 절대 되살아나지 않음
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

/* ===== API (캐시 우회 헤더 포함) ===== */
async function cR(b){
  var r=await fetch(CFG.URL+'/'+b+'/latest',{
    headers:{
      'X-Master-Key':CFG.KEY,
      'X-Bin-Meta':'false',
      'Cache-Control':'no-cache'
    }
  });
  if(!r.ok) throw new Error('READ '+r.status);
  return await r.json();
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
  if(j.metadata&&j.metadata.id){sB(k,j.metadata.id);console.log('✅ Bin created ('+k+'): '+j.metadata.id);return j.metadata.id}
  return '';
}

/* ==========================================================
 *  syncMerge — sync 전용 머지
 *
 *  "현재 로컬(W)"이 마스터. 서버 데이터에서 가져올 것:
 *  - 로컬에 없는 새 워크플로우 (다른 사람이 추가한 것)
 *  - 로컬에 없는 새 수강신청자 (다른 사람이 신청한 것)
 *
 *  로컬에서 삭제한 것은 절대 복원하지 않음.
 * ========================================================== */
function syncMergeWf(local, remote){
  if(!Array.isArray(local)||!Array.isArray(remote)) return {data:local,changed:false};
  var localIds={};
  local.forEach(function(w){localIds[w.id]=true});
  var changed=false;

  // 기존 항목: 서버에서 새 수강신청자만 추가
  var result=local.map(function(w){
    var rw=null;
    for(var i=0;i<remote.length;i++){if(remote[i].id===w.id){rw=remote[i];break}}
    if(!rw) return w;

    var la=w.applicants||[];
    var ra=rw.applicants||[];
    var laSet={};
    la.forEach(function(a){laSet[a]=true});

    // remote에만 있는 새 신청자 찾기
    var newApps=[];
    ra.forEach(function(a){if(!laSet[a]) newApps.push(a)});

    if(newApps.length>0){
      var copy=JSON.parse(JSON.stringify(w));
      copy.applicants=la.concat(newApps);
      changed=true;
      return copy;
    }
    return w;
  });

  // 서버에만 있는 새 워크플로우 추가
  remote.forEach(function(w){
    if(!localIds[w.id]){
      result.push(JSON.parse(JSON.stringify(w)));
      changed=true;
    }
  });

  return {data:result, changed:changed};
}

function syncMergePri(local, remote){
  if(!Array.isArray(local)||!Array.isArray(remote)) return {data:local,changed:false};
  var localIds={};
  local.forEach(function(it){localIds[it.id]=true});
  var changed=false;

  var result=local.map(function(it){
    var rit=null;
    for(var i=0;i<remote.length;i++){if(remote[i].id===it.id){rit=remote[i];break}}
    if(!rit) return it;

    var copy=JSON.parse(JSON.stringify(it));
    var c=false;
    if(!it.q && rit.q){copy.q=rit.q;c=true}
    if(!it.scores && rit.scores){copy.scores=rit.scores;c=true}
    if(!it._autoQ && rit._autoQ){copy._autoQ=rit._autoQ;c=true}
    if(c) changed=true;
    return c?copy:it;
  });

  remote.forEach(function(it){
    if(!localIds[it.id]){
      result.push(JSON.parse(JSON.stringify(it)));
      changed=true;
    }
  });

  return {data:result, changed:changed};
}

function syncMerge(k, local, remote){
  if(k==='wf_data') return syncMergeWf(local, remote);
  if(k==='priority_items') return syncMergePri(local, remote);
  return {data:local, changed:false};
}

/* ==========================================================
 *  saveMerge — save 전용 머지 (로컬이 마스터)
 * ========================================================== */
function saveMergeWf(local, remote){
  if(!Array.isArray(local)||!Array.isArray(remote)) return local;
  var localIds={};
  local.forEach(function(w){localIds[w.id]=true});

  var result=local.map(function(w){
    var rw=null;
    for(var i=0;i<remote.length;i++){if(remote[i].id===w.id){rw=remote[i];break}}
    if(!rw) return JSON.parse(JSON.stringify(w));

    var copy=JSON.parse(JSON.stringify(w));
    var la=w.applicants||[];
    var ra=rw.applicants||[];
    var seen={};
    var merged=[];
    la.forEach(function(a){seen[a]=true;merged.push(a)});
    ra.forEach(function(a){if(!seen[a])merged.push(a)});
    copy.applicants=merged;
    return copy;
  });

  // 다른 사람이 추가한 신규 항목
  remote.forEach(function(w){
    if(!localIds[w.id]) result.push(JSON.parse(JSON.stringify(w)));
  });
  return result;
}

function saveMergePri(local, remote){
  if(!Array.isArray(local)||!Array.isArray(remote)) return local;
  var localIds={};
  local.forEach(function(it){localIds[it.id]=true});

  var result=local.map(function(it){
    var rit=null;
    for(var i=0;i<remote.length;i++){if(remote[i].id===it.id){rit=remote[i];break}}
    if(!rit) return JSON.parse(JSON.stringify(it));
    var copy=JSON.parse(JSON.stringify(it));
    if(!it.q && rit.q) copy.q=rit.q;
    if(!it.scores && rit.scores) copy.scores=rit.scores;
    if(!it._autoQ && rit._autoQ) copy._autoQ=rit._autoQ;
    return copy;
  });

  remote.forEach(function(it){
    if(!localIds[it.id]) result.push(JSON.parse(JSON.stringify(it)));
  });
  return result;
}

function saveMerge(k, local, remote){
  if(k==='wf_data') return saveMergeWf(local, remote);
  if(k==='priority_items') return saveMergePri(local, remote);
  return local;
}

/* ===== STATE ===== */
var st={}, cb={}, lastSaveTime={};

/* ===== SYNC ===== */
function sync(k){
  if(st[k]||!on()) return;
  st[k]=setInterval(async function(){
    // save 후 쿨다운 기간이면 건너뜀
    if(lastSaveTime[k] && (Date.now()-lastSaveTime[k] < CFG.COOLDOWN)) return;
    var b=gB(k);
    if(!b) return;
    try{
      var remote=await cR(b);
      if(!remote) return;
      // 현재 로컬 데이터 읽기
      var localStr=localStorage.getItem(k);
      if(!localStr) return;
      var local;
      try{local=JSON.parse(localStr)}catch(e){return}
      // syncMerge: 로컬 유지 + 서버 신규만 추가
      var result=syncMerge(k, local, remote);
      if(result.changed){
        localStorage.setItem(k,JSON.stringify(result.data));
        if(cb[k]) cb[k](result.data);
      }
    }catch(e){}
  }, CFG.T);
}

/* ===== SAVE ===== */
window.sharedSave=async function(k,d){
  // 쿨다운 타이머 시작
  lastSaveTime[k]=Date.now();
  localStorage.setItem(k,JSON.stringify(d));
  if(!on()) return;
  var b=gB(k);
  if(!b){
    await cC(k,d);
    return;
  }
  try{
    var remote=await cR(b);
    var merged=saveMerge(k,d,remote);
    await cW(b,merged);
    localStorage.setItem(k,JSON.stringify(merged));
    // 쿨다운 갱신 (write 완료 시점 기준)
    lastSaveTime[k]=Date.now();
    if(JSON.stringify(merged)!==JSON.stringify(d)){
      if(cb[k]) cb[k](merged);
    }
  }catch(e){
    try{await cW(b,d);lastSaveTime[k]=Date.now()}catch(e2){}
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
console.log('[SharedDB] '+(on()?'✅ Cloud ON (v6 final)':'❌ Offline'));
})();
