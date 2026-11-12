import pg from 'pg';
import {readFileSync} from 'node:fs';
import {X509Certificate} from 'node:crypto';

const pin = process.env.PG_TLS_PIN_FILE ? readFileSync(process.env.PG_TLS_PIN_FILE) : null;
const fingerprint = pin ? new X509Certificate(pin).fingerprint256 : null;
const ssl = pin ? {
  ca:pin,allowPartialTrustChain:true,
  checkServerIdentity:(_host,cert)=>cert.fingerprint256===fingerprint ? undefined : Error('PostgreSQL certificate changed')
} : undefined;
export const db = new pg.Pool({
  ssl, options:'-c search_path=public -c statement_timeout=12000', connectionTimeoutMillis:5000
});
db.on('error', err => console.error('PostgreSQL connection:', err.code));
export async function transaction(fn) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
export async function rows(client, sql, params = []) {
  return (await client.query(sql, params)).rows;
}
export async function one(client, sql, params) {
  return (await rows(client, sql, params))[0];
}
export function check(condition, message, status = 422) {
  if (!condition) throw Object.assign(new Error(message), {status});
}
export const restriction = alias => `exists(select 1 from user_restriction x
  where x.user_id=${alias} and x.status='ACTIVE' and x.starts_at<=now()
  and (x.ends_at is null or x.ends_at>now()))`;
export function uuid(value) {
  check(typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),'잘못된 식별자입니다.');
  return value;
}
export function string(value,max,min=1) {
  check(typeof value==='string' && value.trim().length>=min && value.trim().length<=max,'입력값을 확인해 주세요.');
  return value.trim();
}
export function date(value) {
  check(typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value),'날짜를 확인해 주세요.');
  const parsed=new Date(value);
  check(Number.isFinite(+parsed) && parsed.toISOString().slice(0,10)===value,'날짜를 확인해 주세요.');
  return value;
}

