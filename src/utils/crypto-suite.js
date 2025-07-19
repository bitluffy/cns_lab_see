import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import fernet from 'fernet';

function fernetMultiEncrypt(buf, k1, k2) {
  const f1 = new fernet.Secret(k1.toString('base64'));
  const f2 = new fernet.Secret(k2.toString('base64'));
  const token1 = new fernet.Token({ secret: f1, time: Date.now() });
  const token2 = new fernet.Token({ secret: f2, time: Date.now() });
  return Buffer.from(token1.encode(token2.encode(buf.toString('base64'))));
}

function fernetMultiDecrypt(buf, k1, k2) {
  const f1 = new fernet.Secret(k1.toString('base64'));
  const f2 = new fernet.Secret(k2.toString('base64'));
  const token1 = new fernet.Token({ secret: f1, token: buf.toString(), ttl: 0 });
  const inner = Buffer.from(token1.decode(), 'base64').toString();
  const token2 = new fernet.Token({ secret: f2, token: inner, ttl: 0 });
  return Buffer.from(token2.decode(), 'base64');
}

export function encryptChunk(algo, data) {
  switch (algo) {
    case 0: {
      const k1 = randomBytes(32), k2 = randomBytes(32);
      return {
        algo,
        key: Buffer.concat([k1, k2]).toString('hex'),
        nonce: '',
        cipher: fernetMultiEncrypt(data, k1, k2)
      };
    }
    case 1: {
      const key = randomBytes(32), nonce = randomBytes(12);
      const cipher = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 })
        .update(data);
      return { algo, key: key.toString('hex'), nonce: nonce.toString('hex'), cipher };
    }
    case 2: {
      const key = randomBytes(16), iv = randomBytes(12);
      const c = createCipheriv('aes-128-gcm', key, iv);
      const cipher = Buffer.concat([c.update(data), c.final(), c.getAuthTag()]);
      return { algo, key: key.toString('hex'), nonce: iv.toString('hex'), cipher };
    }
    case 3: {
      const key = randomBytes(16), iv = randomBytes(13);
      const c = createCipheriv('aes-128-ccm', key, iv, { authTagLength: 16 });
      const cipher = Buffer.concat([c.update(data), c.final(), c.getAuthTag()]);
      return { algo, key: key.toString('hex'), nonce: iv.toString('hex'), cipher };
    }
  }
}

export function decryptChunk(meta, cipher) {
  const { algo, key, nonce } = meta;
  switch (algo) {
    case 0: {
      const k1 = Buffer.from(key, 'hex').subarray(0, 32);
      const k2 = Buffer.from(key, 'hex').subarray(32);
      return fernetMultiDecrypt(cipher, k1, k2);
    }
    case 1: {
      const d = createDecipheriv(
        'chacha20-poly1305',
        Buffer.from(key, 'hex'),
        Buffer.from(nonce, 'hex'),
        { authTagLength: 16 }
      );
      return d.update(cipher);
    }
    case 2: {
      const iv = Buffer.from(nonce, 'hex');
      const tag = cipher.subarray(cipher.length - 16);
      const enc = cipher.subarray(0, cipher.length - 16);
      const d = createDecipheriv('aes-128-gcm', Buffer.from(key, 'hex'), iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(enc), d.final()]);
    }
    case 3: {
      const iv = Buffer.from(nonce, 'hex');
      const tag = cipher.subarray(cipher.length - 16);
      const enc = cipher.subarray(0, cipher.length - 16);
      const d = createDecipheriv('aes-128-ccm', Buffer.from(key, 'hex'), iv, { authTagLength: 16 });
      d.setAuthTag(tag);
      return Buffer.concat([d.update(enc), d.final()]);
    }
  }
}
