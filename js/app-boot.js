/* Load js/app.js.gz.b64 (gzip+base64) then run. Fallback: plain app.js if present. */
(function () {
  function fail(e) { console.error('app boot', e); var t=document.getElementById('toast'); if(t){t.hidden=false;t.textContent='App failed to load';} }
  function run(code) { (0, eval)(code); }
  function gunzip(buf) {
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('no gzip'));
    return new Response(new Response(buf).body.pipeThrough(new DecompressionStream('gzip'))).text();
  }
  function b64ToBuf(t) {
    var bin = atob(t.replace(/\s/g, '')), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  fetch('js/app.js.gz.b64', { cache: 'no-store' }).then(function (r) {
    if (!r.ok) throw new Error('b64 ' + r.status);
    return r.text().then(function (t) { return gunzip(b64ToBuf(t)); }).then(run);
  }).catch(function () {
    return fetch('js/app.js', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('app.js ' + r.status);
      return r.text().then(run);
    });
  }).catch(fail);
})();
