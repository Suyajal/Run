const paths={
 run:'M13 4a2 2 0 1 0 0 .1M4 13l4-3 4-1 3 4h4m-8-3-2 6 4 2 1 4M9 16l-2 4H3',
 home:'m3 10 9-7 9 7v10H3z M9 20v-6h6v6',
 records:'M8 5h12v15H4V5h4m0-2h8v4H8z M8 11h8m-8 4h8',
 friends:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8-7a4 4 0 0 1 0 7m2 4a4 4 0 0 1 3 4v2',
 groups:'M8 21h8m-4-4v4m-5-17h10v7a5 5 0 0 1-10 0z M7 6H3v2a4 4 0 0 0 4 4m10-6h4v2a4 4 0 0 1-4 4',
 bell:'M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0',
 settings:'M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2m0-14-2 2M7 17l-2 2m7 2a9 9 0 1 0 0-18 9 9 0 0 0 0 18m0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
 plus:'M12 5v14M5 12h14', arrow:'M9 6l6 6-6 6', clock:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20m0-16v6l4 2',
 route:'M4 16a3 3 0 1 0 0 6 3 3 0 0 0 0-6M20 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6M7 19h10a4 4 0 0 0 0-8H7a3 3 0 0 1 0-6h10',
 activity:'M2 12h5l3-7 4 14 3-7h5',close:'M6 6l12 12M18 6 6 18', upload:'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6'
};
const icon=n=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[n]||paths.activity}"/></svg>`;
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=(n,d=0)=>Number(n||0).toLocaleString('ko-KR',{maximumFractionDigits:d,minimumFractionDigits:d});
const km=n=>num(n/1000,2);
const pace=n=>n==null?'—':Math.floor(Math.round(n)/60)+':'+String(Math.round(n)%60).padStart(2,'0');
const duration=n=>[Math.floor(n/3600),Math.floor(n/60)%60,Math.floor(n)%60].map(x=>String(x).padStart(2,'0')).join(':');
const localDate=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
const when=v=>v?new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Seoul'}).format(new Date(v)):'—';
const source=n=>n==='SAMSUNG_HEALTH'?'삼성 헬스':'Apple Fitness';
const metrics={distance:'누적 거리',days:'달린 날',longest:'최장 거리',pace:'최고 평균 페이스',cadence:'평균 케이던스'};
const score=(n,m)=>m==='distance'||m==='longest'?km(n)+' km':m==='pace'?pace(n)+' /km':m==='days'?num(n)+'일':num(n,1)+' spm';
const adminMode=location.pathname==='/admin';
const titles={home:'홈',records:'내 기록',friends:'친구',groups:'그룹',notifications:'알림',settings:'설정',capture:'기록 등록',users:'사용자 관리',stats:'사용자 통계',audit:'관리 이력'};
const main=$('#main'), dialog=$('#dialog');
let me=null, generation=0, toastTimer, bootError='';
const page=()=>location.hash.slice(1).split('/')[0] || (adminMode?'users':'home');
const navTo=name=>{if(location.hash==='#'+name) void render();else location.hash=name;};
const empty=message=>`<p class="empty">${esc(message)}</p>`;
const panel=(title,body,action='')=>`<section class="panel"><div class="panel-title"><h2>${title}</h2>${action}</div>${body}</section>`;
const button=(label,action,style='',glyph='')=>`<button class="button ${style}" type="button" data-action="${esc(action)}">${glyph?icon(glyph):''}${label}</button>`;
const field=(label,name,options='')=>`<label class="field">${label}<input name="${name}" ${options}></label>`;
const head=(title,desc='',action='')=>`<div class="page-head"><div><h1>${title}</h1>${desc?`<p>${desc}</p>`:''}</div>${action}</div>`;
const toast=message=>{const t=$('#toast');t.textContent=message;t.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('visible'),4000);};
async function api(path,{method='GET',body,key}={}){
  const headers={};
  if(body && !(body instanceof FormData)) headers['Content-Type']='application/json';
  if(key) headers['Idempotency-Key']=key;
  const res=await fetch('/api'+path,{method,headers,body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
  const data=await res.json();
  if(!res.ok) throw Object.assign(Error(data.message),{status:res.status,details:data.details});
  return data;
}
const post=(path,body={})=>api(path,{method:'POST',body});
const details=[['exercise_date','운동 날짜'],['distance_m','거리'],['duration_sec','운동 시간'],['avg_pace_sec_km','평균 페이스'],['avg_speed_kmh','평균 속도'],['avg_cadence_spm','평균 케이던스'],['avg_heart_rate_bpm','평균 심박수'],['elevation_gain_m','고도 상승']];
function shell(view){
  const links=adminMode?['users','stats','audit']:['home','records','friends','groups','notifications'];
  const link=(name,glyph=name)=>`<a href="#${name}" class="${view===name?'active':''}" ${view===name?'aria-current="page"':''}>${icon(glyph)}${titles[name]}</a>`;
  const brand=`<a class="brand" href="${adminMode?'/admin':'/'}"><span class="brand-mark">${icon('run')}</span>Suyajal Run</a>`;
  $('#sidebar').innerHTML=brand+`<div class="nav-label">${adminMode?'관리자':'러닝 대시보드'}</div><nav class="nav">${links.map(n=>link(n,{notifications:'bell',users:'friends',stats:'activity',audit:'records'}[n]||n)).join('')}</nav>
    <div class="sidebar-end"><nav class="nav">${adminMode?'<a href="/">사용자 앱</a>':link('settings')}${!adminMode&&me?.admin?'<a href="/admin">관리자 페이지</a>':''}</nav><div class="side-profile"><div class="avatar">${esc(me?.display_name?.[0]||'R')}</div><div><strong>${esc(me?.display_name||'러너')}</strong><small>${me?(adminMode?'관리자':'러너 계정'):'둘러보기'}</small></div></div></div>`;
  $('#topbar').innerHTML=`<div class="crumb">${icon(adminMode?'settings':view==='capture'?'upload':view==='notifications'?'bell':view)}${titles[view]||'Suyajal Run'}</div>
    <div class="top-actions">${!adminMode?`<a href="#notifications" class="icon-button" aria-label="알림">${icon('bell')}${!me?'<i class="dot"></i>':''}</a>`:''}
    ${me?button(adminMode?'로그아웃':'계정',adminMode?'logout':'settings'):button('로그인','login','primary')}</div>`;
}
const samples=[
  {record_id:'sample-1',display_name:'러너',source_app:'SAMSUNG_HEALTH',exercise_date:'2026-11-11',distance_m:6200,duration_sec:2178,avg_pace_sec_km:351,avg_speed_kmh:10.25},
  {record_id:'sample-2',display_name:'러너',source_app:'APPLE_FITNESS',exercise_date:'2026-11-09',distance_m:5100,duration_sec:1860,avg_pace_sec_km:365,avg_speed_kmh:9.87},
  {record_id:'sample-3',display_name:'러너',source_app:'SAMSUNG_HEALTH',exercise_date:'2026-11-07',distance_m:7250,duration_sec:2650,avg_pace_sec_km:366,avg_speed_kmh:9.85}
];
const demo={items:samples,totals:{count:8,distance:48600,seconds:17542},
  week:[4200,0,5100,3150,0,6200,0].map((distance,i)=>({day:'2026-11-'+String(6+i).padStart(2,'0'),distance}))};
function recordList(items){
  return items.length?items.map(r=>`<button class="row" data-action="record:${esc(r.record_id)}"><span class="row-icon">${icon('run')}</span>
    <span class="row-main"><strong>${source(r.source_app)}</strong><small>${esc(r.exercise_date)} · ${duration(r.duration_sec)}</small></span>
    <span class="row-score number">${km(r.distance_m)} <small>km</small></span>${icon('arrow')}</button>`).join(''):empty('등록한 러닝 기록이 없습니다.');
}
function chart(week){
  const high=Math.max(4000,Math.ceil(Math.max(...week.map(r=>Number(r.distance)))/2000)*2000);
  const max=Math.max(...week.map(r=>Number(r.distance)));
  return `<svg class="chart" viewBox="0 0 360 160" role="img" aria-label="최근 7일 러닝 거리">
    ${[0,1,2,3].map(i=>`<text x="0" y="${18+i*34}">${num(high*(3-i)/3000,1)}</text><path class="grid" d="M35 ${15+i*34}h320"/>`).join('')}
    ${week.map((d,i)=>{
      const h=d.distance/high*102;
      const day=new Date(d.day+'T00:00:00Z').getUTCDay();
      return `<rect x="${48+i*44}" y="${117-Math.max(2,h)}" width="22" height="${Math.max(2,h)}" rx="4" class="${max>0 && Number(d.distance)===max?'peak':''}"><title>${esc(d.day)} · ${km(d.distance)} km</title></rect><text text-anchor="middle" x="${59+i*44}" y="140">${'일월화수목금토'[day]}</text>`;
    }).join('')}</svg>`;
}
function stats(cards){
  return `<div class="stats">${cards.map(([label,value,unit,glyph])=>`<div class="stat"><span class="stat-icon">${icon(glyph)}</span>
    <div><div class="stat-label">${label}</div><strong class="number">${value}${unit?`<small>${unit}</small>`:''}</strong></div></div>`).join('')}</div>`;
}
async function home(){
  const [data,groups]=me?await Promise.all([api('/records'),api('/groups')]):[demo,[]];
  const top=data.totals, mine=groups.filter(g=>g.joined).slice(0,3);
  return head('러닝 대시보드',me?`${esc(me.display_name)}님의 러닝 기록과 그룹 활동`:'샘플 기록으로 대시보드를 둘러보세요.',button('기록 등록','capture','primary','plus'))+
    `<section class="hero"><div class="hero-body"><div class="eyebrow">SUYAJAL RUN</div><h2>오늘의 러닝을<br>기록해 보세요</h2><p>삼성 헬스나 Apple Fitness의 러닝 화면을 올려보세요.</p>${button('캡처 업로드','capture','lime','upload')}</div></section>`+
    stats([['누적 거리',km(top.distance),'km','route'],['러닝 기록',num(top.count),'회','run'],['평균 페이스',top.distance?pace(top.seconds*1000/top.distance):'—','/km','clock']])+
    `<div class="home-grid">${panel('최근 러닝',recordList(data.items.slice(0,4)), '<a class="text-link" href="#records">모든 기록 →</a>')}
    <div>${panel('최근 7일 거리',chart(data.week),'<span class="chart-caption">km</span>')}
    <div class="panel stack"><div class="panel-title"><h2>내 그룹</h2><a class="text-link" href="#groups">그룹 보기 →</a></div>
    ${mine.length?groupRows(mine):me?empty('가입한 그룹이 없습니다.'):'<div class="row"><span class="row-icon">'+icon('groups')+'</span><span class="row-main"><strong>수야잘 러닝 크루</strong><small>샘플 그룹</small></span><span class="pill">주간 순위</span></div>'}</div></div></div>`;
}
function modal(title,content){
  dialog.innerHTML=`<div class="modal"><div class="panel-title"><h2>${title}</h2><button class="icon-button" data-action="close" aria-label="닫기">${icon('close')}</button></div>${content}</div>`;
  if(!dialog.open) dialog.showModal();
}
function guarded(action){if(!me){login();return;}navTo(action);}
function login(){
  modal('로그인',`<form class="form" data-form="login">${field('아이디','login_id','required maxlength="50" autocomplete="username"')}
    ${field('비밀번호','password','type="password" required maxlength="128" autocomplete="current-password"')}
    <button class="button primary">로그인</button><div class="actions">
    ${button('회원가입','signup')}</div></form>`);
}
function signup(){
  modal('회원가입',`<form class="form" data-form="signup">
    ${field('이름','display_name','required maxlength="100"')}
    ${field('아이디','login_id','required minlength="3" maxlength="50" autocomplete="username"')}
    ${field('비밀번호','password','type="password" required minlength="8" maxlength="128" autocomplete="new-password"')}
    ${field('비밀번호 확인','confirm','type="password" required minlength="8" maxlength="128" autocomplete="new-password"')}
    <button class="button primary">가입하기</button></form>`);
}
function recordDetail(record){
  const format=[v=>v,v=>km(v)+' km',v=>`${Math.floor(v/3600)}시간 ${Math.floor(v/60)%60}분 ${v%60}초`,
    v=>`${Math.floor(Math.round(v)/60)}분 ${Math.round(v)%60}초 /km`,v=>num(v,1)+' km/h',v=>num(v,0)+' spm',v=>num(v,0)+' bpm',v=>num(v,1)+' m'];
  const origins={READ:'화면 인식',MANUAL:'직접 입력',MISSING:'값 없음',CALCULATED:'자동 계산'};
  modal('러닝 상세',`<div class="form"><p class="info">${esc(record.display_name)} · ${source(record.source_app)}</p>
    <div class="detail-grid">${details.map(([key,label],i)=>`<div><small>${label}</small><strong>${record[key]==null?'—':esc(format[i](record[key]))}</strong>
      ${record.meta?.some(m=>m.field_code===key)?`<span>${origins[record.meta.find(m=>m.field_code===key).value_origin]}</span>`:''}</div>`).join('')}</div>
    ${me&&record.user_id===me.user_id?button('기록 및 공유 수정','edit:'+record.record_id,'primary'):''}</div>`);
}
function timeFields(legend,prefix,value,withHours){
  const part=(label,name,amount,options='')=>field(label,prefix+'_'+name,
    `type="number" min="0" ${options} placeholder="0" value="${value===''?'':amount}"`);
  const minutes=Math.floor(value/60);
  const seconds=Number((value%60).toFixed(8));
  return `<fieldset><legend>${legend}</legend><div class="time-parts">
    ${withHours?part('시간','hours',Math.floor(minutes/60)):''}
    ${withHours?part('분','minutes',minutes%60,'max="59"'):part('분','minutes',minutes)}
    ${part('초','seconds',seconds,withHours?'max="59"':'max="59.99999999" step="any"')}
    </div></fieldset>`;
}
const captureIntro=()=>head('러닝 기록 등록','캡처를 분석한 뒤 운동 수치를 확인하세요.')+
  panel('러닝 화면 선택',`<form class="upload" data-form="upload"><span class="row-icon">${icon('upload')}</span>
  <strong>삼성 헬스 또는 Apple Fitness</strong><p>PNG 또는 JPEG · 최대 4 MB</p><input aria-label="러닝 캡처 이미지" type="file" name="capture" accept="image/png,image/jpeg" required>
  <div class="actions"><button class="button primary">분석 시작</button></div></form>`);
function recordForm(r,groups,importId){
  const meta=r.meta||[], isNew=!!importId;
  const value=key=>meta.some(m=>m.field_code===key && m.value_origin==='CALCULATED')?'':r[key]??'';
  const numeric=(label,key,step='any',min='0')=>field(label,key,`type="number" step="${step}" min="${min}" value="${esc(value(key))}"`);
  const known=Object.keys(r).filter(k=>details.some(([f])=>f===k)).length;
  return `<form class="form" data-form="save-record" data-id="${esc(r.record_id||'')}" data-version="${esc(r.version||'')}" data-import="${esc(importId||'')}">
    ${isNew?`<p class="info">${known?'인식한 값과 빈 항목을 확인해 주세요.':'자동으로 읽은 값이 없습니다. 운동 화면을 확인해 입력해 주세요.'} 페이스와 속도를 비우면 자동 계산됩니다.</p>`:''}
    <div class="form-grid">
    <label class="field">기록 출처<select name="source_app" required><option value="">선택</option>
    ${['SAMSUNG_HEALTH','APPLE_FITNESS'].map(s=>`<option value="${s}" ${s===r.source_app?'selected':''}>${source(s)}</option>`).join('')}</select></label>
    ${field('운동 날짜','exercise_date',`type="date" required value="${esc(r.exercise_date||'')}"`)}
    ${field('거리 (km)','distance_km',`type="number" step="0.000001" min="0.001" required value="${r.distance_m?r.distance_m/1000:''}"`)}
    ${timeFields('운동 시간','duration',value('duration_sec'),true)}
    ${timeFields('평균 페이스 (/km)','pace',value('avg_pace_sec_km'),false)}
    ${numeric('평균 속도 (km/h)','avg_speed_kmh')}
    ${numeric('평균 케이던스 (걸음/분)','avg_cadence_spm')}${numeric('평균 심박수 (bpm)','avg_heart_rate_bpm')}
    ${numeric('고도 상승 (m)','elevation_gain_m')}</div>
    <fieldset><legend>공유 범위</legend><label class="check"><input type="checkbox" name="share_to_friends" ${r.share_to_friends?'checked':''}>친구에게 공유</label>
      ${groups.filter(g=>g.joined).map(g=>`<label class="check"><input type="checkbox" name="groups" value="${esc(g.group_id)}" ${r.groups?.includes(g.group_id)?'checked':''}>${esc(g.group_name)}</label>`).join('')}</fieldset>
    <div class="actions"><button class="button primary">확인 후 저장</button>${isNew?button('취소','cancel-import:'+importId):''}</div>
    </form>`;
}
function groupRows(items){
  return items.length?items.map(g=>`<button class="row" data-action="group:${esc(g.group_id)}"><span class="row-icon">${icon('groups')}</span>
    <span class="row-main"><strong>${esc(g.group_name)}</strong><small>${g.visibility==='PUBLIC'?'공개':'비공개'} · ${num(g.member_count)}명</small></span>
    ${g.joined?'<span class="pill">가입 중</span>':''}${icon('arrow')}</button>`).join(''):empty('표시할 그룹이 없습니다.');
}
async function groupDetail(id,metric='distance',period='week'){
  const g=await api(`/groups/${id}?metric=${metric}&period=${period}`);
  const rank=g.ranking.map(r=>`<div class="row"><span class="row-icon">${esc(r.rank_no)}</span><span class="row-main"><strong>${esc(r.display_name)}</strong></span><span class="row-score">${score(r.score,g.metric)}</span></div>`).join('');
  const controls=g.joined?`<form class="toolbar" data-form="ranking" data-id="${esc(id)}"><select name="metric" aria-label="순위 지표">
    ${Object.entries(metrics).map(([k,v])=>`<option value="${k}" ${k===g.metric?'selected':''}>${v}</option>`).join('')}</select>
    <select name="period" aria-label="집계 기간"><option value="week">주간</option><option value="month" ${g.period==='month'?'selected':''}>월간</option></select><button class="button">조회</button></form>`:'';
  const owner=g.owner_user_id===me.user_id;
  modal(esc(g.group_name),`<div class="form"><p class="info">${g.visibility==='PUBLIC'?'공개':'비공개'} · 그룹원 ${g.count}명</p>
    ${controls}<div><strong>${metrics[g.metric]}</strong><p class="preview">${esc(g.bounds.start)} ~ ${esc(g.bounds.end)} 전 · 한국 시간</p><p class="preview">집계 ${when(g.calculated_at)}</p></div>
    ${g.joined?`<p class="info">내 순위 ${g.mine?`${esc(g.mine.rank_no)}위 · ${score(g.mine.score,g.metric)}`:'—'}</p>`:''}
    <div>${rank||empty('이 기간에 공유된 러닝 기록이 없습니다.')}</div>
    ${g.joined?`<details><summary>전체 그룹원 (${g.members.length})</summary><div>${g.members.map(m=>`<div class="row">${esc(m.display_name)}</div>`).join('')}</div></details>`:''}
    <div class="actions">${!g.joined?button('그룹 가입','join:'+id,'primary'):owner?button('초대 링크 만들기','invite:'+id,'primary')+button('초대 모두 폐기','revoke-invites:'+id):button('그룹 탈퇴','leave:'+id,'danger')}</div></div>`);
}
function friendsPage(items){
  const section=(title,subset)=>panel(title,subset.length?subset.map(f=>`<div class="row"><span class="avatar">${esc(f.display_name[0])}</span>
    <span class="row-main"><strong>${esc(f.display_name)}</strong></span>
    ${f.status==='ACCEPTED'?'<span class="pill">연결됨</span>':f.requested_by===me.user_id?'<span class="pill">수락 대기</span>':
    button('수락','friend-accept:'+f.relation_id,'primary')+button('거절','friend-reject:'+f.relation_id)}</div>`).join(''):empty('목록이 비어 있습니다.'));
  return head('친구','전화번호로 친구를 찾아 러닝 기록을 공유하세요.',button('친구 검색','friend-search','primary','plus'))+
    `<div class="home-grid">${section('연결된 친구',items.filter(f=>f.status==='ACCEPTED'))}<div>${section('받은 요청',items.filter(f=>f.status==='PENDING'&&f.requested_by!==me.user_id))}
    <div class="panel stack"><div class="panel-title"><h2>보낸 요청</h2></div>${items.filter(f=>f.status==='PENDING'&&f.requested_by===me.user_id).map(f=>`<div class="row"><span class="row-main">${esc(f.display_name)}</span><span class="pill">수락 대기</span></div>`).join('')||empty('보낸 요청이 없습니다.')}</div></div></div>`;
}
const authWall=()=>head(titles[page()]||'Suyajal Run')+panel('로그인이 필요합니다',`<div class="form"><p class="muted">${esc(bootError||'로그인 후 이 기능을 이용할 수 있습니다.')}</p><div>${button('로그인','login','primary')}</div></div>`);
function groupsPage(groups){
  return head('그룹','함께 달리고 주간·월간 순위를 확인하세요.',button('그룹 만들기','create-group','primary','plus'))+
    `<form class="toolbar" data-form="group-search"><input name="q" aria-label="그룹 이름" placeholder="그룹 이름 검색"><button class="button">검색</button>${button('초대 링크 참여','join-invite')}</form>
    <div id="group-results" class="home-grid">${panel('내 그룹',groupRows(groups.filter(g=>g.joined)))}${panel('공개 그룹',groupRows(groups.filter(g=>!g.joined)))}</div>`;
}
function notificationsPage(items){
  return head('알림','친구가 공유한 새 러닝 기록을 확인하세요.',button('모두 읽음','read-all'))+
    panel('알림함',items.length?items.map(n=>`<button class="row" data-action="notification:${esc(n.notification_id)}">
    <span class="row-icon">${icon('bell')}</span><span class="row-main"><strong>${esc(n.display_name)}님이 러닝 기록을 공유했습니다</strong><small>${when(n.created_at)}</small></span>
    ${n.read_at?'':'<span class="pill">새 알림</span>'}${icon('arrow')}</button>`).join(''):empty('새 알림이 없습니다.'));
}
function usersPage(){
  return head('사용자 관리','계정 상태와 활동을 조회하고 이용 제한을 관리합니다.')+
    `<form class="toolbar" data-form="user-search"><input name="q" aria-label="이름, 아이디, 전화번호" placeholder="이름, 아이디, 전화번호">
      <select name="state" aria-label="계정 상태"><option value="">전체 상태</option><option value="normal">정상</option><option value="limited">제한</option></select>
      <label class="field">가입 시작일<input type="date" name="from"></label><label class="field">가입 종료일<input type="date" name="to"></label>
      <button class="button primary">검색</button></form><div id="user-results"></div>`;
}
async function userResults(form,p=1){
  const q=new URLSearchParams(new FormData(form));q.set('page',p);
  const data=await api('/admin/users?'+q);
  if(!$('#user-results')) return;
  $('#user-results').innerHTML=panel('전체 사용자 · '+num(data.total)+'명',data.items.length?`<div class="table-wrap"><table><thead><tr>
    <th>이름 / 아이디</th><th>전화번호</th><th>가입일</th><th>상태</th><th>작업</th></tr></thead><tbody>
    ${data.items.map(u=>`<tr><td>${esc(u.display_name)} / ${esc(u.login_id)}</td><td>${esc(u.phone)}</td><td>${when(u.created_at)}</td>
    <td><span class="pill ${u.limited?'warn':''}">${u.limited?'제한':'정상'}</span></td><td>${button('상세 보기','user:'+u.user_id)}</td></tr>`).join('')}</tbody></table></div>
    <div class="actions">${p>1?button('이전','user-page:'+(p-1)):''}<span class="pill">${p} / ${Math.ceil(data.total/20)}</span>${p*20<data.total?button('다음','user-page:'+(p+1)):''}</div>`:empty('검색 결과가 없습니다.'));
}
async function adminUser(id){
  const u=await api('/admin/users/'+id);
  modal(esc(u.display_name),`<div class="form"><p class="info">${esc(u.login_id)} · ${esc(u.phone)} · ${u.limited?'제한 중':'정상 이용 중'}</p>
    <div class="detail-grid">${[['가입일',when(u.created_at)],['최근 활동',when(u.last_seen)],['확정 기록',u.records+'건'],['가입 그룹',u.groups+'개'],['친구',u.friends+'명'],['비밀번호 변경',when(u.password_changed_at)]].map(([k,v])=>`<div><small>${k}</small><strong>${esc(v)}</strong></div>`).join('')}</div>
    <h3>제한 이력</h3>${u.history.map(h=>`<div class="row"><span class="row-main"><strong>${esc(h.reason)}</strong><small>${esc(h.actor)} · ${when(h.starts_at)} ~ ${h.ends_at?when(h.ends_at):'무기한'}</small>
    ${h.revoked_at?`<small>해제 · ${esc(h.revoked_by)} · ${when(h.revoked_at)} · ${esc(h.revoke_reason)}</small>`:''}</span><span class="pill">${h.active?'제한 중':h.revoked_at?'해제':'종료'}</span></div>`).join('')||empty('이용 제한 이력이 없습니다.')}
    <div class="actions">${id===me.user_id?'':button(u.limited?'이용 제한 해제':'이용 제한 설정',(u.limited?'release:':'restrict:')+id,'danger')}</div></div>`);
}
function statsPage(){
  const today=localDate();
  return head('사용자 통계','한국 시간 기준으로 사용자와 확정 기록을 집계합니다.')+
    `<form class="toolbar" data-form="stats">${field('시작일','from',`type="date" required value="${today.slice(0,8)}01"`)}
      ${field('종료일','to',`type="date" required value="${today}"`)}<button class="button primary">조회</button></form><div id="stats-results"></div>`;
}
async function statsResults(form){
  const q=new URLSearchParams(new FormData(form));
  const a=await api('/admin/stats?'+q);
  if(!$('#stats-results')) return;
  $('#stats-results').innerHTML=stats([['전체 사용자',num(a.total),'명','friends'],['정상 사용자',num(a.normal),'명','friends'],['제한 사용자',num(a.limited),'명','settings']])+
    stats([['신규 가입',num(a.joined),'명','plus'],['활성 사용자',num(a.active),'명','activity'],['기록 등록자',num(a.runners),'명','run']])+
    panel('확정 기록 · '+num(a.records)+'건',`<p class="info">삼성 헬스 ${num(a.samsung)}건 · Apple Fitness ${num(a.apple)}건</p><p class="preview">집계 ${when(a.calculated_at)}</p>`);
}
async function render(){
  const ticket=++generation, view=page();
  shell(view);
  main.innerHTML='<p class="empty" role="status">불러오는 중…</p>';
  try {
    let content;
    if(adminMode){
      if(!me) content=authWall();
      else if(!me.admin) content=head('관리자 페이지')+panel('접근 권한',empty('관리자 권한이 필요합니다.'));
      else if(view==='stats') content=statsPage();
      else if(view==='audit'){
        const history=await api('/admin/audit');
        content=head('관리 이력')+panel('최근 작업',history.map(h=>`<div class="row"><span class="row-icon">${icon('records')}</span><span class="row-main"><strong>${esc(h.action_code)} · ${esc(h.actor)}</strong><small>${when(h.created_at)} · ${esc(h.target||'—')} · ${esc(h.request_id)}</small></span><span class="pill">${esc(h.result_code)}</span></div>`).join('')||empty('관리 이력이 없습니다.'));
      }else content=usersPage();
    } else if(view==='home') content=await home();
    else if(view==='records') content=head('내 기록',me?'등록한 러닝 기록을 확인하세요.':'샘플 기록을 둘러보세요.',button('기록 등록','capture','primary','plus'))+panel('러닝 기록',recordList(me?(await api('/records')).items:demo.items));
    else if(!me) content=authWall();
    else if(view==='capture') content=captureIntro();
    else if(view==='friends') content=friendsPage(await api('/friends'));
    else if(view==='groups') content=groupsPage(await api('/groups'));
    else if(view==='notifications') content=notificationsPage(await api('/notifications'));
    else if(view==='settings') content=head('설정')+panel('내 계정',`<div class="form"><p class="info">${esc(me.display_name)} · ${esc(me.login_id)} · ${esc(me.phone)}</p>
      <div class="actions">${button('로그아웃','logout','danger')}</div>
      <form class="form" data-form="settings"><label class="check"><input name="push" type="checkbox" ${me.push_enabled?'checked':''}>푸시 알림 수신 설정</label>
      <small>기기 푸시 발송은 연결 준비 중입니다. 앱 내 알림은 알림함에서 확인할 수 있습니다.</small><div><button class="button">설정 저장</button></div></form></div>`);
    else content=head('페이지를 찾을 수 없습니다.')+'<a class="button" href="#home">홈으로</a>';
    if(ticket!==generation) return;
    main.innerHTML=content;
    if(adminMode&&me?.admin){
      if($('[data-form="user-search"]')) await userResults($('[data-form="user-search"]'));
      if($('[data-form="stats"]')) await statsResults($('[data-form="stats"]'));
    }
  }catch(err){
    if(ticket!==generation) return;
    if(err.status===401 && me){me=null;return render();}
    main.innerHTML=head(titles[view]||'Suyajal Run')+panel('다시 시도해 주세요',`<p class="info error">${esc(err.message)}</p><div class="actions">${button('다시 불러오기','refresh')}</div>`);
  }
}
const tokenFrom=value=>value.includes('#invite/')?value.split('#invite/')[1]:value;
async function joinFromLink(){
  const id=location.hash.match(/^#invite\/([\w-]+)$/)?.[1];
  if(!adminMode && id && me){
    modal('그룹 초대',`<p class="info">초대를 수락하면 그룹에 가입합니다.</p><div class="actions">${button('초대 수락','accept-invite:'+id,'primary')}</div>`);
    return true;
  }
  return false;
}
async function loadSession(){
  try{me=await api('/auth/me');bootError='';}
  catch(err){me=null;if(err.status!==401) bootError=err.message;}
}
const getForm=key=>document.querySelector(`[data-form="${key}"]`);
const groupActions={
  join:async id=>{await post('/groups/'+id+'/join');await render();await groupDetail(id);},
  leave:async id=>{if(confirm('탈퇴하면 이 그룹과 공유한 기록이 순위에서 제외됩니다.')){await post('/groups/'+id+'/leave');dialog.close();await render();}},
  invite:async id=>{const result=await post('/groups/'+id+'/invites');const url=location.origin+'/#invite/'+result.token;modal('초대 링크',`<div class="form"><p class="info">링크는 7일간 유효합니다.</p>${field('초대 링크','invite_url',`readonly value="${esc(url)}"`)}${button('복사','copy-invite','primary')}</div>`);},
  'revoke-invites':async id=>{if(confirm('이 그룹의 모든 초대 링크를 폐기할까요?')){await api('/groups/'+id+'/invites',{method:'DELETE'});toast('초대 링크를 폐기했습니다.');await groupDetail(id);}},
  'accept-invite':async token=>{const r=await post('/groups/invite',{token});dialog.close();navTo('groups');await groupDetail(r.group_id);}
};
const actions={
  login,close:()=>dialog.close(),refresh:render,capture:()=>guarded('capture'),settings:()=>navTo('settings'),
  logout:async()=>{await post('/auth/logout');me=null;dialog.close();navTo(adminMode?'users':'home');},
  signup,
  record:async id=>recordDetail(samples.find(s=>s.record_id===id)??await api('/records/'+id)),
  notification:async id=>recordDetail(await post('/notifications/'+id+'/open')),
  'read-all':async()=>{await post('/notifications/read');await render();},
  edit:async id=>{const [r,g]=await Promise.all([api('/records/'+id),api('/groups')]);modal('기록 및 공유 수정',recordForm(r,g));},
  'cancel-import':async id=>{await api('/imports/'+id,{method:'DELETE'});await render();},
  'friend-search':()=>modal('친구 검색',`<form class="form" data-form="friend-search">${field('친구 아이디','login_id','required minlength="3" maxlength="50"')}<button class="button primary">검색</button></form>`),
  'friend-request':async id=>{await post('/friends/request',{user_id:id});dialog.close();toast('친구 요청을 보냈습니다.');await render();},
  'friend-accept':async id=>{await post('/friends/'+id+'/respond',{accept:true});await render();},
  'friend-reject':async id=>{await post('/friends/'+id+'/respond',{accept:false});await render();},
  'create-group':()=>modal('그룹 만들기',`<form class="form" data-form="create-group">${field('그룹 이름','group_name','required maxlength="100"')}
    <label class="field">공개 범위<select name="visibility"><option value="PUBLIC">공개</option><option value="PRIVATE">비공개</option></select></label>
    <button class="button primary">그룹 만들기</button></form>`),
  'join-invite':()=>modal('초대 링크 참여',`<form class="form" data-form="join-invite">${field('초대 링크 또는 코드','token','required maxlength="200"')}<button class="button primary">그룹 가입</button></form>`),
  'copy-invite':async()=>{await navigator.clipboard.writeText($('[name="invite_url"]').value);toast('초대 링크를 복사했습니다.');},
  group:groupDetail,...groupActions,
  'user-page':p=>userResults(getForm('user-search'),Number(p)),user:adminUser,
  restrict:id=>restrictionForm(id,false),release:id=>restrictionForm(id,true)
};
function restrictionForm(id,release){
  modal(release?'이용 제한 해제':'이용 제한 설정',`<form class="form" data-form="restriction" data-id="${esc(id)}" data-mode="${release?'release':'restrict'}">
    <label class="field">사유<textarea name="reason" required maxlength="1000"></textarea></label>
    ${release?'':field('제한 종료 (한국 시간, 빈칸이면 무기한)','ends_at','type="datetime-local"')}
    <button class="button primary">${release?'제한 해제 적용':'제한 적용'}</button></form>`);
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function uploadCapture(form,formData){
  const result=await post('/imports',formData);
  const id=result.id, ticket=generation;
  main.innerHTML=head('러닝 기록 등록')+panel('캡처 분석 중',`<p class="info" role="status">러닝 화면에서 운동 수치를 읽고 있습니다.</p><div class="actions">${button('분석 취소','cancel-import:'+id)}</div>`);
  for(let i=0;i<90 && ticket===generation;i++){
    await delay(1500);
    if(ticket!==generation) return;
    const draft=await api('/imports/'+id);
    if(draft.status==='READY'){
      const groups=await api('/groups');
      if(ticket===generation) main.innerHTML=head('러닝 수치 확인','기록에 저장할 수치와 공유 범위를 확인하세요.')+
        panel('운동 정보',recordForm({...draft.extracted_values,source_app:draft.source_app},groups,id));
      return;
    }
    if(draft.status!=='ANALYZING') break;
  }
  if(ticket===generation) main.innerHTML=head('러닝 기록 등록')+panel('분석 결과 대기',`<p class="info">분석 결과를 받지 못했습니다. 다시 시도해 주세요.</p><div class="actions">${button('다시 시작','cancel-import:'+id,'primary')}</div>`);
}
async function saveRecord(form,formData,values){
  const id=form.dataset.id;
  const {distance_km,duration_hours,duration_minutes,duration_seconds,pace_minutes,pace_seconds,...record}=values;
  const duration_sec=Number(duration_hours)*3600+Number(duration_minutes)*60+Number(duration_seconds);
  if(!duration_sec) throw Error('운동 시간을 입력해 주세요.');
  const avg_pace_sec_km=pace_minutes||pace_seconds
    ? Number((Number(pace_minutes)*60+Number(pace_seconds)).toFixed(8)) : '';
  const body={...record,duration_sec,avg_pace_sec_km,distance_m:Number(distance_km)*1000,
    share_to_friends:formData.has('share_to_friends'),groups:formData.getAll('groups')};
  if(id){
    await api('/records/'+id,{method:'PATCH',body:{...body,version:Number(form.dataset.version)}});
    dialog.close();
  }else{
    body.import_id=form.dataset.import;
    const submit=async()=>{
      const json=JSON.stringify(body);
      if(form.dataset.lastBody!==json){form.dataset.key=crypto.randomUUID();form.dataset.lastBody=json;}
      await api('/records',{method:'POST',body,key:form.dataset.key});
    };
    if(form.dataset.duplicate) body.duplicate_of_record_id=form.dataset.duplicate;
    try {await submit();}
    catch(err){
      const dup=err.details?.duplicate;
      if(!dup) throw err;
      if(!confirm(`유사 기록 · ${dup.exercise_date} · ${km(dup.distance_m)} km · ${duration(dup.duration_sec)}\n별도의 러닝으로 저장할까요?`)) return;
      body.duplicate_of_record_id=dup.record_id;
      form.dataset.duplicate=dup.record_id;
      await submit();
    }
  }
  toast('러닝 기록을 저장했습니다.');
  navTo('records');
}
const forms={
  login:async(_f,_d,v)=>{await post('/auth/login',v);await loadSession();dialog.close();await render();await joinFromLink();},
  signup:async(_f,_d,v)=>{await post('/auth/signup',v);login();toast('가입이 완료되었습니다.');},
  upload:uploadCapture,'save-record':saveRecord,
  ranking:(f,_d,v)=>groupDetail(f.dataset.id,v.metric,v.period),
  'friend-search':async(_f,_d,v)=>{
    const r=await post('/friends/search',v);
    modal('검색 결과',r?`<div class="form"><p class="info">${esc(r.display_name)}</p>
      ${r.status==='ACCEPTED'?'<span>연결된 친구입니다.</span>':r.status==='PENDING'?'<span>수락을 기다리는 요청이 있습니다.</span>':button('친구 요청','friend-request:'+r.user_id,'primary')}</div>`:empty('일치하는 사용자가 없습니다.'));
  },
  'group-search':async(_f,_d,v)=>{
    const g=await api('/groups?q='+encodeURIComponent(v.q));
    if($('#group-results')) $('#group-results').innerHTML=panel('내 그룹',groupRows(g.filter(x=>x.joined)))+panel('공개 그룹',groupRows(g.filter(x=>!x.joined)));
  },
  'create-group':async(_f,_d,v)=>{const r=await post('/groups',v);dialog.close();await render();await groupDetail(r.group_id);},
  'join-invite':async(_f,_d,v)=>groupActions['accept-invite'](tokenFrom(v.token.trim())),
  settings:async(_f,d)=>{await api('/auth/settings',{method:'PATCH',body:{push_enabled:d.has('push')}});await loadSession();toast('설정을 저장했습니다.');},
  'user-search':f=>userResults(f),
  stats:f=>statsResults(f),
  restriction:async(f,_d,v)=>{
    const id=f.dataset.id;
    if(v.ends_at) v.ends_at+='+09:00';
    if(!confirm('이 계정에 변경을 적용할까요?')) return;
    await post('/admin/users/'+id+'/'+f.dataset.mode,v);await render();await adminUser(id);toast('계정 상태를 변경했습니다.');
  }
};
document.addEventListener('click',async event=>{
  const b=event.target.closest('button[data-action]');
  if(!b||b.disabled) return;
  const [key,arg]=b.dataset.action.split(':');
  if(!Object.hasOwn(actions,key)) return;
  b.disabled=true;
  try{await actions[key](arg);}
  catch(err){toast(err.message);}
  finally{b.disabled=false;}
});
document.addEventListener('submit',async event=>{
  const f=event.target, key=f.dataset.form;
  if(!Object.hasOwn(forms,key||'')) return;
  event.preventDefault();
  const b=event.submitter||f.querySelector('button:not([type=button])');
  if(b?.disabled) return;
  if(b) b.disabled=true;
  const data=new FormData(f);
  f.querySelector('.info.error')?.remove();
  try{await forms[key](f,data,Object.fromEntries(data));}
  catch(err){
    if(f.isConnected){const p=document.createElement('p');p.className='info error';p.setAttribute('role','alert');p.textContent=err.message;f.prepend(p);}
    else toast(err.message);
  }
  finally{if(b) b.disabled=false;}
});
window.addEventListener('hashchange',async()=>{if(dialog.open)dialog.close();await render();await joinFromLink();});
await loadSession();
await render();
await joinFromLink();

