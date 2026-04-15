/*
 * shared-db.js — 현대약품 AI 워크플로우 실시간 공유 저장소 v2
 *
 * ★ 세팅: jsonbin.io 가입 → API Keys에서 Master Key 복사 → 아래 붙여넣기
 * ★ API Key 미입력 시 기존 localStorage 방식으로 동작 (오프라인)
 *
 * v2 개선: 저장 시 서버 데이터와 병합(merge) → 수강신청 등 동시 수정 충돌 방지
 */
(function(){
const CFG={
  KEY:'$2a$10$zz/mxGfqMKbtNMOl24jrKO0dWvL5Y7HhIq4v06zQztZNiUXoMUV16',
  BIN_WF:'69df1513aaba882197fe3178',
  BIN_PRI:'69df15a4aaba882197fe33c6',
  URL:'https://api.jsonbin.io/v3/b',
  T:5000
};
const on=()=>CFG.KEY&&CFG.KEY!=='YOUR_API_KEY_HERE';
function gB(k){if(k==='wf_data')return CFG.BIN_WF||localStorage.getItem('_bid_wf')||'';if(k==='priority_items')return CFG.BIN_PRI||localStorage.getItem('_bid_pri')||'';return''}
function sB(k,id){if(k==='wf_data'){CFG.BIN_WF=id;localStorage.setItem('_bid_wf',id)}if(k==='priority_items'){CFG.BIN_PRI=id;localStorage.setItem('_bid_pri',id)}}
async function cR(b){const r=await fetch(CFG.URL+'/'+b+'/latest',{headers:{'X-Master-Key':CFG.KEY}});if(!r.ok)throw new Error(r.status);return(await r.json()).record}
async function cW(b,d){await fetch(CFG.URL+'/'+b,{method:'PUT',headers:{'Content-Type':'application/json','X-Master-Key':CFG.KEY},body:JSON.stringify(d)})}
async function cC(k,d){const r=await fetch(CFG.URL,{method:'POST',headers:{'Content-Type':'application/json','X-Master-Key':CFG.KEY,'X-Bin-Private':'false','X-Bin-Name':'hyundai-'+k},body:JSON.stringify(d)});const j=await r.json();if(j.metadata&&j.metadata.id){sB(k,j.metadata.id);console.log('✅ Bin created ('+k+'): '+j.metadata.id+' ← shared-db.js에 입력하세요!');return j.metadata.id}return''}

/* ===== MERGE LOGIC (충돌 방지) ===== */
function mergeWfData(local, remote){
  if(!Array.isArray(local)||!Array.isArray(remote)) return local;
  var map={};
  remote.forEach(function(w){ map[w.id]=JSON.parse(JSON.stringify(w)) });
  local.forEach(function(w){
    if(!map[w.id]){
      map[w.id]=JSON.parse(JSON.stringify(w));
    } else {
      var r=map[w.id];
      var localApps=w.applicants||[];
      var remoteApps=r.applicants||[];
      var merged=[];
      var seen={};
      remoteApps.concat(localApps).forEach(function(a){if(!seen[a]){seen[a]=true;merged.push(a)}});
      map[w.id]=JSON.parse(JSON.stringify(w));
      map[w.id].applicants=merged;
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

/* ===== SYNC ===== */
var st={},cb={},lh={};
function sync(k){if(st[k]||!on())return;st[k]=setInterval(async function(){var b=gB(k);if(!b)return;try{var c=await cR(b);if(!c)return;var ch=JSON.stringify(c);if(ch!==lh[k]){lh[k]=ch;localStorage.setItem(k,ch);if(cb[k])cb[k](c)}}catch(e){}},CFG.T)}

/* ===== SAVE (머지 후 저장) ===== */
window.sharedSave=async function(k,d){
  localStorage.setItem(k,JSON.stringify(d));
  if(!on())return;
  var b=gB(k);
  if(!b){b=await cC(k,d);}
  else{
    try{
      var remote=await cR(b);
      var merged=mergeData(k,d,remote);
      await cW(b,merged);
      localStorage.setItem(k,JSON.stringify(merged));
      lh[k]=JSON.stringify(merged);
      if(JSON.stringify(merged)!==JSON.stringify(d)){
        if(cb[k])cb[k](merged);
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
console.log('[SharedDB] '+(on()?'✅ Cloud ON (v2 merge)':'❌ Offline — shared-db.js에 API Key 입력 필요'));
})();
