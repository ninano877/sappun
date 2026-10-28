// Shared previews for place attachments and the trip library.
const TravelMedia = (()=>{
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function web(value){try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url:null;}catch{return null;}}
  function preview(url,name,type=''){
    const href=esc(url),label=esc(name),path=String(url).startsWith('blob:')?String(name):String(url).split(/[?#]/)[0];
    if(type.startsWith('image/')||/\.(png|jpe?g|webp|gif|avif|svg)$/i.test(path))return '<img class="media-image" src="'+href+'" alt="'+label+'" loading="lazy" referrerpolicy="no-referrer" />';
    if(type==='application/pdf'||/\.pdf$/i.test(path))return '<object class="media-pdf" data="'+href+'" type="application/pdf" aria-label="'+label+' PDF 미리보기"><a href="'+href+'" target="_blank" rel="noopener">PDF 열기 ↗</a></object>';
    if(type.startsWith('video/')||/\.(mp4|webm|mov)$/i.test(path))return '<video class="media-video" controls preload="metadata" src="'+href+'"></video>';
    if(type.startsWith('audio/')||/\.(mp3|wav|ogg)$/i.test(path))return '<audio controls preload="none" src="'+href+'"></audio>';
    return '';
  }
  function mapHost(url){const host=url.hostname.replace(/^www\./,'');return host==='maps.app.goo.gl'||/^maps\.google\.[a-z.]+$/.test(host)||(host==='goo.gl'&&url.pathname.startsWith('/maps'))||(/^google\.[a-z.]+$/.test(host)&&url.pathname.startsWith('/maps'));}
  function embedSource(url,options={}){
    const host=url.hostname.replace(/^www\./,''),path=url.pathname;
    if(mapHost(url)){
      if(/^\/maps\/embed(?:\/|$)/.test(path))return {url:url.href,type:'map'};
      const cid=url.searchParams.get('cid');if(/^\d+$/.test(cid||''))return {url:'https://www.google.com/maps?cid='+cid+'&output=embed',type:'map'};
      let query=url.searchParams.get('query')||url.searchParams.get('q')||url.searchParams.get('destination')||url.searchParams.get('ll'),place=path.match(/\/place\/([^/]+)/),coordinates=path.match(/@(-?[\d.]+),(-?[\d.]+)/);
      if(!query&&place){try{query=decodeURIComponent(place[1]).replace(/\+/g,' ');}catch{}}
      if(!query&&coordinates)query=coordinates[1]+','+coordinates[2];
      const contextual=!query&&!!options.mapQuery;if(!query)query=options.mapQuery;
      return query?{url:'https://www.google.com/maps?q='+encodeURIComponent(query)+'&output=embed',type:'map',contextual}:null;
    }
    if(['youtube.com','m.youtube.com','youtu.be','youtube-nocookie.com'].includes(host)){
      const id=host==='youtu.be'?path.split('/')[1]:url.searchParams.get('v')||path.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1];
      return /^[a-zA-Z0-9_-]{11}$/.test(id||'')?{url:'https://www.youtube-nocookie.com/embed/'+id,type:'video'}:null;
    }
    if(host==='drive.google.com'){
      const id=path.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)?.[1]||url.searchParams.get('id');
      return /^[a-zA-Z0-9_-]+$/.test(id||'')?{url:'https://drive.google.com/file/d/'+id+'/preview',type:'document'}:null;
    }
    if(host==='vimeo.com'&&/^\/\d+$/.test(path))return {url:'https://player.vimeo.com/video'+path,type:'video'};
    if(/\.(zip|docx?|xlsx?|pptx?)$/i.test(path))return null;
    return {url:url.href,type:'webpage'};
  }
  function link(value,title='',options={}){
    const url=web(value);if(!url)return '';
    const host=url.hostname.replace(/^www\./,''),isMaps=mapHost(url);
    let name=String(title||'').trim();if(!name&&isMaps){const place=url.pathname.match(/\/place\/([^/]+)/);try{name=place?decodeURIComponent(place[1]).replace(/\+/g,' '):'구글 지도';}catch{name='구글 지도';}}
    if(!name){try{const tail=decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1)||'').replace(/[-_]/g,' ');name=tail&&!/^[\d?=&]+$/.test(tail)?tail.slice(0,70):host;}catch{name=host;}}
    const href=esc(url.href),label=esc(name||host),site=isMaps?'Google Maps':host;
    const header='<a class="media-link-card link-mention-card" href="'+href+'" target="_blank" rel="noopener"><span class="link-site-icon" aria-hidden="true">'+(isMaps?'📍':'🔗')+'</span><span class="link-mention-text"><b>'+label+'</b><small>'+esc(site)+'</small></span><span class="link-open-arrow" aria-hidden="true">↗</span></a>';
    const media=preview(url.href,name||host),embed=media?null:embedSource(url,options),mention=options.mode==='mention';
    const frame=embed&&!mention?'<div class="restored-link-preview '+embed.type+'-preview"><iframe class="media-frame" src="'+esc(embed.url)+'" title="'+label+' 미리보기" loading="lazy" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation" referrerpolicy="strict-origin-when-cross-origin" allow="fullscreen; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>':'';
    const toggle=(media||embed)?'<button type="button" class="link-preview-mode" data-media-mode="'+(mention?'preview':'mention')+'">'+(mention?'미리보기 다시 보기':'미리보기가 안 보이면 멘션으로 보기')+'</button>':'';
    return '<figure class="media-preview '+(!mention&&(media||frame)?'has-link-preview':'link-mention')+'">'+(!mention?media+frame:'')+(embed?.contextual&&!mention?'<small class="map-preview-context">연결된 장소 기준 지도</small>':'')+header+toggle+'</figure>';
  }
  function file(file,url){
    if(!String(url).startsWith('blob:')&&!web(url))return '';
    const name=esc(file.name),media=preview(url,file.name,file.blob?.type||'');
    return '<figure class="media-preview attachment-preview">'+(media||'<div class="file-placeholder"><span>📄</span><b>'+name+'</b><small>이 형식은 파일을 열어 확인해 주세요.</small></div>')+'<figcaption><span>'+name+'</span><a href="'+esc(url)+'" target="_blank" rel="noopener" download="'+name+'">열기·저장 ↗</a></figcaption></figure>';
  }
  return {web,link,file,embedSource};
})();
if(typeof document!=='undefined')document.addEventListener('error',event=>{
  const media=event.target;if(!media.matches?.('.media-image,.media-video,.media-pdf,audio'))return;
  const card=media.closest('.media-preview');if(!card)return;
  media.remove();card.classList.add('link-mention');
},true);
if(typeof module!=='undefined')module.exports=TravelMedia;
