import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { createScene, encode, hasGlyph, rasterize, reserveOutput, resolveRun, sha256, validateScene, VERSION, STYLE } from './render.mjs';
import { createShapes, encodeShapes, rasterizeShapes, verifyShapes } from './shapes.mjs';
import { glyphForCell } from './glyphs.mjs';
import { verify } from './verify.mjs';
import { extractSubject } from './subject.mjs';
import { validateDesigns, makeCompactTracks } from './design.mjs';

export const FPS = 25;
const CYCLE_SECONDS = 5.4, FRAMES_PER_IMAGE = CYCLE_SECONDS * FPS;
const HOLD_START = 3, HOLD_END = 4;
const MAX_ANIMATION_PIXELS = 1_000_000_000;
export const RESOLUTIONS = Object.freeze({
  low: Object.freeze({ width:512, columns:64 }),
  medium: Object.freeze({ width:896, columns:128 }),
  high: Object.freeze({ width:1536, columns:256 }),
});

export function resolveResolution({resolution, width, columns} = {}) {
  assert.ok(resolution === undefined || Object.hasOwn(RESOLUTIONS,resolution), '--resolution must be low, medium or high');
  const custom = width !== undefined || columns !== undefined;
  assert.ok(!resolution || !custom, 'Use --resolution or custom --width/--columns');
  const preset = RESOLUTIONS[resolution ?? 'medium'];
  width = Number(width ?? preset.width);
  columns = Number(columns ?? Math.min(preset.columns,Math.floor(width/6)));
  assert.ok(Number.isInteger(width) && width>=96 && width<=1536, 'width must be 96..1536');
  assert.ok(Number.isInteger(columns) && columns>=8 && columns<=256 && width>=columns*6, 'columns must be 8..256 with at least 6 pixels per column');
  return {level:custom?'custom':resolution??'medium',width,height:width,columns};
}

const animationFrames = count => FRAMES_PER_IMAGE*count;
function checkAnimationBudget(width,height,frames) {
  assert.ok(width*height*frames<=MAX_ANIMATION_PIXELS,
    'Selected resolution exceeds the animation pixel budget; confirm fewer images or a lower resolution before rendering');
}
const smooth = value => { const x = Math.max(0, Math.min(1, value)); return x * x * x * (x * (x * 6 - 15) + 10); };
const mix = (a, b, t) => t===0?a:t===1?b:a+(b-a)*t;
const random = (id, salt, seed) => {
  let x = (id ^ salt ^ seed) >>> 0;
  x = Math.imul(x ^ x >>> 16, 0x45d9f3b); x = Math.imul(x ^ x >>> 16, 0x45d9f3b);
  return ((x ^ x >>> 16) >>> 0) / 4294967296;
};
const isShape = scene => scene.representation === 'irregular-shapes';
const finalPixels = scene => isShape(scene) ? rasterizeShapes(scene) : rasterize(scene);
const finalPNG = scene => isShape(scene) ? encodeShapes(scene) : encode(scene);
const checkFinal = (scene, png) => isShape(scene) ? verifyShapes(scene, png) : verify(scene, png);

// A spatial ordering keeps neighbouring particles together while every slot keeps its identity.
function morton(x, y) {
  let value = 0;
  for (let bit = 0; bit < 10; bit++) value |= ((x >> bit) & 1) << (bit * 2) | ((y >> bit) & 1) << (bit * 2 + 1);
  return value;
}

export function makeAnimation(scenes, designInput) {
  assert.ok(scenes.length > 0, 'At least one subject is required');
  const { width, height, seed } = scenes[0];
  const representation = isShape(scenes[0]) ? 'irregular-shapes' : 'characters';
  const layouts = scenes.map(scene => {
    if (isShape(scene)) rasterizeShapes(scene); else validateScene(scene);
    assert.equal(scene.width, width); assert.equal(scene.height, height);
    assert.equal(isShape(scene) ? 'irregular-shapes' : 'characters', representation);
    if (representation === 'characters') assert.equal(scene.charset ?? 'binary', scenes[0].charset ?? 'binary', 'One character set is required for the sequence');
    assert.deepEqual(scene.background_rgba, [0,0,0,0], 'Subject animation requires transparent canvas');
    return scene.cells.flatMap((cell, index) => {
      if (cell.alpha === 0 || cell.visible === false || (!isShape(scene) && !hasGlyph(scene, cell))) return [];
      const col = index % scene.columns, row = Math.floor(index / scene.columns);
      const x = (col + .5) * width / scene.columns, y = (row + .5) * height / scene.rows;
      return [{ index, x: isShape(scene) ? x : Math.floor(x - 2.5 * scene.pixel_size) + 2.5 * scene.pixel_size,
        y: isShape(scene) ? y : Math.floor(y - 3.5 * scene.pixel_size) + 3.5 * scene.pixel_size,
        rgb: cell.rgb, alpha: cell.alpha, order: morton(Math.floor(col * 1024 / scene.columns), Math.floor(row * 1024 / scene.rows)),
        ...(isShape(scene) ? { points: cell.points.map(([px,py]) => [(px - .5) * width / scene.columns, (py - .5) * height / scene.rows]) }
          : { glyph: glyphForCell(scene, cell), size: scene.pixel_size, char: cell.char }),
      }];
    }).sort((a,b) => a.order - b.order);
  });
  assert.ok(layouts.every(items => items.length > 0), 'Each subject must contain visible elements');
  const pool = Math.max(...layouts.map(items => items.length));
  const frames = animationFrames(scenes.length);
  checkAnimationBudget(width,height,frames);
  const tracks = layouts.map(items => {
    const slots = Array(pool).fill(null);
    items.forEach((item, i) => { slots[items.length === 1 ? 0 : Math.round(i * (pool - 1) / (items.length - 1))] = item; });
    return slots;
  });
  const designs=validateDesigns(designInput,scenes.length),compact_tracks=makeCompactTracks(tracks,scenes,designs);
  return { schema_version: 2, representation, width, height, seed, fps: FPS, frames, duration_seconds: frames / FPS,
    pool_count: pool, layout_counts: layouts.map(items => items.length), mapping: 'morton-rank-v1',
    final_times: scenes.map((_,i)=>i*CYCLE_SECONDS+3.4),designs,compact_tracks,scenes,tracks };
}

function phaseAt(animation, time) {
  const count = animation.scenes.length;
  time=Math.max(0,time)%animation.duration_seconds;
  const from=Math.min(count-1,Math.floor(time/CYCLE_SECONDS)),local=time-from*CYCLE_SECONDS;
  if(local<HOLD_START)return {kind:'intro',target:from,time:local};
  if(local<HOLD_END)return {kind:'hold',target:from};
  // Start contraction on its first frame, immediately after the 25-frame hold.
  const contraction=Math.max(0,Math.min(1,(local-HOLD_END+1/FPS)/1.2));
  return {kind:'compact',from,target:(from+1)%count,progress:1-(1-contraction)**3};
}

function paint(pixels, offset, rgb, alpha) {
  const oldAlpha = pixels[offset + 3] / 255, a = alpha / 255, result = a + oldAlpha * (1 - a);
  if (result === 0) return;
  for (let c = 0; c < 3; c++) pixels[offset + c] = Math.round((rgb[c] * a + pixels[offset + c] * oldAlpha * (1 - a)) / result);
  pixels[offset + 3] = Math.round(result * 255);
}

function polygon(pixels, width, height, points, rgb, alpha) {
  const minY = Math.max(0, Math.ceil(Math.min(...points.map(p => p[1])) - .5));
  const maxY = Math.min(height, Math.ceil(Math.max(...points.map(p => p[1])) - .5));
  for (let y = minY; y < maxY; y++) {
    const crossings = [], scan = y + .5;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi,yi] = points[i], [xj,yj] = points[j];
      if ((yi > scan) !== (yj > scan)) crossings.push((xj - xi) * (scan - yi) / (yj - yi) + xi);
    }
    crossings.sort((a,b) => a-b);
    for (let i = 0; i + 1 < crossings.length; i += 2)
      for (let x = Math.max(0, Math.ceil(crossings[i] - .5)); x < Math.min(width, Math.ceil(crossings[i+1] - .5)); x++)
        paint(pixels, (y * width + x) * 4, rgb, alpha);
  }
}

export function renderFrame(animation, time) {
  const { width, height, seed, tracks, pool_count: count } = animation;
  const phase = phaseAt(animation, time);
  if (phase.kind === 'hold') return finalPixels(animation.scenes[phase.target]);
  const pixels = Buffer.alloc(width * height * 4);
  for (let id = 0; id < count; id++) {
    const r = random(id, 101, seed), angle = random(id, 23, seed) * Math.PI * 2;
    const core=animation.compact_tracks[phase.target][id];
    let target = tracks[phase.target][id], source, x, y, scale = 1, rgb, alpha;
    if (phase.kind === 'compact') {
      source = tracks[phase.from][id];
      if (!source && !target) continue;
      const t = phase.progress, arc = Math.sin(Math.PI * t) * width * .055;
      x = mix(source?.x ?? core.x, core?.x ?? source.x, t) + Math.sin(r * 30) * arc;
      y = mix(source?.y ?? core.y, core?.y ?? source.y, t) + Math.cos(r * 37) * arc;
      scale = mix(source ? 1 : 0, core?.scale??0, t);
      const a = source ?? target, b = target ?? source;
      const end=core??source;
      rgb = a.rgb.map((v,c) => Math.round(mix(v,end.rgb[c],t))); alpha = mix(a.alpha,end.alpha,t);
      if (animation.representation === 'irregular-shapes') target = { ...b, points: a.points.map((p,i) => p.map((v,c) => mix(v,b.points[i][c],t))) };
      else target = t < .5 ? a : b;
    } else {
      if (!target) continue;
      const k = Math.max(0,Math.min(1,(phase.time-.4-r*.08)/.52)), burst = 1-(1-k)**3;
      const gather = smooth((phase.time-.8-r*.16)/2.04), blast = (.035+Math.sqrt(random(id,79,seed))*.55)*width;
      x = mix(mix(core.x,width/2+Math.cos(angle+.12)*blast,burst),target.x,gather)+Math.sin(r*30+gather*3)*Math.sin(Math.PI*gather)*width*.05;
      y = mix(mix(core.y,height/2+Math.sin(angle+.12)*blast,burst),target.y,gather)+Math.cos(r*37+gather*3)*Math.sin(Math.PI*gather)*width*.05;
      scale = mix(mix(core.scale,.9,burst),1,gather);
      rgb=core.rgb.map((v,c)=>Math.round(mix(v,target.rgb[c],gather)));alpha=mix(core.alpha,target.alpha,gather);
    }
    if (scale <= 0 || alpha <= 0) continue;
    if (animation.representation === 'irregular-shapes') {
      polygon(pixels,width,height,target.points.map(([px,py]) => [x+px*scale,y+py*scale]),rgb,alpha);
    } else {
      const size = target.size * scale;
      for (let gy=0;gy<7;gy++) for (let gx=0;gx<5;gx++) if (target.glyph[gy][gx] === '1') {
        const x0 = Math.round(x+(gx-2.5)*size), x1 = Math.round(x+(gx-1.5)*size);
        const y0 = Math.round(y+(gy-3.5)*size), y1 = Math.round(y+(gy-2.5)*size);
        for (let py=Math.max(0,y0);py<Math.min(height,y1);py++) for (let px=Math.max(0,x0);px<Math.min(width,x1);px++)
          paint(pixels,(py*width+px)*4,rgb,alpha);
      }
    }
  }
  return pixels;
}

export async function encodeAnimation(animation, onProgress = () => {}) {
  const pngs = [];
  for (let frame=0;frame<animation.frames;frame++) {
    pngs.push(await sharp(renderFrame(animation,frame/FPS), { raw: { width: animation.width, height: animation.height, channels: 4 } }).png().toBuffer());
    if (frame % 50 === 0) onProgress(frame,animation.frames);
  }
  return sharp(pngs, { join: { animated: true }, limitInputPixels: MAX_ANIMATION_PIXELS })
    .gif({ loop:0, delay:Array(animation.frames).fill(40), colours:256, dither:0, effort:1, keepDuplicateFrames:true }).toBuffer();
}

export async function verifyAnimation(animation, gif) {
  const rebuilt = makeAnimation(animation.scenes,animation.designs);
  assert.deepEqual(animation,rebuilt,'Animation tracks differ from the declared subjects');
  const metadata = await sharp(gif,{animated:true,limitInputPixels:MAX_ANIMATION_PIXELS}).metadata();
  assert.equal(metadata.format,'gif'); assert.equal(metadata.width,animation.width); assert.equal(metadata.pageHeight,animation.height);
  assert.equal(metadata.pages,animation.frames); assert.equal(metadata.loop,0);
  assert.ok(metadata.delay.every(delay=>delay===40),'GIF frame timing mismatch');
  assert.equal(metadata.delay.reduce((total,delay)=>total+delay,0),animation.frames*1000/FPS,'GIF duration mismatch');
  assert.ok(renderFrame(animation,0).equals(renderFrame(animation,animation.duration_seconds)),'Loop geometry mismatch');
  const decode = page => sharp(gif,{page}).ensureAlpha().raw().toBuffer();
  assert.ok((await decode(0)).equals(await decode(animation.frames-1)),'GIF loop endpoint mismatch');
  const checkpoints=animation.scenes.flatMap((_,i)=>[0,15,24,50,75,87,99,114].map(frame=>i*FRAMES_PER_IMAGE+frame));
  for (const frame of checkpoints) {
    const expected=renderFrame(animation,frame/FPS), actual=await decode(frame);
    let visible=0,error=0;
    for(let i=0;i<actual.length;i+=4){
      assert.equal(actual[i+3]>0,expected[i+3]>=128,'GIF transparency differs from the polygon/character layer');
      if(actual[i+3]) {visible++;for(let c=0;c<3;c++)error+=Math.abs(actual[i+c]-expected[i+c]);}
    }
    assert.ok(visible>0,'GIF frame is empty');
    assert.ok(error/(visible*3)<12,'GIF colours differ excessively from sampled colours');
  }
  return {status:'pass',format:'GIF',representation:animation.representation,frames:metadata.pages,fps:FPS,duration_seconds:animation.duration_seconds,
    seconds_per_image:CYCLE_SECONDS,final_hold_seconds:Math.round((HOLD_END-HOLD_START)*FPS)/FPS,
    infinite_loop:true,loop_endpoint_equality:true,fixed_particle_pool:animation.pool_count,layout_counts:animation.layout_counts,checked_frames:checkpoints,
    compact_designs:animation.designs.map(d=>({image_index:d.image_index,label:d.label,reason:d.reason})),
    colour_note:'GIF uses 256 colours and binary alpha; PNG and scenes retain sampled RGB and alpha.',visual_review:'not_run'};
}

async function verifyRun(run) {
  const directory=await resolveRun(run);
  const manifest=JSON.parse(await readFile(resolve(directory,'manifest.json')));
  try {
    assert.deepEqual(manifest.deliverables,manifest.format==='gif'?['animation.gif']:[],'Final deliverables must contain only the GIF');
    for(const output of manifest.outputs){
      assert.ok(/^[a-z0-9.-]+$/.test(output.path),'Invalid output path');
      assert.equal(sha256(await readFile(resolve(directory,output.path))),output.sha256,`Hash mismatch: ${output.path}`);
    }
    const scenes=JSON.parse(await readFile(resolve(directory,'scenes.json')));
    if(manifest.resolution) {
      const selection=manifest.resolution;
      const expected=selection.level==='custom'?resolveResolution({width:selection.width,columns:selection.columns}):resolveResolution({resolution:selection.level});
      assert.deepEqual(selection,expected,'Resolution metadata differs from selected tier');
      for(const scene of scenes) for(const key of ['width','height','columns']) assert.equal(scene[key],expected[key],'Scene differs from selected resolution');
    }
    const finals=[];
    for(let i=0;i<scenes.length;i++) finals.push(await checkFinal(scenes[i],await readFile(resolve(directory,`image-${i+1}.png`))));
    let report={status:'pass',format:'PNG'};
    if(manifest.format==='gif'){
      const animation=JSON.parse(await readFile(resolve(directory,'animation.json')));
      assert.deepEqual(animation.scenes,scenes,'Animation subjects differ from the final mosaics');
      assert.deepEqual(animation.designs,manifest.designs,'Animation designs differ from the per-image manifest');
      report=await verifyAnimation(animation,await readFile(resolve(directory,'animation.gif')));
    }
    report.final_frames=finals;report.deliverables=manifest.deliverables;
    if(manifest.resolution) report.resolution=manifest.resolution;
    await writeFile(resolve(directory,'checks.json'),JSON.stringify(report,null,2)+'\n');
    manifest.status='structure_passed_pending_visual_review';
    await writeFile(resolve(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    return report;
  } catch(error) {
    await writeFile(resolve(directory,'checks.json'),JSON.stringify({status:'fail',reason:error.message})+'\n');
    manifest.status='verification_failed'; await writeFile(resolve(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    throw error;
  }
}

async function main() {
  const {values}=parseArgs({options:{input:{type:'string'},'subject-mask':{type:'string'},images:{type:'string'},designs:{type:'string'},out:{type:'string'},run:{type:'string'},
    representation:{type:'string'},format:{type:'string',default:'gif'},resolution:{type:'string'},width:{type:'string'},columns:{type:'string'},seed:{type:'string',default:'42'},charset:{type:'string',default:'binary'}}});
  if(values.run){console.log(JSON.stringify(await verifyRun(values.run)));return;}
  assert.ok(['irregular-shapes','characters'].includes(values.representation),'--representation must be chosen by the Agent: irregular-shapes or characters');
  assert.ok(['gif','png'].includes(values.format),'--format must be gif or png');
  assert.ok(values.out && Boolean(values.input)!==Boolean(values.images),'Use --input or --images, and --out');
  let inputs=[{input:values.input,subject_mask:values['subject-mask']}];
  if(values.images){
    assert.ok(!values['subject-mask'],'Put per-image masks in --images JSON');
    assert.ok((await stat(values.images)).size<=128*1024,'Image list is too large');
    inputs=JSON.parse(await readFile(values.images,'utf8'));
    assert.ok(Array.isArray(inputs)&&inputs.length>0,'--images JSON must be a nonempty array');
    inputs=inputs.map(item=>({input:resolve(dirname(values.images),item.input),subject_mask:item.subject_mask?resolve(dirname(values.images),item.subject_mask):undefined}));
  }
  assert.ok(values.format==='gif'||inputs.length===1,'Static PNG requires one input');
  const resolution=resolveResolution(values),{width,columns}=resolution;
  if(values.format==='gif') checkAnimationBudget(width,width,animationFrames(inputs.length));
  let designs;
  if(values.format==='gif'){
    assert.ok(values.designs,'GIF requires --designs with an independently authored compact shape for each image');
    const file=await stat(values.designs);assert.ok(file.isFile()&&file.size<=128*1024,'Design JSON must be a file of at most 128 KiB');
    designs=validateDesigns(JSON.parse(await readFile(values.designs,'utf8')),inputs.length);
  }
  const directory=await reserveOutput(values.out),scenes=[],extractions=[],outputs=[];
  const save=async(name,bytes)=>{await writeFile(resolve(directory,name),bytes,{flag:'wx'});outputs.push({path:name,sha256:sha256(bytes)});};
  for(let i=0;i<inputs.length;i++){
    const extracted=await extractSubject(inputs[i].input,inputs[i].subject_mask,width);
    const name=`subject-${i+1}.png`;await save(name,extracted.png);extractions.push({source:extracted.source,policy:extracted.policy});
    const options={width,columns,seed:Number(values.seed),charset:values.charset,background:'transparent'};
    const scene=values.representation==='irregular-shapes'?await createShapes(resolve(directory,name),options):await createScene(resolve(directory,name),options);
    scenes.push(scene);await save(`image-${i+1}.png`,await finalPNG(scene));
  }
  await save('extraction.json',JSON.stringify(extractions,null,2)+'\n');
  await save('scenes.json',JSON.stringify(scenes)+'\n');
  if(values.format==='gif'){
    const animation=makeAnimation(scenes,designs);await save('animation.json',JSON.stringify(animation)+'\n');
    await save('animation.gif',await encodeAnimation(animation,(frame,total)=>console.log(`Rendered ${frame}/${total} frames`)));
  }
  const manifest={skill:{id:STYLE,version:VERSION},format:values.format,deliverables:values.format==='gif'?['animation.gif']:[],
    designs:designs??null,resolution,representation:values.representation,subject_policy:'subject-only',background:'transparent',
    style_spec_ref:null,outputs,execution:{renderer:'local-node-sharp',renderer_sha256:sha256(await readFile(fileURLToPath(import.meta.url))),node:process.version,sharp:sharp.versions,seed:Number(values.seed)},
    checks_ref:'checks.json',status:'rendered_pending_checks',visual_review:'not_run',user_confirmation:'pending',external_transfers:[],cost:{amount:0,currency:'USD',evidence:'Local rendering; resource costs excluded.'}};
  await writeFile(resolve(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  const report=await verifyRun(directory);console.log(JSON.stringify({directory,...report}));
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
