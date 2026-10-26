import { expect, test } from '@playwright/test'
import { freshBoard, postSync, waitForSync } from './helpers.ts'
import { setCamera } from './touch.ts'

test('1,000 members in one area stay individually culled with smooth pan and low-detail rendering @perf',async({page,browserName})=>{
  test.skip(browserName!=='chromium','Chromium frame and heap metrics')
  test.setTimeout(120000)
  await page.setViewportSize({width:1440,height:900})
  await freshBoard(page,'Large canvas area')
  const board=page.url().split('/b/')[1]!,area=crypto.randomUUID()
  const base={kind:'card',boardId:board,color:'none',createdAt:Date.now(),columnId:null,z:1}
  const objects=[{...base,id:area,type:'area',x:0,y:0,w:800,h:480,content:{title:'One thousand references'}},...Array.from({length:1000},(_,i)=>({...base,id:crypto.randomUUID(),type:'todo',areaId:area,x:24+i%40*300,y:80+Math.floor(i/40)*180,w:260,h:80,content:{title:`Reference ${i}`,items:[]}}))]
  for(let i=0;i<objects.length;i+=200){const response=await postSync(page.request,{data:{changes:objects.slice(i,i+200).map(o=>({id:o.id,patch:o}))}});expect(response.ok(),await response.text()).toBe(true)}
  await page.reload();await setCamera(page,{x:0,y:0,zoom:1})
  await expect.poll(()=>page.getByTestId('card').count()).toBeLessThan(80)
  expect(await page.getByTestId('card').count()).toBeGreaterThan(10)
  await page.evaluate(()=>{const w=window as unknown as {areaFrames:number[];areaStop:boolean};w.areaFrames=[];w.areaStop=false;let last=performance.now();const tick=(now:number)=>{w.areaFrames.push(now-last);last=now;if(!w.areaStop)requestAnimationFrame(tick)};requestAnimationFrame(tick)})
  await page.mouse.move(800,400)
  for(let i=0;i<90;i++)await page.mouse.wheel(i<45?20:-20,i<45?12:-12)
  const frames=await page.evaluate(()=>{const w=window as unknown as {areaFrames:number[];areaStop:boolean};w.areaStop=true;return w.areaFrames.slice(4).sort((a,b)=>a-b)})
  const p95=frames[Math.floor(frames.length*.95)]!
  expect(frames.length).toBeGreaterThan(30);expect(p95).toBeLessThan(33.4)
  await page.keyboard.press('ControlOrMeta+1');await expect(page.getByTestId('lod-layer')).toBeVisible();await expect(page.getByTestId('card')).toHaveCount(0)
  await waitForSync(page)
  const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('HeapProfiler.collectGarbage')
  const {metrics}=await cdp.send('Performance.getMetrics');const heap=metrics.find(m=>m.name==='JSHeapUsedSize')!.value/1024/1024
  expect(heap).toBeLessThan(150)
  console.log('AREA_PERF',JSON.stringify({members:1000,p95,heapMB:Math.round(heap)}))
})
