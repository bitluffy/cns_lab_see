import { randomBytes } from 'node:crypto';
import fernet from 'fernet';

const header = 'SECURE‑HYBRID‑BUNDLE‖';

export function wrap(metaArr) {
  const masterKey = randomBytes(32);               // this becomes My_Key.pem
  const secret = new fernet.Secret(masterKey.toString('base64'));
  const token = new fernet.Token({ secret, time: Date.now() });
  const payload = Buffer.from(JSON.stringify(metaArr)).toString('base64');
  const pem = token.encode(header + payload);
  // Store both the Fernet key and the PEM token, separated by a newline
  return { pem: Buffer.from(masterKey.toString('base64') + '\n' + pem), masterKey };
}

export function unwrap(masterPem) {
  // Split the PEM file into Fernet key and token
  const [keyB64, pemToken] = masterPem.toString().split('\n');
  if (!keyB64 || !pemToken) {
    throw new Error('Invalid PEM file format: missing key or token');
  }
  // Validate Fernet key
  let keyBuf;
  try {
    keyBuf = Buffer.from(keyB64, 'base64');
  } catch (e) {
    throw new Error('Invalid Fernet key: not base64');
  }
  if (keyBuf.length !== 32) {
    throw new Error('Invalid Fernet key: must be 32 bytes after base64 decoding');
  }
  const secret = new fernet.Secret(keyB64);
  // user uploads the PEM – decode without TTL
  const token = new fernet.Token({ secret, token: pemToken, ttl: 0 });
  const decoded = token.decode();
  return JSON.parse(Buffer.from(decoded.replace(header, ''), 'base64').toString());
}
