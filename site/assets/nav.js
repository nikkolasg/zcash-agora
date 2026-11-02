// Marks the current page in the navigation and keeps the theme toggle, nothing else.
(function () {
  var here = location.pathname.replace(/index\.html$/, '');
  document.querySelectorAll('nav.main a').forEach(function (a) {
    var p = a.getAttribute('href').replace(/index\.html$/, '');
    if (p === here || (p !== '/' && here.indexOf(p) === 0)) a.setAttribute('aria-current', 'page');
  });
})();
