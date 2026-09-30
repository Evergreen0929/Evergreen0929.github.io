/* ==========================================================================
   S4VY Playground (projects/s4vy.html)
   Left: the input (video, or a few stills) and the cinematic render; any shot can be looped.
   Right: the regenerated scene as a clay model (three.js, loaded on demand):
     hover an object -> it floats, with whatever rests on it, and its motion pauses; leave -> it settles and moves on
     click an object -> it spins up close while the scene blurs and turns into the textured mesh (fetched on click);
                        drag to turn it; Esc / click away to return
     drag the scene to orbit; Ctrl/Cmd + scroll (or pinch) to zoom
   Bedroom: the walls between the camera and the room (and what stands against them) fade out as you orbit.
   ========================================================================== */

const root = document.querySelector('.pg');

const SCENES = {
    bedroom: {
        frames: 4,                                              // input shown as stills: pg_bedroom_frame1..4.jpg
        shots: [['S1', 'S1', 'Room tour'], ['S2', 'S2', 'Lateral dolly'], ['S3', 'S3', 'Low orbit'],
                ['S4', 'S4', 'Focus pull'], ['S5', 'S5', 'Light shafts']],          // [file, label, tooltip], in reel order
        reel: [0, 9.75, 14.25, 18.75, 23.25, 29],             // shot boundaries in the reel (0.5 s cross-fades)
        yaw: -13.57,                                            // square the room to the view (same turn as the renders)
        frame: ['component_027_plane_room'],
        view: { az: 20, el: 44, dist: 2.35 },                   // degrees; distance in framing radii (corner between door and wardrobe walls)
        shell: 0xb9b1a4,                                        // colour of the fixed parts (room shell / ground)
        fixed: ['component_027_plane_room'],                    // room shell: not pickable
        names: {
            pet_cabinet_procedural: 'Pet cabinet', bedside_table_second: 'Bedside table', red_box: 'Red box',
            window_front: 'Window', window_recess: 'Window', floor_mat: 'Floor mat', tabletop_cloth: 'Cloth',
            tabletop_black_bag: 'Black bag', tabletop_beige_bag: 'Beige bag', pet_food_bag_floor: 'Pet food bag',
            pet_food_bag_top: 'Pet food bag', pet_storage_container: 'Pet food container', storage_box_left: 'Storage box',
            storage_box_right: 'Storage box', storage_box_top: 'Storage box', painting_left: 'Painting',
            painting_middle: 'Painting', painting_right: 'Painting', device: 'Pet feeder', bin: 'Trash bin',
        },
        // walls that fade as the camera moves outside them, with the objects standing against them
        cutaway: {
            ceiling: { planes: ['027_plane_room_001'], objects: ['029_ceiling_lamp'] },
            walls: [
                { planes: ['027_plane_room_003'], objects: ['018_door'] },                         // opposite the windows
                { planes: ['027_plane_room_006'], objects: ['007_wardrobe', '008_pet_cabinet', '014_storage_box', '015_storage_box',
                    '016_suitcase', '017_storage_box', '022_guitar_case', '033_pet_storage', '034_pet_food', '035_pet_food'] },  // wardrobe side
                { planes: ['027_plane_room_002'], objects: ['009_painting', '010_painting', '011_painting'] },
                { planes: ['027_plane_room_004', '027_plane_room_005', '027_plane_room_007'], objects: ['019_window', '020_window', '028_hanging'] },
            ],
        },
    },
    roundabout: {
        frames: 0,
        shots: [['R1', 'R1', 'Chase'], ['R3', 'R2', 'Wheel close-up'], ['R4', 'R3', 'Monument'],
                ['R5', 'R4', 'Source view'], ['R2', 'R5', 'Drone rise']],
        reel: [0, 6.5, 12.5, 19, 25.209, 32.709],
        yaw: 0,
        frame: ['island_curb', 'mini', 'L27_suv', 'L20', 'L19', 'L28_convertible', 'L22', 'L24', 'L18', 'L33_clio', 'L26'],
        target: 'monument_group',                               // orbit around the roundabout's centre
        view: { az: -140, el: 46, dist: 2.3 },
        shell: 0x807d78,
        fixed: ['ground_far', 'ground_near', 'raised_parking_strip_left', 'island_curb', 'island_grass', 'island_platform'],
        pick: /^(mini|L\d+.*|sign_\d+|monument_group)$/,        // only the cars, the signs and the monument respond
        names: {
            mini: 'Mini', L27_suv: 'SUV', L28_convertible: 'Convertible', L33_clio: 'Renault Clio',
            L18: 'Car', L19: 'Car', L20: 'Car', L22: 'Car', L24: 'Car', L26: 'Car',
            monument_group: 'Monument', sign: 'Traffic sign',
        },
        fog: [1.7, 4.0],                                        // near / far in framing radii
    },
};

const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeInOut = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

if (root) boot();

function boot() {
    const A = root.dataset.assets;
    const tabs = [...root.querySelectorAll('.pg__tab')];
    const input = root.querySelector('.pg__input');
    const rgb = root.querySelector('.pg__rgb');
    const framesEl = root.querySelector('.pg__frames');
    const inputLabel = root.querySelector('.pg__input-label');
    const reel = root.querySelector('.pg__reel');
    const shotsEl = root.querySelector('.pg__shots');
    const viewerEl = root.querySelector('.pg__viewer');
    let scene = 'bedroom', shot = null, visible = false, viewer = null;

    /* ------------------------------------------------ input + cinematic render */

    const play = v => { const p = v.play(); if (p && p.catch) p.catch(() => {}); };
    function swap(v, src, poster) {
        const stage = v.closest('.stage');
        stage.classList.add('is-swapping');
        setTimeout(() => {
            v.poster = poster; v.src = src; v.load();
            if (visible) play(v);
            v.addEventListener('loadeddata', () => stage.classList.remove('is-swapping'), { once: true });
        }, 260);
    }
    function setInput(id, first) {
        const n = SCENES[id].frames;
        const apply = () => {
            input.classList.toggle('is-frames', !!n);
            inputLabel.textContent = n ? 'Input frames' : 'Input video';
            if (n) {
                framesEl.innerHTML = Array.from({ length: n }, (_, k) => `<img src="${A}/pg_${id}_frame${k + 1}.jpg" alt="">`).join('');
                rgb.pause(); rgb.removeAttribute('src'); rgb.removeAttribute('poster'); rgb.load();
                requestAnimationFrame(() => input.classList.remove('is-swapping'));
            } else {
                framesEl.innerHTML = '';
                rgb.poster = `${A}/pg_${id}_rgb.jpg`; rgb.src = `${A}/pg_${id}_rgb.mp4`; rgb.load();
                if (visible) play(rgb);
                rgb.addEventListener('loadeddata', () => input.classList.remove('is-swapping'), { once: true });
            }
        };
        if (first) { apply(); return; }
        input.classList.add('is-swapping');
        setTimeout(apply, 260);
    }
    function renderShots() {
        shotsEl.innerHTML = `<button class="pg__shot is-active" type="button" data-shot="">Full reel</button>` +
            SCENES[scene].shots.map(([file, label, title]) =>
                `<button class="pg__shot" type="button" data-shot="${file}" title="${title}">${label}</button>`).join('');
    }
    function setShot(id) {
        shot = id || null;
        [...shotsEl.children].forEach(b => {
            b.classList.toggle('is-active', (b.dataset.shot || null) === shot);
            b.setAttribute('aria-pressed', (b.dataset.shot || null) === shot);
            b.classList.remove('is-current');
        });
        reel.loop = true;
        const name = shot ? `pg_${scene}_${shot}` : `pg_${scene}_reel`;
        swap(reel, `${A}/${name}.mp4`, `${A}/${name}.jpg`);
    }
    shotsEl.addEventListener('click', e => {
        const b = e.target.closest('.pg__shot');
        if (b && (b.dataset.shot || null) !== shot) setShot(b.dataset.shot);
    });
    reel.addEventListener('timeupdate', () => {
        const t = reel.currentTime, buttons = shotsEl.children;
        if (shot) {
            const b = shotsEl.querySelector('.is-active');
            if (b && reel.duration) b.style.setProperty('--p', (t / reel.duration).toFixed(3));
            return;
        }
        const cuts = SCENES[scene].reel;
        for (let k = 0; k + 1 < cuts.length; k++) {
            const b = buttons[k + 1], on = t >= cuts[k] && t < cuts[k + 1];
            if (!b) continue;
            b.classList.toggle('is-current', on);
            if (on) b.style.setProperty('--p', ((t - cuts[k]) / (cuts[k + 1] - cuts[k])).toFixed(3));
        }
    });

    function setScene(id, first) {
        scene = id;
        tabs.forEach(t => { const on = t.dataset.scene === id; t.classList.toggle('is-active', on); t.setAttribute('aria-selected', on); });
        renderShots();
        shot = null;
        setInput(id, first);
        if (first) { reel.src = `${A}/pg_${id}_reel.mp4`; reel.loop = true; }
        else { swap(reel, `${A}/pg_${id}_reel.mp4`, `${A}/pg_${id}_reel.jpg`); reel.loop = true; }
        if (viewer) viewer.show(id);
    }
    tabs.forEach(t => t.addEventListener('click', () => { if (t.dataset.scene !== scene) setScene(t.dataset.scene); }));

    /* ------------------------------------------------ start when the section comes near */

    let started = false;
    const onVisible = on => {
        visible = on;
        if (on && !started) {
            started = true;
            setScene(scene, true);
            createViewer(viewerEl, A).then(v => { viewer = v; v.show(scene); v.run(visible); })
                .catch(err => { console.error(err); viewerEl.classList.add('is-failed'); viewerEl.querySelector('.pg__load span').textContent = '3D viewer needs WebGL'; });
        }
        [rgb, reel].forEach(v => { if (!v.getAttribute('src')) return; if (on) play(v); else v.pause(); });
        if (viewer) viewer.run(on);
    };
    if ('IntersectionObserver' in window) {
        new IntersectionObserver(es => es.forEach(e => onVisible(e.isIntersecting)), { rootMargin: '200px 0px' }).observe(root);
    } else onVisible(true);
    document.addEventListener('visibilitychange', () => { if (viewer) viewer.run(visible && !document.hidden); });
}

/* ==========================================================================
   clay viewer
   ========================================================================== */

async function createViewer(el, A) {
    const [THREE, { OrbitControls }, { GLTFLoader }, { MeshoptDecoder }, { RoomEnvironment }] = await Promise.all([
        import('three'),
        import('three/addons/controls/OrbitControls.js'),
        import('three/addons/loaders/GLTFLoader.js'),
        import('three/addons/libs/meshopt_decoder.module.js'),
        import('three/addons/environments/RoomEnvironment.js'),
    ]);
    const V3 = THREE.Vector3;
    const canvas = el.querySelector('canvas');
    const nameEl = el.querySelector('.pg__name');
    const hintEl = el.querySelector('.pg__hint');
    const toastEl = el.querySelector('.pg__toast');
    const loadEl = el.querySelector('.pg__load');
    if (window.matchMedia && window.matchMedia('(hover: none)').matches) hintEl.textContent = 'Drag to orbit \u00b7 Pinch to zoom \u00b7 Tap to inspect';
    const accent = new THREE.Color((getComputedStyle(document.body).getPropertyValue('--accent') || '#de94d8').trim());
    const BG = new THREE.Color(0x0b0e11);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setClearColor(BG, 1);
    renderer.localClippingEnabled = true;          // the close-up scans from clay to texture with a moving plane

    const world = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    world.environment = env; world.environmentIntensity = .38;
    const hemi = new THREE.HemisphereLight(0xfff4e6, 0x1a1e24, .4);
    const key = new THREE.DirectionalLight(0xfff0dc, 2.6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 3;
    const rim = new THREE.DirectionalLight(0xc6d6ff, .45);
    world.add(hemi, key, key.target, rim);

    const camera = new THREE.PerspectiveCamera(35, 1, .01, 100);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = .08;
    controls.enableZoom = false;                 // plain wheel scrolls the page; Ctrl/Cmd + wheel or pinch zooms
    controls.screenSpacePanning = true;
    controls.maxPolarAngle = Math.PI * .47;
    controls.rotateSpeed = .7;

    /* focus stage: the clicked object, drawn sharp over the blurred scene */
    const focusScene = new THREE.Scene();
    focusScene.environment = env; focusScene.environmentIntensity = .55;
    const fKey = new THREE.DirectionalLight(0xfff0dc, 2.0), fRim = new THREE.DirectionalLight(0xc6d6ff, .6);
    focusScene.add(new THREE.HemisphereLight(0xfff4e6, 0x1a1e24, .6), fKey, fRim, fKey.target, fRim.target);
    const clipClay = new THREE.Plane(new V3(0, 1, 0), 1e6), clipTex = new THREE.Plane(new V3(0, -1, 0), -1e6);
    const focusMat = new THREE.MeshStandardMaterial({ color: 0xf1ece2, roughness: .72, metalness: 0, side: THREE.DoubleSide,
                                                      clippingPlanes: [clipClay] });

    /* scene -> render target -> separable blur -> composite (tone mapping + sRGB applied here) */
    const rtOpts = { type: THREE.HalfFloatType, depthBuffer: true };
    const rtSharp = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, samples: 4 });
    const rtA = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    const rtB = rtA.clone();
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    const VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';
    const blurMat = new THREE.ShaderMaterial({
        uniforms: { tMap: { value: null }, uDir: { value: new THREE.Vector2() } },
        vertexShader: VS, toneMapped: false, depthTest: false, depthWrite: false,
        fragmentShader: `uniform sampler2D tMap; uniform vec2 uDir; varying vec2 vUv;
            void main() {
                vec4 c = texture2D(tMap, vUv) * .2270270;
                c += (texture2D(tMap, vUv + uDir * 1.3846154) + texture2D(tMap, vUv - uDir * 1.3846154)) * .3162162;
                c += (texture2D(tMap, vUv + uDir * 3.2307692) + texture2D(tMap, vUv - uDir * 3.2307692)) * .0702703;
                gl_FragColor = c;
            }`,
    });
    const compMat = new THREE.ShaderMaterial({
        uniforms: { tSharp: { value: rtSharp.texture }, tBlur: { value: rtA.texture }, k: { value: 0 } },
        vertexShader: VS, depthTest: false, depthWrite: false,
        fragmentShader: `uniform sampler2D tSharp, tBlur; uniform float k; varying vec2 vUv;
            void main() {
                vec3 c = mix(texture2D(tSharp, vUv).rgb, texture2D(tBlur, vUv).rgb, smoothstep(0., .6, k));
                c *= 1. - .62 * k;
                gl_FragColor = vec4(c, 1.);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`,
    });
    const pass = (mat, target) => { quad.material = mat; renderer.setRenderTarget(target); renderer.render(quad, quadCam); };

    /* ------------------------------------------------ loading */

    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const cache = {}, texCache = new Map();
    const owner = new WeakMap();                  // mesh -> its object record (userData must stay cloneable)
    let cur = null, want = null, running = false, raf = 0;

    const labelOf = (cfg, raw) => {
        const key = raw.replace(/^component_\d+_/, ''), base = key.replace(/_(\d+|procedural|second)$/, '');
        if (cfg.names[key] || cfg.names[base]) return cfg.names[key] || cfg.names[base];
        const s = base.replace(/_/g, ' ');
        return s.charAt(0).toUpperCase() + s.slice(1);
    };

    async function load(id) {
        const cfg = SCENES[id];
        const gltf = await loader.loadAsync(`${A}/pg_${id}.glb`, e => {
            if (e.total) loadEl.style.setProperty('--p', (e.loaded / e.total).toFixed(3));
        });
        const group = gltf.scene;
        group.rotation.y = THREE.MathUtils.degToRad(cfg.yaw || 0);
        group.updateMatrixWorld(true);
        const sroot = group.getObjectByName('scene_root') || group.children[0];
        const up = new V3(0, 1, 0).applyQuaternion(sroot.getWorldQuaternion(new THREE.Quaternion()).invert());
        // generated meshes do not all agree on winding: draw both sides, as the renders did
        const base = new THREE.MeshStandardMaterial({ color: 0xf0ebe1, roughness: .8, metalness: 0, side: THREE.DoubleSide });

        const objs = [], pick = [], lifts = [];
        for (const obj of [...sroot.children]) {        // every object hangs from a lift group (hover float)
            const lift = new THREE.Group();
            sroot.add(lift); lift.add(obj); lifts.push(lift);
        }
        group.updateMatrixWorld(true);
        for (const lift of lifts) {
            const obj = lift.children[0];
            const fixed = cfg.fixed.includes(obj.name);
            const mat = base.clone();
            if (fixed) mat.color.set(cfg.shell);                // shell a shade darker so the objects read against it
            const meshes = [];
            obj.traverse(m => { if (m.isMesh) { m.material = mat; m.castShadow = !fixed; m.receiveShadow = true; meshes.push(m); } });
            const box = new THREE.Box3().setFromObject(obj);
            const o = { obj, lift, mat, meshes, fixed, box, label: labelOf(cfg, obj.name), h: 0, lh: 0, gl: 0, ghost: 0, fade: 1,
                        pickable: !fixed && (!cfg.pick || cfg.pick.test(obj.name)),
                        radius: box.getBoundingSphere(new THREE.Sphere()).radius, offset: 0, paused: false, riders: [] };
            // this object's animations (cars: trajectory + wheel spin) run on their own mixer and clock
            const clips = gltf.animations.filter(c => c.tracks.every(t => {
                const n = THREE.PropertyBinding.parseTrackName(t.name).nodeName;
                return n === obj.name || obj.getObjectByName(n);
            }));
            if (clips.length) {
                o.mixer = new THREE.AnimationMixer(obj);
                clips.forEach(c => o.mixer.clipAction(c).play());
                o.D = Math.max(...clips.map(c => c.duration));
                const tr = clips.flatMap(c => c.tracks).find(t => t.name.endsWith('.position') && THREE.PropertyBinding.parseTrackName(t.name).nodeName === obj.name);
                if (tr) {
                    const v = tr.values, n = v.length;
                    o.moving = Math.hypot(v[n - 3] - v[0], v[n - 2] - v[1], v[n - 1] - v[2]) > 1e-3;   // parked cars stay put
                }
            }
            meshes.forEach(m => { owner.set(m, o); pick.push(m); });    // everything occludes; only o.pickable responds
            objs.push(o);
        }

        // framing
        const fbox = new THREE.Box3();
        objs.filter(o => cfg.frame.includes(o.obj.name)).forEach(o => fbox.expandByObject(o.obj));
        const center = fbox.getCenter(new V3()), radius = fbox.getBoundingSphere(new THREE.Sphere()).radius;
        const tobj = cfg.target && objs.find(o => o.obj.name === cfg.target);
        const target = tobj ? tobj.box.getCenter(new V3()).setY(center.y) : center.clone();
        objs.forEach(o => { o.liftH = THREE.MathUtils.clamp(o.radius * .18, radius * .012, radius * .04); });

        // stacking: B rests on A when most of B's footprint lies over A and B's base sits on A's upper part or top;
        // hovering A lifts everything resting on it, transitively (boxes on the wardrobe, bags on the desk ...)
        const tol = radius * .02, free = objs.filter(o => !o.fixed);
        const on = new Map(free.map(o => [o, []]));
        for (const b of free) {                        // each object rests on one support: the top closest to its base
            let best = null, gap = Infinity;
            for (const a of free) {
                if (a === b) continue;
                const P = a.box, Q = b.box;
                const ox = Math.min(P.max.x, Q.max.x) - Math.max(P.min.x, Q.min.x), oz = Math.min(P.max.z, Q.max.z) - Math.max(P.min.z, Q.min.z);
                if (ox <= 0 || oz <= 0 || ox * oz < .35 * (Q.max.x - Q.min.x) * (Q.max.z - Q.min.z)) continue;
                if (Q.min.y < P.min.y + Math.max(.15 * (P.max.y - P.min.y), tol) || Q.min.y > P.max.y + tol) continue;
                if (Math.abs(Q.min.y - P.max.y) < gap) { gap = Math.abs(Q.min.y - P.max.y); best = a; }
            }
            if (best) on.get(best).push(b);
        }
        for (const o of free) {
            const seen = new Set(), walk = x => on.get(x).forEach(y => { if (y !== o && !seen.has(y)) { seen.add(y); walk(y); } });
            walk(o); o.riders = [...seen];
        }

        // cutaway groups (bedroom)
        const groups = [];
        if (cfg.cutaway) {
            const byPrefix = p => objs.filter(o => o.obj.name.replace(/^component_/, '').startsWith(p));
            const planeMeshes = p => objs.filter(o => o.fixed).flatMap(o => o.meshes).filter(m => m.name.startsWith(p));
            const mk = (spec, kind) => {
                const g = { kind, planes: [], objs: spec.objects.flatMap(byPrefix), g: 0 };
                spec.planes.flatMap(planeMeshes).forEach(m => {
                    const mat = m.material.clone(); m.material = mat; m.castShadow = false;
                    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 25),
                        new THREE.LineBasicMaterial({ color: 0xf2ead8, transparent: true, opacity: 0, depthWrite: false }));
                    edges.visible = false; edges.userData.aux = true; m.add(edges);
                    // plane frame in world space, normal pointing into the room
                    m.geometry.computeBoundingBox();
                    const c = m.geometry.boundingBox.getCenter(new V3()).applyMatrix4(m.matrixWorld);
                    const nrm = m.geometry.attributes.normal;
                    const n = new V3(nrm.getX(0), nrm.getY(0), nrm.getZ(0)).applyMatrix3(new THREE.Matrix3().getNormalMatrix(m.matrixWorld)).normalize();
                    if (n.dot(new V3().subVectors(center, c)) < 0) n.negate();
                    g.planes.push({ m, mat, edges, c, n });
                });
                groups.push(g);
            };
            mk(cfg.cutaway.ceiling, 'ceiling');
            cfg.cutaway.walls.forEach(w => mk(w, 'wall'));
            // objects that can ghost get a depth pre-pass so only their nearest surface shows through
            groups.flatMap(g => g.objs).forEach(o => {
                o.pre = o.meshes.map(m => {
                    const d = new THREE.Mesh(m.geometry, new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true, opacity: 0 }));
                    d.renderOrder = 1; d.visible = false; d.userData.aux = true; m.add(d); return d;
                });
                o.meshes.forEach(m => { m.renderOrder = 2; });
                // its shadow fades with it (dithered depth), rather than vanishing in one frame
                o.shadowMat = new THREE.MeshDepthMaterial({ alphaHash: true });   // basic packing: the only one that reads opacity
                o.meshes.forEach(m => { m.customDepthMaterial = o.shadowMat; });
            });
        }
        const animated = objs.filter(o => o.mixer);
        return { id, cfg, group, objs, pick, groups, animated, center, target, radius, up };
    }

    /* ------------------------------------------------ view */

    function homePose(s) {
        const { az, el, dist } = s.cfg.view;
        const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el), r = dist * s.radius;
        return { pos: new V3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).multiplyScalar(r).add(s.target), target: s.target.clone() };
    }
    let camTween = null;
    function goHome(animated) {
        const p = homePose(cur);
        if (!animated || REDUCED) { camera.position.copy(p.pos); controls.target.copy(p.target); controls.update(); return; }
        camTween = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: p.pos, t1: p.target };
    }
    function stage(s) {
        world.remove(...Object.values(cache).filter(c => c.group).map(c => c.group));
        world.add(s.group);
        cur = s; hovered = null;
        const r = s.radius;
        camera.near = r * .01; camera.far = r * 80; camera.updateProjectionMatrix();
        controls.minDistance = r * .45; controls.maxDistance = r * 5;
        key.position.copy(s.center).add(new V3(-.55, 1, .35).normalize().multiplyScalar(r * 4));
        key.target.position.copy(s.center);
        Object.assign(key.shadow.camera, { left: -r * 1.4, right: r * 1.4, top: r * 1.4, bottom: -r * 1.4, near: r * .5, far: r * 8 });
        key.shadow.camera.updateProjectionMatrix();
        key.shadow.bias = -.0004; key.shadow.normalBias = r * .004;
        rim.position.copy(s.center).add(new V3(.8, .5, -.6).multiplyScalar(r * 4));
        world.fog = s.cfg.fog ? new THREE.Fog(BG, s.cfg.fog[0] * r, s.cfg.fog[1] * r) : null;
        goHome(false);
    }

    async function show(id) {
        want = id;
        exitFocus(true);
        if (!cache[id]) {
            el.classList.add('is-loading'); el.classList.remove('is-ready');
            loadEl.style.setProperty('--p', 0);
            cache[id] = load(id);
        }
        const s = await cache[id];
        cache[id] = s;
        if (want !== id) return;
        el.classList.add('is-switching');
        setTimeout(() => {
            if (want !== id) return;
            stage(s);
            el.classList.remove('is-loading', 'is-switching'); el.classList.add('is-ready');
        }, cur ? 320 : 0);
    }

    /* ------------------------------------------------ pointer */

    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let hovered = null, pointerIn = false, moved = true, down = null;
    const setNdc = e => {
        const r = canvas.getBoundingClientRect();
        ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    };
    function pickAt() {
        if (!cur) return null;
        // test against the resting pose: a lifted object must not float out from under the cursor
        const lifted = cur.objs.filter(o => o.h > 0), saved = lifted.map(o => o.lift.position.clone());
        lifted.forEach(o => { o.lift.position.set(0, 0, 0); o.lift.updateMatrixWorld(true); });
        ray.setFromCamera(ndc, camera);
        let found = null;
        for (const hit of ray.intersectObjects(cur.pick, false)) {
            const o = owner.get(hit.object);
            if (!o || !o.lift.visible || hit.object.material.opacity < .5) continue;   // see through faded walls / objects
            found = o.pickable ? o : null;                                             // anything else in front blocks
            break;
        }
        lifted.forEach((o, i) => { o.lift.position.copy(saved[i]); o.lift.updateMatrixWorld(true); });
        return found;
    }
    canvas.addEventListener('pointermove', e => {
        setNdc(e); pointerIn = true; moved = true;
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) down.drag = true;
        if (focus && down && focus.phase !== 'out') {
            const dx = e.clientX - down.lx, dy = e.clientY - down.ly;
            down.lx = e.clientX; down.ly = e.clientY;
            focus.vx = dx * .008; focus.vy = dy * .008;
            spinBy(focus.vx, focus.vy);
        }
    });
    canvas.addEventListener('pointerleave', () => { pointerIn = false; moved = true; });
    canvas.addEventListener('pointerdown', e => {
        down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, drag: false };
        hintEl.classList.add('is-used');
        if (e.pointerType === 'touch') controls.enableZoom = true;
        if (focus) canvas.setPointerCapture(e.pointerId);
    });
    let dragged = false;
    canvas.addEventListener('pointerup', () => { dragged = !!(down && down.drag); down = null; });
    canvas.addEventListener('click', e => {
        if (dragged) return;                                        // the end of an orbit / turn, not a click
        setNdc(e);
        if (focus) {
            if (focus.phase === 'in' || focus.phase === 'hold') {
                ray.setFromCamera(ndc, camera);
                if (!ray.intersectObject(focus.pivot, true).length) exitFocus();
            }
            return;
        }
        const o = pickAt();
        if (o) enterFocus(o);
    });
    // plain wheel keeps scrolling the page; Ctrl/Cmd + wheel (and trackpad pinch) zooms
    let toastTimer = 0;
    el.addEventListener('wheel', e => {
        controls.enableZoom = !focus && (e.ctrlKey || e.metaKey);
        if (!controls.enableZoom && !focus && hintEl.classList.contains('is-used')) {   // only once they have used the viewer
            toastEl.textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Hold ⌘ and scroll to zoom' : 'Hold Ctrl and scroll to zoom';
            el.classList.add('is-toast'); clearTimeout(toastTimer);
            toastTimer = setTimeout(() => el.classList.remove('is-toast'), 1400);
        }
    }, { capture: true, passive: true });
    el.querySelector('.pg__reset').addEventListener('click', () => { exitFocus(); goHome(true); });
    el.querySelector('.pg__close').addEventListener('click', () => exitFocus());
    window.addEventListener('keydown', e => { if (e.key === 'Escape' && focus) exitFocus(); });

    /* ------------------------------------------------ focus: fly the object up close */

    let focus = null;
    function enterFocus(o) {
        o.paused = true;
        const box = new THREE.Box3().setFromObject(o.obj);
        const center = box.getCenter(new V3()), r = box.getBoundingSphere(new THREE.Sphere()).radius;
        const pivot = new THREE.Group(), inner = new THREE.Group();
        const clone = o.obj.clone(true);
        o.obj.updateWorldMatrix(true, false);
        o.obj.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
        clone.traverse(m => {
            if (m.userData.aux) m.visible = false;                         // ghost pre-pass, wall edges
            else if (m.isMesh) { m.material = focusMat; m.castShadow = m.receiveShadow = false; m.renderOrder = 0; }
        });
        inner.position.copy(center).negate();
        inner.add(clone); pivot.add(inner); pivot.position.copy(center);
        focusScene.add(pivot);
        o.lift.visible = false;
        // the textured mesh is fetched on the first click and scanned in bottom-up once it arrives
        const key = `${cur.id}/${o.obj.name}`;
        if (!texCache.has(key)) texCache.set(key, loader.loadAsync(`${A}/pgt/${cur.id}/${o.obj.name}.glb`).then(g => g.scene, () => null));
        texCache.get(key).then(src => {
            if (!src || !focus || focus.o !== o || focus.phase === 'out') return;
            const tex = src.clone(true);
            tex.position.copy(clone.position); tex.quaternion.copy(clone.quaternion); tex.scale.copy(clone.scale);
            tex.traverse(m => {
                if (!m.isMesh) return;
                m.castShadow = m.receiveShadow = false;
                [].concat(m.material).forEach(mt => { if (!mt.clippingPlanes) { mt.clippingPlanes = [clipTex]; mt.needsUpdate = true; } });
            });
            inner.add(tex);
            focus.rvGoal = 1;
        });
        // destination: in front of the camera, big enough to fill about 3/4 of the frame height
        const dir = camera.getWorldDirection(new V3());
        const dist = camera.position.distanceTo(controls.target) * .62;
        const halfH = dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, camera.aspect);
        focus = { o, pivot, center, r, phase: 'in', t: 0, vx: 0, vy: 0, rv: 0, rvGoal: 0,
                  p0: center.clone(), p1: camera.position.clone().addScaledVector(dir, dist), s1: halfH * .78 / r, q: new THREE.Quaternion() };
        fKey.position.copy(camera.position).add(new V3(-1, 1.2, .4).multiplyScalar(dist)); fKey.target.position.copy(focus.p1);
        fRim.position.copy(focus.p1).add(new V3(1, .3, -1).multiplyScalar(dist)); fRim.target.position.copy(focus.p1);
        controls.enabled = false;
        el.classList.add('is-focus');
        nameEl.textContent = o.label;
        hovered = null;
    }
    function spinBy(ax, ay) {
        const qy = new THREE.Quaternion().setFromAxisAngle(new V3(0, 1, 0), ax);
        const right = new V3(1, 0, 0).applyQuaternion(camera.quaternion);
        const qx = new THREE.Quaternion().setFromAxisAngle(right, ay);
        focus.q.premultiply(qy).premultiply(qx);
    }
    function exitFocus(instant) {
        if (!focus || (focus.phase === 'out' && !instant)) return;
        if (instant) { endFocus(); return; }
        focus.phase = 'out'; focus.t = 0; focus.rvGoal = 0;       // scan back to clay on the way home
        focus.from = { p: focus.pivot.position.clone(), s: focus.pivot.scale.x, q: focus.pivot.quaternion.clone() };
        el.classList.remove('is-focus');
    }
    function endFocus() {
        if (!focus) return;
        focusScene.remove(focus.pivot);
        clipClay.constant = 1e6; clipTex.constant = -1e6;
        focus.o.lift.visible = true; focus.o.paused = false;
        focus = null; controls.enabled = true; compMat.uniforms.k.value = 0;
        el.classList.remove('is-focus');
    }
    const scanBox = new THREE.Box3();
    function updateFocus(dt) {
        const f = focus;
        if (f.rv !== f.rvGoal) {                       // clay above the plane, texture below it
            f.rv = f.rvGoal > f.rv ? Math.min(1, f.rv + dt / (REDUCED ? .01 : .9)) : Math.max(0, f.rv - dt / (REDUCED ? .01 : .6));
        }
        if (f.rv > 0 || f.rvGoal > 0) {
            scanBox.setFromObject(f.pivot);
            const pad = (scanBox.max.y - scanBox.min.y) * .02 + 1e-4;
            const h = THREE.MathUtils.lerp(scanBox.min.y - pad, scanBox.max.y + pad, easeInOut(f.rv));
            clipClay.constant = -h; clipTex.constant = h;
        }
        if (f.phase === 'in') {
            f.t = Math.min(1, f.t + dt / (REDUCED ? .01 : 1.05));
            const e = easeInOut(f.t);
            f.pivot.position.lerpVectors(f.p0, f.p1, e);
            f.pivot.scale.setScalar(1 + (f.s1 - 1) * e);
            f.pivot.quaternion.setFromAxisAngle(new V3(0, 1, 0), e * Math.PI * 2).premultiply(f.q);   // one full turn on the way in
            compMat.uniforms.k.value = e;
            if (f.t >= 1) { f.phase = 'hold'; }
        } else if (f.phase === 'hold') {
            if (!down) {                               // idle: keep turning slowly; a flick carries on and settles
                f.vx *= Math.exp(-dt * 3); f.vy *= Math.exp(-dt * 3);
                spinBy(f.vx + (REDUCED ? 0 : dt * .35), f.vy);
            }
            f.pivot.quaternion.copy(f.q);
        } else {
            f.t = Math.min(1, f.t + dt / (REDUCED ? .01 : .75));
            const e = easeInOut(f.t);
            f.pivot.position.lerpVectors(f.from.p, f.center, e);
            f.pivot.scale.setScalar(f.from.s + (1 - f.from.s) * e);
            f.pivot.quaternion.slerpQuaternions(f.from.q, new THREE.Quaternion(), e);
            compMat.uniforms.k.value = 1 - e;
            if (f.t >= 1) endFocus();
        }
    }

    /* ------------------------------------------------ per-frame state */

    let T = 0;
    const tmp = new V3();
    function update(dt) {
        const s = cur;
        if (camTween) {
            camTween.t = Math.min(1, camTween.t + dt / .9);
            const e = easeInOut(camTween.t);
            camera.position.lerpVectors(camTween.p0, camTween.p1, e);
            controls.target.lerpVectors(camTween.t0, camTween.t1, e);
            if (camTween.t >= 1) camTween = null;
        }
        controls.update();

        if (moved && !focus && !down) {
            moved = false;
            hovered = pointerIn ? pickAt() : null;
            el.classList.toggle('is-hover', !!hovered);
        }

        // animations: one shared clock; a hovered / inspected car holds still, then eases back into the traffic
        T += dt;
        for (const o of s.animated) {
            const hold = o.paused || o === hovered;
            if (hold) o.offset -= dt;
            else if (o.offset) {
                const goal = Math.round(o.offset / o.D) * o.D;
                o.offset += (goal - o.offset) * (1 - Math.exp(-dt * 1.2));
                if (Math.abs(goal - o.offset) < 1e-3) o.offset = 0;
            }
            const t = Math.max(0, T + o.offset);
            o.mixer.setTime(t);
            if (o.moving) {                            // dip out and back in across the clip's loop point
                const u = t % o.D;
                o.fade = Math.min(1, u / .22, (o.D - u) / .22);
            }
        }

        // hover lift + glow
        const k = 1 - Math.exp(-dt * 9);
        const group = hovered ? [hovered, ...hovered.riders] : [];
        for (const o of s.objs) {
            const goal = group.includes(o) ? 1 : 0, glow = o === hovered ? 1 : 0;
            if (goal) o.lh = hovered.liftH;            // the whole stack rises by the same height
            if (!goal && !glow && o.h < 1e-4 && o.gl < 1e-4) {
                if (o.h || o.gl) { o.h = o.gl = 0; o.lift.position.set(0, 0, 0); o.mat.emissive.setRGB(0, 0, 0); }
                continue;
            }
            o.h += (goal - o.h) * k; o.gl += (glow - o.gl) * k;
            const bob = goal ? Math.sin(T * 2.4) * .08 : 0;
            o.lift.position.copy(s.up).multiplyScalar(o.lh * o.h * (1 + bob));
            o.mat.emissive.copy(accent).multiplyScalar(.16 * o.gl);
        }

        // cutaway: fade the walls the camera is outside of, and what stands against them
        const cam = camera.position;
        for (const g of s.groups) {
            // cosine between the wall's inward normal and the direction to the camera: > 0 inside, < 0 outside;
            // the fade follows it smoothly through the plane instead of switching when the camera crosses it
            const cosOf = p => tmp.subVectors(cam, p.c).normalize().dot(p.n);
            const v = !g.planes.length ? 1 : g.kind === 'ceiling' ? Math.min(...g.planes.map(cosOf)) : cosOf(g.planes[0]);
            const goal = 1 - THREE.MathUtils.smoothstep(v, -.35, 0);
            g.g += (goal - g.g) * (1 - Math.exp(-dt * 2.5));
            for (const p of g.planes) {
                const op = 1 - g.g * .93;
                setOpacity(p.mat, op, false);
                p.edges.visible = g.g > .01; p.edges.material.opacity = g.g * .3;
            }
            for (const o of g.objs) o.ghost = g.g;
        }
        for (const o of s.objs) {
            if (o.fixed) continue;
            const op = (1 - o.ghost * .8) * o.fade;
            setOpacity(o.mat, op, !!o.pre);
            if (o.pre) o.pre.forEach(d => { d.visible = op < .999; });
            if (o.shadowMat) {                         // shadow goes once the object is mostly see-through: a short dithered fade, no grain at rest
                o.sh = (o.sh ?? 1) + ((o.ghost > .5 ? 0 : 1) - (o.sh ?? 1)) * (1 - Math.exp(-dt * 8));
                o.shadowMat.opacity = o.sh;
            }
            o.meshes.forEach(m => { m.castShadow = o.fade > .5 && (o.sh ?? 1) > .01; });
        }
    }
    function setOpacity(mat, op, prepass) {
        const tr = op < .999;
        if (mat.transparent !== tr) { mat.transparent = tr; mat.depthWrite = !tr || prepass; mat.needsUpdate = true; }
        if (prepass && tr) mat.depthFunc = THREE.LessEqualDepth;
        mat.opacity = op;
    }

    /* ------------------------------------------------ render */

    let W = 0, H = 0;
    function resize() {
        const w = el.clientWidth, h = el.clientHeight;
        if (!w || !h || (w === W && h === H)) return;
        W = w; H = h;
        renderer.setSize(w, h, false);
        const pr = renderer.getPixelRatio();
        rtSharp.setSize(Math.round(w * pr), Math.round(h * pr));
        rtA.setSize(Math.round(w * pr / 2), Math.round(h * pr / 2)); rtB.setSize(Math.round(w * pr / 2), Math.round(h * pr / 2));
        camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(el);

    function render() {
        const k = compMat.uniforms.k.value;
        if (!focus && k <= 0) { renderer.setRenderTarget(null); renderer.render(world, camera); return; }
        renderer.setRenderTarget(rtSharp); renderer.render(world, camera);
        const px = 1 / rtA.width, py = 1 / rtA.height;
        blurMat.uniforms.tMap.value = rtSharp.texture; blurMat.uniforms.uDir.value.set(px * 1.5, 0); pass(blurMat, rtB);
        blurMat.uniforms.tMap.value = rtB.texture; blurMat.uniforms.uDir.value.set(0, py * 1.5); pass(blurMat, rtA);
        blurMat.uniforms.tMap.value = rtA.texture; blurMat.uniforms.uDir.value.set(px * 3.5, 0); pass(blurMat, rtB);
        blurMat.uniforms.tMap.value = rtB.texture; blurMat.uniforms.uDir.value.set(0, py * 3.5); pass(blurMat, rtA);
        pass(compMat, null);
        if (focus) {
            renderer.autoClear = false; renderer.clearDepth();
            renderer.render(focusScene, camera);
            renderer.autoClear = true;
        }
    }

    let last = 0;
    function frame(now) {
        raf = running ? requestAnimationFrame(frame) : 0;
        const dt = Math.min(.05, (now - (last || now)) / 1000); last = now;
        resize();
        if (!cur) return;
        if (focus) updateFocus(dt);
        update(dt);
        render();
    }

    return {
        show,
        run(on) {
            running = on;
            if (on && !raf) { last = 0; raf = requestAnimationFrame(frame); }
        },
    };
}
