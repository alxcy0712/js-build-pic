import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { after, test } from 'node:test';
import sharp from 'sharp';
import { createMask } from '../scripts/mask.mjs';
import { ROOT, createScene, encode, rasterize, sha256 } from '../scripts/render.mjs';
import { createShapes, encodeShapes, rasterizeShapes, verifyShapes } from '../scripts/shapes.mjs';
import { verify } from '../scripts/verify.mjs';
import { extractSubject } from '../scripts/subject.mjs';
import { makeAnimation, renderFrame, encodeAnimation, verifyAnimation, resolveResolution } from '../scripts/animate.mjs';
import { validateDesigns } from '../scripts/design.mjs';

await mkdir(join(ROOT, 'runs'), { recursive: true });
const directory = await mkdtemp(join(ROOT, 'runs', 'test-animation '));
await mkdir(join(directory, 'runs'));
after(()=>rm(directory,{recursive:true,force:true}));
const mask=join(directory,'mask.png');
await writeFile(mask,await createMask(64,80,[[.25,.1],[.75,.1],[.75,.9],[.25,.9]]));
const input=join(directory,'source.png');
async function fixture(background,path){
  const pixels=Buffer.alloc(64*80*4);
  for(let y=0;y<80;y++)for(let x=0;x<64;x++)pixels.set(x>=16&&x<48&&y>=8&&y<72?[239,141,55,255]:background,(y*64+x)*4);
  await writeFile(path,await sharp(pixels,{raw:{width:64,height:80,channels:4}}).png().toBuffer());
}
await fixture([19,39,239,255],input);
const cutout=await extractSubject(input,mask,96),subject=join(directory,'subject.png');
await writeFile(subject,cutout.png);
const options={width:96,columns:12,background:'transparent'};
// Plans belong to these fixtures; production geometry is supplied by the Agent for each image.
const vertical={image_index:1,label:'Upright orange strip',reason:'The first fixture is a tall orange rectangle.',
  parts:[{polygon:[[.35,.1],[.65,.1],[.65,.9],[.35,.9]],source_region:[0,0,1,1]}]};
const horizontal={image_index:2,label:'Horizontal green strip',reason:'The second fixture has a wide green bar.',
  parts:[{polygon:[[.1,.35],[.9,.35],[.9,.65],[.1,.65]],source_region:[0,0,1,1]}]};
const singleDesigns=join(directory,'designs.json'),pairDesigns=join(directory,'pair-designs.json');
await writeFile(singleDesigns,JSON.stringify([vertical]));
await writeFile(pairDesigns,JSON.stringify([vertical,horizontal]));

test('subject extraction removes background before sampling, fits proportionally and requires a selection for opaque input',async()=>{
  const other=join(directory,'other-background.png');await fixture([230,15,205,255],other);
  assert.equal(sha256(cutout.png),sha256((await extractSubject(other,mask,96)).png));
  const rgba=await sharp(cutout.png).ensureAlpha().raw().toBuffer();
  assert.equal(rgba[3],0);
  for(let i=0;i<rgba.length;i+=4)if(rgba[i+3]>0)assert.deepEqual([...rgba.subarray(i,i+3)],[239,141,55]);
  assert.deepEqual(cutout.source.crop,{left:16,top:8,width:32,height:64});
  await assert.rejects(extractSubject(input,undefined,96),/subject-mask/);
  const small=join(directory,'small-mask.png');await writeFile(small,await createMask(4,4,[[0,0],[1,0],[1,1],[0,1]]));
  await assert.rejects(extractSubject(input,small,96),/dimensions/);
  assert.ok((await extractSubject(subject,undefined,96)).png.length>0);
});

test('both representations and both character sets encode real transparent loop GIFs',async()=>{
  for(const mode of ['shapes','binary','mixed']){
    const scene=mode==='shapes'?await createShapes(subject,options):await createScene(subject,{...options,charset:mode});
    const animation=makeAnimation([scene],[vertical]),gif=await encodeAnimation(animation);
    const report=await verifyAnimation(animation,gif);
    assert.equal(report.frames,135);assert.equal(report.duration_seconds,5.4);assert.equal(report.final_hold_seconds,1);
    const final=mode==='shapes'?rasterizeShapes(scene):rasterize(scene);
    const held=await sharp(gif,{page:75}).ensureAlpha().raw().toBuffer();
    for(let frame=75;frame<100;frame++){
      assert.ok(renderFrame(animation,frame/25).equals(final));
      assert.ok((await sharp(gif,{page:frame}).ensureAlpha().raw().toBuffer()).equals(held));
    }
    assert.notEqual(sha256(renderFrame(animation,.8)),sha256(renderFrame(animation,3.4)));
    assert.notEqual(sha256(renderFrame(animation,4)),sha256(final));
    const spread=time=>{
      const pixels=renderFrame(animation,time);let sum=0,count=0;
      for(let p=0;p<pixels.length;p+=4)if(pixels[p+3]>=128){
        const x=(p/4)%animation.width+.5-animation.width/2,y=Math.floor(p/4/animation.width)+.5-animation.height/2;
        sum+=x*x+y*y;count++;
      }
      return sum/count;
    };
    assert.ok(spread(1.36)<spread(1),'Expanded particles should already be moving inward');
    const metadata=await sharp(gif,{animated:true}).metadata();assert.equal(metadata.hasAlpha,true);
    assert.equal(metadata.delay.reduce((sum,delay)=>sum+delay,0),5400);
  }
});

test('multiple unequal subjects use one fixed particle pool and form every target in upload order',async()=>{
  const binary=await createScene(subject,options),mixed=await createScene(subject,{...options,charset:'mixed'});
  assert.throws(()=>makeAnimation([binary,mixed],[vertical,horizontal]),/One character set/);
  const second=join(directory,'second.png');
  await writeFile(second,await sharp({create:{width:96,height:96,channels:4,background:'#00000000'}}).composite([{input:await sharp({create:{width:70,height:20,channels:4,background:'#28ab98'}}).png().toBuffer(),left:13,top:38}]).png().toBuffer());
  const scenes=[await createShapes(subject,options),await createShapes(second,options)];
  const animation=makeAnimation(scenes,[vertical,horizontal]);
  assert.notEqual(animation.layout_counts[0],animation.layout_counts[1]);
  assert.equal(animation.pool_count,Math.max(...animation.layout_counts));
  assert.ok(animation.tracks.every(track=>track.length===animation.pool_count));
  for(let i=0;i<scenes.length;i++){
    const ownColours=new Set(animation.tracks[i].filter(Boolean).map(c=>c.rgb.join(',')));
    assert.ok(animation.compact_tracks[i].filter(Boolean).every(c=>ownColours.has(c.rgb.join(','))));
    const compact=animation.compact_tracks[i].filter(Boolean);
    const extent=key=>Math.max(...compact.map(c=>c[key]))-Math.min(...compact.map(c=>c[key]));
    assert.ok(i===0?extent('y')>extent('x')*2:extent('x')>extent('y')*2,JSON.stringify({i,x:extent('x'),y:extent('y')}));
    assert.ok(renderFrame(animation,i*5.4).equals(renderFrame(makeAnimation([scenes[i]],[{...[vertical,horizontal][i],image_index:1}]),0)));
    for(let frame=75;frame<100;frame++)assert.ok(renderFrame(animation,i*5.4+frame/25).equals(rasterizeShapes(scenes[i])));
  }
  for(let i=0;i<scenes.length;i++)assert.ok(renderFrame(animation,animation.final_times[i]).equals(rasterizeShapes(scenes[i])));
  const mid=renderFrame(animation,4.6);
  assert.notEqual(sha256(mid),sha256(rasterizeShapes(scenes[0])));
  assert.notEqual(sha256(mid),sha256(rasterizeShapes(scenes[1])));
  const gif=await encodeAnimation(animation),report=await verifyAnimation(animation,gif);
  assert.equal(report.frames,270);assert.equal(report.duration_seconds,10.8);assert.equal(report.infinite_loop,true);
  const tampered=structuredClone(animation);tampered.tracks[0][0].x+=10;
  await assert.rejects(verifyAnimation(tampered,gif),/tracks/);
  const compactTampered=structuredClone(animation);compactTampered.compact_tracks[0].find(Boolean).x+=10;
  await assert.rejects(verifyAnimation(compactTampered,gif),/tracks/);
  await assert.rejects(verifyAnimation(animation,await sharp(cutout.png).gif().toBuffer()));
});

test('CLI delivers only GIF, keeps PNG internal and checks ordered image designs and tampering',async()=>{
  const run=promisify(execFile),script=fileURLToPath(new URL('../scripts/animate.mjs',import.meta.url));
  const args=[script,'--input',input,'--subject-mask',mask,'--representation','characters','--width','96','--columns','12','--designs',singleDesigns];
  await run(process.execPath,[...args,'--out',join(directory,'runs/default')],{cwd:directory});
  const manifest=JSON.parse(await readFile(join(directory,'runs/default/manifest.json')));
  assert.equal(manifest.format,'gif');assert.equal(manifest.subject_policy,'subject-only');
  assert.deepEqual(manifest.deliverables,['animation.gif']);
  await run(process.execPath,[script,'--run',join(directory,'runs/default')],{cwd:directory});
  await run(process.execPath,[...args,'--out',join(directory,'runs/static'),'--format','png'],{cwd:directory});
  const internal=JSON.parse(await readFile(join(directory,'runs/static/manifest.json')));
  assert.equal(internal.format,'png');assert.deepEqual(internal.deliverables,[]);
  const list=join(directory,'images.json');await writeFile(list,JSON.stringify([{input:'subject.png'},{input:'subject.png'}]));
  await run(process.execPath,[script,'--images',list,'--designs',pairDesigns,'--representation','irregular-shapes','--width','96','--columns','12','--out',join(directory,'runs/multi')],{cwd:directory});
  assert.equal(JSON.parse(await readFile(join(directory,'runs/multi/checks.json'))).frames,270);
  await assert.rejects(run(process.execPath,[...args,'--out','../escape'],{cwd:directory}),/Output/);
  await assert.rejects(run(process.execPath,[...args,'--out',join(directory,'runs/default')],{cwd:directory}));
  await writeFile(join(directory,'runs/default/manifest.json'),JSON.stringify({...manifest,deliverables:['animation.gif','image-1.png']}));
  await assert.rejects(run(process.execPath,[script,'--run',join(directory,'runs/default')],{cwd:directory}),/only the GIF/);
  await writeFile(join(directory,'runs/default/manifest.json'),JSON.stringify(manifest));
  await writeFile(join(directory,'runs/default/animation.gif'),await sharp(cutout.png).gif().toBuffer());
  await assert.rejects(run(process.execPath,[script,'--run',join(directory,'runs/default')],{cwd:directory}),/Hash mismatch/);
  assert.equal(JSON.parse(await readFile(join(directory,'runs/default/checks.json'))).status,'fail');
});

test('each authored design controls its compact geometry while retaining the same final mosaic',async()=>{
  const scene=await createShapes(subject,options);
  const first=makeAnimation([scene],[vertical]);
  const second=makeAnimation([scene],[{...horizontal,image_index:1}]);
  assert.notEqual(sha256(renderFrame(first,0)),sha256(renderFrame(second,0)));
  assert.ok(renderFrame(first,3.4).equals(renderFrame(second,3.4)));
  assert.throws(()=>makeAnimation([scene]),/one independently authored design/);
  assert.throws(()=>validateDesigns([vertical],2),/one independently authored design/);
  assert.throws(()=>validateDesigns([horizontal],1),/order/);
  assert.throws(()=>validateDesigns([{...vertical,reason:''}],1),/rationale/);
  assert.throws(()=>validateDesigns([{...vertical,parts:[{...vertical.parts[0],polygon:[[0,0],[1,0],[2,1]]}]}],1),/normalized/);
  assert.throws(()=>validateDesigns([{...vertical,parts:[{...vertical.parts[0],source_region:[.9,0,.2,.5]}]}],1),/inside/);
  assert.throws(()=>makeAnimation([scene],[{...vertical,parts:[{...vertical.parts[0],source_region:[0,0,.01,.01]}]}]),/own image/);
});

test('CLI requires per-image model designs before creating output',async()=>{
  const run=promisify(execFile),script=fileURLToPath(new URL('../scripts/animate.mjs',import.meta.url));
  const target=join(directory,'runs/missing-designs');
  const args=[script,'--input',subject,'--representation','irregular-shapes','--width','96','--columns','12','--out',target];
  await assert.rejects(run(process.execPath,args),/requires --designs/);
  await assert.rejects(access(target),/ENOENT/);
  await assert.rejects(run(process.execPath,[...args,'--designs',pairDesigns]),/one independently authored design/);
  await assert.rejects(access(target),/ENOENT/);
});

test('resolution tiers increase real canvas and sampling detail, with the current medium as default',async()=>{
  const run=promisify(execFile),script=fileURLToPath(new URL('../scripts/animate.mjs',import.meta.url));
  let previousCells=0;
  for(const [level,width,columns] of [['low',512,64],['medium',896,128],['high',1536,256]]){
    const target=join(directory,`runs/resolution-${level}`);
    await run(process.execPath,[script,'--input',subject,'--representation','irregular-shapes','--format','png','--resolution',level,'--out',target],{cwd:directory});
    const manifest=JSON.parse(await readFile(join(target,'manifest.json')));
    const [scene]=JSON.parse(await readFile(join(target,'scenes.json')));
    const metadata=await sharp(join(target,'image-1.png')).metadata();
    assert.equal(manifest.skill.id,'mosaic-digital-art');
    assert.deepEqual(manifest.resolution,{level,width,height:width,columns});
    assert.equal(metadata.width,width);assert.equal(metadata.height,width);
    assert.equal(scene.columns,columns);assert.ok(scene.cells.length>previousCells);previousCells=scene.cells.length;
    assert.deepEqual(scene.cells.find(cell=>cell.alpha===255).rgb,[239,141,55]);
  }
  await run(process.execPath,[script,'--input',subject,'--representation','characters','--format','png','--out',join(directory,'runs/default-resolution')],{cwd:directory});
  assert.deepEqual(JSON.parse(await readFile(join(directory,'runs/default-resolution/manifest.json'))).resolution,
    {level:'medium',width:896,height:896,columns:128});
  const target=join(directory,'runs/resolution-low/manifest.json');
  const manifest=JSON.parse(await readFile(target));manifest.resolution.level='high';
  await writeFile(target,JSON.stringify(manifest));
  await assert.rejects(run(process.execPath,[script,'--run',join(directory,'runs/resolution-low')],{cwd:directory}),/Resolution metadata/);
});

test('invalid tiers, conflicting overrides and oversized sequences fail before creating output',async()=>{
  assert.throws(()=>resolveResolution({resolution:'ultra'}),/low, medium or high/);
  assert.throws(()=>resolveResolution({resolution:'high',width:512}),/Use --resolution or/);
  assert.throws(()=>resolveResolution({width:96,columns:32}),/6 pixels per column/);
  assert.deepEqual(resolveResolution({width:192,columns:24}),{level:'custom',width:192,height:192,columns:24});
  const run=promisify(execFile),script=fileURLToPath(new URL('../scripts/animate.mjs',import.meta.url));
  const list=join(directory,'too-many-high.json');
  await writeFile(list,JSON.stringify(Array(4).fill({input:'subject.png'})));
  await assert.rejects(run(process.execPath,[script,'--images',list,'--representation','irregular-shapes','--resolution','high','--out',join(directory,'runs/over-budget')],{cwd:directory}),/Selected resolution exceeds/);
  await assert.rejects(access(join(directory,'runs/over-budget')),/ENOENT/);
});

test('new scenes use the mosaic identity and retired style identifiers are rejected',async()=>{
  const shapes=await createShapes(subject,options),characters=await createScene(subject,options);
  assert.equal(shapes.style,'mosaic-digital-art');assert.equal(characters.style,'mosaic-digital-art');
  const shapePNG=await encodeShapes(shapes),characterPNG=await encode(characters);
  shapes.style='binary-digital-art';characters.style='binary-digital-art';
  await assert.rejects(verifyShapes(shapes,shapePNG),/Unsupported shape style/);
  await assert.rejects(verify(characters,characterPNG),/Unsupported glyph representation/);
});
