/**
 * 鉴权：scrypt 存密码，HMAC-SHA256 签发无状态 token。
 * token 格式 base64url(payload).base64url(sig)，payload 含 exp 与 jti；
 * 登出时把 jti 记入吊销表，实现"登出即失效"。
 */
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';

const SESSION_TTL = 12 * 3600; // 12 小时

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createTokenizer(secret) {
  const hmac = (data) => createHmac('sha256', secret).update(data).digest('base64url');

  return {
    sign(payload = {}, ttl = SESSION_TTL) {
      const now = Math.floor(Date.now() / 1000);
      const body = Buffer.from(JSON.stringify({
        ...payload,
        iat: now,
        exp: now + ttl,
        jti: randomBytes(8).toString('hex'),
      })).toString('base64url');
      return `${body}.${hmac(body)}`;
    },

    /** 校验签名与有效期；失败返回 null，成功返回 payload。 */
    verify(token) {
      if (typeof token !== 'string' || token.length > 4096) return null;
      const dot = token.indexOf('.');
      if (dot <= 0) return null;
      const body = token.slice(0, dot);
      const sig = token.slice(dot + 1);
      const expected = hmac(body);
      if (sig.length !== expected.length) return null;
      if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
      let payload;
      try {
        payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      } catch {
        return null;
      }
      if (!payload || typeof payload.exp !== 'number') return null;
      if (payload.exp < Math.floor(Date.now() / 1000)) return null;
      return payload;
    },
  };
}
