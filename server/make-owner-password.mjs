// Reads a password without echoing it. Writes the hash directly to Wrangler's secret stdin.
import {spawnSync} from 'node:child_process';
import {passwordHash} from './worker.mjs';
if (!process.stdin.isTTY) throw Error('직접 터미널에서 실행해 주세요. 비밀번호를 명령줄에 적지 마세요.');
process.stdout.write('설정할 로그인 비밀번호 (12자 이상): ');
process.stdin.setRawMode(true); process.stdin.setEncoding('utf8'); process.stdin.resume();
let password = '';
process.stdin.on('data', async chunk => {
  for (const char of chunk) {
    if (char === '\u0003') {process.stdin.setRawMode(false);process.exit(1);}
    if (char === '\r' || char === '\n') {
      process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n');
      if (password.length < 12 || password.length > 128) {console.error('12~128자로 다시 설정해 주세요.');process.exitCode = 1;return;}
      const hashed = await passwordHash(password); password = '';
      const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      // Hash is sent through stdin, never command arguments or a project file.
      const result = spawnSync(executable,['--yes','wrangler@4','secret','put','OWNER_PASSWORD_HASH','--config','server/wrangler.jsonc'],{input:hashed+'\n',stdio:['pipe','inherit','inherit'],shell:process.platform==='win32'});
      process.exitCode = result.status ?? 1; return;
    }
    if (char === '\u007f' || char === '\b') password = password.slice(0,-1);
    else if (char >= ' ') password += char;
  }
});
