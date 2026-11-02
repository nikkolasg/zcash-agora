// Marks the current page in the navigation; paths are relative to the page's <base>.
(function () {
  var base = new URL(document.baseURI).pathname;
  var here = location.pathname.replace(/index\.html$/, '');
  document.querySelectorAll('nav.main a').forEach(function (a) {
    var p = new URL(a.getAttribute('href'), document.baseURI).pathname.replace(/index\.html$/, '');
    if (p === here || (p !== base && here.indexOf(p) === 0)) a.setAttribute('aria-current', 'page');
  });
})();
