const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../js/travel-planner.js'),'utf8');
const ctx=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function routePathPoint('),source.indexOf('async function drawMapRoutes(')),ctx);
for(const points of [
  [{lat:0,lng:0},{lat:0,lng:10}],
  [{lat:0,lng:0},{lat:0,lng:1},{lat:0,lng:10}],
  [{lat:0,lng:0},{lat:0,lng:0},{lat:0,lng:10}]
]) {
  const middle=ctx.routeMidpoint(points);
  assert.ok(Math.abs(middle.lng-5)<1e-9,'label belongs halfway along distance, not at the middle vertex or destination');
}
const zero=ctx.routeMidpoint([{lat:35,lng:135},{lat:35,lng:135}]);
assert.equal(zero.lat,35);assert.equal(zero.lng,135);
console.log('PASS: connection labels use distance midpoint for two-point, uneven, and repeated-point paths.');
