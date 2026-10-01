/* ==========================================================================
   Jingdong Zhang — homepage interactions
   - cover: reveal, hold, then glide down into the page while the photo fades;
     scrolling back up past the top of the page glides back to the cover
   - star-trail backdrop that turns with scrolling and drifts when idle
   - smooth anchor navigation, scroll-spy table of contents
   - reveal-on-scroll, mobile drawer
   - publication figure -> page transition (zoom + fade to ink)

   Smoothness notes
   - Programmatic scrolling is a spring (critically damped, with a smoothed goal),
     so glides start and stop along an S-curve and can be retargeted mid-flight
     without a velocity jump.
   - Scroll-linked styles are written in the same frame as the scroll position
     (directly from the glide step / scroll event), never a frame late.
   - Geometry is measured once and on resize/content changes, so nothing reads
     layout inside the per-frame path.
   - Everything animated per frame is transform / opacity only.
   ========================================================================== */
(function () {
    'use strict';

    var COVER_HOLD_MS = 3000;     // how long the cover stays before auto-gliding
    var SNAP_IDLE_MS = 160;       // scroll-idle delay before snapping inside the cover zone
    var WHEEL_GAP_MS = 180;       // wheel events closer than this belong to the same gesture (incl. trackpad momentum)

    var body = document.body;
    var root = document.documentElement;
    var cover = document.getElementById('cover');
    var media = cover.querySelector('.cover__media');
    var inner = cover.querySelector('.cover__inner');
    var hint = cover.querySelector('.cover__hint-wrap');   // scroll-driven fade lives on the wrapper
    var page = document.querySelector('.page');
    var sections = [].slice.call(document.querySelectorAll('.content .section'));
    var navLinks = [].slice.call(document.querySelectorAll('.toc a, .drawer a'));
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function y() { return window.pageYOffset || root.scrollTop; }
    function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
    function isMobile() { return window.innerWidth <= 900; }
    function topbarOffset() { return isMobile() ? 58 : 0; }

    /* ---------------------------------------------------------- geometry cache */

    var geo = { coverH: 1, vh: 1, docH: 1, tops: [], pageL: 0, pageR: 0 };

    function measure() {
        var s = y();
        geo.coverH = cover.offsetHeight || 1;
        geo.vh = window.innerHeight;
        geo.docH = root.scrollHeight;
        geo.tops = sections.map(function (el) { return el.getBoundingClientRect().top + s; });
        if (page) {
            var r = page.getBoundingClientRect();
            var cs = getComputedStyle(page);
            geo.pageL = r.left + parseFloat(cs.paddingLeft);
            geo.pageR = r.right - parseFloat(cs.paddingRight);
        }
    }

    var measureQueued = false;
    function queueMeasure() {
        if (measureQueued) return;
        measureQueued = true;
        requestAnimationFrame(function () { measureQueued = false; measure(); paint(y()); });
    }

    /* ---------------------------------------------------------- spring scroller */

    var sc = { on: false, pos: 0, vel: 0, goal: 0, target: 0, w: 5, raf: 0, last: 0 };

    function glideTo(target, stiffness) {
        target = Math.max(0, Math.min(target, geo.docH - geo.vh));
        if (reduceMotion) { window.scrollTo(0, target); paint(target); return; }
        if (!sc.on) { sc.pos = y(); sc.vel = 0; sc.goal = sc.pos; sc.last = 0; }
        sc.target = target;
        sc.w = stiffness || 5;
        sc.on = true;
        if (!sc.raf) sc.raf = requestAnimationFrame(scStep);
    }

    function stopGlide() {
        sc.on = false;
        if (sc.raf) { cancelAnimationFrame(sc.raf); sc.raf = 0; }
    }

    function scStep(ts) {
        sc.raf = 0;
        if (!sc.on) return;
        var dt = sc.last ? Math.min(.05, (ts - sc.last) / 1000) : 1 / 60;
        sc.last = ts;
        var n = Math.max(1, Math.ceil(dt * 240)), h = dt / n, w = sc.w;
        var k = 1 - Math.exp(-w * h);
        for (var i = 0; i < n; i++) {
            sc.goal += (sc.target - sc.goal) * k;                    // smoothed goal -> gentle start
            sc.vel += (w * w * (sc.goal - sc.pos) - 2 * w * sc.vel) * h;
            sc.pos += sc.vel * h;
        }
        if (Math.abs(sc.target - sc.pos) < .4 && Math.abs(sc.vel) < 6 && Math.abs(sc.target - sc.goal) < .4) {
            sc.pos = sc.target;
            sc.on = false;
        }
        window.scrollTo(0, sc.pos);
        paint(sc.pos);                                               // same frame as the scroll
        if (sc.on) sc.raf = requestAnimationFrame(scStep);
    }

    /* ---------------------------------------------------------- cover */

    var userActed = false;

    function glideDown(stiffness) { glideTo(geo.coverH, stiffness || 5.6); }
    function glideUp(stiffness) { glideTo(0, stiffness || 5.6); }

    // Build per-letter spans so the name can "gather" with transforms only
    (function splitName() {
        var el = cover.querySelector('.cover__name');
        if (!el || reduceMotion) return;
        var txt = el.textContent.trim();
        el.setAttribute('aria-label', txt);
        el.textContent = '';
        var mid = (txt.length - 1) / 2;
        for (var i = 0; i < txt.length; i++) {
            var sp = document.createElement('span');
            sp.className = 'ch';
            sp.setAttribute('aria-hidden', 'true');
            sp.textContent = txt[i] === ' ' ? ' ' : txt[i];
            sp.style.setProperty('--dx', ((i - mid) * .14).toFixed(3) + 'em');
            el.appendChild(sp);
        }
    })();

    /* ---------------------------------------------------------- star trails
       Arcs around an off-centre celestial pole are rendered once to a canvas;
       the canvas is then rotated with a CSS transform (compositor only).
       Angle follows a critically damped spring: scrolling pushes the target
       (down = clockwise), idle time drifts it slowly. A CSS mask keeps the sky
       in the side margins. */

    var sky = document.querySelector('.sky');
    var skyCanvas = sky && sky.querySelector('canvas');
    var skyOn = !!(sky && skyCanvas && skyCanvas.getContext);
    var POLE_X = .80, POLE_Y = .14;  // pole position as a fraction of the viewport
    var SKY_AUTO = .006;             // rad / s idle drift (~0.35 deg/s)
    var SKY_PER_PX = .00045;         // rad per scrolled px (1000 px ~ 26 deg)
    var SKY_W = 2.2;                 // spring stiffness of the rotation
    var sk = { angle: 0, vel: 0, target: 0, lastY: 0, raf: 0, last: 0, visible: false, opacity: -1 };

    function mulberry32(a) {
        return function () {
            a |= 0; a = a + 0x6D2B79F5 | 0;
            var t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    function buildSky() {
        if (!skyOn || isMobile()) return;
        var w = window.innerWidth, h = window.innerHeight;
        var cx = w * POLE_X, cy = h * POLE_Y;
        var R = Math.ceil(Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy))) + 8;
        var size = 2 * R;
        var dpr = Math.min(window.devicePixelRatio || 1, 1.5, 3400 / size);
        skyCanvas.width = Math.round(size * dpr);
        skyCanvas.height = Math.round(size * dpr);
        skyCanvas.style.width = size + 'px';
        skyCanvas.style.height = size + 'px';
        skyCanvas.style.left = (cx - R) + 'px';
        skyCanvas.style.top = (cy - R) + 'px';

        var ctx = skyCanvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, dpr * R, dpr * R);
        ctx.clearRect(-R, -R, size, size);
        ctx.lineCap = 'round';

        var rnd = mulberry32(929);
        var palette = [[236, 230, 216], [236, 230, 216], [236, 230, 216], [176, 198, 228], [176, 198, 228], [238, 206, 160]];
        var n = Math.max(500, Math.min(1500, Math.round(size * size / 3000)));
        var SEG = 10;
        for (var i = 0; i < n; i++) {
            var r = R * Math.sqrt(.0015 + rnd() * .9985);      // uniform over the disc
            var a0 = rnd() * Math.PI * 2;
            var len = .34 * (.7 + rnd() * .6);                // same exposure => similar angular length
            var b = Math.pow(rnd(), 2.4);                     // mostly faint, a few bright
            var alpha = .07 + b * .5;
            var c = palette[(rnd() * palette.length) | 0];
            ctx.lineWidth = .45 + b * 1.05;
            for (var s = 0; s < SEG; s++) {                   // tail fades in towards the leading end
                ctx.strokeStyle = 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (alpha * Math.pow((s + 1) / SEG, 1.4)).toFixed(3) + ')';
                ctx.beginPath();
                ctx.arc(0, 0, r, a0 + len * s / SEG, a0 + len * (s + 1) / SEG + .002);
                ctx.stroke();
            }
        }
        skyMask();
        skyApply();
    }

    // Fade the sky out over the sidebar + text column, keep it in the side margins
    function skyMask() {
        if (!skyOn) return;
        sky.style.setProperty('--sky-l1', Math.max(0, geo.pageL - 70) + 'px');
        sky.style.setProperty('--sky-l2', (geo.pageL + 20) + 'px');
        sky.style.setProperty('--sky-r2', (geo.pageR - 20) + 'px');
        sky.style.setProperty('--sky-r1', Math.min(window.innerWidth, geo.pageR + 70) + 'px');
    }

    function skyApply() {
        skyCanvas.style.transform = 'rotate(' + sk.angle.toFixed(5) + 'rad)';
    }

    function skyFrame(ts) {
        sk.raf = 0;
        if (!sk.visible || document.hidden) return;
        var dt = sk.last ? Math.min(.05, (ts - sk.last) / 1000) : 1 / 60;
        sk.last = ts;
        sk.target += SKY_AUTO * dt;
        var n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
        for (var i = 0; i < n; i++) {
            sk.vel += (SKY_W * SKY_W * (sk.target - sk.angle) - 2 * SKY_W * sk.vel) * h;
            sk.angle += sk.vel * h;
        }
        skyApply();
        sk.raf = requestAnimationFrame(skyFrame);
    }

    function skyStart() {
        if (!skyOn || reduceMotion || sk.raf || isMobile()) return;
        sk.last = 0;
        sk.raf = requestAnimationFrame(skyFrame);
    }

    // Only visible once the cover is (mostly) behind us
    function skyReveal(p) {
        if (!skyOn) return;
        var v = clamp01((p - .55) / .4);
        v = v * v * (3 - 2 * v);
        var o = Math.round(v * .85 * 1000) / 1000;           // decorative: never full strength
        if (o !== sk.opacity) { sk.opacity = o; sky.style.opacity = o; }
        var was = sk.visible;
        sk.visible = v > 0;
        if (sk.visible && !was) skyStart();
    }

    document.addEventListener('visibilitychange', function () { if (!document.hidden && sk.visible) skyStart(); });

    /* ---------------------------------------------------------- per-frame paint */

    var pastCover = null;
    var coverSettled = false;    // true once cover styles have been written for p = 1
    var currentId;

    function paint(s) {
        var h = geo.coverH;
        var p = clamp01(s / h);
        if (p < 1 || !coverSettled) {
            media.style.transform = 'translate3d(0,' + (Math.min(s, h) * .42).toFixed(1) + 'px,0)';
            media.style.opacity = (1 - p * .96).toFixed(3);
            inner.style.transform = 'translate3d(0,' + (-Math.min(s, h) * .18).toFixed(1) + 'px,0)';
            inner.style.opacity = Math.max(0, 1 - p * 1.9).toFixed(3);
            hint.style.opacity = Math.max(0, 1 - p * 3).toFixed(3);
            coverSettled = p >= 1;
        }
        var past = p >= .9;
        if (past !== pastCover) { pastCover = past; body.classList.toggle('past-cover', past); }
        skyReveal(p);
        spy(s);
    }

    function spy(s) {
        var id = null;
        if (s >= geo.coverH - 2) {
            var line = s + geo.vh * .38;
            for (var i = 0; i < geo.tops.length; i++) if (geo.tops[i] <= line) id = sections[i].id;
            if (!id && sections.length) id = sections[0].id;
            if (s + geo.vh >= geo.docH - 4 && sections.length) id = sections[sections.length - 1].id;
        }
        if (id === currentId) return;
        currentId = id;
        navLinks.forEach(function (a) { a.classList.toggle('is-active', a.getAttribute('href') === '#' + id); });
    }

    /* ---------------------------------------------------------- input */

    // The wheel gesture that drove a cover glide. While that glide runs, the rest of the gesture is
    // absorbed by it; once it has landed, only a decaying trackpad momentum tail is absorbed, so the
    // user's next deliberate scroll applies at once instead of piling up behind the glide.
    var gesture = { dir: 0, last: 0, mag: 0 };

    // Wheel inside the cover zone (or upward at the very top of the page) glides instead of scrolling
    window.addEventListener('wheel', function (e) {
        if (e.ctrlKey || reduceMotion) return;
        var dir = e.deltaY > 0 ? 1 : e.deltaY < 0 ? -1 : 0;
        if (!dir) return;
        var now = performance.now(), mag = Math.abs(e.deltaY);
        var sameGesture = dir === gesture.dir && now - gesture.last < WHEEL_GAP_MS;
        if (sameGesture && (sc.on || mag < gesture.mag || (mag === gesture.mag && mag < 20))) {
            e.preventDefault();
            gesture.last = now; gesture.mag = mag;
            return;
        }
        gesture.dir = 0;
        var h = geo.coverH, s = y();
        if (s < h - 2 || (s <= h + 2 && dir < 0)) {
            e.preventDefault();
            userActed = true;
            // the user takes over: an auto glide speeds up, or turns round; retargeting keeps velocity
            glideTo(dir > 0 ? h : 0, 5.6);
            gesture = { dir: dir, last: now, mag: mag };
            return;
        }
        if (sc.on) stopGlide();          // ordinary scrolling: hand control back to the user
    }, { passive: false });

    // Keyboard inside the cover zone
    window.addEventListener('keydown', function (e) {
        userActed = true;
        var t = e.target;
        if (t && (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName))) return;
        var down = ['ArrowDown', 'PageDown', ' ', 'Spacebar'].indexOf(e.key) !== -1 && !e.shiftKey;
        var up = ['ArrowUp', 'PageUp', 'Home'].indexOf(e.key) !== -1 || (e.key === ' ' && e.shiftKey);
        var s = y(), h = geo.coverH;
        if (s < h - 2 && down) { e.preventDefault(); glideDown(); }
        else if (s > 0 && s <= h + 2 && up) { e.preventDefault(); glideUp(); }
    });

    ['touchstart', 'mousedown'].forEach(function (ev) {
        window.addEventListener(ev, function () { userActed = true; }, { passive: true });
    });
    // grabbing the scrollbar takes over from any glide (it would otherwise fight the drag every frame)
    window.addEventListener('mousedown', function (e) {
        if (sc.on && e.clientX >= root.clientWidth) stopGlide();
    }, { passive: true });
    window.addEventListener('touchstart', function () { stopGlide(); }, { passive: true });

    // Touch / scrollbar fallback: when scrolling settles inside the cover zone, glide to the nearer end
    var lastY = y(), direction = 0, idleTimer = 0;
    function onScrollSettled() {
        if (sc.on || reduceMotion) return;
        var s = y(), h = geo.coverH;
        if (s > 1 && s < h - 2) {
            if (direction > 0) glideDown();
            else if (direction < 0) glideUp();
            else (s > h / 2 ? glideDown : glideUp)();
        }
    }

    window.addEventListener('scroll', function () {
        var s = y();
        if (s !== lastY) direction = s > lastY ? 1 : -1;
        lastY = s;
        if (skyOn) { sk.target += (s - sk.lastY) * SKY_PER_PX; sk.lastY = s; }
        if (!sc.on) paint(s);            // during a glide, scStep already painted this frame
        clearTimeout(idleTimer);
        idleTimer = setTimeout(onScrollSettled, SNAP_IDLE_MS);
    }, { passive: true });

    var skyResizeTimer = 0;
    window.addEventListener('resize', function () {
        measure(); skyMask(); coverSettled = false; paint(y());
        clearTimeout(skyResizeTimer);
        skyResizeTimer = setTimeout(buildSky, 250);
    });
    if ('ResizeObserver' in window) new ResizeObserver(queueMeasure).observe(document.querySelector('.content') || body);
    window.addEventListener('load', queueMeasure);

    /* ---------------------------------------------------------- reveal */

    var revealEls = [].slice.call(document.querySelectorAll('.reveal'));
    if ('IntersectionObserver' in window) {
        var revealIO = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                if (en.isIntersecting) { en.target.classList.add('is-visible'); revealIO.unobserve(en.target); }
            });
        }, { rootMargin: '0px 0px -8% 0px', threshold: .08 });
        revealEls.forEach(function (el) { revealIO.observe(el); });
    } else {
        revealEls.forEach(function (el) { el.classList.add('is-visible'); });
    }

    /* ---------------------------------------------------------- anchors */

    function closeMenu() { body.classList.remove('menu-open'); }

    document.addEventListener('click', function (e) {
        var a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
        if (!a) return;
        var id = a.getAttribute('href').slice(1);
        e.preventDefault();
        closeMenu();
        if (id === 'main') { glideDown(); return; }
        var el = document.getElementById(id);
        if (!el) return;
        var target = el.getBoundingClientRect().top + y() - topbarOffset();
        if (id === 'Home' && !isMobile()) target = geo.coverH;
        glideTo(Math.max(target, geo.coverH), 4.8);
        if (history.replaceState) history.replaceState(null, '', '#' + id);
    });

    var menuBtn = document.querySelector('.topbar__menu');
    if (menuBtn) menuBtn.addEventListener('click', function () { body.classList.toggle('menu-open'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });

    /* ---------------------------------------------------------- news fade hint */

    var news = document.querySelector('.news');
    var newsList = news && news.querySelector('.news__list');
    if (newsList) {
        var checkNews = function () {
            news.classList.toggle('is-end', newsList.scrollTop + newsList.clientHeight >= newsList.scrollHeight - 4);
        };
        newsList.addEventListener('scroll', checkNews, { passive: true });
        checkNews();
    }

    /* ---------------------------------------------------------- publication -> page transition
       Clicking a publication figure starts one continuous move: the whole page — the
       lifted copy of the figure (gilded rim included) as well — dims to ink while that
       copy drifts to the centre, grows and dissolves; then the link is followed.
       Project pages are expected to rise out of that dark on arrival.
       Modified clicks keep the browser's default behaviour. */

    var ZOOM_MS = 900;          // kept under 1 s: Safari only forwards the click's user gesture to timers < 1 s
    var RESTORE_FALLBACK_MS = 5000;
    var lift = null;            // { thumb, clone, veil, left } while a transition is (or was left) on screen

    // Put the page back: overlays dissolve, the original figure fades back into its slot.
    // State lives in `lift` + one CSS class, so restoring never depends on the browser
    // having kept (or reported) Web Animations across a back/forward-cache round trip.
    function clearZoom(fade) {
        var L = lift;
        lift = null;
        if (!L) return;
        var t = L.thumb;
        t.classList.remove('is-lifted', 'is-leaving');     // CSS transition fades it back in
        // nudge a repaint of the figure (belt and braces against a stale, unpainted layer)
        t.style.backgroundColor = '#0b0e11';
        requestAnimationFrame(function () { requestAnimationFrame(function () { t.style.backgroundColor = ''; }); });
        [L.clone, L.veil].forEach(function (n) {
            if (!n || !n.parentNode) return;
            var from = getComputedStyle(n).opacity;
            if (n.getAnimations) n.getAnimations().forEach(function (an) { an.cancel(); });
            n.classList.remove('is-leaving');
            if (!fade || !n.animate || +from === 0) { n.remove(); return; }
            n.style.opacity = from;
            n.animate([{ opacity: from }, { opacity: 0 }], { duration: 420, easing: 'ease-out', fill: 'forwards' })
                .onfinish = function () { n.remove(); };
        });
    }

    // Leaving for another page: hand the dimmed state over to CSS (see .is-leaving),
    // so it unwinds on return even if no script event fires.
    function armLeave(L) {
        if (L.clone && L.clone.parentNode) L.clone.remove();          // fully faded by now
        if (L.veil.getAnimations) L.veil.getAnimations().forEach(function (an) { an.cancel(); });
        L.veil.style.opacity = '1';
        L.veil.classList.add('is-leaving');
        L.thumb.classList.add('is-leaving');
    }

    function restoreIfLeft() { if (lift && lift.left) clearZoom(true); }

    function zoomOut(thumb, done) {
        var r = thumb.getBoundingClientRect();
        var clone = thumb.cloneNode(true);
        clone.removeAttribute('href');
        clone.removeAttribute('target');
        clone.classList.add('zoomer');
        clone.style.left = r.left + 'px';
        clone.style.top = r.top + 'px';
        clone.style.width = r.width + 'px';
        clone.style.height = r.height + 'px';
        var veil = document.createElement('div');
        veil.className = 'zoom-veil';
        body.appendChild(veil);
        body.appendChild(clone);
        lift = { thumb: thumb, clone: clone, veil: veil, left: false };

        var vw = window.innerWidth, vh = window.innerHeight;
        var k = Math.min(vw * .78 / r.width, vh * .78 / r.height);
        var dx = vw / 2 - (r.left + r.width / 2), dy = vh / 2 - (r.top + r.height / 2);
        function at(f, s) { return 'translate3d(' + (dx * f).toFixed(1) + 'px,' + (dy * f).toFixed(1) + 'px,0) scale(' + s.toFixed(4) + ')'; }

        // One continuous move: from the first frame the whole page dims — the lifted figure
        // included, since the veil sits above it — while the figure drifts to the centre and
        // grows. The zoom only signals "entering the next page"; its content fades with the rest.
        thumb.classList.add('is-lifted');                  // the original fades out of its slot (CSS)
        veil.animate([{ opacity: 0 }, { opacity: 1 }],
            { duration: ZOOM_MS, easing: 'cubic-bezier(.2,.55,.35,1)', fill: 'forwards' });   // responds on the first frame
        clone.animate([
            { transform: at(0, 1), opacity: 1 },
            { transform: at(.62, 1 + (k - 1) * .5), opacity: 1, offset: .55 },
            { transform: at(1, k), opacity: 0 }
        ], { duration: ZOOM_MS, easing: 'cubic-bezier(.38,0,.25,1)', fill: 'forwards' });

        setTimeout(done, ZOOM_MS - 20);
    }

    document.addEventListener('click', function (e) {
        var a = e.target.closest ? e.target.closest('a.pub__thumb') : null;
        if (!a || lift) return;
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (reduceMotion || !document.body.animate) return;
        e.preventDefault();
        var href = a.href, newTab = a.getAttribute('target') === '_blank';
        zoomOut(a, function () {
            if (!lift) return;
            lift.left = true;
            if (newTab) {
                // still inside the click's user-activation window (< 1 s), so this is not a blocked popup
                window.open(href, '_blank', 'noopener');
                setTimeout(function () { clearZoom(true); }, 120);
            } else {
                armLeave(lift);
                window.location.href = href;
                // Timers are frozen while a page sits in the back/forward cache, so this also
                // fires shortly after coming back if no event below restored the page first.
                setTimeout(restoreIfLeft, RESTORE_FALLBACK_MS);
            }
        });
    });

    // Coming back (back/forward cache, tab switch, refocus): never leave the page faded out
    window.addEventListener('pageshow', function () { restoreIfLeft(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) restoreIfLeft(); });
    window.addEventListener('focus', restoreIfLeft);

    // Warm the cache for same-site project pages so the page after the transition appears at once
    var prefetched = {};
    document.querySelectorAll('a.pub__thumb').forEach(function (a) {
        a.addEventListener('pointerenter', function () {
            var url = a.href;
            if (prefetched[url] || a.origin !== location.origin) return;
            prefetched[url] = true;
            var l = document.createElement('link');
            l.rel = 'prefetch';
            l.href = url;
            document.head.appendChild(l);
        });
    });

    /* ---------------------------------------------------------- boot */

    if (root.classList.contains('jz-from-dark')) {          // arrived from a project page (see index.html head)
        requestAnimationFrame(function () { requestAnimationFrame(function () { root.classList.add('jz-lit'); }); });
    }

    measure();
    sk.lastY = y();
    buildSky();
    paint(y());

    var coverSrc = window.matchMedia('(max-width: 900px)').matches
        ? 'homepage_assets/cover_1280.jpg' : 'homepage_assets/cover_2560.jpg';
    var readyFired = false;
    function coverReady() {
        if (readyFired) return;
        readyFired = true;
        cover.classList.add('is-ready');
        // Auto-glide only on a fresh landing at the very top (no deep link, no restored scroll)
        if (location.hash || reduceMotion) return;
        setTimeout(function () {
            if (!userActed && y() < 4) glideDown(4.2);   // softer spring for the cinematic first glide
        }, COVER_HOLD_MS);
    }
    var img = new Image();
    img.onload = img.onerror = function () { requestAnimationFrame(coverReady); };
    img.src = coverSrc;
    setTimeout(coverReady, 2500);   // don't wait forever on a slow network
})();
