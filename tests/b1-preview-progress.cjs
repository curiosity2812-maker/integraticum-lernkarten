const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { readFileSync, createReadStream } = require('node:fs');
const { createServer } = require('node:http');
const path = require('node:path');

const authEmulator = 'http://127.0.0.1:9099';
const firestorePort = 8080;
const sdkBase = 'https://www.gstatic.com/firebasejs/13.4.0/';
const repositoryRoot = path.resolve(__dirname, '..');
const previewRoot = path.join(repositoryRoot, 'data/b1_preview');
const manifest = JSON.parse(readFileSync(path.join(previewRoot, 'manifest.json')));
const aliases = manifest.files.flatMap(file =>
  JSON.parse(readFileSync(path.join(previewRoot, file)))
).filter(card => card.combined_into === 'a1-270-1');
const old = aliases.find(card => card.de === 'Viel Glück!');
const target = old?.combined_into;
assert.ok(old && target);
const third = aliases.find(card => card.id !== old.id);
assert.ok(third);

function replaceOnce(html, from, to) {
  assert.equal(html.split(from).length, 2, 'Expected one test injection point: ' + from);
  return html.replace(from, to);
}

function emulatorPage() {
  let html = readFileSync(path.join(repositoryRoot, 'index.html'), 'utf8');
  html = replaceOnce(html, "projectId:'integraticum'", "projectId:'demo-integraticum'");
  html = replaceOnce(html, 'import {getAuth,', 'import {connectAuthEmulator,getAuth,');
  html = replaceOnce(html, 'import {getFirestore,', 'import {connectFirestoreEmulator,getFirestore,');
  html = replaceOnce(html, 'if (!B1_PREVIEW) try{', 'try{');
  html = replaceOnce(html, "auth.languageCode='ru';", `
    connectAuthEmulator(auth, '${authEmulator}', {disableWarnings:true});
    connectFirestoreEmulator(db, '127.0.0.1', ${firestorePort});
    auth.languageCode='ru';`);
  return html;
}

async function main() {
  const html = emulatorPage();
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(html);
      return;
    }
    const mime = {'.css':'text/css', '.svg':'image/svg+xml', '.json':'application/json'}[path.extname(pathname)];
    const filename = path.resolve(repositoryRoot, '.' + pathname);
    if (!mime || !filename.startsWith(repositoryRoot + path.sep)) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', mime);
    const stream = createReadStream(filename);
    stream.on('error', () => response.writeHead(404).end());
    stream.pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const site = 'http://127.0.0.1:' + server.address().port;
  const sdk = new Map();
  let browser;
  try {
    browser = await chromium.launch({executablePath:process.env.INTEGRATICUM_CHROMIUM || undefined});
    async function tab(context) {
      const page = await context.newPage();
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.href.startsWith(sdkBase)) {
          if (!sdk.has(url.href)) sdk.set(url.href, fetch(url.href).then(async response => {
            if (!response.ok) throw Error('Firebase SDK: ' + response.status);
            return await response.text();
          }));
          await route.fulfill({contentType:'text/javascript', body:await sdk.get(url.href),
            headers:{'access-control-allow-origin':'*'}});
        } else if ([site,authEmulator,'http://127.0.0.1:' + firestorePort].includes(url.origin)) {
          await route.continue();
        } else {
          await route.abort();
        }
      });
      await page.goto(site + '/?dictionary-preview=b1');
      await page.waitForFunction(id => word(id)?.combined_into && window.integraticumAuth, old.id);
      return page;
    }

    const email = 'b1-preview-' + crypto.randomUUID() + '@example.test';
    const password = 'Local-test-123!';
    async function logIn(page, register) {
      await page.evaluate(() => go('account'));
      await page.locator('#authEmail').fill(email);
      await page.locator('#authPassword').fill(password);
      await page.evaluate(register => window.integraticumAuth.email(register ? 'register' : 'login'), register);
      await page.waitForFunction(email => window.integraticumUser?.email === email, email);
    }
    const firstContext = await browser.newContext();
    const first = await tab(firstContext);
    await logIn(first, true);
    const ids = [old.id, target, third.id];
    const setId = 'b1-preview-progress';
    await first.evaluate(({ids,setId}) => {
      data.sets.push({id:setId,name:'B1 preview recovery',level:'A1',topic:'B1',description:'',wordIds:ids});
      save();
      startSession(ids, 'cards');
      feedback = {ok:true,errorType:'correct'};
      nextQuestion();
      feedback = {ok:false,errorType:'recall'};
      nextQuestion();
    }, {ids,setId});

    const expected = await first.evaluate(({ids,setId}) => ({
      progress: ids.slice(0,2).map(id => rec(id)),
      history: data.history.map(({id,eventId,ok,at}) => ({id,eventId,ok,at})),
      set: data.sets.find(item => item.id === setId),
      saved: data.learningSessions[0]
    }), {ids,setId});
    assert.equal(expected.saved.index, 2);
    assert.equal(expected.progress[0].streak, 1);
    assert.equal(expected.progress[1].streak, 0);
    assert.deepEqual(expected.history.map(event => event.id), ids.slice(0,2));
    await first.waitForFunction(() => {
      const uid = window.integraticumUser?.uid;
      return window.integraticumProgressStatus === 'Облачный прогресс загружен' &&
        localStorage.getItem(KEY + ':workspacePending:' + uid) === '[]';
    });

    await first.reload();
    await first.waitForFunction(({email,id}) => window.integraticumUser?.email === email &&
      word(id) && data.learningSessions[0]?.index === 2, {email,id:third.id});
    await first.evaluate(() => resumeLearning(0));
    assert.equal(await first.evaluate(() => session.queue[session.index].id), third.id);
    await first.evaluate(() => window.integraticumAuth.signOut());
    await first.waitForFunction(() => !window.integraticumUser);
    await firstContext.close();

    const freshContext = await browser.newContext();
    const fresh = await tab(freshContext);
    assert.equal(await fresh.evaluate(() => data.history.length), 0);
    await logIn(fresh, false);
    await fresh.waitForFunction(({ids,setId}) => ids.slice(0,2).every(id => rec(id)) &&
      data.sets.some(item => item.id === setId) && data.learningSessions[0]?.index === 2, {ids,setId});
    const restored = await fresh.evaluate(({ids,setId}) => ({
      progress: ids.slice(0,2).map(id => rec(id)),
      history: data.history.map(({id,eventId,ok,at}) => ({id,eventId,ok,at})),
      set: data.sets.find(item => item.id === setId),
      saved: data.learningSessions[0]
    }), {ids,setId});
    assert.deepEqual(restored, expected);
    await fresh.evaluate(() => resumeLearning(0));
    assert.equal(await fresh.evaluate(() => session.queue[session.index].id), third.id);
    await fresh.evaluate(id => openWord(id), old.id);
    assert.ok(await fresh.getByRole('button',{name:'Открыть общую карточку'}).isVisible());
    await fresh.getByRole('button',{name:'Открыть общую карточку'}).click();
    assert.equal(await fresh.evaluate(() => selectedWord), target);
    console.log('B1 preview: cloud answer history, two independent ID records and due dates, saved set and resumed session all restored.');
  } finally {
    await browser?.close();
    server.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
