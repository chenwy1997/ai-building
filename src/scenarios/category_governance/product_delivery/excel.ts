import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { writeFile, rename } from "node:fs/promises";
import { PRODUCT_HEADERS, ATTRIBUTE_HEADERS, workbookRows, type ResolvedProduct } from "./build.ts";
import { outputDir } from "./io.ts";

export async function writeProductExcel(products:ResolvedProduct[],directory=outputDir):Promise<string>{
  const output=join(directory,"比赛结果-1000商品.xlsx"),reproDir=join(directory,".repro");
  if(typeof Bun!=="undefined"){
    const node=process.env.ARTIFACT_NODE??resolve(homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node");
    const child=Bun.spawn([node,"--max-old-space-size=6144",resolve(import.meta.dir,"excel-worker.mjs")],{stdin:new Blob([JSON.stringify({products,directory})]),stdout:"inherit",stderr:"inherit"});
    if(await child.exited!==0)throw new Error("商品Excel导出失败");
    return output;
  }
  const module=process.env.ARTIFACT_TOOL_MODULE??resolve(homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs");
  const {Workbook,SpreadsheetFile}=await import(module);
  const wb=Workbook.create(),rows=workbookRows(products);
  const definitions=[
    {name:"商品挂载",headers:PRODUCT_HEADERS,rows:rows.products,widths:[8,23,62,36,13,18,20,24,27,39,28,14,38,95,65,65],table:"ProductMounts"},
    {name:"商品属性",headers:ATTRIBUTE_HEADERS,rows:rows.attributes,widths:[10,23,58,50,24,18,45,12,75,65,16],table:"ProductAttributeValues"},
  ];
  for(const def of definitions){
    const sheet=wb.worksheets.add(def.name),n=def.headers.length;
    sheet.getRangeByIndexes(0,0,1,n).values=[def.headers];
    for(let i=0;i<def.rows.length;i+=4000){const block=def.rows.slice(i,i+4000);sheet.getRangeByIndexes(i+1,0,block.length,n).values=block;}
    const all=sheet.getRangeByIndexes(0,0,def.rows.length+1,n);
    all.format.font={name:"PingFang SC",size:10,color:"#253448"};all.format.wrapText=true;all.format.verticalAlignment="center";all.format.rowHeight=36;
    const head=sheet.getRangeByIndexes(0,0,1,n);
    head.format={fill:"#174D59",font:{name:"PingFang SC",size:10,bold:true,color:"#FFFFFF"},horizontalAlignment:"center",verticalAlignment:"center",wrapText:true};head.format.rowHeight=40;
    def.widths.forEach((w,i)=>sheet.getRangeByIndexes(0,i,1,1).format.columnWidth=w);
    // Keep string identifiers in the file; format explicitly because the preview
    // renderer otherwise displays numeric-looking text in scientific notation.
    sheet.getRangeByIndexes(1,1,def.rows.length,1).setNumberFormat("0");
    sheet.getRangeByIndexes(1,1,def.rows.length,1).format.horizontalAlignment="left";
    if(def.name==="商品挂载")sheet.getRangeByIndexes(1,4,def.rows.length,1).setNumberFormat("#,##0.00");
    for(let i=0;i<def.rows.length;i++){
      const row=def.rows[i]!;
      const lines=Math.max(...row.map((v,j)=>String(v??"").split("\n").reduce((total,line)=>total+Math.max(1,Math.ceil([...line].reduce((s,c)=>s+(c.charCodeAt(0)>127?1.9:1),0)/(def.widths[j]!-2))),0)));
      sheet.getRangeByIndexes(i+1,0,1,n).format.rowHeight=Math.min(390,Math.max(32,lines*16+10));

    }
    sheet.freezePanes.freezeRows(1);sheet.showGridLines=false;
    const last=String.fromCharCode(64+n);
    sheet.tables.add(`A1:${last}${def.rows.length+1}`,true,def.table);
  }
  wb.recalculate();
  const inspected=await wb.inspect({kind:"table",range:"商品属性!E1:I5",include:"values",tableMaxRows:5,tableMaxCols:5,maxChars:1200});
  console.log(inspected.ndjson);
  const errors=await wb.inspect({kind:"match",searchTerm:"#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!|#SPILL!|#CALC!",options:{useRegex:true,maxResults:20},summary:"final formula error scan"});
  await writeFile(join(reproDir,"excel-checks.txt"),`${inspected.ndjson}\n${errors.ndjson}`);
  for(const spec of [{sheetName:"商品挂载",range:"A1:I5",file:"products-preview.png"},{sheetName:"商品属性",range:"E1:K9",file:"attributes-preview.png"}]){
    const img=await wb.render({sheetName:spec.sheetName,range:spec.range,scale:1.3,format:"png"});
    await writeFile(join(reproDir,spec.file),new Uint8Array(await img.arrayBuffer()));
  }
  const file=await SpreadsheetFile.exportXlsx(wb);await file.save(output);
  await rename(`${output}.inspect.ndjson`,join(reproDir,"excel.inspect.ndjson")).catch(e=>{if(e.code!=="ENOENT")throw e;});
  return output;
}
