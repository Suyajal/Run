import {Router} from 'express';
import {randomUUID} from 'node:crypto';
import {db,rows,one,transaction,check,uuid,date,string,restriction} from './db.mjs';
import {mask,lookup,phone} from './identity.mjs';

export const admin=Router();
admin.use((req,_res,next)=>{check(req.user.admin,'관리자 권한이 필요합니다.',403);next();});
async function audit(c,req,action,target=null,restrictionId=null){
  await c.query(`insert into admin_audit_log(audit_id,actor_user_id,action_code,target_user_id,restriction_id,result_code,request_id)
    values($1,$2,$3,$4,$5,'SUCCESS',$6)`,[randomUUID(),req.user.user_id,action,target,restrictionId,req.requestId]);
}
function publicUser({phone_ciphertext,...u}){return {...u,phone:mask(phone_ciphertext)};}
admin.get('/users',async(req,res)=>{
  const page=Math.min(100000,Math.max(1,parseInt(req.query.page,10)||1));
  const q=typeof req.query.q==='string'?req.query.q.slice(0,100).trim():'';
  const ph=/^\+?\d[\d\s-]{8,}$/.test(q)?(()=>{try{return lookup(phone(q));}catch{return null;}})():null;
  const from=req.query.from?date(req.query.from):null,to=req.query.to?date(req.query.to):null;
  const state=['normal','limited'].includes(req.query.state)?req.query.state:null;
  const filter=`from app_user u where ($2::text is null or u.phone_lookup_hash=$2)
    and ($2::text is not null or strpos(lower(u.login_id),lower($1))>0 or strpos(lower(u.display_name),lower($1))>0)
    and ($3::text is null or ${restriction('u.user_id')}=($3='limited'))
    and ($4::date is null or u.created_at>=($4::date::timestamp at time zone 'Asia/Seoul'))
    and ($5::date is null or u.created_at<(($5::date+1)::timestamp at time zone 'Asia/Seoul'))`;
  const params=[q,ph,state,from,to];
  const data=await transaction(async c=>{
    const total=await one(c,`select count(*)::int total ${filter}`,params);
    const items=await rows(c,`select u.user_id,u.display_name,u.login_id,u.phone_ciphertext,u.created_at,
      ${restriction('u.user_id')} limited ${filter} order by created_at desc,user_id limit 20 offset $6`,[...params,(page-1)*20]);
    await audit(c,req,'USER_LIST');
    return {...total,page,items:items.map(publicUser)};
  });
  res.json(data);
});
admin.get('/users/:id',async(req,res)=>{
  const id=uuid(req.params.id);
  const data=await transaction(async c=>{
    const user=await one(c,`select u.user_id,u.login_id,u.display_name,u.phone_ciphertext,u.created_at,u.password_changed_at,
      ${restriction('u.user_id')} limited,
      (select max(last_seen_at) from user_activity_daily where user_id=u.user_id) last_seen,
      (select count(*)::int from running_record where user_id=u.user_id and deleted_at is null) records,
      (select count(*)::int from group_member where user_id=u.user_id and status='ACTIVE') groups,
      (select count(*)::int from friend_relation where u.user_id in(user_low_id,user_high_id) and status='ACCEPTED') friends
      from app_user u where u.user_id=$1`,[id]);
    check(user,'사용자를 찾을 수 없습니다.',404);
    const history=await rows(c,`select x.restriction_id,x.reason,x.starts_at,x.ends_at,x.status,x.revoked_at,x.revoke_reason,
      a.display_name actor,b.display_name revoked_by,(x.status='ACTIVE' and x.starts_at<=now() and (x.ends_at is null or x.ends_at>now())) active
      from user_restriction x join app_user a on a.user_id=x.restricted_by left join app_user b on b.user_id=x.revoked_by
      where x.user_id=$1 order by x.created_at desc limit 100`,[id]);
    await audit(c,req,'USER_DETAIL',id);
    return {...publicUser(user),history};
  });
  res.json(data);
});
admin.post('/users/:id/restrict',async(req,res)=>{
  const id=uuid(req.params.id), why=string(req.body.reason,1000), end=req.body.ends_at||null;
  check(id!==req.user.user_id,'현재 로그인한 계정은 제한할 수 없습니다.');
  check(!end||(typeof end==='string' && /(?:Z|[+-]\d\d:\d\d)$/.test(end) && +new Date(end)>Date.now()),'종료 시각은 현재보다 뒤여야 합니다.');
  await transaction(async c=>{
    const u=await one(c,`select user_id,${restriction('app_user.user_id')} limited from app_user where user_id=$1 for update`,[id]);
    check(u && !u.limited,'사용자가 없거나 이미 이용 제한 상태입니다.',409);
    await c.query("update user_restriction set status='EXPIRED' where user_id=$1 and status='ACTIVE' and ends_at<=now()",[id]);
    const rid=randomUUID();
    await c.query(`insert into user_restriction(restriction_id,user_id,restricted_by,reason,status,ends_at)
      values($1,$2,$3,$4,'ACTIVE',$5)`,[rid,id,req.user.user_id,why,end]);
    await c.query('update auth_session set revoked_at=now() where user_id=$1 and revoked_at is null',[id]);
    await audit(c,req,'RESTRICT',id,rid);
  });
  res.json({ok:true});
});
admin.post('/users/:id/release',async(req,res)=>{
  const id=uuid(req.params.id), why=string(req.body.reason,1000);
  await transaction(async c=>{
    await c.query('select user_id from app_user where user_id=$1 for update',[id]);
    const r=await one(c,`update user_restriction set status='REVOKED',revoked_at=now(),revoked_by=$2,revoke_reason=$3
      where user_id=$1 and status='ACTIVE' and starts_at<=now() and (ends_at is null or ends_at>now()) returning restriction_id`,
      [id,req.user.user_id,why]);
    check(r,'유효한 제한이 없습니다.',409);
    await audit(c,req,'RELEASE',id,r.restriction_id);
  });
  res.json({ok:true});
});
admin.post('/users/:id/reset-guidance',async(req,res)=>{
  const id=uuid(req.params.id);
  check(await one(db,'select 1 from app_user where user_id=$1',[id]),'사용자를 찾을 수 없습니다.',404);
  await audit(db,req,'RESET_GUIDANCE',id);
  res.json({message:'로그인 화면에서 비밀번호 초기화를 선택한 뒤 아이디와 가입 휴대폰으로 인증해 주세요.'});
});
admin.get('/stats',async(req,res)=>{
  const from=date(req.query.from),to=date(req.query.to);
  check(from<=to,'조회 시작일과 종료일을 확인해 주세요.');
  const data=await transaction(async c=>{
    const result=await one(c,`with d as(select $1::date a,$2::date b, $1::date::timestamp at time zone 'Asia/Seoul' first,
      (($2::date+1)::timestamp at time zone 'Asia/Seoul') last),
    roster as(select count(*)::int total,count(*) filter(where exists(select 1 from user_restriction x
      where x.user_id=u.user_id and x.starts_at<d.last and (x.ends_at is null or x.ends_at>=d.last)
      and (x.revoked_at is null or x.revoked_at>=d.last)))::int limited,
      count(*) filter(where u.created_at>=d.first)::int joined from app_user u cross join d where u.created_at<d.last),
    logs as(select count(distinct user_id)::int active from user_activity_daily cross join d where activity_date between d.a and d.b),
    runs as(select count(*)::int records,count(distinct user_id)::int runners,
      count(*) filter(where source_app='SAMSUNG_HEALTH')::int samsung,count(*) filter(where source_app='APPLE_FITNESS')::int apple
      from running_record cross join d where created_at>=d.first and created_at<d.last and deleted_at is null)
    select *,total-limited normal,now() calculated_at from roster,logs,runs`,[from,to]);
    await audit(c,req,'STATS_VIEW');
    return result;
  });
  res.json(data);
});
admin.get('/audit',async(_req,res)=>{
  res.json(await rows(db,`select l.action_code,l.created_at,l.result_code,l.request_id,a.display_name actor,t.display_name target
    from admin_audit_log l join app_user a on a.user_id=l.actor_user_id left join app_user t on t.user_id=l.target_user_id
    order by l.created_at desc limit 100`));
});

