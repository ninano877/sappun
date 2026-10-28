const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../js/travel-planner.js'),'utf8');
const parser=source.slice(source.indexOf('function decodeMapsLink('),source.indexOf('function installSearch()'));
const calls=[];
const context=vm.createContext({URL,AbortSignal,window:{SAPPUN_CLOUD:{apiBase:'https://test.example'}},gmap:null,
  fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({url:'https://www.google.com/maps/place/Test+Place/data=!3d35.1!4d135.2'})};}
});
vm.runInContext(parser,context);
(async()=>{
  const places=await vm.runInContext('searchMapInput("https://maps.app.goo.gl/test")',context);
  assert.equal(places[0].lat,35.1);assert.equal(places[0].lng,135.2);assert.equal(places[0].name,'Test Place');
  assert.equal(calls.length,1);assert.equal(calls[0].options.credentials,'omit');
  assert.equal(calls[0].options.headers.Authorization,undefined);
  assert.equal((await vm.runInContext('searchMapInput("https://www.google.com/maps?q=35,135")',context))[0].lat,35);
  assert.equal(calls.length,1,'long coordinate links require no API call');
  const pasted=await vm.runInContext('searchMapInput("Test place · Google 지도\\nhttps://maps.app.goo.gl/test")',context);
  assert.equal(pasted[0].lat,35.1,'pasted Google Maps share text accepts its embedded URL');
  assert.doesNotMatch(source.slice(source.indexOf('function edit(i'),source.indexOf('// Main map search uses')),/地域|지역 · 쉼표로 구분|val\("region"\)/);
  console.log('PASS: short map share link expansion, coordinate import without a map key, and no region field.');
})().catch(error=>{console.error(error);process.exitCode=1;});
