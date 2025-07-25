import express from 'express';
import multer from 'multer';
import { split, merge } from './utils/divider.js';
import { encryptChunk, decryptChunk } from './utils/crypto-suite.js';
import { wrap, unwrap } from './utils/key-bundle.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { send, receive } from './utils/network.js';
import fsSync from 'node:fs';
import { WebSocketServer } from 'ws';
import net from 'net';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const uploadDir = path.resolve(__dirname, 'uploads');
const restoredDir = path.resolve(__dirname, 'restored');
const encryptedDir = path.resolve(__dirname, 'encrypted');
const keyDir = path.resolve(__dirname, 'key');

// Ensure required directories exist at startup
(async () => {
  await fs.mkdir(uploadDir, { recursive: true });
  await fs.mkdir(restoredDir, { recursive: true });
  await fs.mkdir(encryptedDir, { recursive: true });
  await fs.mkdir(keyDir, { recursive: true });
})();

const upload = multer({ dest: uploadDir });

// Serve static frontend
const publicDir = path.resolve(__dirname, '../public');
app.use(express.static(publicDir));

// Fallback: always serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

let receiverServer = null;

app.post('/d2d_send', upload.single('file'), async (req, res) => {
  const { ip, port } = req.body;
  if (!ip || !port || !req.file) return res.status(400).send('Missing IP, port, or file');
  const sock = net.createConnection({ host: ip, port: parseInt(port) }, async () => {
    try {
      const filename = req.file.originalname;
      const nameBuf = Buffer.from(filename, 'utf8');
      const fileBuf = await fs.readFile(req.file.path);
      // Send filename length (4 bytes, BE int)
      const nameLenBuf = Buffer.alloc(4);
      nameLenBuf.writeUInt32BE(nameBuf.length, 0);
      sock.write(nameLenBuf);
      sock.write(nameBuf);
      // Send file length (8 bytes, BE BigInt)
      const fileLenBuf = Buffer.alloc(8);
      fileLenBuf.writeBigUInt64BE(BigInt(fileBuf.length), 0);
      sock.write(fileLenBuf);
      sock.write(fileBuf);
      sock.end();
      res.status(200).send('File sent');
    } catch (err) {
      res.status(500).send('Send error: ' + err.message);
    }
  });
  sock.on('error', (err) => {
    res.status(500).send('Send error: ' + err.message);
  });
});

app.post('/d2d_receive', async (req, res) => {
  if (receiverServer) return res.status(400).send('Receiver already running');
  receiverServer = net.createServer(sock => {
    let state = 'filename', nameLen = 0, filename = '', fileLen = 0n, fileBuf = Buffer.alloc(0);
    let buf = Buffer.alloc(0);
    sock.on('data', async data => {
      buf = Buffer.concat([buf, data]);
      while (true) {
        if (state === 'filename') {
          if (buf.length < 4) break;
          nameLen = buf.readUInt32BE(0);
          buf = buf.subarray(4);
          state = 'filename_data';
        } else if (state === 'filename_data') {
          if (buf.length < nameLen) break;
          filename = buf.subarray(0, nameLen).toString('utf8');
          buf = buf.subarray(nameLen);
          state = 'filelen';
        } else if (state === 'filelen') {
          if (buf.length < 8) break;
          fileLen = buf.readBigUInt64BE(0);
          buf = buf.subarray(8);
          state = 'filedata';
        } else if (state === 'filedata') {
          if (buf.length < Number(fileLen)) break;
          fileBuf = buf.subarray(0, Number(fileLen));
          buf = buf.subarray(Number(fileLen));
          // Save file as binary
          const savePath = path.join(restoredDir, filename);
          await fs.mkdir(path.dirname(savePath), { recursive: true });
          await fs.writeFile(savePath, fileBuf);
          wsClients.forEach(ws => {
            if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'received', file: filename }));
          });
          state = 'done';
        } else {
          break;
        }
      }
    });
  }).listen(4000, () => console.log('[RECEIVER] Waiting on port 4000…'));
  res.status(200).send('Receiver started');
});

app.post('/data', upload.single('file'), async (req, res) => {
  const pieces = await split(req.file.path);
  const meta = [];

  await fs.mkdir('encrypted', { recursive: true });
  await fs.mkdir('key', { recursive: true });

  for (let i = 0; i < pieces; i++) {
    const part = await fs.readFile(`files/SECRET${String(i).padStart(7, '0')}`);
    const info = encryptChunk((i % 3) + 1, part); // Only use algos 1, 2, 3
    meta.push({ algo: info.algo, key: info.key, nonce: info.nonce });
    await fs.writeFile(`encrypted/SECRET${String(i).padStart(7, '0')}`, info.cipher);
  }

  // Store original filename in the first meta entry
  if (meta.length > 0 && req.file && req.file.originalname) {
    meta[0].originalName = req.file.originalname;
  }
  const { pem } = wrap(meta);
  await fs.writeFile('key/My_Key.pem', pem);
  res.download('key/My_Key.pem');
});

// WebSocket server for real-time notifications
const wss = new WebSocketServer({ noServer: true });
let wsClients = [];
wss.on('connection', (ws) => {
  wsClients.push(ws);
  ws.on('close', () => {
    wsClients = wsClients.filter(c => c !== ws);
  });
});

app.post('/download_data', upload.single('file'), async (req, res) => {
  const metaArr = unwrap(await fs.readFile(req.file.path));
  const chunks = metaArr.length;

  await fs.mkdir('restored', { recursive: true });

  for (let i = 0; i < chunks; i++) {
    const cipher = await fs.readFile(`encrypted/SECRET${String(i).padStart(7, '0')}`);
    const plain = decryptChunk(metaArr[i], cipher);
    await fs.writeFile(`restored/SECRET${String(i).padStart(7, '0')}`, plain);
  }
  const outputName = metaArr[0].originalName || 'output.bin';
  const output = path.join('restored', outputName);
  await merge(chunks, output);
  // Notify all WebSocket clients
  wsClients.forEach(ws => {
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'received', file: outputName }));
  });
  res.download(output, outputName);
});

app.get('/received_files', async (req, res) => {
  try {
    const files = await fs.readdir(restoredDir);
    res.json(files);
  } catch (err) {
    res.json([]);
  }
});

app.get('/download_received', async (req, res) => {
  const { file } = req.query;
  if (!file || file.includes('..') || file.includes('/')) return res.status(400).send('Invalid file');
  const filePath = path.join(restoredDir, file);
  if (!fsSync.existsSync(filePath)) return res.status(404).send('File not found');
  res.download(filePath);
});

const server = app.listen(8000, () => console.log('Secure‑Store listening on :8000'));
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws') {
    wss.handleUpgrade(req, socket, head, ws => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});
