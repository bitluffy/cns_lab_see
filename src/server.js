import express from 'express';
import multer from 'multer';
import { split, merge } from './utils/divider';
import { encryptChunk, decryptChunk } from './utils/crypto-suite';
import { wrap, unwrap } from './utils/key-bundle';
import { sendOverTCP, receiveOverTCP } from './utils/network';

const app = express();
const upload = multer({ dest: 'uploads/' });

// 1️⃣ Encrypt File and Generate PEM Key File
app.post('/encrypt', upload.single('file'), async (req, res) => {
  const chunks = await split(req.file.path);
  const metadata = [];

  for (let i = 0; i < chunks; i++) {
    const rawData = readChunk(i);
    const encrypted = encryptChunk((i % 3) + 1, rawData);  
    saveEncryptedChunk(i, encrypted.cipher);
    metadata.push({
      algo: encrypted.algo,
      key: encrypted.key,
      nonce: encrypted.nonce
    });
  }

  metadata[0].originalName = req.file.originalname;  
  const pem = wrap(metadata);  
  savePEM(pem, 'My_Key.pem');
  res.download('My_Key.pem');
});

// 2️⃣ Send PEM Key File Over TCP
app.post('/send-pem', upload.single('file'), async (req, res) => {
  const { ip, port } = req.body;
  await sendOverTCP(req.file.path, ip, port);
  res.send('PEM file sent.');
});

// 3️⃣ Receive PEM Key File Over TCP
app.post('/receive-pem', async (req, res) => {
  await receiveOverTCP('restored/My_Key.pem'); // Save in restored dir
  res.send('PEM file received.');
});

// 4️⃣ Decrypt Encrypted Chunks and Rebuild File
app.post('/decrypt', upload.single('pem'), async (req, res) => {
  const metadata = unwrap(req.file.path); // Extract keys and algos

  for (let i = 0; i < metadata.length; i++) {
    const cipher = readEncryptedChunk(i);
    const plain = decryptChunk(metadata[i], cipher);
    savePlainChunk(i, plain);
  }

  const outputName = metadata[0].originalName || 'output.bin';
  await merge(metadata.length, `restored/${outputName}`);
  res.download(`restored/${outputName}`);
});

// Start Express Server
app.listen(8000, () => {
  console.log('Secure File Transfer System running on port 8000');
});
