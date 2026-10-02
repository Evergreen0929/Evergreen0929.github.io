/* ==========================================================================
   Imagining in 360 (projects/imagining360.html): "Imagination, Step by Step"
   One episode at a time: the Imaginator's sampled hypotheses drawn on the panorama for
   each step, the suggestions it injects, and the Actor's reply. Steps advance on their
   own while the viewer is on screen; any click hands control to the reader.
   Data: steps.json written by tools/ref/build_i360_page_assets.py.
   ========================================================================== */
(function () {
    'use strict';

    var root = document.querySelector('.istep');
    if (!root) return;
    var A = root.getAttribute('data-assets');
    var STEP_MS = 4500;
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var casesEl = root.querySelector('.istep__cases'), img = root.querySelector('.istep__img');
    var title = root.querySelector('.istep__stage .stage__title'), task = root.querySelector('.istep__task');
    var stepsEl = root.querySelector('.istep__steps'), opts = root.querySelector('.istep__opts');
    var think = root.querySelector('.istep__think'), act = root.querySelector('.istep__act'), base = root.querySelector('.istep__base');
    var data = [], ci = 0, si = 0, timer = 0, auto = !reduceMotion, visible = false;
    root.style.setProperty('--istep-ms', STEP_MS + 'ms');

    function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function clip(s, n) {                       // the Actor's reasoning, cut at a sentence boundary
        if (s.length <= n) return s;
        var cut = s.slice(0, n), dot = cut.lastIndexOf('. ');
        return (dot > n * 0.5 ? cut.slice(0, dot + 1) : cut.replace(/\s+\S*$/, '') + ' …');
    }

    function render() {
        var c = data[ci], s = c.steps[si], n = c.steps.length;
        img.src = A + '/step_' + c.id + '_' + (si + 1) + '.jpg';
        title.textContent = 'Step ' + (si + 1) + ' / ' + n;
        task.textContent = '“' + c.task + '”';
        [].forEach.call(stepsEl.children, function (b, k) {
            b.classList.toggle('is-active', k === si);
            b.setAttribute('aria-pressed', k === si);
        });
        opts.innerHTML = s.options.map(function (o) { return '<li>' + esc(o) + '</li>'; }).join('');
        think.textContent = clip(s.think, 260);
        act.textContent = s.answer;
        var parts = [];
        if (si === n - 1 && /SUCCESS/.test(c.result)) parts.push('Target found in <b>' + n + ' steps</b>.');
        if (c.baseline) {
            var b = c.baseline, how = /SUCCESS/.test(b.result) ? 'found in ' + b.steps + ' steps'
                : b.steps >= 10 ? 'not found within the 10-step limit' : 'submitted a wrong spot at step ' + b.steps;
            parts.push('Same task, Actor alone: <b>' + how + '</b>.');
        }
        base.innerHTML = parts.join(' ');
    }

    function show(i, k, fade) {
        var changeCase = i !== ci;
        ci = i; si = k;
        if (changeCase) {
            [].forEach.call(casesEl.children, function (b, j) { b.classList.toggle('is-active', j === ci); b.setAttribute('aria-selected', j === ci); });
            stepsEl.innerHTML = data[ci].steps.map(function (_, j) { return '<button class="istep__step" type="button">Step ' + (j + 1) + '</button>'; }).join('');
        }
        if (!fade) { render(); return; }
        root.classList.add('is-swapping');
        setTimeout(function () {
            render();
            var done = function () { root.classList.remove('is-swapping'); };
            if (img.complete) requestAnimationFrame(done); else { img.onload = done; img.onerror = done; }
        }, 300);
    }

    function restartPlay() {
        clearTimeout(timer);
        // restart the progress bar on the active step button
        root.classList.remove('is-playing'); void root.offsetWidth;
        if (!auto || !visible) return;
        root.classList.add('is-playing');
        timer = setTimeout(function () {
            var c = data[ci];
            if (si + 1 < c.steps.length) show(ci, si + 1, true);
            else show((ci + 1) % data.length, 0, true);
            restartPlay();
        }, STEP_MS);
    }

    function takeOver() { auto = false; clearTimeout(timer); root.classList.remove('is-playing'); }

    casesEl.addEventListener('click', function (e) {
        var b = e.target.closest('.istep__case'); if (!b) return;
        takeOver();
        var i = [].indexOf.call(casesEl.children, b);
        if (i !== ci) show(i, 0, true);
    });
    stepsEl.addEventListener('click', function (e) {
        var b = e.target.closest('.istep__step'); if (!b) return;
        takeOver();
        var k = [].indexOf.call(stepsEl.children, b);
        if (k !== si) show(ci, k, true);
    });

    fetch(root.getAttribute('data-steps')).then(function (r) { return r.json(); }).then(function (d) {
        data = d;
        casesEl.innerHTML = data.map(function (c, j) {
            return '<button class="istep__case' + (j === 0 ? ' is-active' : '') + '" type="button" role="tab" aria-selected="' + (j === 0) + '">' + esc(c.title) + '</button>';
        }).join('');
        ci = -1; show(0, 0, false);
        var warmed = false;
        if ('IntersectionObserver' in window) {
            new IntersectionObserver(function (es) {
                visible = es[0].isIntersecting;
                if (visible && !warmed) {           // fetch the other steps once the viewer is reached
                    warmed = true;
                    data.forEach(function (c) { c.steps.forEach(function (_, k) { new Image().src = A + '/step_' + c.id + '_' + (k + 1) + '.jpg'; }); });
                }
                if (visible) restartPlay(); else { clearTimeout(timer); root.classList.remove('is-playing'); }
            }, { threshold: .35 }).observe(root);
        }
    });
})();
