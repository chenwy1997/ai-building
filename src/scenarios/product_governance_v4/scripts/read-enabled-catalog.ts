import { SQL } from 'bun';
import fs from 'node:fs/promises';
import path from 'node:path';
const argv = process.argv.slice(2), execute = argv.includes('--execute');
const tokens = argv.filter(v => v !== '--execute'), flags: Record<string,string> = {};
for(let i=0;i<tokens.length;i+=2){if(!tokens[i]?.startsWith('--')||!tokens[i+1])throw Error('Use --out FILE [--env-file FILE] [--execute]');flags[tokens[i]!.slice(2)]=tokens[i+1]!;}
if(!flags.out)throw Error('--out required');
if(!execute){console.log(JSON.stringify({preflight:true,table:'public.jdvop_categories',enabledOnly:true,readOnlyTransaction:true}));process.exit(0);}
let db: InstanceType<typeof SQL> | undefined;
try{
  let config=process.env.DATABASE_URL;
  if(!config&&flags['env-file'])config=(await fs.readFile(flags['env-file'],'utf8')).match(/^\s*DATABASE_URL\s*=\s*(.*?)\s*$/m)?.[1]?.replace(/^(['"])(.*)\1$/,'$2');
  if(!config)throw Error('Missing database configuration');
  const u=new URL(config),decode=(s:string)=>decodeURIComponent(s.replace(/%(?![0-9A-Fa-f]{2})/g,'%25'));
  db=new SQL({hostname:u.hostname,port:Number(u.port||5432),database:decode(u.pathname.slice(1)),username:decode(u.username),password:decode(u.password),max:1,connectionTimeout:12,idleTimeout:5});
  const result=await db.begin(async tx=>{
    await tx`SET TRANSACTION READ ONLY`;
    await tx`SET LOCAL statement_timeout = '20000ms'`;
    const matches=await tx`SELECT "categoryId","parentId",name,level,"fullPath",enabled FROM public.jdvop_categories WHERE enabled=true ORDER BY level,"fullPath"`;
    const readonly=await tx`SHOW transaction_read_only`;
    return {matches,readonly};
  });
  await fs.mkdir(path.dirname(path.resolve(flags.out)),{recursive:true});
  await fs.writeFile(flags.out,JSON.stringify({source:'public.jdvop_categories',enabledOnly:true,fetchedAt:new Date().toISOString(),...result},(_,v)=>typeof v==='bigint'?String(v):v,2),{flag:'wx'});
  console.log(JSON.stringify({rows:result.matches.length,productionWrites:0}));
}catch{console.error('Read-only enabled catalog query failed; connection and provider details omitted');process.exitCode=1;}finally{await db?.close();}
