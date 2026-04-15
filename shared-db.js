/*
 * shared-db.js v4 — 현대약품 AI 워크플로우 실시간 공유 저장소
 *
 * ★ 세팅: jsonbin.io API Key를 아래 KEY에 입력
 * ★ v4: 삭제/취소 시 되살아나는 버그 수정 — "저장하는 쪽이 항상 우선"
 */
(function(){
var CFG={
  KEY:'$2a$10$zz/mxGfqMKbtNMOl24jrKO0dWvL5Y7HhIq4v06zQztZNiUXoMUV16',
  BIN_WF:'69df1513aaba882197fe3178',
  BIN_PRI:'69df15a4aaba882197fe33c6',
  URL:'https://api.jsonbin.io/v3/b',
  T:8000
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

async function cR(b){
  var r=await fetch(CFG.URL+'/'+b+'/latest',{headers:{'X-Master-Key':CFG.KEY}});
  if(!r.ok) throw new Error('READ '+r.status);
  return(await r.json()).record;
}
async function cW(b,d){
  var r=await fetch(CFG.URL+'/'+b,{method:'PUT',headers:{'Content-Type':'application/json','X-Master-Key':CFG.KEY},body:JSON.stringify(d)});
  if(!r.ok) throw new Error('WRITE '+r.status);
}
async function cC(k,d){
  var r=await fetch(CFG.URL,{method:'POST',headers:{'Content-Type':'application/json','X-Master-Key':CFG.KEY,'X-Bin-Private':'false','X-Bin-Name':'hyundai-'+k},body:JSON.stringify(d)});
  var j=await r.json();
  if(j.metadata&&j.metadata.id){sB(k,j.metadata.id);console.log('✅ Bin created ('+k+'): '+j.metadata.id);return j.metadata.id}
  return '';
}

/* ==========================================================
 *  MERGE v4 — "저장하는 쪽(local)이 마스터"
 *
 *  원칙:
 *  1. local에 있는 항목의 내용은 local이 우선 (방금 수정한 것)
 *  2. local에서 삭제한 항목은 삭제 유지 (서버에서 되살리지 않음)
 *  3. remote에만 새로 추가된 항목(다른 사람이 등록)은 가져옴
 *  4. applicants만 예외: 양쪽 합집합 (수강신청은 합치기)
 * ========================================================== */

function mergeWfData(local, remote){
  if(!Array.isArray(local)||!Array.isArray(remote)) return local;

  // local ID 목록 (이것이 "진실")
  var localIds={};
  local.forEach(function(w){ localIds[w.id]=true });

  // remote 중에서 local에 없는 것 = "다른 사람이 새로 추가한 것"
  var remoteMap={};
  remote.forEach(function(w){ remoteMap[w.id]=w });

  // 결과: local 순서 유지, 각 항목은 local 우선 + applicants만 합침
  var result=[];
  local.forEach(function(w){
    var rw=remoteMap[w.id];
    if(rw){
      // 양쪽에 다 있음 → local 우선, applicants만 합침
      var copy=JSON.parse(JSON.stringify(w));
      var la=w.applicants||[];
      var ra=rw.applicants||[];
      var merged=[];
      var seen={};
      // local의 applicants가 "현재 진실" — 취소한 사람은 local에 없음
      // 하지만 remote에만 있는 새 신청자는 추가해야 함
      // → local 기준으로, remote에 있지만 local에 없는 사람만 추가
      la.forEach(function(a){seen[a]=true; merged.push(a)});
      ra.forEach(function(a){if(!seen[a]) merged.push(a)});
      copy.applicants=merged;
      result.push(copy);
    } else {
      // local에만 있음 (새로 등록 등) → 그대로
      result.push(JSON.parse(JSON.stringify(w)));
    }
  });

  // remote에만 있고 local에 없는 것 = 다른 사람이 새로 추가
  remote.forEach(function(w){
    if(!localIds[w.id]){
      result.push(JSON.parse(JSON.stringify(w)));
    }
  });

  return result;
}

function mergePriData(local, remote){
  if(!Array.isArray(local)||!Array.isArray(remote)) return local;
  var localIds={};
  local.forEach(function(it){ localIds[it.id]=true });
  var remoteMap={};
  remote.forEach(function(it){ remoteMap[it.id]=it });

  var result=[];
  local.forEach(function(it){
    var rit=remoteMap[it.id];
    if(rit){
      var copy=JSON.parse(JSON.stringify(it));
      // 배치 안 한 것인데 remote에 배치가 있으면 가져옴
      if(!it.q && rit.q) copy.q=rit.q;
      if(!it.scores && rit.scores) copy.scores=rit.scores;
      if(!it._autoQ && rit._autoQ) copy._autoQ=rit._autoQ;
      result.push(copy);
    } else {
      result.push(JSON.parse(JSON.stringify(it)));
    }
  });
  remote.forEach(function(it){
    if(!localIds[it.id]) result.push(JSON.parse(JSON.stringify(it)));
  });
  return result;
}

function mergeData(k, local, remote){
  if(k==='wf_data') return mergeWfData(local, remote);
  if(k==='priority_items') return mergePriData(local, remote);
  return local;
}

/* ===== SYNC ===== */
var st={}, cb={}, lh={};

function sync(k){
  if(st[k]||!on()) return;
  st[k]=setInterval(async function(){
    var b=gB(k);
    if(!b) return;
    try{
      var c=await cR(b);
      if(!c) return;
      var ch=JSON.stringify(c);
      if(ch!==lh[k]){
        lh[k]=ch;
        localStorage.setItem(k,ch);
        if(cb[k]) cb[k](c);
      }
    }catch(e){}
  }, CFG.T);
}

/* ===== SAVE ===== */
window.sharedSave=async function(k,d){
  localStorage.setItem(k,JSON.stringify(d));
  if(!on()) return;
  var b=gB(k);
  if(!b){
    b=await cC(k,d);
  } else {
    try{
      var remote=await cR(b);
      var merged=mergeData(k,d,remote);
      await cW(b,merged);
      localStorage.setItem(k,JSON.stringify(merged));
      lh[k]=JSON.stringify(merged);
      if(JSON.stringify(merged)!==JSON.stringify(d)){
        if(cb[k]) cb[k](merged);
      }
    }catch(e){
      try{await cW(b,d)}catch(e2){}
    }
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
          lh[k]=JSON.stringify(c);
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
console.log('[SharedDB] '+(on()?'✅ Cloud ON (v4)':'❌ Offline — shared-db.js에 API Key 입력 필요'));
})();
