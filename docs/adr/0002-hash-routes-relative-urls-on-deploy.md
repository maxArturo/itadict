# Hash routes, relative URLs, and a frozen deploy subpath

The app is a static GitHub Pages project site at `https://maxarturo.github.io/itadict/`. It installs
to a home screen and must work offline. So: hash routes only; every URL relative (`./js/app.js`,
never `/itadict/js/app.js`); `.nojekyll` committed at the root; `sw.js` at the root of the
subpath; the subpath fixed from day one.

Routes are fragments: `#/search`, `#/entry/<id>`, `#/text`, `#/reference`, `#/lists`,
`#/study`, `#/settings`. The router reads only the fragment, so the deployed subpath never
reaches it. Screen names may be renamed any day.

Pages offers no rewrites, so a path route 404s on reload. Pages sets no custom headers, so the
service worker is classic, not a module, and serves the shell cache-first. The worker's scope comes
from the path of `sw.js`. Moving that file later makes the installed app a different app: new
scope, cold cache, re-install. Hash routes have no bearing on scope.

**Consequences:** URLs contain a `#`. Pretty paths would need another host, or accepting a 404 on
reload. The `CACHE` constant must be bumped on every deploy, because Pages sends
`Cache-Control: max-age=600` and `sw.js` itself can be ten minutes stale.
