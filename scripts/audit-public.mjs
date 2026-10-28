import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {dirname,resolve,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const checks=[
  ['private-key',/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/],
  ['google-api-key',/AIza[0-9A-Za-z_-]{30,}/],
  ['github-token',/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/],
  ['gitlab-token',/\bglpat-[A-Za-z0-9_-]{20,}/],
  ['openai-key',/\bsk-(?:proj-|svcacct-)[A-Za-z0-9_-]{20,}/],
  ['aws-access-key',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['slack-token',/\bxox[baprs]-[A-Za-z0-9-]{20,}/],
  ['stripe-secret',/\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/],
  ['literal-credential',/\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|password)\s*[:=]\s*["'][A-Za-z0-9_+\/-]{24,}["']/i],
];
const forbidden=path=>/(?:^|\/)(?:data|imports|backups|exports|\.aws|\.ssh)(?:\/|$)|(?:^|\/)(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?|\.netrc|\.npmrc|id_rsa|id_ed25519)$|\.private\.|\.(?:pem|key|p12|pfx|jks|sqlite3?|db|zip)$/i.test(path);
export async function auditPublic({gitExecutable='git'}={}) {
  const findings=[];
  const inspect=(path,content,scope)=>{
    if(forbidden(path)) findings.push({scope,path,type:'private-file-path'});
    for(const [type,pattern] of checks)if(pattern.test(content)) findings.push({scope,path,type});
  };
  let sourceCount=0,stagedCount=0,deployCount=0;
  async function scan(dir,scope){
    for(const entry of await readdir(dir,{withFileTypes:true})){
      if(['.git','node_modules','output','.wrangler'].includes(entry.name))continue;
      if(scope==='source'&&entry.name==='dist')continue;
      const path=join(dir,entry.name),label=relative(scope==='deploy'?join(root,'dist'):root,path).replaceAll('\\','/');
      if(entry.isSymbolicLink()){findings.push({scope,path:label,type:'symbolic-link'});continue;}
      if(entry.isDirectory())await scan(path,scope);
      else {inspect(label,(await readFile(path)).toString('utf8'),scope);if(scope==='deploy')deployCount++;else sourceCount++;}
    }
  }
  await scan(root,'source');
  const staged=execFileSync(gitExecutable,['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  for(const path of staged){
    const content=execFileSync(gitExecutable,['show',':'+path],{cwd:root,encoding:'utf8',maxBuffer:10*1024*1024});
    inspect(path,content,'git-index');stagedCount++;
  }
  await scan(join(root,'dist'),'deploy');
  const html=await readFile(join(root,'dist/travel-planner.html'),'utf8');
  if(/notion-import|data\/|\.private\./i.test(html))findings.push({scope:'deploy',path:'travel-planner.html',type:'private-or-removed-script-reference'});
  const report={checkedAt:new Date().toISOString(),sourceCount,stagedCount,deployCount,findings};
  await mkdir(join(root,'output'),{recursive:true});
  await writeFile(join(root,'output/privacy-audit.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if(findings.length)throw Error('Public release audit failed; see output/privacy-audit.json. No credential values are logged.');
  return report;
}
if(typeof process!=='undefined'&&process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await auditPublic();
