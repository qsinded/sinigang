// Registers the offline cache. Kept out of app.js so a browser without service workers (or a page
// opened straight from a file) never touches anything the app needs to boot.
(function () {
  if (!('serviceWorker' in navigator)) return;
  // Service workers need http(s); file:// and some html viewers throw or silently do nothing.
  if (!/^https?:$/.test(location.protocol)) return;
  // The first visit is loaded by the network, so a brand-new worker taking control needs no reload;
  // only a worker that replaces an existing one does.
  var hadController = !!navigator.serviceWorker.controller, done = false;
  addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').catch(function () { /* offline mode is best effort */ });
  });
  // A newer worker took over after a deploy: reload once, so the page is never a mix of old and new
  // scripts. The guard stops a reload loop when the browser restores the page from the back/forward cache.
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (done || !hadController) return;
    done = true;
    location.reload();
  });
})();
