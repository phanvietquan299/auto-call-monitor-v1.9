/* Apply before paint. Only a display preference is persisted; no server requests. */
(function(){
 const key='fs-automation-theme',media=window.matchMedia('(prefers-color-scheme: dark)');
 let choice=null;
 try{const value=localStorage.getItem(key);if(value==='dark'||value==='light')choice=value;}catch(_){}
 function apply(){
  const dark=(choice|| (media.matches?'dark':'light'))==='dark';
  document.documentElement.dataset.theme=dark?'dark':'light';
  const button=document.getElementById('theme-toggle');
  if(button){button.textContent=dark?'☀ Light':'☾ Dark';button.setAttribute('aria-pressed',String(dark));button.setAttribute('aria-label',dark?'Chuyển sang chế độ sáng':'Chuyển sang chế độ tối');}
 }
 function bind(){const button=document.getElementById('theme-toggle');if(button)button.addEventListener('click',()=>{choice=document.documentElement.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem(key,choice);}catch(_){}apply();});apply();}
 apply();if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
 media.addEventListener?.('change',()=>{if(!choice)apply();});
 window.addEventListener('storage',event=>{if(event.key===key){choice=['dark','light'].includes(event.newValue)?event.newValue:null;apply();}});
})();
