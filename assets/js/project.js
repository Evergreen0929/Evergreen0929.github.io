/* ==========================================================================
   Project pages — interactions that continue the homepage's motion language
   - arrive: the page rises out of the ink the homepage faded into
     (html.pp-js ::before veil lifts; the hero rises in a short stagger)
   - scroll: blocks settle in as they enter the viewport
   - leave: links back home / to a sibling project page fade to ink first, and
     tell the next page (via sessionStorage) to rise out of the dark as well
   - BibTeX copy buttons; videos only play while visible
   ========================================================================== */
(function () {
    'use strict';

    var root = document.documentElement;
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var LEAVE_MS = 560;
    var HANDOFF_KEY = 'jz-transition';        // read by the homepage to fade in from ink

    try { sessionStorage.removeItem(HANDOFF_KEY); } catch (e) { /* storage may be blocked */ }

    /* ---------------------------------------------------------- living background
       Fixed to the viewport and driven by time only (never by scrolling):
         smoke  WebGL smoke drifting with light shafts that fade in and out (UniSER pages)
         pano   a blurred mosaic of results sliding around like a panorama (MTPano)
         segfield  a point lattice partitioned into slowly evolving instances (S4VY)
       Rendered small and scaled up by the browser, which is what makes it soft. */

    var FRAME_MS = 1000 / 30;

    function loop(draw) {
        var last = -1e9;
        function tick(ts) {
            if (!document.hidden && ts - last >= FRAME_MS) { last = ts; draw(ts / 1000); }
            if (!reduceMotion) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    var SMOKE_FS = [
        'precision mediump float;',
        'uniform vec2 uRes; uniform float uTime;',
        'float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
        'float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);',
        '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }',
        'float fbm(vec2 p){ float v = 0.0, a = 0.5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);',
        '  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; } return v; }',
        'void main(){',
        '  vec2 uv = gl_FragCoord.xy / uRes; float asp = uRes.x / uRes.y;',
        '  vec2 p = vec2(uv.x * asp, uv.y) * 1.8; float t = uTime * 0.03;',
        // domain-warped fbm: smoke that folds into itself as it drifts
        '  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(4.7, 1.9) - vec2(t * 0.8, 0.0)));',
        '  vec2 r = vec2(fbm(p + 2.2 * q + vec2(1.7, 9.2) + vec2(t * 0.9, -t * 0.3)), fbm(p + 2.2 * q + vec2(8.3, 2.8) - t * 0.5));',
        '  float smoke = smoothstep(0.30, 0.95, fbm(p + 2.6 * r));',
        // Tyndall shafts from beyond the top-left corner, breathing in and out
        '  vec2 d = vec2((uv.x + 0.12) * asp, uv.y - 1.18); float ang = atan(d.y, d.x); float dist = length(d);',
        '  float sh = 0.65 * noise(vec2(ang * 7.0, uTime * 0.05)) + 0.35 * noise(vec2(ang * 19.0, -uTime * 0.04));',
        '  sh = pow(clamp((sh - 0.42) / 0.58, 0.0, 1.0), 1.8);',
        '  float breathe = max(0.0, 0.5 + 0.5 * sin(uTime * 0.21) * sin(uTime * 0.083 + 1.1));',
        '  sh *= breathe * smoothstep(2.2, 0.3, dist);',
        '  vec3 bg = vec3(0.055, 0.071, 0.082);',
        '  vec3 smokeCol = mix(vec3(0.32, 0.34, 0.40), vec3(0.68, 0.53, 0.36), smoothstep(0.1, 1.0, uv.y));',
        '  vec3 col = bg + smokeCol * smoke * 0.38 + vec3(1.0, 0.80, 0.52) * sh * (0.3 + 0.7 * smoke) * 0.62;',
        '  float vig = smoothstep(1.35, 0.35, length((uv - vec2(0.5, 0.55)) * vec2(asp * 0.8, 1.0)));',
        '  gl_FragColor = vec4(mix(bg, col, 0.35 + 0.65 * vig), 1.0);',
        '}'
    ].join('\n');

    function startSmoke(host) {
        var c = document.createElement('canvas');
        var gl = c.getContext('webgl', { antialias: false, depth: false, alpha: false }) ||
                 c.getContext('experimental-webgl', { antialias: false, depth: false, alpha: false });
        var prog = null;
        if (gl) {
            var sh = function (type, src) { var o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); return gl.getShaderParameter(o, gl.COMPILE_STATUS) ? o : null; };
            var v = sh(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }');
            var f = sh(gl.FRAGMENT_SHADER, SMOKE_FS);
            if (v && f) {
                prog = gl.createProgram(); gl.attachShader(prog, v); gl.attachShader(prog, f); gl.linkProgram(prog);
                if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) prog = null;
            }
        }
        if (!prog) {                                            // CSS fallback
            host.classList.add('pp-bg--smoke-css');
            host.innerHTML = '<i class="pp-bg__glow"></i><i class="pp-bg__glow"></i>';
            return;
        }
        host.appendChild(c);
        gl.useProgram(prog);
        var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        var loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        var uRes = gl.getUniformLocation(prog, 'uRes'), uTime = gl.getUniformLocation(prog, 'uTime');
        var DOWN = 4;                                           // render small; upscaling softens it
        function size() {
            c.width = Math.max(2, Math.round(window.innerWidth / DOWN));
            c.height = Math.max(2, Math.round(window.innerHeight / DOWN));
            gl.viewport(0, 0, c.width, c.height);
        }
        size(); window.addEventListener('resize', size);
        var t0 = Math.random() * 60;                            // start somewhere in the cycle
        function draw(t) { gl.uniform2f(uRes, c.width, c.height); gl.uniform1f(uTime, t0 + t); gl.drawArrays(gl.TRIANGLES, 0, 3); }
        if (reduceMotion) draw(0); else loop(draw);
    }

    function startPano(host, src) {
        var c = document.createElement('canvas'), ctx = c.getContext('2d'), img = new Image();
        var SCALE = .5, SPEED = 45;                             // CSS px per second
        host.appendChild(c);
        function size() { c.width = Math.ceil(window.innerWidth * SCALE); c.height = Math.ceil(window.innerHeight * SCALE); }
        size(); window.addEventListener('resize', size);
        function draw(t) {
            if (!img.naturalWidth) return;
            var h = c.height, w = img.naturalWidth * h / img.naturalHeight;
            var x = -((t * SPEED * SCALE) % w);                  // seamless: the strip wraps horizontally
            for (var k = 0; x + k * w < c.width; k++) ctx.drawImage(img, x + k * w, 0, w, h);
        }
        img.onload = function () { if (reduceMotion) draw(0); else loop(draw); };
        img.src = src;
    }

    // S4VY: a lattice of points riding an irregular, slowly travelling wave surface, tinted by
    // softly blended instance colours that drift over time. Pure decoration, drawn by a shader.
    var SEGFIELD_FS = [
        'precision mediump float;',
        'uniform vec2 uRes; uniform float uTime; uniform float uPx;',
        'float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
        'vec3 pal(float t){ return 0.56 + 0.36 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }',
        'float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);',
        '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }',
        'void main(){',
        '  vec2 frag = gl_FragCoord.xy; vec2 uv = frag / uRes; float asp = uRes.x / uRes.y;',
        '  vec2 p = vec2(uv.x * asp, uv.y); float t = uTime;',
        // instance colours blended softly between drifting seeds (no hard borders)
        '  vec3 acc = vec3(0.0); float ws = 0.0;',
        '  for (int i = 0; i < 9; i++) {',
        '    float fi = float(i);',
        '    vec2 s = vec2(asp * (0.5 + 0.48 * sin(t * (0.021 + 0.004 * fi) + fi * 1.7)), 0.5 + 0.48 * cos(t * (0.017 + 0.005 * fi) + fi * 2.9));',
        '    vec2 d = p - s; float w = exp(-dot(d, d) * 16.0);',
        '    acc += pal(fi * 0.137 + 0.08) * w; ws += w;',
        '  }',
        '  vec3 col = acc / max(ws, 1e-4);',
        // an irregular surface from three travelling waves + noise; the lattice rides on it
        '  vec2 cp = frag / uPx;',
        '  float h = (sin(dot(cp, vec2(0.0090, 0.0035)) + t * 0.95)',
        '           + sin(dot(cp, vec2(-0.0046, 0.0080)) + t * 0.72 + 1.7)',
        '           + sin(dot(cp, vec2(0.0028, -0.0064)) - t * 0.58 + 4.0 * vnoise(cp * 0.003 + t * 0.06))) / 3.0;',
        '  vec2 wv = vec2(vnoise(cp * 0.005 + vec2(t * 0.12, 1.3)), vnoise(cp * 0.005 + vec2(4.1, t * 0.10))) - 0.5;',
        '  vec2 q = frag + (wv * 30.0 + vec2(h * 10.0, h * 18.0)) * uPx;',
        '  float cell = 18.0 * uPx; vec2 ci = floor(q / cell); vec2 g = mod(q, cell) - 0.5 * cell;',
        '  float r = (0.8 + 0.45 * hash(ci) + 0.95 * max(h, 0.0)) * uPx;',        // dots swell on the crests
        '  float dotm = 1.0 - smoothstep(r, r + 1.1 * uPx, length(g));',
        '  float tw = 0.5 + 0.5 * sin(t * 0.45 + hash(ci + 7.1) * 6.2831);',
        '  float lift = 0.2 + 1.4 * smoothstep(-0.85, 0.9, h);',                   // and brighten with them
        '  vec3 c = col * dotm * (0.13 + 0.15 * tw) * lift + col * 0.012;',
        '  float vig = smoothstep(1.3, 0.15, length((uv - 0.5) * vec2(asp * 0.85, 1.0)));',
        '  vec3 bg = vec3(0.055, 0.071, 0.082);',
        '  float grain = (hash(floor(frag / uPx) + 3.7) - 0.5) * 0.022;',
        '  gl_FragColor = vec4(bg + c * (0.45 + 0.55 * vig) + grain, 1.0);',
        '}'
    ].join('\n');

    var SEGFIELD_SPEED = .5;       // overall pace of the lattice (waves, drift, twinkle, colours)

    function startSegfield(host) {
        var c = document.createElement('canvas');
        host.appendChild(c);
        var gl = null, uRes, uTime, uPx, px = 1, running = false;
        var t0 = 40 + Math.random() * 200;
        function setup() {
            gl = c.getContext('webgl', { antialias: false, depth: false, alpha: true, premultipliedAlpha: true }) ||
                 c.getContext('experimental-webgl', { antialias: false, depth: false, alpha: true, premultipliedAlpha: true });
            if (!gl) return false;
            var sh = function (type, src) { var o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); return gl.getShaderParameter(o, gl.COMPILE_STATUS) ? o : null; };
            var v = sh(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }'), f = sh(gl.FRAGMENT_SHADER, SEGFIELD_FS);
            if (!v || !f) return false;
            var prog = gl.createProgram(); gl.attachShader(prog, v); gl.attachShader(prog, f); gl.linkProgram(prog);
            if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
            gl.useProgram(prog);
            var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
            var loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
            uRes = gl.getUniformLocation(prog, 'uRes'); uTime = gl.getUniformLocation(prog, 'uTime');
            uPx = gl.getUniformLocation(prog, 'uPx');
            size();
            return true;
        }
        function size() {
            var w = window.innerWidth, h = window.innerHeight;
            // device pixels per CSS px (re-read: browser zoom changes it), capped at ~5 MP so large or zoomed-out windows stay cheap
            px = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(5e6 / Math.max(1, w * h)));
            c.width = Math.max(2, Math.round(w * px)); c.height = Math.max(2, Math.round(h * px));
            if (gl) gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        }
        function draw(t) {
            if (!gl || gl.isContextLost()) return;
            gl.uniform2f(uRes, gl.drawingBufferWidth, gl.drawingBufferHeight);
            gl.uniform1f(uTime, t0 + t * SEGFIELD_SPEED); gl.uniform1f(uPx, px * gl.drawingBufferWidth / c.width);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
        c.addEventListener('webglcontextlost', function (e) { e.preventDefault(); });
        c.addEventListener('webglcontextrestored', function () { setup(); if (reduceMotion) draw(0); });
        window.addEventListener('resize', size);
        if (!setup()) { c.remove(); return; }                  // plain ink background
        if (reduceMotion) draw(0); else if (!running) { running = true; loop(draw); }
    }

    var bgMode = document.body.getAttribute('data-bg');
    if (bgMode) {
        var bg = document.createElement('div');
        bg.className = 'pp-bg pp-bg--' + bgMode;
        bg.setAttribute('aria-hidden', 'true');
        document.body.insertBefore(bg, document.body.firstChild);
        if (bgMode === 'smoke') startSmoke(bg);
        else if (bgMode === 'pano') startPano(bg, document.body.getAttribute('data-bg-src'));
        else if (bgMode === 'segfield') startSegfield(bg);
    }

    /* ---------------------------------------------------------- arrive */

    var hero = document.querySelector('body > section');
    if (hero) {
        var parts = hero.querySelectorAll('.paper-title, .author-block, .affiliation-block, .mb-4, .venue-block, .mb-5, .pill, .teaser-img, video, .caption');
        [].forEach.call(parts, function (el, i) {
            el.classList.add('pp-rise');
            el.style.setProperty('--d', (0.12 + Math.min(i, 8) * 0.09).toFixed(2) + 's');
        });
    }
    requestAnimationFrame(function () { requestAnimationFrame(function () { root.classList.add('pp-in'); }); });

    /* ---------------------------------------------------------- reveal on scroll */

    var blocks = [];
    [].forEach.call(document.querySelectorAll('body > section'), function (sec, k) {
        if (k === 0) return;
        [].forEach.call(sec.querySelectorAll('h2, h5, .section-lede, .stage-wrap, .fig-wrap, .demo-soon, .abstract-box, .img-container, .embed-responsive, .dataset-section, .stat-card, table.comp, pre, .col-lg-10 > p, .col-lg-10 > .row'), function (el) {
            if (el.closest('.pp-reveal')) return;               // parent already animates
            el.classList.add('pp-reveal');
            blocks.push(el);
        });
    });
    if ('IntersectionObserver' in window) {
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); }
            });
        }, { rootMargin: '0px 0px -6% 0px', threshold: .06 });
        blocks.forEach(function (el) { io.observe(el); });
    } else {
        blocks.forEach(function (el) { el.classList.add('is-visible'); });
    }

    /* ---------------------------------------------------------- leave */

    function isInternalPage(a) {
        if (!a || a.target === '_blank' || a.hasAttribute('download')) return false;
        if (a.origin !== location.origin) return false;
        if (a.pathname === location.pathname) return false;     // in-page anchors
        return /(^|\/)(index\.html)?$/.test(a.pathname) || /\/projects\/[^/]+\.html$/.test(a.pathname);
    }

    document.addEventListener('click', function (e) {
        var a = e.target.closest ? e.target.closest('a[href]') : null;
        if (!isInternalPage(a)) return;
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || reduceMotion) return;
        e.preventDefault();
        try { sessionStorage.setItem(HANDOFF_KEY, '1'); } catch (err) { /* ignore */ }
        root.classList.remove('pp-in');
        root.classList.add('pp-out');
        setTimeout(function () { window.location.href = a.href; }, LEAVE_MS);
    });

    // back/forward cache: never come back to a faded-out page
    window.addEventListener('pageshow', function (e) {
        if (e.persisted) { root.classList.remove('pp-out'); root.classList.add('pp-in'); }
    });

    /* ---------------------------------------------------------- result stages
       [data-stage] holds one <video>; buttons with data-src / data-title inside the
       stage's [data-stage-for] strip swap it with a short crossfade. */

    function swapVideo(stage, src, poster) {
        var v = stage.querySelector('video');
        if (!v || v.getAttribute('src') === src) return;
        stage.classList.add('is-swapping');
        setTimeout(function () {
            v.poster = poster || '';
            v.src = src;
            v.load();
            var p = v.play(); if (p && p.catch) p.catch(function () {});
            v.addEventListener('loadeddata', function once() { v.removeEventListener('loadeddata', once); stage.classList.remove('is-swapping'); });
            setTimeout(function () { stage.classList.remove('is-swapping'); }, 900);   // never stay hidden
        }, 260);
    }

    // sliders: arrow buttons page the strip; they dim at either end
    [].forEach.call(document.querySelectorAll('.slider'), function (sl) {
        var strip = sl.querySelector('.thumbs'), prev = sl.querySelector('.slider__btn--prev'), next = sl.querySelector('.slider__btn--next');
        function update() {
            prev.disabled = strip.scrollLeft <= 2;
            next.disabled = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 2;
        }
        prev.addEventListener('click', function () { strip.scrollBy({ left: -strip.clientWidth * .85, behavior: 'smooth' }); });
        next.addEventListener('click', function () { strip.scrollBy({ left: strip.clientWidth * .85, behavior: 'smooth' }); });
        strip.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update);
        update();
    });

    [].forEach.call(document.querySelectorAll('[data-stage-for]'), function (strip) {
        var stage = document.getElementById(strip.getAttribute('data-stage-for'));
        if (!stage) return;
        var title = stage.querySelector('.stage__title');
        strip.addEventListener('click', function (e) {
            var b = e.target.closest('[data-src]');
            if (!b || !strip.contains(b)) return;
            [].forEach.call(strip.querySelectorAll('[data-src]'), function (x) { x.classList.toggle('is-active', x === b); });
            swapVideo(stage, b.getAttribute('data-src'), b.getAttribute('data-poster'));
            if (title) title.textContent = b.getAttribute('data-title') || '';
            var list = document.querySelector('[data-queries-for="' + stage.id + '"]'), qs = b.getAttribute('data-queries');
            if (list && qs !== null) {
                list.classList.add('is-swapping');
                setTimeout(function () {
                    list.innerHTML = '';
                    qs.split('|').forEach(function (q) { var li = document.createElement('li'); li.textContent = q; list.appendChild(li); });
                    list.classList.remove('is-swapping');
                }, 260);
            }
            // keep the chosen thumbnail in view without scrolling the page
            var l = b.offsetLeft - strip.offsetLeft, r = l + b.offsetWidth;
            if (l < strip.scrollLeft) strip.scrollTo({ left: l - 12, behavior: 'smooth' });
            else if (r > strip.scrollLeft + strip.clientWidth) strip.scrollTo({ left: r - strip.clientWidth + 12, behavior: 'smooth' });
        });
    });

    /* ---------------------------------------------------------- BibTeX copy */

    [].forEach.call(document.querySelectorAll('.bibtex-box'), function (pre) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bib-copy';
        btn.textContent = 'Copy';
        btn.addEventListener('click', function () {
            var text = pre.textContent.replace(/Copy$|Copied$/, '').trim();
            var done = function () {
                btn.textContent = 'Copied';
                btn.classList.add('is-done');
                setTimeout(function () { btn.textContent = 'Copy'; btn.classList.remove('is-done'); }, 1600);
            };
            if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () {});
        });
        pre.appendChild(btn);
    });

    /* ---------------------------------------------------------- videos: play only while visible */

    if ('IntersectionObserver' in window) {
        var vio = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                var v = en.target;
                if (en.isIntersecting) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
                else if (!v.paused) v.pause();
            });
        }, { rootMargin: '120px 0px' });
        [].forEach.call(document.querySelectorAll('video[autoplay]'), function (v) { vio.observe(v); });
    }
})();
