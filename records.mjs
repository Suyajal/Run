import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { db, one, rows, transaction, check, restriction, uuid, date } from './db.mjs';
import { digest } from './identity.mjs';

export const records=Router();
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:4*1024*1024,files:1,fields:0}});
const sources=['SAMSUNG_HEALTH','APPLE_FITNESS'];
const fields=['exercise_date','distance_m','duration_sec','avg_pace_sec_km','avg_speed_kmh','avg_cadence_spm','avg_heart_rate_bpm','elevation_gain_m'];
const recordSelect=`r.record_id,r.user_id,u.display_name,r.source_app,r.exercise_date::text,r.distance_m,r.duration_sec,
 r.avg_pace_sec_km,r.avg_speed_kmh,r.avg_cadence_spm,r.avg_heart_rate_bpm,r.elevation_gain_m,r.version`;
records.get('/records',async(req,res)=>{
  const id=req.user.user_id;
  const items=await rows(db,`select ${recordSelect},r.share_to_friends from running_record r join app_user u using(user_id)
    where r.user_id=$1 and r.deleted_at is null order by r.exercise_date desc,r.created_at desc limit 100`,[id]);
  const totals=await one(db,`select count(*)::int count,coalesce(sum(distance_m),0) distance,coalesce(sum(duration_sec),0) seconds
    from running_record where user_id=$1 and deleted_at is null`,[id]);
  const month=await rows(db,`with d as (select (now() at time zone 'Asia/Seoul')::date today)
    select t.day::date::text as "day", coalesce(sum(r.distance_m),0) distance
    from d cross join lateral generate_series(d.today-6,d.today,interval '1 day') t(day)
    left join running_record r on r.exercise_date=t.day::date and r.user_id=$1 and r.deleted_at is null
    group by 1 order by 1`,[id]);
  res.json({items,totals,week:month});
});
async function accessible(c,id,uid) {
  return one(c,`select ${recordSelect},case when r.user_id=$2 then r.share_to_friends end share_to_friends
    from running_record r join app_user u using(user_id)
    where r.record_id=$1 and r.deleted_at is null and (r.user_id=$2 or
      (not ${restriction('r.user_id')} and (
        (r.share_to_friends and exists(select 1 from friend_relation f where f.user_low_id=least(r.user_id,$2)
          and f.user_high_id=greatest(r.user_id,$2) and f.status='ACCEPTED'))
        or exists(select 1 from record_group_share s join group_member a on a.group_id=s.group_id and a.user_id=r.user_id
          join group_member b on b.group_id=s.group_id and b.user_id=$2
          where s.record_id=r.record_id and a.status='ACTIVE' and b.status='ACTIVE'))))`,[id,uid]);
}
records.get('/records/:id',async(req,res)=>{
  const id=uuid(req.params.id), uid=req.user.user_id;
  const item=await accessible(db,id,uid);
  check(item,'기록을 볼 수 없습니다.',404);
  if(item.user_id===uid){
    item.meta=await rows(db,'select field_code,value_origin,recognized_value from record_field_meta where record_id=$1',[id]);
    item.groups=(await rows(db,'select group_id from record_group_share where record_id=$1',[id])).map(r=>r.group_id);
  }
  res.json(item);
});
let active=0;
function captureDate(text,samsungDetails){
  const patterns=[
    /\b(20\d{2})[ \t]*년[ \t]*(\d{1,2})[ \t]*월[ \t]*(\d{1,2})[ \t]*일/,
    /\b(20\d{2})[ \t]*[-./][ \t]*(\d{1,2})[ \t]*[-./][ \t]*(\d{1,2})(?!\d)/
  ];
  if(samsungDetails){
    // A textured background can make the Korean year and month suffixes look like digits or quotes.
    patterns.push(/\b(20\d{2})(?:[년4]|[ \t]+)[ \t]*(0?[1-9]|1[0-2])(?:[월8"”]|[ \t]+)[ \t]*(\d{1,2})[ \t]*일/);
    patterns.push(/\b(20\d{2})[ \t]+(0?[1-9]|1[0-2])8[ \t]+(\d{1,2})[%일][ \t]*\(/);
  }
  for(const pattern of patterns){
    const match=text.match(pattern);
    if(!match) continue;
    const day=match[1]+'-'+match[2].padStart(2,'0')+'-'+match[3].padStart(2,'0');
    const parsed=new Date(day);
    if(Number.isFinite(+parsed) && parsed.toISOString().slice(0,10)===day) return day;
  }
}
export async function readCapture(bytes){
  const worker=await createWorker(process.env.OCR_LANG || 'eng+kor',1,{cachePath:process.env.VERCEL ? tmpdir() : 'ocr-cache'});
  try{
    const {data}=await worker.recognize(bytes);
    const text=data.text.normalize('NFKC');
    const out={};
    const km=text.match(/\b(\d{1,3}(?:[.,]\d{1,3})?)\s*km\b(?!\s*\/\s*h)/i);
    const samsungSection=text.split(/운동\s*상\s*세\s*정\s*보/)[1]?.split(/지도|차트/)[0];
    const samsungDetails=!!samsungSection;
    const duration=(samsungSection ?? text).match(/\b(\d{1,2}):([0-5]\d):([0-5]\d)\b/);
    const shortDuration=!duration && (samsungSection ?? text.match(/(?:운동\s*시간|workout time|duration)\s*[:\n]?\s*\d+:\d+/i)?.[0])
      ?.match(/\b(\d{1,3}):([0-5]\d)\b(?!:)/);
    const pace=text.match(/\b(\d{1,2})['’′]([0-5]\d)["”″]?\s*\/?\s*km/i) ??
      samsungSection?.match(/\b(\d{1,2})['’′]([0-5]\d)["”″]/);
    const cadence=text.match(/\b(\d{2,3})[ \t]*(?:spm\b|steps\/min\b|걸음[ \t]*\/[ \t]*분)/i) ??
      samsungSection?.match(/^\s*(\d{2,3})[ \t]+(?:sem|s[pr]rn)\b/im);
    const heart=text.match(/\b(\d{2,3})\s*bpm\b/i) ??
      samsungSection?.match(/^\s*(\d{2,3})[ \t]+ber\b/im);
    const speed=text.match(/\b(\d{1,3}(?:[.,]\d+)?)\s*km\/h\b/i);
    const elevation=text.match(/(?:elevation gain|고도\s*상승)\s*[:\n]?\s*(\d{1,5}(?:[.,]\d+)?)\s*m\b/i);
    const day=captureDate(text,samsungDetails);
    if(km) out.distance_m=Math.round(Number(km[1].replace(',','.'))*1000);
    if(duration) out.duration_sec=+duration[1]*3600 + +duration[2]*60 + +duration[3];
    else if(shortDuration) out.duration_sec=+shortDuration[1]*60 + +shortDuration[2];
    if(pace) out.avg_pace_sec_km=+pace[1]*60 + +pace[2];
    if(cadence) out.avg_cadence_spm=+cadence[1];
    if(heart) out.avg_heart_rate_bpm=+heart[1];
    if(speed) out.avg_speed_kmh=+speed[1].replace(',','.');
    if(elevation) out.elevation_gain_m=+elevation[1].replace(',','.');
    if(day) out.exercise_date=day;
    return {values:out,source:/apple\s*fitness/i.test(text)?sources[1]:
      samsungDetails||/samsung|삼성\s*헬스/i.test(text)?sources[0]:null};
  } finally {await worker.terminate();}
}
records.post('/imports',upload.single('capture'),async(req,res)=>{
  const file=req.file?.buffer;
  check(file && (file.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) ||
    file.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))),'PNG 또는 JPEG 이미지를 선택해 주세요.');
  check(active<2,'현재 이미지 분석 중입니다. 잠시 후 다시 시도해 주세요.',429);
  const id=randomUUID(), imageHash=digest(file), uid=req.user.user_id;
  active++;
  let image;
  try {
    image=await sharp(file,{limitInputPixels:16000000}).rotate().resize({width:1600,height:2200,fit:'inside',withoutEnlargement:true}).png().toBuffer();
  } catch {
    active--;
    check(false,'이미지를 읽을 수 없습니다. 최대 1,600만 픽셀의 PNG 또는 JPEG를 선택해 주세요.');
  } finally {file.fill(0);}
  try{
    await db.query(`insert into record_import(import_id,user_id,image_sha256,status,expires_at)
      values($1,$2,$3,'ANALYZING',now()+interval '1 day')`,[id,uid,imageHash]);
  } catch(err){image.fill(0);active--;throw err;}
  req.file=null;
  const analyze=async()=>{
    let result;
    try{result=await readCapture(image);}catch(err){console.error('OCR',err.code||err.name);}
    finally{image.fill(0);active--;}
    await db.query(`update record_import set status=case when status='ANALYZING' then 'READY' else status end,
      source_app=case when status='ANALYZING' then $2 end,extracted_values=case when status='ANALYZING' then $3::jsonb end,
      error_code=$4,original_deleted_at=now(),updated_at=now() where import_id=$1 and status in ('ANALYZING','CANCELLED')`,
      [id,result?.source||null,result?.values||{},result?null:'OCR_FAILED']);
  };
  if(process.env.VERCEL){
    await analyze();
    return res.status(202).json({id});
  }
  res.status(202).json({id});
  void analyze().catch(err=>console.error('OCR result',err.code));
});
records.get('/imports/:id',async(req,res)=>{
  const item=await one(db,`select import_id,status,source_app,extracted_values,error_code from record_import
    where import_id=$1 and user_id=$2 and expires_at>now()`,[uuid(req.params.id),req.user.user_id]);
  check(item,'분석 내역이 만료되었습니다.',404);
  res.json(item);
});
records.delete('/imports/:id',async(req,res)=>{
  await db.query("update record_import set status='CANCELLED',updated_at=now() where import_id=$1 and user_id=$2 and status in ('ANALYZING','READY')",
    [uuid(req.params.id),req.user.user_id]);
  res.json({ok:true});
});
function number(value,min,max,integer=false) {
  const n=Number(value);
  check((typeof value==='number'||(typeof value==='string'&&value.trim()!=='')) &&
    Number.isFinite(n) && n>=min && n<=max && (!integer||Number.isInteger(n)),'기록 수치를 확인해 주세요.');
  return n;
}
const optional=(value,min,max)=>value===''||value==null?null:number(value,min,max);
function normalized(body){
  check(sources.includes(body.source_app),'기록 출처를 선택해 주세요.');
  const distance=Math.round(number(body.distance_m,1,1000000)*1000)/1000;
  const duration=number(body.duration_sec,1,604800,true);
  const pace=optional(body.avg_pace_sec_km,1,100000);
  const speed=optional(body.avg_speed_kmh,0.000001,300);
  return {source:body.source_app,values:[
    date(body.exercise_date),distance,duration,pace??duration*1000/distance,speed??distance*3.6/duration,
    optional(body.avg_cadence_spm,1,400),optional(body.avg_heart_rate_bpm,1,300),optional(body.elevation_gain_m,0,100000)
  ],calculated:[pace===null,speed===null]};
}
async function setShares(c,id,uid,body){
  check(Array.isArray(body.groups) && body.groups.length<=100,'공유 그룹을 확인해 주세요.');
  const ids=[...new Set(body.groups.map(uuid))];
  const memberships=await rows(c,`select group_id from group_member where user_id=$1 and group_id=any($2::uuid[])
    and status='ACTIVE' order by group_id for update`,[uid,ids]);
  check(memberships.length===ids.length,'현재 가입 중인 그룹만 선택할 수 있습니다.',403);
  await c.query('delete from record_group_share where record_id=$1 and not(group_id=any($2::uuid[]))',[id,ids]);
  await c.query(`insert into record_group_share(record_id,group_id)
    select $1,unnest($2::uuid[]) on conflict do nothing`,[id,ids]);
}
async function saveMeta(c,id,values,calculated,recognized={},previous=[]){
  for(const [i,field] of fields.entries()){
    const old=previous.find(m=>m.field_code===field);
    const original=old?.recognized_value??recognized[field]??null;
    const value=values[i];
    const origin=value===null?'MISSING':(i===3&&calculated[0]||i===4&&calculated[1])?'CALCULATED':
      original!==null && String(original)===String(value)?'READ':'MANUAL';
    await c.query(`insert into record_field_meta(record_id,field_code,value_origin,recognized_value,needs_review)
      values($1,$2,$3,$4,false) on conflict(record_id,field_code) do update set
      value_origin=excluded.value_origin,needs_review=false,updated_at=now()`,[id,field,origin,original===null?null:String(original)]);
  }
}
records.post('/records',async(req,res)=>{
  const body=req.body, uid=req.user.user_id, imp=uuid(body.import_id), key=uuid(req.get('Idempotency-Key'));
  const data=normalized(body), requestHash=digest(JSON.stringify(body));
  const id=await transaction(async c=>{
    await c.query('select user_id from app_user where user_id=$1 for update',[uid]);
    const retry=await one(c,'select record_id,request_hash from record_save_request where user_id=$1 and idempotency_key=$2',[uid,key]);
    if(retry){check(retry.request_hash===requestHash,'저장 요청이 변경되었습니다.',409);return retry.record_id;}
    const draft=await one(c,`select image_sha256,extracted_values from record_import where import_id=$1 and user_id=$2 and status='READY'
      and expires_at>now() for update`,[imp,uid]);
    check(draft,'이미 확정했거나 만료된 분석 내역입니다.',409);
    const [day,distance,duration]=data.values;
    const duplicate=await one(c,`select record_id,exercise_date::text,distance_m,duration_sec from running_record
      where user_id=$1 and deleted_at is null and (image_sha256=$2 or
       (exercise_date=$3 and distance_m=$4 and duration_sec=$5)) order by created_at desc limit 1`,[uid,draft.image_sha256,day,distance,duration]);
    if(duplicate && body.duplicate_of_record_id!==duplicate.record_id) {
      throw Object.assign(Error('유사한 기록이 있습니다. 비교 후 저장해 주세요.'),{status:409,details:{duplicate}});
    }
    const id=randomUUID();
    await c.query(`insert into running_record(record_id,user_id,source_app,image_sha256,
      exercise_date,distance_m,duration_sec,avg_pace_sec_km,avg_speed_kmh,avg_cadence_spm,avg_heart_rate_bpm,
      elevation_gain_m,share_to_friends,duplicate_confirmed,duplicate_of_record_id)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [id,uid,data.source,draft.image_sha256,...data.values,body.share_to_friends===true,!!duplicate,duplicate?.record_id??null]);
    await setShares(c,id,uid,body);
    await saveMeta(c,id,data.values,data.calculated,draft.extracted_values);
    if(body.share_to_friends===true){
      await c.query(`insert into notification(notification_id,recipient_user_id,actor_user_id,type,record_id,event_key)
        select gen_random_uuid(),case when f.user_low_id=$1 then f.user_high_id else f.user_low_id end,
          $1,'NEW_RECORD',$2::uuid,'new_record:'||($2::uuid)::text from friend_relation f
        where $1 in(f.user_low_id,f.user_high_id) and f.status='ACCEPTED'`,[uid,id]);
    }
    await c.query('insert into record_save_request(user_id,idempotency_key,request_hash,record_id) values($1,$2,$3,$4)',[uid,key,requestHash,id]);
    await c.query("update record_import set status='CONFIRMED',updated_at=now() where import_id=$1",[imp]);
    return id;
  });
  res.json({record_id:id});
});
records.patch('/records/:id',async(req,res)=>{
  const body=req.body, id=uuid(req.params.id), uid=req.user.user_id, data=normalized(body);
  await transaction(async c=>{
    const update=await c.query(`update running_record set source_app=$3,exercise_date=$4,distance_m=$5,
      duration_sec=$6,avg_pace_sec_km=$7,avg_speed_kmh=$8,avg_cadence_spm=$9,avg_heart_rate_bpm=$10,
      elevation_gain_m=$11,share_to_friends=$12,version=version+1,updated_at=now()
      where record_id=$1 and user_id=$2 and version=$13 and deleted_at is null`,
      [id,uid,data.source,...data.values,body.share_to_friends===true,number(body.version,1,2147483647,true)]);
    check(update.rowCount===1,'기록이 변경되었습니다. 다시 열어 주세요.',409);
    await setShares(c,id,uid,body);
    const meta=await rows(c,'select * from record_field_meta where record_id=$1',[id]);
    await saveMeta(c,id,data.values,data.calculated,{},meta);
  });
  res.json({ok:true});
});
records.get('/notifications',async(req,res)=>{
  const items=await rows(db,`select n.notification_id,n.record_id,n.read_at,n.created_at,u.display_name,n.type
    from notification n join app_user u on u.user_id=n.actor_user_id where n.recipient_user_id=$1
    order by n.created_at desc limit 100`,[req.user.user_id]);
  res.json(items);
});
records.post('/notifications/read',async(req,res)=>{
  await db.query('update notification set read_at=now() where recipient_user_id=$1 and read_at is null',[req.user.user_id]);
  res.json({ok:true});
});
records.post('/notifications/:id/open',async(req,res)=>{
  const id=uuid(req.params.id), uid=req.user.user_id;
  const n=await one(db,'select record_id from notification where notification_id=$1 and recipient_user_id=$2',[id,uid]);
  check(n?.record_id,'알림 대상을 찾을 수 없습니다.',404);
  const item=await accessible(db,n.record_id,uid);
  check(item,'현재 공유 중인 기록을 볼 수 없습니다.',404);
  await db.query('update notification set read_at=coalesce(read_at,now()),opened_at=coalesce(opened_at,now()) where notification_id=$1',[id]);
  res.json(item);
});

