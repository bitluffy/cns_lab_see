import { createServer, createConnection } from 'node:net';
import { promises as fs } from 'node:fs';
import { pipeline } from 'node:stream/promises';

export async function send(fileDir, bundlePath, host, port = 4000) {
  const files = await fs.readdir(fileDir);
  const bundle = await fs.readFile(bundlePath);
  const sock = createConnection({ host, port });

  let socketOpen = true;
  sock.on('error', (err) => {
    socketOpen = false;
    console.error('Socket error:', err.message);
  });
  sock.on('close', () => {
    socketOpen = false;
  });

  try {
    sock.write(Buffer.alloc(8, bundle.length.toString(16).padStart(16, '0'), 'hex'));
    sock.write(bundle);

    for (const f of files) {
      if (!socketOpen) break;
      const stat = await fs.stat(`${fileDir}/${f}`);
      sock.write(Buffer.alloc(8, stat.size.toString(16).padStart(16, '0'), 'hex'));
      await pipeline(
        await fs.open(`${fileDir}/${f}`, 'r').then(fd => fd.createReadStream()),
        sock
      );
    }
    if (socketOpen) sock.end();
  } catch (err) {
    console.error('Send error:', err.message);
  }
}

export function receive(saveDir, bundleDest, port = 4000) {
  const server = createServer(sock => {
    let expecting = 'bundle', left = 0, meta = [];
    const bufQ = [];
    sock.on('data', async data => {
      bufQ.push(data);
      while (bufQ.length) {
        if (left === 0) {
          left = parseInt(bufQ.shift().toString('hex'), 16);
          continue;
        }
        const chunk = bufQ.shift();
        if (chunk.length < left) {
          // wait for more
          bufQ.unshift(chunk); break;
        }
        const piece = chunk.subarray(0, left);
        if (expecting === 'bundle') {
          await fs.writeFile(bundleDest, piece);
          expecting = 'file';
        } else {
          const idx = meta.length;
          await fs.writeFile(`${saveDir}/SECRET${String(idx).padStart(7, '0')}`, piece);
          meta.push(true);
        }
        left = 0;
        // push remainder back in queue
        if (chunk.length > piece.length) bufQ.unshift(chunk.subarray(piece.length));
      }
    });
  });
  server.listen(port, () => console.log(`Waiting on ${port}…`));
}
