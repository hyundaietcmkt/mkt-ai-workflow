/*
 * shared-db.js v3 — 현대약품 AI 워크플로우 실시간 공유 저장소
 *
 * ★ 세팅: jsonbin.io API Key를 아래 KEY에 입력
 * ★ v3: 디버깅 로그 + rate limit 대응 + sync 안정화
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

/* ===== API 호출 (디버깅 로그 포함) ===== */
async function cR(b){
  console.log('[SharedDB] 📥 READ bin:', b);
  var r=await fetch(CFG.URL+'/'+b+'/latest',{headers:{'X-Master-Key':CFG.KEY}});
  if(!r.ok){
    console.error('[SharedDB] ❌ READ 실패 status:', r.status);
    throw new Error('READ '+r.status);
  }
  var j=await r.json();
  console.log('[SharedDB] ✅ READ 성공');
  return j.record;
}

async function cW(b,d){
  console.log('[SharedDB] 📤 WRITE bin:', b);
  var r=await fetch(CFG.URL+'/'+b,{
    method:'PUT',
    headers:{'Content-Type':'application/json','X-Master-Key':CFG.KEY},
    body:JSON.stringify(d)
  });
  if(!r.ok){
    console.error('[SharedDB] ❌ WRITE 실패 status:', r.status);
    throw new Error('WRITE '+r.status);
  }
  console.log('[SharedDB] ✅ WRITE 성공');
}

async function cC(k,d){
  console.log('[SharedDB] 🆕 CREATE bin for:', k);
  var r=await fetch(CFG.URL,{
    method:'POST',
    headers:{'Content-Type':'application/json','X-Master-Key':CFG.KEY,'X-Bin-Private':'false','X-Bin-Name':'hyundai-'+k},
    body:JSON.stringify(d)
  });
  var j=await r.json();
  if(j.metadata&&j.metadata.id){
    sB(k,j.metadata.id);
    console.log('✅ Bin created ('+k+'): '+j.metadata.id+' ← shared-db.js에 입력하세요!');
    return j.metadata.id;
  }
  console.error('[SharedDB] ❌ CREATE 실패:', j);
  return '';
}

/* ===== MERGE LOGIC ===== */
function mergeWfData(local, remote){
  if(!Array.isArray(local)||!Array.isArray(remote)) return local;
  var map={};
  remote.forEach(function(w){ map[w.id]=JSON.parse(JSON.stringify(w)) });
  local.forEach(function(w){
    if(!map[w.id]){
      map[w.id]=JSON.parse(JSON.stringify(w));
    } else {
      var r=map[w.id];
      // applicants 합치기
      var localApps=w.applicants||[];
      var remoteApps=r.applicants||[];
      var merged=[];
      var seen={};
      remoteApps.concat(localApps).forEach(function(a){if(!seen[a]){seen[a]=true;merged.push(a)}});
      // local 기반으로 덮어쓰되 applicants는 합침
      map[w.id]=JSON.parse(JSON.stringify(w));
      map[w.id].applicants=merged;
      // placements도 합치기
      if(r.placements&&w.placements){
        var mp={};
        Object.keys(r.placements).forEach(function(t){mp[t]=(r.placements[t]||[]).slice()});
        Object.keys(w.placements).forEach(function(t){
          if(!mp[t])mp[t]=[];
          (w.placements[t]||[]).forEach(function(s){if(mp[t].indexOf(s)<0)mp[t].push(s)});
        });
        map[w.id].placements=mp;
      }
    }
  });
  var result=[];
  var added={};
  local.forEach(function(w){if(map[w.id]){result.push(map[w.id]);added[w.id]=true}});
  remote.forEach(function(w){if(!added[w.id]&&map[w.id]){result.push(map[w.id])}});
  return result;
}

function mergePriData(local, remote){
  if(!Array.isArray(local)||!Array.isArray(remote)) return local;
  var map={};
  remote.forEach(function(it){ map[it.id]=JSON.parse(JSON.stringify(it)) });
  local.forEach(function(it){
    if(!map[it.id]){
      map[it.id]=JSON.parse(JSON.stringify(it));
    } else {
      var r=map[it.id];
      map[it.id]=JSON.parse(JSON.stringify(it));
      if(!it.q && r.q) map[it.id].q=r.q;
      if(!it.scores && r.scores) map[it.id].scores=r.scores;
      if(!it._autoQ && r._autoQ) map[it.id]._autoQ=r._autoQ;
    }
  });
  var result=[];
  var added={};
  local.forEach(function(it){if(map[it.id]){result.push(map[it.id]);added[it.id]=true}});
  remote.forEach(function(it){if(!added[it.id]&&map[it.id]){result.push(map[it.id])}});
  return result;
}

function mergeData(k, local, remote){
  if(k==='wf_data') return mergeWfData(local, remote);
  if(k==='priority_items') return mergePriData(local, remote);
  return local;
}

/* ===== SYNC (폴링) ===== */
var st={}, cb={}, lh={};

function sync(k){
  if(st[k]||!on()) return;
  console.log('[SharedDB] 🔄 SYNC 시작:', k, '(간격:', CFG.T+'ms)');
  st[k]=setInterval(async function(){
    var b=gB(k);
    if(!b) return;
    try{
      var c=await cR(b);
      if(!c) return;
      var ch=JSON.stringify(c);
      if(ch!==lh[k]){
        console.log('[SharedDB] 🔔 변경 감지!', k);
        lh[k]=ch;
        localStorage.setItem(k,ch);
        if(cb[k]) cb[k](c);
      }
    }catch(e){
      console.warn('[SharedDB] ⚠️ SYNC 실패:', k, e.message);
    }
  }, CFG.T);
}

/* ===== SAVE ===== */
window.sharedSave=async function(k,d){
  console.log('[SharedDB] 💾 SAVE 호출:', k);
  localStorage.setItem(k,JSON.stringify(d));
  if(!on()){console.log('[SharedDB] ⏸ 오프라인 — localStorage만 저장');return}
  var b=gB(k);
  if(!b){
    b=await cC(k,d);
  } else {
    try{
      // 서버 최신 데이터 가져와서 머지
      var remote=await cR(b);
      var merged=mergeData(k,d,remote);
      await cW(b,merged);
      localStorage.setItem(k,JSON.stringify(merged));
      lh[k]=JSON.stringify(merged);
      console.log('[SharedDB] ✅ SAVE 완료 (머지 적용)');
      // 머지 결과가 로컬과 다르면 UI 갱신
      if(JSON.stringify(merged)!==JSON.stringify(d)){
        console.log('[SharedDB] 🔀 머지로 인해 UI 갱신');
        if(cb[k]) cb[k](merged);
      }
    }catch(e){
      console.warn('[SharedDB] ⚠️ 머지 실패, 로컬 데이터로 직접 저장:', e.message);
      try{await cW(b,d)}catch(e2){console.error('[SharedDB] ❌ 직접 저장도 실패:', e2.message)}
    }
  }
};

/* ===== LOAD ===== */
window.sharedLoad=async function(k,df){
  console.log('[SharedDB] 📂 LOAD 호출:', k);
  if(on()){
    var b=gB(k);
    if(b){
      try{
        var c=await cR(b);
        if(c){
          localStorage.setItem(k,JSON.stringify(c));
          lh[k]=JSON.stringify(c);
          sync(k);
          console.log('[SharedDB] ✅ LOAD: 서버 데이터 사용');
          return c;
        }
      }catch(e){
        console.warn('[SharedDB] ⚠️ LOAD 서버 실패, localStorage 시도:', e.message);
      }
    }
  }
  var l=localStorage.getItem(k);
  if(l){
    try{
      sync(k);
      console.log('[SharedDB] 📦 LOAD: localStorage 데이터 사용');
      return JSON.parse(l);
    }catch(e){}
  }
  sync(k);
  console.log('[SharedDB] 🏗 LOAD: 기본 데이터(defaults) 사용');
  return JSON.parse(JSON.stringify(df));
};

window.sharedOnSync=function(k,c){cb[k]=c};
window.sharedIsOnline=on;

console.log('[SharedDB] '+(on()?'✅ Cloud ON (v3)':'❌ Offline — shared-db.js에 API Key 입력 필요'));
console.log('[SharedDB] BIN_WF:', CFG.BIN_WF);
console.log('[SharedDB] BIN_PRI:', CFG.BIN_PRI);
})();
