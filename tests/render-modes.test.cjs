const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// Reuse the app's lightweight DOM harness and load the same data as the HTML.
const harness = fs.readFileSync(path.join(__dirname, 'app-boot.test.cjs'), 'utf8')
  .split("vm.runInContext('openTrip")[0];
const checks = `
vm.runInContext('openTrip(tripBook.trips[0].id)',context);
const count=vm.runInContext('state.days.flat().length',context);
for(const mode of ['map','list','map']) {
  vm.runInContext('trip().viewMode='+JSON.stringify(mode)+';render();',context);
  assert.match(get('#stops').innerHTML,/테스트 장소/);
  assert.match(get('#stops').innerHTML,mode==='list'?/schedule-grid-table/:/day-group/);if(mode==='map'){assert.match(get('#stops').innerHTML,/data-mapday="0"/);assert.match(get('#stops').innerHTML,/class="day-fold-toggle" data-dayfold="0"/);assert.match(get('#stops').innerHTML,/aria-controls="day-content-0"/);assert.match(get('#daytitle').innerHTML,/show-all-map/);assert.match(get('#daytitle').innerHTML,/search-all-map-locations/);assert.match(get('#stops').innerHTML,/data-load-day="0"/);assert.match(get('#stops').innerHTML,/Google 위치 검색/);assert.equal(get('#mapstrip').innerHTML,'');assert.doesNotMatch(get('#api-call-controls').innerHTML,/load-entire-map|선택 날짜 위치 조회/);}if(mode==='list'){assert.doesNotMatch(get('#stops').innerHTML,/data-stop-map/);assert.match(get('#stops').innerHTML,/전체 내용 보기/);assert.match(get('#stops').innerHTML,/data-schedule-map-day="0"/);assert.match(get('#stops').innerHTML,/grid-category-icon/);}
}
for(const view of ['settlement','preparation','materials','itinerary']) {
  vm.runInContext('trip().workspaceView='+JSON.stringify(view)+';render();',context);
}
assert.equal(vm.runInContext('state.days.flat().length',context),count);
assert.equal(count,2);
console.log('PASS: map/table round trip, all workspaces render, and schedule data stays intact.');
`;
vm.runInNewContext(harness + checks, {
  require, __dirname, console, URL, Intl, Date, Blob, AbortController,
  queueMicrotask, structuredClone
}, {filename: path.join(__dirname, 'render-modes-harness.cjs')});
