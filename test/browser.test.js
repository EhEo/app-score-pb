import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

test('real Chrome: mobile setup, tablet sync, authorization, offline restore, undo, results', {timeout:90000}, async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'courtside-test-'));
  const port=31000+Math.floor(Math.random()*1000), origin=`http://localhost:${port}`;
  const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port),DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error(`server exited ${code}`)));});
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  const tablet=await browser.newContext({viewport:{width:1180,height:820},serviceWorkers:'block'});
  try {
    await mkdir('artifacts',{recursive:true});
    const page=await mobile.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin);await page.screenshot({path:'artifacts/mobile-home.png',fullPage:true});
    await page.getByRole('button',{name:'새 경기 시작'}).click();
    await page.screenshot({path:'artifacts/mobile-setup.png',fullPage:true});
    await page.locator('#setup button.primary').click();
    assert.equal(await page.locator('[data-rally="0"] .tap-action').textContent(),'＋ 1점 득점');
    assert.match(await page.locator('[data-rally="1"] .tap-action').textContent(),/서브권 이동/);
    assert.ok((await page.locator('[data-rally="0"]').boundingBox()).height>=200);
    for (const [width,height] of [[667,375],[844,390],[740,320],[1024,768],[1180,820]]) {
      await page.setViewportSize({width,height});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight||document.documentElement.scrollWidth>innerWidth),false,`standalone scroll ${width}x${height}`);
      for (const selector of ['[data-rally="0"]','[data-rally="1"]','#undo','#swap','#correct','#more']) {
        const box=await page.locator(selector).boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<=height+1,`${selector} outside standalone ${width}x${height}`);
      }
      const target=await page.locator('[data-rally="0"]').boundingBox(),caption=await page.locator('[data-rally="0"] .tap-action').boundingBox();
      assert.ok(caption.y+caption.height<=target.y+target.height,`clipped rally action ${width}x${height}`);
      await page.screenshot({path:`artifacts/standalone-${width}x${height}.png`,fullPage:true});
    }
    await page.setViewportSize({width:390,height:844});
    await page.locator('[data-rally="0"]').tap();
    assert.equal(await page.locator('.score').first().textContent(),'1');
    await page.getByRole('button',{name:'태블릿 연결',exact:true}).click();
    const code=await page.locator('.pair-code').textContent();
    await page.getByRole('button',{name:'창 닫기'}).click();
    const view=await tablet.newPage();view.on('pageerror',e=>errors.push(e.message));await view.goto(`${origin}/?watch=${code}`);
    await view.waitForFunction(()=>document.querySelector('.score')?.textContent==='1');
    assert.equal(await view.locator('[data-rally]').count(),0);
    const unauthorized=await fetch(`${origin}/api/rooms/${code}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(unauthorized.status,403);
    const secondViewer=await fetch(`${origin}/api/rooms/${code}/events?viewer=second-tablet`);assert.equal(secondViewer.status,409);
    const qr=await fetch(`${origin}/api/qr?url=${encodeURIComponent(origin)}`);assert.equal(qr.status,200);assert.match(await qr.text(),/<svg/);
    await page.locator('[data-rally="0"]').click();await view.waitForFunction(()=>document.querySelector('.score')?.textContent==='2');
    await page.screenshot({path:'artifacts/mobile-score.png',fullPage:true});await view.screenshot({path:'artifacts/tablet-score.png',fullPage:true});
    await mobile.setOffline(true);await page.locator('[data-rally="0"]').click();
    assert.equal(await page.locator('.score').first().textContent(),'3');
    await mobile.setOffline(false);await page.reload();
    await view.waitForFunction(()=>document.querySelector('.score')?.textContent==='3');
    assert.equal(await page.locator('.score').first().textContent(),'3');
    await page.getByRole('button',{name:'되돌리기'}).click();await view.waitForFunction(()=>document.querySelector('.score')?.textContent==='2');
    await page.getByRole('button',{name:'좌우 바꾸기'}).click();
    await view.waitForFunction(()=>document.querySelector('.score-panel h2')?.textContent==='B팀');
    await page.getByRole('button',{name:'상태 수정',exact:true}).click();
    await page.getByRole('button',{name:'A팀 점수 1점 증가',exact:true}).click();
    assert.equal(await page.locator('[name=score0]').inputValue(),'3');
    await page.getByRole('button',{name:'A팀 점수 1점 감소',exact:true}).click();
    assert.equal(await page.locator('[name=score0]').inputValue(),'2');
    assert.equal(await page.getByRole('button',{name:'B팀 점수 1점 감소',exact:true}).isDisabled(),true);
    await page.screenshot({path:'artifacts/mobile-correction.png',fullPage:true});
    await page.locator('[name=score0]').fill('11');await page.locator('#correction button.primary').click();
    await page.getByRole('heading',{name:'A팀 경기 승리!'}).waitFor();
    await page.reload();await page.getByRole('heading',{name:'A팀 경기 승리!'}).waitFor();
    await page.getByRole('button',{name:'경기 관리',exact:true}).click();await page.getByRole('button',{name:'경기 기록',exact:true}).click();
    assert.match(await page.locator('.history-row').textContent(),/11:0/);
    await page.screenshot({path:'artifacts/mobile-history.png',fullPage:true});
    await page.getByRole('button',{name:'창 닫기'}).click();
    await page.getByRole('button',{name:'되돌리기'}).click();assert.equal(await page.locator('.result').count(),0);
    for(const width of [360,390,768,1180]) { await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`overflow at ${width}`); }
    await page.screenshot({path:'artifacts/tablet-control.png',fullPage:true});
    assert.deepEqual(errors,[]);
    const cachedContext=await browser.newContext({viewport:{width:390,height:844}});
    const cachedPage=await cachedContext.newPage();await cachedPage.goto(origin);
    await cachedPage.evaluate(()=>navigator.serviceWorker.ready);
    await cachedPage.reload();
    await cachedPage.getByRole('button',{name:'새 경기 시작'}).click();
    await cachedPage.locator('#setup [name=mode]').selectOption('rally');
    await cachedPage.getByRole('button',{name:'목표 점수 1점 증가',exact:true}).click();
    assert.equal(await cachedPage.locator('[name=rallyTarget]').inputValue(),'12');
    await cachedPage.locator('#setup [name=kind]').selectOption('singles');
    await cachedPage.locator('#setup button.primary').click();
    await cachedPage.locator('[data-rally="1"]').click();
    await cachedContext.setOffline(true);await cachedPage.reload();
    assert.equal(await cachedPage.locator('.score').nth(1).textContent(),'1');
    await cachedPage.locator('[data-rally="1"]').click();
    assert.equal(await cachedPage.locator('.score').nth(1).textContent(),'2');
    await cachedPage.getByRole('button',{name:'되돌리기'}).click();
    assert.equal(await cachedPage.locator('.score').nth(1).textContent(),'1');
    await cachedContext.close();
  } finally {await browser.close();server.kill();await new Promise(resolve=>server.once('exit',resolve));await rm(dir,{recursive:true,force:true});}
});
