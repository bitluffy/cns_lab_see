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
    console.log(`[RECEIVER] Connection received from`, sock.remoteAddress, ':', sock.remotePort);
    let expecting = 'bundle', left = 0, meta = [];
    let buf = Buffer.alloc(0);
    sock.on('data', async data => {
      buf = Buffer.concat([buf, data]);
      while (true) {
        if (left === 0) {
          if (buf.length < 8) break; // Wait for 8 bytes for the length
          left = parseInt(buf.subarray(0, 8).toString('hex'), 16);
          console.log(`[RECEIVER] Expecting next chunk of size`, left);
          buf = buf.subarray(8);
        }
        if (buf.length < left) break; // Wait for enough data
        const piece = buf.subarray(0, left);
        if (expecting === 'bundle') {
          await fs.writeFile(bundleDest, piece);
          console.log(`[RECEIVER] Bundle written to`, bundleDest);
          expecting = 'file';
        } else {
          const idx = meta.length;
          const filePath = `${saveDir}/SECRET${String(idx).padStart(7, '0')}`;
          await fs.writeFile(filePath, piece);
          console.log(`[RECEIVER] File part written to`, filePath);
          meta.push(true);
        }
        buf = buf.subarray(left);
        left = 0;
      }
    });
    sock.on('end', () => {
      console.log('[RECEIVER] Connection ended');
    });
    sock.on('error', (err) => {
      console.error('[RECEIVER] Socket error:', err.message);
    });
  });
  server.listen(port, () => console.log(`[RECEIVER] Waiting on port ${port}…`));
}
