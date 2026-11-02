import { homedir } from "node:os";
import { resolve } from "node:path";
import { writeFile, rename } from "node:fs/promises";
import { requirementLabel } from "./requirements.ts";
import type { DraftDocument, KnowledgeProperty } from "./types.ts";

export const HEADERS = ["一级类目","二级类目","三级类目","品名（四级类目）","属性名称","属性说明","属性值类型","属性值填写要求","属性值单位","属性值选项","属性值格式","属性值示例"];
const TYPES: Record<string,string> = {text:"文本",number:"数值",boolean:"布尔",single:"单选",multi:"多选",date:"日期",file:"文件"};
export function excelRows(document: DraftDocument): string[][] {
  return document.categories.flatMap(c => {
    const path = c.category.path.slice(c.category.path[0] === "标准类目" ? 1 : 0);
    if (path.length !== 4) throw new Error(`本示例工作簿要求四级类目；${c.category.name} 为 ${path.length} 级，不能截断或伪造层级`);
    return [...c.shared,...c.properties].map((p: KnowledgeProperty) => [
      ...path,p.name,[p.description,p.condition?`适用条件：${p.condition}`:""].filter(Boolean).join("；"),TYPES[p.type]!,requirementLabel(p),p.unit??"",(p.options??[]).join(";"),p.format??"",p.example??"",
    ]);
  });
}
export async function writeExcel(document: DraftDocument, output: string): Promise<{ rows: number; preview: string }> {
  if (typeof Bun !== "undefined") {
    const node = process.env.ARTIFACT_NODE ?? resolve(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node");
    const child = Bun.spawn([node, "--max-old-space-size=8192", resolve(import.meta.dir, "excel-worker.mjs"), output], { stdin: new Blob([JSON.stringify(document)]), stdout: "inherit", stderr: "inherit" });
    if (await child.exited !== 0) throw new Error("Excel 导出失败");
    return { rows: excelRows(document).length, preview: resolve(output, "..", ".repro", "excel-preview.png") };
  }
  const modulePath = process.env.ARTIFACT_TOOL_MODULE ?? resolve(homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs");
  const { Workbook, SpreadsheetFile } = await import(modulePath);
  const wb = Workbook.create(); const sheet = wb.worksheets.add("属性模板");
  const rows = excelRows(document);
  sheet.getRange("A1:L1").values = [HEADERS];
  const blockSize = 10000;
  for (let i=0;i<rows.length;i+=blockSize) sheet.getRangeByIndexes(i+1,0,Math.min(blockSize,rows.length-i),HEADERS.length).values=rows.slice(i,i+blockSize);
  const all=sheet.getRangeByIndexes(0,0,rows.length+1,HEADERS.length);
  all.format.font={name:"PingFang SC",size:10,color:"#172033"};
  all.format.verticalAlignment="center"; all.format.wrapText=true; all.format.rowHeight=36;
  const head=sheet.getRange("A1:L1"); head.format={fill:"#1F4E78",font:{name:"PingFang SC",size:10,bold:true,color:"#FFFFFF"},horizontalAlignment:"center",verticalAlignment:"center",wrapText:true}; head.format.rowHeight=36;
  const widths=[16,20,26,27,24,65,12,20,16,25,45,33];
  widths.forEach((w,i)=>sheet.getRangeByIndexes(0,i,1,1).format.columnWidth=w);
  // Bound heights to actual text; no merged category cells, so filtering remains usable.
  for(let i=0;i<rows.length;i++){const lines=Math.max(...rows[i]!.map((s,j)=>Math.ceil([...s].reduce((n,c)=>n+(c.charCodeAt(0)>127?1.8:1),0)/(widths[j]!-2))));if(lines>2)sheet.getRangeByIndexes(i+1,0,1,12).format.rowHeight=Math.min(180,lines*15+8);}
  sheet.freezePanes.freezeRows(1); sheet.showGridLines=false;
  // One native table gives sorting/filtering without an extra sheet.
  sheet.tables.add(`A1:L${rows.length+1}`,true,"AttributeTemplates");
  wb.recalculate();
  const inspected=await wb.inspect({kind:"table",range:"属性模板!A1:L5",include:"values",tableMaxRows:5,tableMaxCols:12,maxChars:2200});
  console.log(inspected.ndjson);
  const previewPath=resolve(output,"..",".repro","excel-preview.png");
  const firstChanged=rows.findIndex(r=>r[3]==="手机");
  const start=firstChanged+2;
  const image=await wb.render({sheetName:"属性模板",range:`D${start}:I${start+10}`,scale:1.5,format:"png"});
  await writeFile(previewPath,new Uint8Array(await image.arrayBuffer()));
  const conditionalRow=rows.findIndex(r=>r[7]==="条件必填")+2;
  const conditionalImage=await wb.render({sheetName:"属性模板",range:`D${conditionalRow}:I${conditionalRow+4}`,scale:1.5,format:"png"});
  await writeFile(resolve(output,"..",".repro","excel-conditional-preview.png"),new Uint8Array(await conditionalImage.arrayBuffer()));
  const file=await SpreadsheetFile.exportXlsx(wb); await file.save(output);
  // Keep the exporter diagnostics with reproducibility files, away from the user's result files.
  await rename(`${output}.inspect.ndjson`,resolve(output,"..",".repro","excel.inspect.ndjson")).catch(error=>{if(error.code!=="ENOENT")throw error;});
  return {rows:rows.length,preview:previewPath};
}
