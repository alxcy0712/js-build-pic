import assert from 'node:assert/strict';

export function validateDesigns(designs, count) {
  assert.ok(Array.isArray(designs) && designs.length===count,'Provide one independently authored design for each image');
  designs.forEach((design,index)=>{
    assert.equal(design.image_index,index+1,'Design order must match image order');
    for(const key of ['label','reason']) assert.ok(typeof design[key]==='string' && design[key].trim().length>0 && design[key].length<=1000,
      'Each design requires its own label and content rationale');
    assert.ok(Array.isArray(design.parts) && design.parts.length>0 && design.parts.length<=16,'Each design requires 1..16 polygon parts');
    for(const part of design.parts){
      assert.ok(Array.isArray(part.polygon) && part.polygon.length>=3 && part.polygon.length<=256
        && part.polygon.every(p=>Array.isArray(p)&&p.length===2&&p.every(v=>Number.isFinite(v)&&v>=0&&v<=1)),
      'Design polygons require normalized points in 0..1');
      assert.ok(Array.isArray(part.source_region)&&part.source_region.length===4&&part.source_region.every(v=>Number.isFinite(v)&&v>=0&&v<=1),
        'Each part requires a source colour region [left,top,width,height]');
      const [x,y,w,h]=part.source_region;
      assert.ok(w>0&&h>0&&x+w<=1&&y+h<=1,'Source colour region must lie inside its subject canvas');
    }
  });
  return structuredClone(designs);
}

function inside(points,x,y) {
  let hit=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const [xi,yi]=points[i],[xj,yj]=points[j];
    if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)hit=!hit;
  }
  return hit;
}

// Geometry is supplied per image by the Agent; this module only samples that design.
export function makeCompactTracks(tracks,scenes,designs) {
  return designs.map((design,index)=>{
    const scene=scenes[index],track=tracks[index],active=track.filter(Boolean);
    const parts=design.parts.map(part=>{
      const [x,y,w,h]=part.source_region;
      const colours=active.filter(c=>c.alpha>=128&&c.x>=x*scene.width&&c.x<(x+w)*scene.width
        &&c.y>=y*scene.height&&c.y<(y+h)*scene.height);
      assert.ok(colours.length>0,'Design colour region must contain visible cells from its own image');
      return {...part,colours};
    });
    const samples=[],grid=64;
    for(let y=0;y<grid;y++)for(let x=0;x<grid;x++){
      const u=(x+.5)/grid,v=(y+.5)/grid;
      const part=parts.findLast(p=>inside(p.polygon,u,v));
      if(part){
        const donor=part.colours[(x*97+y*193+scene.seed)%part.colours.length];
        let order=0;
        for(let bit=0;bit<6;bit++)order|=((x>>bit)&1)<<(bit*2)|((y>>bit)&1)<<(bit*2+1);
        samples.push({u,v,donor,order});
      }
    }
    assert.ok(samples.length>0,'Design polygons must cover a visible area');
    samples.sort((a,b)=>a.order-b.order);
    const minX=Math.min(...samples.map(p=>p.u))-.5/grid,maxX=Math.max(...samples.map(p=>p.u))+.5/grid;
    const minY=Math.min(...samples.map(p=>p.v))-.5/grid,maxY=Math.max(...samples.map(p=>p.v))+.5/grid;
    const fit=.26/Math.max(maxX-minX,maxY-minY),jitter=active.length>samples.length?.65/grid:0;
    const scale=Math.min(.65,.26*Math.sqrt(scene.columns*scene.rows/active.length));
    let rank=0;
    return track.map(cell=>{
      if(!cell)return null;
      const sample=samples[Math.floor(rank++*samples.length/active.length)];
      const dx=(((cell.index*73+scene.seed)%997)/997-.5)*jitter;
      const dy=(((cell.index*151+scene.seed)%991)/991-.5)*jitter;
      return {x:scene.width*(.5+(sample.u-(minX+maxX)/2+dx)*fit),
        y:scene.height*(.5+(sample.v-(minY+maxY)/2+dy)*fit),scale,
        rgb:[...sample.donor.rgb],alpha:sample.donor.alpha,source_index:sample.donor.index};
    });
  });
}
