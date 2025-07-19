import { promises as fs } from 'node:fs';

/** Split file into fixed‑size parts inside `files/` */
export async function split(path, chunkSize = 32 * 1024) {
  await fs.mkdir('files', { recursive: true });
  const fd = await fs.open(path, 'r');
  const stat = await fd.stat();
  const chunks = Math.ceil(stat.size / chunkSize);
  const buf = Buffer.alloc(chunkSize);

  for (let i = 0; i < chunks; i++) {
    const { bytesRead } = await fd.read(buf, 0, chunkSize, i * chunkSize);
    await fs.writeFile(`files/SECRET${String(i).padStart(7, '0')}`, buf.subarray(0, bytesRead));
  }
  await fd.close();
  return chunks;
}

/** Merge decrypted parts in `restored/` back to <destPath> */
export async function merge(chunks, destPath) {
  await fs.mkdir('restored', { recursive: true });
  const w = await fs.open(destPath, 'w');
  for (let i = 0; i < chunks; i++) {
    const part = await fs.readFile(`restored/SECRET${String(i).padStart(7, '0')}`);
    await w.write(part);
  }
  await w.close();
}
