(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SiftWheelGeometry=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const point=(r,a)=>({x:200+r*Math.cos(a*Math.PI/180),y:200+r*Math.sin(a*Math.PI/180)});
 const xy=p=>`${p.x.toFixed(3)} ${p.y.toFixed(3)}`;
 function sector(index,count,outer=176,inner=72,corner=13){
  const step=360/count,gap=1.4,start=-90+index*step-step/2+gap,end=start+step-gap*2;
  const od=corner/outer*180/Math.PI,id=corner/inner*180/Math.PI;
  return `M ${xy(point(outer-corner,start))} Q ${xy(point(outer,start))} ${xy(point(outer,start+od))} A ${outer} ${outer} 0 0 1 ${xy(point(outer,end-od))} Q ${xy(point(outer,end))} ${xy(point(outer-corner,end))} L ${xy(point(inner+corner,end))} Q ${xy(point(inner,end))} ${xy(point(inner,end-id))} A ${inner} ${inner} 0 0 0 ${xy(point(inner,start+id))} Q ${xy(point(inner,start))} ${xy(point(inner+corner,start))} Z`;
 }
 function imageTargets(extension='jpeg'){
  let ext=String(extension).toLowerCase().replace(/^\./,'');
  if(ext==='jpg')ext='jpeg';if(ext==='tif')ext='tiff';if(ext==='heif')ext='heic';
  const all=[['png','PNG'],['jpeg','JPG'],['webp','WEBP'],['heic','HEIC'],['gif','GIF'],['avif','AVIF'],['bmp','BMP'],['pdf','PDF'],['docx','DOCX']].filter(([id])=>id!==ext);
  return {outer:all.slice(0,8),center:all.length>8?all[8][0]:'tiff'};
 }
 const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
 function adjustSelection(start,handle,dx,dy,bounds,ratio=0){
  if(handle==='move')return {...start,left:Math.round(clamp(start.left+dx,0,bounds.width-start.width)),top:Math.round(clamp(start.top+dy,0,bounds.height-start.height))};
  const west=handle.includes('w'),east=handle.includes('e'),north=handle.includes('n'),south=handle.includes('s');
  let left=start.left,top=start.top,right=left+start.width,bottom=top+start.height;
  if(!ratio){
   if(west)left=clamp(left+dx,0,right-1);if(east)right=clamp(right+dx,left+1,bounds.width);
   if(north)top=clamp(top+dy,0,bottom-1);if(south)bottom=clamp(bottom+dy,top+1,bounds.height);
   return {left:Math.round(left),top:Math.round(top),width:Math.max(1,Math.round(right-left)),height:Math.max(1,Math.round(bottom-top))};
  }
  const horizontal=west||east,vertical=north||south,cx=left+start.width/2,cy=top+start.height/2;
  let width=start.width+(west?-dx:east?dx:0),height=start.height+(north?-dy:south?dy:0);
  if(!horizontal||(vertical&&Math.abs(dy)*ratio>Math.abs(dx)))width=height*ratio;
  const maxWidth=horizontal?(west?right:bounds.width-left):2*Math.min(cx,bounds.width-cx);
  const maxHeight=vertical?(north?bottom:bounds.height-top):2*Math.min(cy,bounds.height-cy);
  width=clamp(width,1,Math.min(maxWidth,maxHeight*ratio));height=width/ratio;
  left=horizontal?(west?right-width:left):cx-width/2;
  top=vertical?(north?bottom-height:top):cy-height/2;
  return {left:Math.round(left),top:Math.round(top),width:Math.max(1,Math.round(width)),height:Math.max(1,Math.round(height))};
 }
 return {point,sector,imageTargets,adjustSelection};
});
