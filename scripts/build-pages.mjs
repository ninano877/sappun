import {readFile, writeFile, mkdir, copyFile, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, resolve, relative, join} from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist');
const html = await readFile(join(root, 'travel-planner.html'), 'utf8');
const files = new Set(['index.html', 'travel-planner.html']);
for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  const path = match[1];
  if (/^https?:\/\//.test(path)) continue;
  if (path.includes('..') || path.startsWith('/') || path.includes('.private.') || !/^(css|js|data|assets)\//.test(path)) throw Error('Unexpected publish path: ' + path);
  if (path.startsWith('data/')) throw Error('Publish data must not include a personal itinerary: '+path);
  files.add(path);
}
await mkdir(output, {recursive:true});
for (const path of files) {
  const contents = await readFile(join(root,path));
  if (/AIza[0-9A-Za-z_-]{30,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(contents.toString('utf8'))) throw Error('Potential credential found in '+path);
  const destination = join(output,path);
  await mkdir(dirname(destination), {recursive:true});
  await copyFile(join(root,path),destination);
}
await writeFile(join(output,'.nojekyll'),'');
files.add('.nojekyll');
async function verify(directory) {
  for (const entry of await readdir(directory,{withFileTypes:true})) {
    const path = join(directory,entry.name);
    if (entry.isSymbolicLink()) throw Error('Publish output contains a link');
    if (entry.isDirectory()) await verify(path);
    else if (!files.has(relative(output,path).replaceAll('\\','/'))) throw Error('Publish output contains an unexpected file: '+entry.name);
  }
}
await verify(output);
console.log('GitHub Pages: '+files.size+' public app files prepared in dist/');
