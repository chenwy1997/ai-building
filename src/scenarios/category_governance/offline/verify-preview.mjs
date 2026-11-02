import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const { chromium }=require(resolve(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const edition=process.argv.find(a=>a.startsWith('--edition='))?.slice(10)??'agent-draft-v1';
const port=process.argv.find(a=>a.startsWith('--port='))?.slice(7)??'4319';
if(!/^[a-zA-Z0-9_-]+$/.test(edition)||!/^\d+$/.test(port))throw new Error('无效版本或端口');
const url=`http://127.0.0.1:${port}/`;
const out=resolve(dirname(fileURLToPath(import.meta.url)),`../workspace/output/v1/${edition}/.repro`);
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
  const page=await browser.newPage({viewport:{width:1480,height:1060},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);
  await page.locator('h2').filter({hasText:'手机'}).waitFor();
  const phone=await page.locator('tbody').innerText();
  assert(phone.includes('处理器型号')&&phone.includes('运行内存')&&phone.includes('机身存储容量'));
  await page.screenshot({path:resolve(out,'view-desktop.png')});
  async function pick(name){await page.locator('#search').fill(name);await page.locator('#list .item').filter({has:page.locator('strong',{hasText:new RegExp('^'+name+'$')})}).click();}
  await pick('平垫');let body=await page.locator('tbody').innerText();assert(body.includes('内径')&&!body.includes('螺纹规格'));
  assert((await page.locator('.breadcrumb').innerText()).includes('螺栓'));
  await pick('保暖耳罩');body=await page.locator('tbody').innerText();assert(!body.includes('SNR')&&!body.includes('NRR'));
  await pick('保温管');assert((await page.locator('tbody').innerText()).includes('交付物包含承压输送内管时'));
  await page.locator('#search').fill('');await page.locator('#scope').selectOption('curated');
  const matched=await page.locator('#resultcount').innerText();assert(matched.includes('匹配'));
  await page.locator('#scope').selectOption('');await pick('手机');
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=390));
  await page.screenshot({path:resolve(out,'view-mobile.png')});
  const hidden=await page.request.get(url+'.repro/input.snapshot.json.gz');assert.equal(hidden.status(),404);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({preview:'passed',matched,checks:['手机配置','平垫保留原路径','保暖耳罩不含降噪','保温管条件属性','过滤与搜索','窄屏布局','源快照不公开','浏览器无异常']}));
} finally {await browser.close();}
