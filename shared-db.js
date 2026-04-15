/*
 * shared-db.js v10 — 현대약품 AI 워크플로우 실시간 공유 저장소
 *
 * ★ KEY에 jsonbin.io API Key 입력
 *
 * v10:
 *   sync시 기존 항목의 steps/placements/tools 등 변경사항도 반영
 *   단, 로컬에서 삭제한 항목은 절대 부활 안 함 (삭제 이력)
 *   첨부파일 base64는 클라우드에서 제외
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

/* ===== 파일 데이터 제거 (클라우드용) ===== */
function stripFileData(d){
  if(!Array.isArray(d)) return d;
  return d.map(function(item){
    if(!item.files||!item.files.length) return item;
    var copy=JSON.parse(JSON.stringify(item));
    copy.files=copy.files.map(function(f){
      return {name:f.name, size:f.size, type:f.type};
    });
    return copy;
  });
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

/* ===== saveMerge: 로컬 + 서버 신규(삭제이력 제외) ===== */
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

/* ==========================================================
 *  SYNC v10 — 서버 데이터 기준으로 로컬 갱신
 *
 *  원칙:
 *  1. 서버에 있고 로컬에도 있는 항목 → 서버 버전으로 업데이트
 *     (단, 로컬의 첨부파일 data는 보존)
 *  2. 서버에만 있는 항목 → 삭제이력 없으면 추가
 *  3. 로컬에만 있는 항목 → 유지 (아직 서버에 안 올라간 것)
 * ========================================================== */
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
      var local;
      try{local=JSON.parse(localStr)}catch(e){return}
      if(!Array.isArray(local)) return;

      var serverStr=JSON.stringify(remote);
      if(serverStr===lastSaveHash[k]) return;

      var ds=getDelSet(k);

      // remote를 맵으로
      var remoteMap={};
      remote.forEach(function(w){remoteMap[w.id]=w});

      // local을 맵으로 (파일 data 보존용)
      var localFileMap={};
      local.forEach(function(w){
        if(w.files&&w.files.length){
          var hasData=w.files.some(function(f){return f.data});
          if(hasData) localFileMap[w.id]=w.files;
        }
      });
      var localIds={};
      local.forEach(function(w){localIds[w.id]=true});

      var changed=false;
      var result=[];

      // 1) 로컬 항목 순회
      local.forEach(function(w){
        var rw=remoteMap[w.id];
        if(rw){
          // 서버에도 있음 → 서버 버전 사용 (최신 반영)
          var copy=JSON.parse(JSON.stringify(rw));
          // 로컬 첨부파일 data 보존
          if(localFileMap[w.id]) copy.files=localFileMap[w.id];
          // 변경 여부 체크
          var localNoFile=JSON.parse(JSON.stringify(w));
          if(localNoFile.files) localNoFile.files=localNoFile.files.map(function(f){return{name:f.name,size:f.size,type:f.type}});
          if(JSON.stringify(rw)!==JSON.stringify(localNoFile)) changed=true;
          result.push(copy);
        } else {
          // 서버에 없음 → 로컬에만 있음 (아직 미업로드 또는 다른 사람이 삭제)
          result.push(w);
        }
      });

      // 2) 서버에만 있는 신규 항목
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
  lastSaveTime[k]=Date.now();
  if(!on()) return;
  var b=gB(k);
  var cloudData=stripFileData(d);
  if(!b){await cC(k,cloudData);lastSaveHash[k]=JSON.stringify(cloudData);return}
  try{
    var remote=await cR(b);
    var merged=saveMerge(k,cloudData,remote);
    await cW(b,merged);
    lastSaveHash[k]=JSON.stringify(merged);
    lastSaveTime[k]=Date.now();
    if(merged.length>cloudData.length){
      var localIds={};
      d.forEach(function(w){localIds[w.id]=true});
      var newItems=merged.filter(function(w){return !localIds[w.id]});
      if(newItems.length>0){
        var updated=d.concat(newItems);
        localStorage.setItem(k,JSON.stringify(updated));
        if(cb[k]) cb[k](updated);
      }
    }
  }catch(e){
    try{await cW(b,cloudData);lastSaveTime[k]=Date.now()}catch(e2){}
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
          var localStr=localStorage.getItem(k);
          var local=null;
          try{local=JSON.parse(localStr)}catch(e){}
          if(local&&Array.isArray(local)&&Array.isArray(c)){
            var fileMap={};
            local.forEach(function(w){
              if(w.files&&w.files.length){
                var hasData=w.files.some(function(f){return f.data});
                if(hasData) fileMap[w.id]=w.files;
              }
            });
            c.forEach(function(w){
              if(fileMap[w.id]) w.files=fileMap[w.id];
            });
          }
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

window.sharedMarkDeleted=function(k,id){addDel(k,id)};
window.sharedOnSync=function(k,c){cb[k]=c};
window.sharedIsOnline=on;
console.log('[SharedDB] '+(on()?'✅ Cloud ON (v10)':'❌ Offline'));
})();
