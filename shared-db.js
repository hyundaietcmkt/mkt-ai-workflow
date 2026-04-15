/*
 * shared-db.js v5 — 현대약품 AI 워크플로우 실시간 공유 저장소
 *
 * ★ KEY에 jsonbin.io API Key 입력
 * ★ v5 핵심 수정:
 *   - save 중 sync 잠금 → 삭제/취소가 되살아나는 버그 완전 차단
 *   - 머지: 저장하는 쪽(local)이 마스터, 다른 사람 신규 추가만 가져옴
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

/* ===== MERGE v5 — 로컬이 마스터, remote 신규만 추가 ===== */
function mergeWfData(local, remote){
  if(!Array.isArray(local)||!Array.isArray(remote)) return local;
  var localIds={};
  local.forEach(function(w){ localIds[w.id]=true });
  var remoteMap={};
  remote.forEach(function(w){ remoteMap[w.id]=w });

  var result=[];
  // local 항목 유지 (삭제한 건 여기 없으므로 자연히 삭제됨)
  local.forEach(function(w){
    var rw=remoteMap[w.id];
    if(rw){
      var copy=JSON.parse(JSON.stringify(w));
      // applicants: local 기준 유지 + remote에만 있는 새 신청자 추가
      var la=w.applicants||[];
      var ra=rw.applicants||[];
      var seen={};
      var merged=[];
      la.forEach(function(a){seen[a]=true; merged.push(a)});
      ra.forEach(function(a){if(!seen[a]) merged.push(a)});
      copy.applicants=merged;
      result.push(copy);
    } else {
      result.push(JSON.parse(JSON.stringify(w)));
    }
  });
  // remote에만 있는 신규 항목 (다른 사람이 추가)
  remote.forEach(function(w){
    if(!localIds[w.id]) result.push(JSON.parse(JSON.stringify(w)));
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

/* ===== SYNC (save 중 잠금) ===== */
var st={}, cb={}, lh={}, saving={};

function sync(k){
  if(st[k]||!on()) return;
  st[k]=setInterval(async function(){
    // ★ save 진행 중이면 sync 건너뛰기 (핵심 수정)
    if(saving[k]) return;
    var b=gB(k);
    if(!b) return;
    try{
      var c=await cR(b);
      if(!c) return;
      var ch=JSON.stringify(c);
      if(ch!==lh[k]){
        // ★ sync 도중에 save가 시작됐으면 무시
        if(saving[k]) return;
        lh[k]=ch;
        localStorage.setItem(k,ch);
        if(cb[k]) cb[k](c);
      }
    }catch(e){}
  }, CFG.T);
}

/* ===== SAVE (잠금 적용) ===== */
window.sharedSave=async function(k,d){
  // ★ 잠금 ON — sync가 끼어들지 못하게
  saving[k]=true;

  localStorage.setItem(k,JSON.stringify(d));
  lh[k]=JSON.stringify(d);

  if(!on()){saving[k]=false; return}

  var b=gB(k);
  if(!b){
    await cC(k,d);
    saving[k]=false;
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
    // ★ 잠금 OFF — 저장 완전히 끝난 후에야 sync 허용
    saving[k]=false;
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
console.log('[SharedDB] '+(on()?'✅ Cloud ON (v5)':'❌ Offline'));
})();
