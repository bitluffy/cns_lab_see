import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { receive } from '../utils/network.js';

const { port } = yargs(hideBin(process.argv))
  .option('port', { default: 4000, type: 'number' })
  .argv;

await receive('encrypted', 'key/My_Key.pem', port);
