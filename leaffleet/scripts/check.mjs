import {readdir,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

async function files(dir){const entries=await readdir(dir,{withFileTypes:true});return (await Promise.all(entries.map(e=>e.isDirectory()?files(`${dir}/${e.name}`):`${dir}/${e.name}`))).flat();}
for(const file of (await Promise.all(['cloud/src','server','public','scripts','test','cloud/test'].map(files))).flat().filter(f=>f.endsWith('.mjs'))){
 const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
 if(result.status!==0)process.exit(result.status||1);
}
const html=await readFile('public/index.html','utf8');
for(const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)){
 const path=match[1].split('?')[0];
 if(!path.includes('://'))await readFile(resolve('public',path));
}
const app=await readFile('public/app.mjs','utf8');
if(app.includes('Доступ через ChatGPT')||html.includes('chatgpt.site'))throw Error('Hosted auth dependency found');
console.log('Source syntax and static asset references: PASS');
