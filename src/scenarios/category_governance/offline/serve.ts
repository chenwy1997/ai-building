import { join, resolve } from "node:path";

// Serve the public draft artifacts only; source snapshots and the project directory are not exposed.
const edition=Bun.argv.find(a=>a.startsWith("--edition="))?.slice(10)??"agent-draft-v1";
const version=Bun.argv.find(a=>a.startsWith("--version="))?.slice(10)??"v1";
if(!/^[a-zA-Z0-9_-]+$/.test(edition)||!/^v\d+$/.test(version))throw new Error("版本目录名无效");
const root=resolve(import.meta.dir,"../workspace/output",version,edition);
const port=Number(Bun.argv.find(a=>a.startsWith("--port="))?.slice(7)??"4319");
const mime:Record<string,string>={"view.html":"text/html;charset=utf-8","report.md":"text/plain;charset=utf-8","templates.std.json":"application/json;charset=utf-8","attributes.xlsx":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"};
const server=Bun.serve({hostname:"127.0.0.1",port,async fetch(request){
  if(!["GET","HEAD"].includes(request.method))return new Response("Method not allowed",{status:405});
  const name=new URL(request.url).pathname.slice(1)||"view.html";
  if(!Object.hasOwn(mime,name))return new Response("Not found",{status:404});
  const file=Bun.file(join(root,name));if(!await file.exists())return new Response("尚未生成，请先执行离线编制命令",{status:404});
  return new Response(request.method==="HEAD"?null:file,{headers:{"Content-Type":mime[name]!,"Cache-Control":"no-cache","X-Content-Type-Options":"nosniff"}});
}});
console.log(`属性结果查看：http://127.0.0.1:${server.port}/`);
