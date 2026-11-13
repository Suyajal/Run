import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { hash, verify } from '@node-rs/argon2';
import { randomBytes, randomUUID, createHash, createHmac, createCipheriv, createDecipheriv } from 'node:crypto';
import { db, one, transaction, check, restriction, string } from './db.mjs';

const secret = process.env.APP_SECRET;
if (!secret || secret.length<32) throw Error('APP_SECRET must contain at least 32 characters.');
export const digest = value => createHash('sha256').update(value).digest('hex');
const hmac = (domain,value) => createHmac('sha256',secret).update(domain+':'+value).digest('hex');
const key = Buffer.from(hmac('cipher','phone'),'hex');
export function phone(input) {
  let value = string(input,24).replace(/[\s-]/g,'');
  if(value.startsWith('+82')) value='0'+value.slice(3);
  check(/^01[016789]\d{7,8}$/.test(value),'휴대폰 번호를 확인해 주세요.');
  return '+82'+value.slice(1);
}
export const lookup = number => hmac('lookup',number);
function encrypt(value) {
  const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key,iv);
  return Buffer.concat([iv,cipher.update(value),cipher.final(),cipher.getAuthTag()]).toString('base64url');
}
export function mask(ciphertext) {
  try {
    const b=Buffer.from(ciphertext,'base64url'), cipher=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));
    cipher.setAuthTag(b.subarray(-16));
    const p=Buffer.concat([cipher.update(b.subarray(12,-16)),cipher.final()]).toString();
    return /^(dev|no-phone):/.test(p)?'미등록':'0'+p.slice(3,5)+'-****-'+p.slice(-4);
  } catch {return '***-****-****';}
}
const cookie='suyajal_session';
const cookieOptions={httpOnly:true,sameSite:'strict',secure:process.env.COOKIE_SECURE==='1',path:'/'};
const limit=(windowMs,limit)=>rateLimit({windowMs,limit,standardHeaders:'draft-8',legacyHeaders:false,message:{message:'요청이 많습니다. 잠시 후 다시 시도해 주세요.'}});
async function current(req){
  const token=req.headers.cookie?.match(/(?:^|;\s*)suyajal_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if(!token) return;
  return one(db,`select s.session_id,u.user_id,u.login_id,u.display_name,u.phone_ciphertext,
    exists(select 1 from admin_access a where a.user_id=u.user_id and a.status='ACTIVE') admin,
    ${restriction('u.user_id')} restricted
    from auth_session s join app_user u using(user_id)
    where s.refresh_token_hash=$1 and s.expires_at>now() and s.revoked_at is null`,[digest(token)]);
}
export async function auth(req,res,next){
  req.user=await current(req);
  check(req.user,'로그인이 필요합니다.',401);
  check(!req.user.restricted,'현재 이용이 제한된 계정입니다.',403);
  if(!req.originalUrl.startsWith('/api/admin')){
    res.once('finish',()=>{
      if(res.statusCode<300) void touchActivity(db,req.user.user_id).catch(err=>console.error('Activity:',err.code));
    });
  }
  next();
}
function touchActivity(c,uid){
  return c.query(`insert into user_activity_daily(activity_date,user_id,first_seen_at,last_seen_at)
    values((now() at time zone 'Asia/Seoul')::date,$1,now(),now())
    on conflict(activity_date,user_id) do update set last_seen_at=now()
    where user_activity_daily.last_seen_at < now()-interval '1 minute'`,[uid]);
}
export const identity=Router();
identity.post('/login',limit(60000,12),async(req,res)=>{
  const login=string(req.body.login_id,50);
  const p=req.body.password;
  check(typeof p==='string' && p.length<=128,'로그인 정보를 확인해 주세요.',401);
  const u=await one(db,'select user_id,password_hash from app_user where login_id=$1',[login]);
  const encoded=u?.password_hash ?? await dummyHash;
  const valid=await verify(encoded,p).catch(()=>false);
  check(u && valid,'아이디 또는 비밀번호를 확인해 주세요.',401);
  const token=randomBytes(32).toString('hex');
  await transaction(async c=>{
    const state=await one(c,`select password_hash,${restriction('app_user.user_id')} restricted from app_user where user_id=$1 for update`,[u.user_id]);
    check(state?.password_hash===u.password_hash,'다시 로그인해 주세요.',401);
    check(!state.restricted,'현재 이용이 제한된 계정입니다.',403);
    await c.query("insert into auth_session(session_id,user_id,refresh_token_hash,expires_at) values($1,$2,$3,now()+interval '7 days')",[randomUUID(),u.user_id,digest(token)]);
    await touchActivity(c,u.user_id);
  });
  res.cookie(cookie,token,{...cookieOptions,maxAge:604800000}).json({ok:true});
});
const dummyHash=hash(randomBytes(32).toString('hex'));
identity.post('/logout',async(req,res)=>{
  const u=await current(req);
  if(u) await db.query('update auth_session set revoked_at=now() where session_id=$1',[u.session_id]);
  res.clearCookie(cookie,cookieOptions).json({ok:true});
});
identity.get('/me',auth,async(req,res)=>{
  const u=req.user;
  const settings=await one(db,'select push_enabled from user_setting where user_id=$1',[u.user_id]);
  res.json({user_id:u.user_id,display_name:u.display_name,login_id:u.login_id,admin:u.admin,phone:mask(u.phone_ciphertext),push_enabled:settings?.push_enabled||false});
});
identity.patch('/settings',auth,async(req,res)=>{
  check(typeof req.body.push_enabled==='boolean','설정값을 확인해 주세요.');
  await db.query(`insert into user_setting(user_id,push_enabled) values($1,$2)
    on conflict(user_id) do update set push_enabled=excluded.push_enabled,updated_at=now()`,[req.user.user_id,req.body.push_enabled]);
  res.json({ok:true});
});
const purposes=['SIGNUP','FIND_ID','RESET_PASSWORD','CHANGE_PHONE'];
function password(body) {
  check(typeof body.password==='string' && body.password.length>=8 && body.password.length<=128 &&
    body.password===body.confirm,'비밀번호는 8자 이상이며 확인 값과 같아야 합니다.');
  return hash(body.password);
}
identity.post('/signup',limit(60000,8),async(req,res)=>{
  const login=string(req.body.login_id,50,3), name=string(req.body.display_name,100);
  check(/^[a-zA-Z0-9_.-]+$/.test(login),'아이디는 영문, 숫자, 점, 밑줄, 하이픈을 사용할 수 있습니다.');
  const encoded=await password(req.body);
  const id=randomUUID(), placeholder='no-phone:'+id;
  await transaction(async c=>{
    await c.query(`insert into app_user(user_id,login_id,display_name,password_hash,phone_ciphertext,phone_lookup_hash)
      values($1,$2,$3,$4,$5,$6)`,[id,login,name,encoded,encrypt(placeholder),lookup(placeholder)]);
    await c.query('insert into user_setting(user_id,push_enabled) values($1,false)',[id]);
  });
  res.status(201).json({ok:true});
});
