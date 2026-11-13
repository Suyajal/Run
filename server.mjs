import express from 'express';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db, one } from './db.mjs';
import { auth, identity } from './identity.mjs';
import { records } from './records.mjs';
import { social } from './social.mjs';
import { admin } from './admin.mjs';

const app = express();
app.disable('x-powered-by');
app.use((req,res,next)=>{
  res.set({'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'same-origin',
    'Content-Security-Policy':"default-src 'self'; style-src 'self'; img-src 'self' data: blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"});
  req.requestId=randomUUID();
  next();
});
app.use('/api', express.json({limit:'96kb'}), (req,res,next)=>{
  res.set('Cache-Control','no-store');
  if (!['GET','HEAD','OPTIONS'].includes(req.method) &&
      (req.headers['sec-fetch-site']==='cross-site' ||
       (req.headers.origin && req.headers.origin!==(process.env.APP_ORIGIN || `http${req.secure?'s':''}://${req.headers.host}`)))) {
    return res.status(403).json({message:'요청 출처를 확인해 주세요.'});
  }
  next();
});
app.get('/api/health',async(req,res)=>{
  await one(db,"select 'public.app_user'::regclass, 'public.running_record'::regclass");
  res.json({status:'ok',database:'connected'});
});
app.use('/api/auth', identity);
app.use('/api/admin',auth,admin);
app.use('/api',auth,records,social);
app.use('/api',(_req,res)=>res.status(404).json({message:'요청을 찾을 수 없습니다.'}));
app.get('/admin',(_req,res)=>res.sendFile(fileURLToPath(new URL('./public/index.html',import.meta.url))));
app.use(express.static(fileURLToPath(new URL('./public/',import.meta.url))));
app.use((err,req,res,_next)=>{
  const status=err.status || ({23505:409,'22P02':422,23514:422,LIMIT_FILE_SIZE:413}[err.code]) || 500;
  if(status>=500) console.error(req.requestId,err.code||err.name,err.stack?.split('\n')[1]);
  res.status(status).json({request_id:req.requestId,message:err.status && status<500 ? err.message :
    ({409:'이미 등록되어 있거나 상태가 변경되었습니다.',422:'입력값을 확인해 주세요.',413:'이미지는 4 MB 이하로 선택해 주세요.'}[status]||'요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'),details:err.details});
});
export const server=app.listen(Number(process.env.PORT??3000),process.env.BIND_HOST||'127.0.0.1',()=>console.log(`Suyajal Run · http://127.0.0.1:${server.address().port}`));

