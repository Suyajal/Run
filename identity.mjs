import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { hash, verify } from '@node-rs/argon2';
import { randomBytes, randomInt, randomUUID, createHash, createHmac, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { db, one, transaction, check, restriction, string, uuid } from './db.mjs';

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
    return p.startsWith('dev:')?'테스트 계정':'0'+p.slice(3,5)+'-****-'+p.slice(-4);
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
function canSkipSignupSms(req){
  return process.env.DEV_SKIP_SIGNUP_SMS==='1' &&
    ['127.0.0.1','::1'].includes(process.env.BIND_HOST||'127.0.0.1') &&
    ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) &&
    ['127.0.0.1','localhost','[::1]'].includes(req.hostname);
}
identity.get('/config',(req,res)=>res.json({
  smsConfigured:!!process.env.SMS_WEBHOOK_URL || process.env.DEV_SMS==='1',
  skipSignupSms:canSkipSignupSms(req)
}));
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
identity.post('/verify',limit(60000,5),async(req,res)=>{
  const {purpose}=req.body;
  check(purposes.includes(purpose),'인증 목적을 확인해 주세요.');
  check(process.env.SMS_WEBHOOK_URL || process.env.DEV_SMS==='1','문자 발송 설정이 필요합니다.',503);
  const p=phone(req.body.phone), ph=lookup(p), id=randomUUID();
  let user;
  if(purpose==='CHANGE_PHONE'){
    user=await current(req);
    check(user && !user.restricted,'로그인이 필요합니다.',401);
    const u=await one(db,'select password_hash from app_user where user_id=$1',[user.user_id]);
    check(typeof req.body.password==='string' && req.body.password.length<=128 &&
      await verify(u.password_hash,req.body.password).catch(()=>false),'현재 비밀번호를 확인해 주세요.',401);
  }
  if(purpose==='RESET_PASSWORD') user=await one(db,'select user_id from app_user where phone_lookup_hash=$1 and login_id=$2',[ph,string(req.body.login_id,50)]);
  if(purpose==='FIND_ID') user=await one(db,'select user_id from app_user where phone_lookup_hash=$1',[ph]);
  const eligible = !['RESET_PASSWORD','FIND_ID'].includes(purpose) || !!user;
  if(!eligible) return res.status(202).json({id});
  const code=String(randomInt(100000,1000000));
  await transaction(async c=>{
    await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[ph]);
    const previous=await one(c,"select count(*)::int n from phone_verification where phone_lookup_hash=$1 and created_at>now()-interval '15 minutes'",[ph]);
    check(previous.n<3,'인증 요청이 많습니다. 잠시 후 다시 시도해 주세요.',429);
    await c.query(`insert into phone_verification(verification_id,user_id,purpose,phone_ciphertext,phone_lookup_hash,code_digest,status,expires_at)
      values($1,$2,$3,$4,$5,$6,'PENDING',now()+interval '5 minutes')`,[id,user?.user_id||null,purpose,encrypt(p),ph,hmac('otp',id+code)]);
  });
  {
    if(process.env.SMS_WEBHOOK_URL){
      const url=new URL(process.env.SMS_WEBHOOK_URL);
      check(url.protocol==='https:','문자 발송 설정을 확인해 주세요.',503);
      const reply=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',
        ...(process.env.SMS_WEBHOOK_TOKEN?{Authorization:'Bearer '+process.env.SMS_WEBHOOK_TOKEN}:{})},
        body:JSON.stringify({to:p,message:`[Suyajal Run] 인증번호 ${code}`}),signal:AbortSignal.timeout(8000)});
      check(reply.ok,'문자 발송에 실패했습니다.',502);
    } else console.log('DEV SMS',id,code);
    await db.query('update phone_verification set sent_at=now() where verification_id=$1',[id]);
  }
  res.status(202).json({id});
});
identity.post('/verify/:id',limit(60000,20),async(req,res)=>{
  const id=uuid(req.params.id), code=string(req.body.code,6,6);
  const result=await transaction(async c=>{
    const v=await one(c,`select * from phone_verification where verification_id=$1 and status='PENDING'
      and expires_at>now() and attempt_count<5 for update`,[id]);
    if(!v) return false;
    const ok=!!v.sent_at && timingSafeEqual(Buffer.from(v.code_digest,'hex'),Buffer.from(hmac('otp',id+code),'hex'));
    await c.query(`update phone_verification set status=case when $2 then 'VERIFIED' when attempt_count>=4 then 'FAILED' else status end,
      verified_at=case when $2 then now() end,attempt_count=attempt_count+case when $2 then 0 else 1 end
      where verification_id=$1`,[id,ok]);
    return ok;
  });
  check(result,'인증번호가 올바르지 않거나 만료되었습니다.');
  // An HttpOnly proof binds the verified challenge to the current browser.
  res.cookie('suyajal_verify',hmac('proof',id),{...cookieOptions,maxAge:300000}).json({ok:true});
});
function password(body) {
  check(typeof body.password==='string' && body.password.length>=8 && body.password.length<=128 &&
    body.password===body.confirm,'비밀번호는 8자 이상이며 확인 값과 같아야 합니다.');
  return hash(body.password);
}
async function consume(req,purpose,fn){
  const id=uuid(req.body.verification_id);
  const proof=req.headers.cookie?.match(/(?:^|;\s*)suyajal_verify=([a-f0-9]{64})(?:;|$)/)?.[1];
  check(proof && timingSafeEqual(Buffer.from(proof,'hex'),Buffer.from(hmac('proof',id),'hex')),'먼저 문자 인증을 완료해 주세요.');
  return transaction(async c=>{
    const v=await one(c,`select * from phone_verification where verification_id=$1 and purpose=$2
      and status='VERIFIED' and consumed_at is null and expires_at>now() for update`,[id,purpose]);
    check(v,'인증이 만료되었습니다. 다시 인증해 주세요.');
    const result=await fn(c,v);
    await c.query("update phone_verification set status='CONSUMED',consumed_at=now() where verification_id=$1",[id]);
    return result;
  });
}
identity.post('/signup',limit(60000,8),async(req,res)=>{
  const login=string(req.body.login_id,50,3), name=string(req.body.display_name,100), encoded=await password(req.body);
  check(/^[a-zA-Z0-9_.-]+$/.test(login),'아이디는 영문, 숫자, 점, 밑줄, 하이픈을 사용할 수 있습니다.');
  const createUser=async(c,v)=>{
    const id=randomUUID();
    await c.query(`insert into app_user(user_id,login_id,display_name,password_hash,phone_ciphertext,phone_lookup_hash,phone_verified_at)
      values($1,$2,$3,$4,$5,$6,now())`,[id,login,name,encoded,v.phone_ciphertext,v.phone_lookup_hash]);
    await c.query('insert into user_setting(user_id,push_enabled) values($1,false)',[id]);
  };
  if(req.body.skip_sms===true){
    check(canSkipSignupSms(req),'문자 인증을 완료해 주세요.',403);
    const testIdentity='dev:'+randomUUID();
    await transaction(c=>createUser(c,{phone_ciphertext:encrypt(testIdentity),phone_lookup_hash:lookup(testIdentity)}));
  }else{
    await consume(req,'SIGNUP',createUser);
  }
  res.status(201).json({ok:true});
});
identity.post('/find-id',async(req,res)=>{
  const u=await consume(req,'FIND_ID',async(c,v)=>{
    const u=await one(c,'select login_id from app_user where user_id=$1 and phone_lookup_hash=$2',[v.user_id,v.phone_lookup_hash]);
    check(u,'가입 정보를 확인해 주세요.');
    return u;
  });
  res.json(u);
});
identity.post('/reset-password',limit(60000,8),async(req,res)=>{
  const encoded=await password(req.body);
  await consume(req,'RESET_PASSWORD',async(c,v)=>{
    const result=await c.query(`update app_user set password_hash=$3,password_changed_at=now(),updated_at=now()
      where user_id=$1 and phone_lookup_hash=$2`,[v.user_id,v.phone_lookup_hash,encoded]);
    check(result.rowCount===1,'가입 정보를 확인해 주세요.');
    await c.query('update auth_session set revoked_at=now() where user_id=$1 and revoked_at is null',[v.user_id]);
  });
  res.clearCookie(cookie,cookieOptions).json({ok:true});
});
identity.post('/change-phone',auth,async(req,res)=>{
  await consume(req,'CHANGE_PHONE',async(c,v)=>{
    check(v.user_id===req.user.user_id,'인증 사용자를 확인해 주세요.',403);
    await c.query(`update app_user set phone_ciphertext=$2,phone_lookup_hash=$3,phone_verified_at=now(),updated_at=now()
      where user_id=$1`,[v.user_id,v.phone_ciphertext,v.phone_lookup_hash]);
  });
  res.json({ok:true});
});

