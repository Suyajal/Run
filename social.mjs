import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { randomBytes,randomUUID } from 'node:crypto';
import { db,one,rows,transaction,check,uuid,string,restriction } from './db.mjs';
import { digest,lookup,phone } from './identity.mjs';
export const social=Router();
social.get('/friends',async(req,res)=>{
  res.json(await rows(db,`select f.relation_id,f.requested_by,f.status,u.user_id,u.display_name from friend_relation f
    join app_user u on u.user_id=case when f.user_low_id=$1 then f.user_high_id else f.user_low_id end
    where $1 in(f.user_low_id,f.user_high_id) and f.status in('PENDING','ACCEPTED')
    order by f.updated_at desc limit 200`,[req.user.user_id]));
});
social.post('/friends/search',rateLimit({windowMs:60000,limit:15,keyGenerator:req=>req.user.user_id,message:{message:'검색 요청이 많습니다. 잠시 후 다시 시도해 주세요.'}}),async(req,res)=>{
  const u=await one(db,`select u.user_id,u.display_name,f.status from app_user u left join friend_relation f
    on f.user_low_id=least(u.user_id,$2) and f.user_high_id=greatest(u.user_id,$2)
    where u.phone_lookup_hash=$1 and u.user_id<>$2 and not ${restriction('u.user_id')}`,
    [lookup(phone(req.body.phone)),req.user.user_id]);
  res.json(u??null);
});
social.post('/friends/request',async(req,res)=>{
  const uid=req.user.user_id, other=uuid(req.body.user_id);
  check(uid!==other,'본인에게 요청할 수 없습니다.');
  check(await one(db,`select user_id from app_user u where user_id=$1 and not ${restriction('u.user_id')}`,[other]),'사용자를 찾을 수 없습니다.',404);
  const result=await db.query(`insert into friend_relation(relation_id,user_low_id,user_high_id,requested_by,status)
    values($1,least($2::uuid,$3::uuid),greatest($2::uuid,$3::uuid),$2,'PENDING')
    on conflict(user_low_id,user_high_id) do update set status='PENDING',requested_by=$2,
      requested_at=now(),responded_at=null,updated_at=now()
    where friend_relation.status='REJECTED' and friend_relation.responded_at<=now()-interval '1 day'`,[randomUUID(),uid,other]);
  check(result.rowCount,'이미 연결됐거나 응답을 기다리고 있습니다. 거절된 요청은 24시간 후 다시 보낼 수 있습니다.',409);
  res.json({ok:true});
});
social.post('/friends/:id/respond',async(req,res)=>{
  const id=uuid(req.params.id), uid=req.user.user_id;
  const state=req.body.accept===true?'ACCEPTED':'REJECTED';
  const result=await db.query(`update friend_relation set status=$3,responded_at=now(),updated_at=now()
    where relation_id=$1 and $2 in(user_low_id,user_high_id) and requested_by<>$2 and status='PENDING'`,[id,uid,state]);
  if(!result.rowCount) check(await one(db,`select 1 from friend_relation where relation_id=$1 and $2 in(user_low_id,user_high_id)
    and requested_by<>$2 and status=$3`,[id,uid,state]),'응답할 수 없는 요청입니다.',409);
  res.json({ok:true});
});
social.get('/groups',async(req,res)=>{
  const q=typeof req.query.q==='string'?req.query.q.slice(0,100):'';
  res.json(await rows(db,`select g.group_id,g.group_name,g.visibility,g.owner_user_id,coalesce(m.status='ACTIVE',false) joined,
    (select count(*)::int from group_member a where a.group_id=g.group_id and a.status='ACTIVE') member_count
    from running_group g left join group_member m on m.group_id=g.group_id and m.user_id=$1
    where (g.visibility='PUBLIC' or m.status='ACTIVE') and strpos(lower(g.group_name),lower($2))>0
    order by joined desc,g.created_at desc limit 100`,[req.user.user_id,q]));
});
async function join(c,id,uid){
  await c.query(`insert into group_member(group_id,user_id,status) values($1,$2,'ACTIVE')
    on conflict(group_id,user_id) do update set status='ACTIVE',left_at=null,joined_at=now(),updated_at=now()
    where group_member.status<>'ACTIVE'`,[id,uid]);
}
social.post('/groups',async(req,res)=>{
  const name=string(req.body.group_name,100), visibility=req.body.visibility, uid=req.user.user_id, id=randomUUID();
  check(['PUBLIC','PRIVATE'].includes(visibility),'공개 범위를 선택해 주세요.');
  await transaction(async c=>{
    await c.query('insert into running_group(group_id,group_name,visibility,owner_user_id) values($1,$2,$3,$4)',[id,name,visibility,uid]);
    await join(c,id,uid);
  });
  res.status(201).json({group_id:id});
});
social.post('/groups/:id/join',async(req,res)=>{
  const id=uuid(req.params.id), uid=req.user.user_id;
  check(await one(db,"select 1 from running_group where group_id=$1 and visibility='PUBLIC'",[id]),'공개 그룹을 찾을 수 없습니다.',404);
  await join(db,id,uid);
  res.json({ok:true});
});
social.post('/groups/:id/leave',async(req,res)=>{
  const id=uuid(req.params.id), uid=req.user.user_id;
  await transaction(async c=>{
    const g=await one(c,'select owner_user_id from running_group where group_id=$1',[id]);
    check(g && g.owner_user_id!==uid,'그룹 소유자는 탈퇴할 수 없습니다.',403);
    await c.query(`update group_member set status='LEFT',left_at=now(),updated_at=now()
      where group_id=$1 and user_id=$2 and status='ACTIVE'`,[id,uid]);
    await c.query('delete from record_group_share s using running_record r where s.record_id=r.record_id and s.group_id=$1 and r.user_id=$2',[id,uid]);
  });
  res.json({ok:true});
});
social.post('/groups/:id/invites',async(req,res)=>{
  const id=uuid(req.params.id), uid=req.user.user_id;
  const token=randomBytes(24).toString('base64url');
  const out=await db.query(`insert into group_invite(invite_id,group_id,created_by,token_hash,expires_at)
    select $1,group_id,$3,$4,now()+interval '7 days' from running_group where group_id=$2 and owner_user_id=$3`,
    [randomUUID(),id,uid,digest(token)]);
  check(out.rowCount,'그룹 소유자만 초대할 수 있습니다.',403);
  res.json({token});
});
social.delete('/groups/:id/invites',async(req,res)=>{
  await db.query(`update group_invite i set revoked_at=now() from running_group g where i.group_id=g.group_id
    and g.group_id=$1 and g.owner_user_id=$2 and i.revoked_at is null`,[uuid(req.params.id),req.user.user_id]);
  res.json({ok:true});
});
social.post('/groups/invite',async(req,res)=>{
  const token=string(req.body.token,100);
  const id=await transaction(async c=>{
    const invite=await one(c,`select group_id from group_invite where token_hash=$1 and revoked_at is null
      and (expires_at is null or expires_at>now()) for update`,[digest(token)]);
    check(invite,'유효한 초대가 아닙니다.',404);
    await join(c,invite.group_id,req.user.user_id);
    return invite.group_id;
  });
  res.json({group_id:id});
});
const metrics={
  distance:'sum(r.distance_m)',
  days:'count(distinct r.exercise_date)',
  longest:'max(r.distance_m)',
  pace:'min(r.avg_pace_sec_km) filter (where r.distance_m>=3000)',
  cadence:'sum(r.avg_cadence_spm*r.duration_sec)/nullif(sum(r.duration_sec) filter(where r.avg_cadence_spm is not null),0)'
};
social.get('/groups/:id',async(req,res)=>{
  const id=uuid(req.params.id), uid=req.user.user_id;
  const group=await one(db,`select g.group_id,g.group_name,g.visibility,g.owner_user_id,
    exists(select 1 from group_member where group_id=g.group_id and user_id=$2 and status='ACTIVE') joined
    from running_group g where g.group_id=$1`,[id,uid]);
  check(group && (group.joined||group.visibility==='PUBLIC'),'그룹을 볼 수 없습니다.',404);
  const metric=group.joined && Object.hasOwn(metrics,req.query.metric)?req.query.metric:'distance';
  const period=group.joined && req.query.period==='month'?'month':'week';
  const bounds=await one(db,`select date_trunc($1,now() at time zone 'Asia/Seoul')::date::text start,
    (date_trunc($1,now() at time zone 'Asia/Seoul')+case when $1='month' then interval '1 month' else interval '1 week' end)::date::text "end"`,[period]);
  const ranking=await rows(db,`with scores as (select u.user_id,u.display_name,${metrics[metric]} score
    from group_member m join app_user u using(user_id) join running_record r using(user_id)
    join record_group_share s on s.record_id=r.record_id and s.group_id=m.group_id
    where m.group_id=$1 and m.status='ACTIVE' and r.deleted_at is null
      and r.exercise_date >= $2 and r.exercise_date < $3 and not ${restriction('u.user_id')}
    group by u.user_id,u.display_name), ranked as (select *,rank() over(order by score ${metric==='pace'?'asc':'desc'}) rank_no
    from scores where score is not null)
    select * from ranked where rank_no<=100 or user_id=$4 order by rank_no,user_id`,[id,bounds.start,bounds.end,uid]);
  const members=group.joined?await rows(db,`select u.user_id,u.display_name from group_member m join app_user u using(user_id)
    where m.group_id=$1 and m.status='ACTIVE' order by u.display_name`,[id]):[];
  const count=await one(db,"select count(*)::int n from group_member where group_id=$1 and status='ACTIVE'",[id]);
  const mine=ranking.find(item=>item.user_id===uid)??null;
  res.json({...group,metric,period,bounds,members,count:count.n,mine,calculated_at:new Date().toISOString(),
    ranking:group.joined?ranking:ranking.map(({display_name,score,rank_no})=>({display_name,score,rank_no}))});
});

