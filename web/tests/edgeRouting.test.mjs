import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveRoute, routePoints, routeControls, moveRoute } from '../src/edgeRouting.ts'
const source={x:770,y:302}, target={x:343,y:216}, saved={x:821,y:91}
test('legacy upper route exposes the missing target-side vertical handle',()=>{
  const route=resolveRoute(source,target,saved)
  const controls=routeControls(source,target,route)
  assert.deepEqual(controls.map(c=>c.field),['x','y','targetX'])
  assert.deepEqual(controls[2].point,{x:343,y:153.5})
  const points=routePoints(source,target,route)
  assert.deepEqual(points.slice(0,5),[source,{x:821,y:302},{x:821,y:91},{x:343,y:91},target])
  assert.deepEqual(points[5],target)
})
test('dragging near W5500 moves its vertical leg away and keeps both ports attached',()=>{
  const route=resolveRoute(source,target,saved), next=moveRoute(saved,route,'targetX',-80)
  assert.deepEqual(next,{x:821,y:91,targetX:263})
  const points=routePoints(source,target,resolveRoute(source,target,next))
  assert.deepEqual(points[0],source);assert.deepEqual(points.at(-1),target)
  assert.deepEqual(points[3],{x:263,y:91});assert.deepEqual(points[4],{x:263,y:216})
  for(let i=1;i<points.length;i++) assert.ok(points[i-1].x===points[i].x || points[i-1].y===points[i].y)
})
test('each routing handle changes only its own coordinate',()=>{
  const original={...saved,targetX:250}, route=resolveRoute(source,target,original)
  assert.deepEqual(moveRoute(original,route,'x',20),{x:841,y:91,targetX:250})
  assert.deepEqual(moveRoute(original,route,'y',-30),{x:821,y:61,targetX:250})
  assert.deepEqual(original,{...saved,targetX:250})
})
test('ordinary edits do not pin targetX; saved custom routes survive JSON roundtrip and moving blocks',()=>{
  const route=resolveRoute(source,target,saved), ordinary=moveRoute(saved,route,'y',30)
  assert.equal('targetX' in ordinary,false)
  assert.equal(resolveRoute(source,{x:400,y:216},ordinary).targetX,400)
  const custom=JSON.parse(JSON.stringify(moveRoute(saved,route,'targetX',-80)))
  const points=routePoints(source,{x:400,y:260},resolveRoute(source,{x:400,y:260},custom))
  assert.deepEqual(points.at(-1),{x:400,y:260});assert.deepEqual(points.at(-2),{x:263,y:260})
})
test('zero/short legs do not show misleading controls and overlapping legs have separate handles',()=>{
  assert.equal(routeControls(source,source,resolveRoute(source,source)).length,0)
  const coincident={x:821,y:91,targetX:821}, flatTarget={x:343,y:302}
  const handles=routeControls(source,flatTarget,coincident)
  assert.equal(handles.length,2);assert.notDeepEqual(handles[0].point,handles[1].point)
})
