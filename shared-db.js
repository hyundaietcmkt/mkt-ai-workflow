/*
 * shared-db.js v11 — 현대약품 AI 워크플로우 실시간 공유 저장소
 *
 * ★ KEY에 jsonbin.io API Key 입력
 *
 * v11: 커스텀 도구(tm_custom) 클라우드 공유 추가
 *      + v10 기능 유지
 */
(function(){
var CFG={
  KEY:'$2a$10$zz/mxGfqMKbtNMOl24jrKO0dWvL5Y7HhIq4v06zQztZNiUXoMUV16',
  BIN_WF:'69df1513aaba882197fe3178',
  BIN_PRI:'69df15a4aaba882197fe33c6',
  BIN_TM:'',
  URL:'https://api.jsonbin.io/v3/b',
  T:8000,
  COOLDOWN:15000
};

function on(){return CFG.KEY && CFG.KEY!=='YOUR_API_KEY_HERE'}
function gB(k){
  if(k==='wf_data') return CFG.BIN_WF||localStorage.getItem('_bid_wf')||'';
  if(k==='priority_items') return CFG.BIN_PRI||localStorage.getItem('_bid_pri')||'';
  if(k==='tm_custom') return CFG.BIN_TM||localStorage.getItem('_bid_tm')||'';
  return '';
}
function sB(k,id){
  if(k==='wf_data'){CFG.BIN_WF=id;localStorage.setItem('_bid_wf',id)}
  if(k==='priority_items'){CFG.BIN_PRI=id;localStorage.setItem('_bid_pri',id)}
  if(k==='tm_custom'){CFG.BIN_TM=id;localStorage.setItem('_bid_tm',id)}
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

/* ===== 파일 데이터 제거 ===== */
function stripFileData(d){
  if(!Array.isArray(d)) return d;
  return d.map(function(item){
    if(!item.files||!item.files.length) return item;
    var copy=JSON.parse(JSON.stringify(item));
    copy.files=copy.files.map(function(f){return{name:f.name,size:f.size,type:f.type}});
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
  if(j.metadata&&j.metadata.id){sB(k,j.metadata.id);console.log('✅ Bin created ('+k+'): '+j.metadata.id);return j.metadata.id}
  return '';
}

/* ===== saveMerge (배열 전용) ===== */
function saveMerge(k, local, remote){
  if(!Array.isArray(local)||!Array.isArray(remote)) return local;
  var localIds={};
  local.forEach(function(w){localIds[w.id]=true});
  var ds=getDelSet(k);
  var result=local.map(function(w){return JSON.parse(JSON.stringify(w))});
  remote.forEach(function(w){
    if(!localIds[w.id] && !ds[w.id]) result.push(JSON.parse(JSON.stringify(w)));
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
      if(!remote) return;

      /* --- 객체 타입 (tm_custom 등) --- */
      if(!Array.isArray(remote)){
        var localStr=localStorage.getItem(k);
        var serverStr=JSON.stringify(remote);
        if(serverStr===localStr) return;
        if(serverStr===lastSaveHash[k]) return;
        // 객체: 서버 것과 로컬 것 합치기 (서버 키 추가)
        var local;
        try{local=JSON.parse(localStr)||{}}catch(e){local={}}
        var changed=false;
        Object.keys(remote).forEach(function(rk){
          if(!local[rk]){local[rk]=remote[rk];changed=true}
        });
        if(changed){
          localStorage.setItem(k,JSON.stringify(local));
          if(cb[k]) cb[k](local);
        }
        return;
      }

      /* --- 배열 타입 (wf_data, priority_items) --- */
      var localStr=localStorage.getItem(k);
      var local;
      try{local=JSON.parse(localStr)}catch(e){return}
      if(!Array.isArray(local)) return;

      var serverStr=JSON.stringify(remote);
      if(serverStr===lastSaveHash[k]) return;

      var ds=getDelSet(k);
      var remoteMap={};
      remote.forEach(function(w){remoteMap[w.id]=w});
      var localIds={};
      local.forEach(function(w){localIds[w.id]=true});

      // 로컬 첨부파일 data 보존용
      var localFileMap={};
      local.forEach(function(w){
        if(w.files&&w.files.length){
          var hasData=w.files.some(function(f){return f.data});
          if(hasData) localFileMap[w.id]=w.files;
        }
      });

      var changed=false;
      var result=[];

      // 로컬 항목: 서버 버전으로 업데이트
      local.forEach(function(w){
        var rw=remoteMap[w.id];
        if(rw){
          var copy=JSON.parse(JSON.stringify(rw));
          if(localFileMap[w.id]) copy.files=localFileMap[w.id];
          var localNoFile=JSON.parse(JSON.stringify(w));
          if(localNoFile.files) localNoFile.files=localNoFile.files.map(function(f){return{name:f.name,size:f.size,type:f.type}});
          if(JSON.stringify(rw)!==JSON.stringify(localNoFile)) changed=true;
          result.push(copy);
        } else {
          result.push(w);
        }
      });

      // 서버에만 있는 신규 항목
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
  var isArr=Array.isArray(d);
  var ds=JSON.stringify(d);
  localStorage.setItem(k,ds);
  lastSaveTime[k]=Date.now();
  if(!on()) return;
  var b=gB(k);

  var cloudData=isArr ? stripFileData(d) : d;

  if(!b){await cC(k,cloudData);lastSaveHash[k]=JSON.stringify(cloudData);return}
  try{
    if(isArr){
      var remote=await cR(b);
      var merged=saveMerge(k,cloudData,remote);
      await cW(b,merged);
      lastSaveHash[k]=JSON.stringify(merged);
      // merged에 서버 신규 항목이 포함되었으면 로컬+UI 갱신
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
    } else {
      // 객체(tm_custom 등): 서버 것과 합쳐서 저장
      var remote=await cR(b);
      var merged=Object.assign({},remote||{},cloudData);
      await cW(b,merged);
      lastSaveHash[k]=JSON.stringify(merged);
      if(JSON.stringify(merged)!==ds){
        localStorage.setItem(k,JSON.stringify(merged));
        if(cb[k]) cb[k](merged);
      }
    }
    lastSaveTime[k]=Date.now();
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
          // 배열: 로컬 첨부파일 data 보존
          if(Array.isArray(c)){
            var localStr=localStorage.getItem(k);
            var local=null;
            try{local=JSON.parse(localStr)}catch(e){}
            if(local&&Array.isArray(local)){
              var fileMap={};
              local.forEach(function(w){
                if(w.files&&w.files.length){
                  var hasData=w.files.some(function(f){return f.data});
                  if(hasData) fileMap[w.id]=w.files;
                }
              });
              c.forEach(function(w){if(fileMap[w.id]) w.files=fileMap[w.id]});
            }
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
console.log('[SharedDB] '+(on()?'✅ Cloud ON (v11)':'❌ Offline'));
})();
