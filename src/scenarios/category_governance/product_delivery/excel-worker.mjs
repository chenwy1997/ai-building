import {writeProductExcel} from "./excel.ts";
process.stdin.setEncoding("utf8");let input="";
for await(const chunk of process.stdin)input+=chunk;
const payload=JSON.parse(input);
console.log(await writeProductExcel(Array.isArray(payload)?payload:payload.products,Array.isArray(payload)?undefined:payload.directory));
