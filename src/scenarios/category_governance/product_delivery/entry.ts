import {join} from "node:path";
import {parseFlags,asInt,boolFlag} from "../util.ts";
import {outputDir} from "./io.ts";
import {importProducts,collect} from "./collect.ts";
import {prepare} from "./prepare.ts";
import {buildProducts} from "./build.ts";
import {writeProductExcel} from "./excel.ts";
import {writeProductView} from "./html.ts";
export async function main(argv:string[]){
 const {flags}=parseFlags(argv);
 if(flags.template){await (await import("./revision-entry.ts")).main(argv);return;}
 if(boolFlag(flags.help)){console.log(`bun run category-governance:products [--json-only] [--refresh-evidence --direct]\n默认离线复用这份1000商品测试集的证据和语义决策，生成Excel、压缩JSON及浏览页面。\n--template=修订模板.xlsx --changes=改动类目清单.csv 基于原商品结果增量修订，输出product-delivery-v2。\n--input=文件.xlsx 验证并导入同一测试集；不同测试集需另做语义决策。\n--refresh-evidence 仅补取未缓存的京东SKU；--force 强制刷新现有证据。\n--serve [--port=4322] 浏览已生成结果，不重新采样。`);return;}
 if(boolFlag(flags.serve)){
  const port=asInt(flags.port,4322);if(!(await Bun.file(join(outputDir,"view.html")).exists()))throw new Error("先运行默认导出命令生成结果");
  Bun.serve({hostname:"127.0.0.1",port,fetch(req){const path=decodeURIComponent(new URL(req.url).pathname);const name=path==="/"?"view.html":path.slice(1);if(!["view.html","比赛结果-1000商品.xlsx","products.std.json","交付说明.md"].includes(name))return new Response("Not found",{status:404});return new Response(Bun.file(join(outputDir,name)));}});
  console.log(`商品结果：http://127.0.0.1:${port}/`);return;
 }
 await importProducts(flags.input);
 if(boolFlag(flags["refresh-evidence"])) {await collect(argv);await prepare(argv);}
 const {products,stat}=await buildProducts();await writeProductView(products);
 if(!boolFlag(flags["json-only"]))console.log(`Excel：${await writeProductExcel(products)}`);
 console.log(`完成：${stat.products}个SKU，末级${stat.leafMounted}，暂挂上级${stat.parentMounted}；已填${stat.filled}项，待补${stat.missing}项，冲突${stat.conflicts}项。`);
 console.log(`结果目录：${outputDir}`);
}
if(import.meta.main)main(Bun.argv.slice(2)).catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
