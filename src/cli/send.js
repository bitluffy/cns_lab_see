import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { send } from '../utils/network.js';

const { file, host, port } = yargs(hideBin(process.argv))
  .option('file', { demandOption: true, type: 'string' })
  .option('host', { demandOption: true, type: 'string' })
  .option('port', { default: 4000, type: 'number' })
  .argv;

await send('encrypted', 'key/My_Key.pem', host, port);
console.log('File package sent.');
