# Browser Platform Capabilities and Constraints (as of October 2026) for a 3D Online MMO Client Port

Scope: graphics, threading/main loop, memory, storage/asset delivery, networking, audio, input, distribution, and shipped-game precedents, with the Spiral Knights profile in mind (2011-era Java/OpenGL 2.x client, GLSL 1.x shaders, ~1–2 GB asset tree, streaming OGG audio, persistent TCP connection). Status dates/versions are cited inline; anything not confirmed by a fetched source is listed under Gaps.

---

## 1. Graphics: WebGL2 vs WebGPU in 2026, and mapping desktop OpenGL 2.x/GLSL 1.x to the web

### Takeaway
WebGL2 is the only universally safe target in October 2026 (every major browser incl. iOS Safari 15+ via ANGLE-on-Metal). WebGPU is "supported in all four engines" on paper, but Firefox on Linux/Android and Intel Macs is still not shipped and Chrome Android requires Android 12+ with Qualcomm/ARM GPUs; the pragmatic plan for an OpenGL-2-era renderer is WebGL2 first (Emscripten GL subset or a gl4es/Regal-style layer), with WebGPU as an optional later backend.

### Cited Findings

**WebGPU support status**
- Chrome/Edge: WebGPU available on Windows (D3D12), macOS, ChromeOS from Chrome 113; Android from Chrome 121 only for devices on Android 12+ with Qualcomm/ARM GPUs; Linux "in progress". Firefox: Windows from Firefox 141, macOS Tahoe 26 on ARM64 from Firefox 145; Linux, Android and Intel Macs "in progress". Safari: Safari 26 on macOS Tahoe 26, iOS 26, iPadOS 26, visionOS 26 (article dated 2025-11-25). — [web.dev](https://web.dev/blog/webgpu-supported-major-browsers)
- The community-maintained gpuweb Implementation Status wiki (last edited 2026-05-28) lists Firefox Mac support at 145 (macOS 26+) and 147 (all macOS versions), Firefox Linux as Nightly-only, and Firefox Android behind a flag/disabled by default; Mozilla "expects to ship on Linux in 2026". — [gpuweb wiki](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)
- Safari first shipped WebGPU in Safari 26 (June 2025 WWDC beta; Sept 2025 release per the web.dev timeline). Safari 27 beta (post dated 2026-06-08) adds the WGSL `clip_distances` built-in and fixes to `GPUDevice.onuncapturederror`, `maxStorageBuffersInFragmentStage` limits, and multisampled resolve targets. — [WebKit blog, Safari 27 beta](https://webkit.org/blog/17967/news-from-wwdc26-webkit-in-safari-27-beta/)
- **WebGPU compatibility mode** (runs WebGPU on OpenGL ES 3.1-class hardware) shipped as opt-in in Chrome 146 (post dated 2026-02-25): request with `navigator.gpu.requestAdapter({ featureLevel: "compatibility" })`; initial backend is OpenGL ES 3.1 on Android; ChromeOS (GLES 3.1) and Windows (D3D11) "under exploration"; core-capable devices still return a core adapter and the app must stay within compat limits unless it enables `"core-features-and-limits"`. Milestones: Chrome 133 enabled via `featureLevel`, 136 restrictions lifted, 139 origin trial, 146 ship. — [Chrome Developers, New in WebGPU 146](https://developer.chrome.com/blog/new-in-webgpu-146)
- WebGPU Fundamentals states "nearly all WebGL2 programs could be converted to run on compatibility mode" and that any app following compat limits is a valid core WebGPU app. — [webgpufundamentals](https://webgpufundamentals.org/webgpu/lessons/webgpu-compatibility-mode.html)
- Chrome removed the `isFallbackAdapter` attribute in Chrome 140 and never shipped fallback (software) adapters, so there is no browser-provided WebGPU→WebGL2 fallback; that is an app-level decision. — [Chrome Developers, New in WebGPU 136](https://developer.chrome.com/blog/new-in-webgpu-136)

**WebGL2 support status and Safari specifics**
- WebGL 2.0 reached Safari 15 on macOS and iOS, completing support in all major browsers; Apple built Safari's WebGL on ANGLE and spent over a year improving ANGLE's Metal backend, so Safari now runs WebGL on Metal. — [Khronos blog](https://www.khronos.org/blog/webgl-2-achieves-pervasive-support-from-all-major-web-browsers)
- WebKit integrated ANGLE as its primary WebGL backend starting June 2019 specifically because that was the easiest path to conformant WebGL 2. — [WebKit wiki: ANGLE for WebGL](https://trac.webkit.org/wiki/AngleforWebGL)
- Safari 15 shipped with a significant WebGL point-rendering performance regression attributed to the new Metal backend (WebKit bug 230749, Sept 2021), still reported reproducible in Safari 16.1.1. — [WebKit Bugzilla 230749](https://bugs.webkit.org/show_bug.cgi?id=230749); [Apple Developer Forums](https://developer.apple.com/forums/thread/696821)
- Godot's official web export docs (current) state: only the Compatibility renderer (WebGL 2.0) is supported on web; Forward+/Mobile are not; Godot "doesn't currently support WebGPU"; and "Safari has WebGL 2.0 issues that other browsers don't," so Chromium or Firefox are recommended. — [Godot docs](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)
- Unity Web requires a WebGL 2–capable, 64-bit browser with WebAssembly; "Safari versions before 15 don't support WebGL 2"; Safari doesn't support IndexedDB for content in an iframe; mobile support is iOS Safari 15+ and Chrome 58+ on Android. — [Unity Manual: browser compatibility](https://docs.unity3d.com/6000.2/Documentation/Manual/webgl-browsercompatibility.html)
- Unity 6 added WebGPU as a web graphics backend (Unity says developed with Google; a third-party aggregator dates the stable backend to Unity 6.1, April 2025 — sources conflict on 6.0 vs 6.1). — [Unity web solutions page](https://unity.com/solutions/web); [Cinevva (aggregator)](https://app.cinevva.com/news/2025-04-22-unity-6-1-webgpu)

**Mapping GLSL 1.x / WebGL1-style code to WebGL2 / GLSL ES 3.00** (concrete migration list)
- `#version 300 es` must be the first line (no comments/blank lines before); `attribute`→`in`; vertex `varying`→`out`, fragment `varying`→`in`; `gl_FragColor` is removed and replaced with a user-declared `out vec4` (name may not start with `gl_`); `texture2D`/`textureCube` → overloaded `texture()`. — [webgl2fundamentals: WebGL1 to WebGL2](https://webgl2fundamentals.org/webgl/lessons/webgl1-to-webgl2.html)
- Features that were WebGL1 extensions and are core in WebGL2: depth textures, float/half-float textures, VAOs (`gl.createVertexArray()` instead of `OES_vertex_array_object`), standard derivatives, instancing, `UNSIGNED_INT` indices, `gl_FragDepth`, min/max blend equations, texture LOD, multiple draw buffers (MRT), sRGB textures and framebuffers, NPOT textures with mipmaps, texture fetch in vertex shaders. Float textures need sized internal formats (`RGBA32F`, `R32F`); rendering to float still needs `EXT_color_buffer_float`; linear filtering of float needs `OES_texture_float_linear`; depth textures need sized formats (`DEPTH_COMPONENT24`, `DEPTH24_STENCIL8`, ...). Attribute locations should be fixed with `layout(location=N)` or `bindAttribLocation`; element-array binding is VAO state. — [webgl2fundamentals](https://webgl2fundamentals.org/webgl/lessons/webgl1-to-webgl2.html)
- MSAA offscreen: WebGL2 `renderbufferStorageMultisample(target, samples, internalFormat, w, h)` with sized color/depth/stencil formats (`RGBA8`, `SRGB8_ALPHA8`, `DEPTH24_STENCIL8`, etc.; `DEPTH_STENCIL` unsized is not allowed); resolve via `blitFramebuffer`. MDN marks it Baseline widely available since September 2021. — [MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/renderbufferStorageMultisample)
- Emscripten GL modes: (1) default WebGL-friendly subset of OpenGL ES 2.0/3.0 (no client-side arrays; WebGL spec ch.6 differences); (2) `-sFULL_ES2` (emulates client-side vertex arrays) / `-sFULL_ES3` (emulates buffer mapping); (3) `-sLEGACY_GL_EMULATION` for desktop GL 1.x features such as immediate mode and `glNormalPointer`, "by no means complete" (sufficient to port the Sauerbraten-based BananaBread). Non-default modes "are less efficient". `-sMAX_WEBGL_VERSION=2` enables WebGL2 contexts; `-sMIN_WEBGL_VERSION=2` drops WebGL1 code. Legacy-mode tuning flags: `-sGL_UNSAFE_OPTS`, `-sGL_FFP_ONLY`, `Module.GL_MAX_TEXTURE_IMAGE_UNITS`. Alternatives named for unsupported desktop GL: **Regal** (desktop GL on ES2) and **gl4es** (OpenGL 2.1 profile on ES2, aimed at games). WebGL extensions must be explicitly enabled (`emscripten_webgl_enable_extension`) unless SDL/EGL/GLUT/GLFW does it. — [Emscripten OpenGL support](https://emscripten.org/docs/porting/multimedia_and_graphics/OpenGL-support.html)

**Texture compression on the web**
- `WEBGL_compressed_texture_s3tc` (DXT1/3/5): caniuse shows support across desktop browsers and on iOS Safari in recent versions (the S3TC and S3TC_sRGB tables disagree on the iOS start version — one shows 8+, the other 14.5+). `WEBGL_compressed_texture_astc`: iOS Safari 12+. — [caniuse S3TC](https://caniuse.com/wf-webgl-compressed-texture-s3tc); [caniuse S3TC sRGB](https://caniuse.com/wf-webgl-compressed-texture-s3tc-srgb); [caniuse ASTC](https://caniuse.com/wf-webgl-compressed-texture-astc)
- WebKit: ASTC was only exposed on a GLES3 (WebGL2) context, not GLES2, and the iOS Simulator did not support it (test on real devices). — [WebKit bug 202836](https://www2.webkit.org/show_bug.cgi?id=202836)
- Basis Universal / KTX2 is the standard answer to the format split: textures stored once as ETC1S (~0.3–3 bpp, JPEG-like quality levels) or UASTC (8 bpp, high quality) and transcoded at load to BC1-7, ETC1/2, ASTC or PVRTC; the C++ transcoder compiles to WebAssembly with a JS wrapper and only optional zstd dependency. — [Basis Universal README](https://github.com/BinomialLLC/basis_universal)
- Safari 27 beta added validation that `compressedTexImage` checks the compressed-format extension is enabled (so calling without enabling the extension now errors where it may have silently worked). — [WebKit blog, Safari 27 beta](https://webkit.org/blog/17967/news-from-wwdc26-webkit-in-safari-27-beta/)

### Inferences
- For Spiral Knights' GLSL 1.x shaders: a mechanical translation pass (version pragma, `in`/`out`, output variable, `texture()`, add `precision mediump float;` defaults in fragment shaders — the precision item is from general GLSL ES knowledge and not from a fetched source) will cover most material shaders; anything using fixed-function state (lighting, fog, texture environments) must be rewritten as shaders or routed through gl4es/Regal/`LEGACY_GL_EMULATION`, all of which are documented as incomplete and slower. Budget for rewriting the renderer backend to shader-only ES3 rather than relying on emulation in production.
- Ship textures as KTX2/Basis (or pre-split DXT for desktop + ASTC for iOS/Android) because no single hardware format is guaranteed everywhere; detect extensions at runtime, never by UA.
- Target WebGL2 first. WebGPU adds a WGSL translation burden (GLSL→WGSL via naga/Tint) for little gain on a 2011-era forward renderer, and still excludes Firefox Linux/Android/Intel-Mac users and pre-Android-12 devices. Keep the renderer abstracted so a WebGPU backend (which, via compat mode, is converging on the WebGL2 device base) can be added later.
- Expect Safari-specific WebGL2 bugs/perf cliffs (Godot explicitly warns; Safari 15–16 had known regressions) and plan a Safari test matrix early.

### Gaps
- No fetched source gave current (2026) numbers for WebGPU vs WebGL2 draw-call throughput; "where WebGPU is faster" is therefore unquantified here.
- Could not confirm current ETC2 (`WEBGL_compressed_texture_etc`) exposure on Safari from a 2025–2026 source; only 2019–2021 reports that it was missing.
- Did not fetch naga/Tint/glslang/SPIRV-Cross documentation; shader-translation tool specifics (e.g., naga's GLSL frontend maturity) are not covered.
- Firefox WebGPU on Linux/Android ship date after May 2026 unverified (no Firefox release notes fetched).

---

## 2. Threads and the main loop: SharedArrayBuffer, COOP/COEP, Workers/OffscreenCanvas, Asyncify/JSPI, rAF and throttling

### Takeaway
Wasm threads require cross-origin isolation (`Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`), which static hosts like GitHub Pages cannot set (service-worker shim exists); JSPI—the zero-overhead replacement for Asyncify—is now in Chrome 137+, Safari 27, and scheduled for Firefox 153, so a blocking game loop can be kept with a feature-detected Asyncify fallback.

### Cited Findings
- Emscripten pthreads: "Pthreads code will not work in deployed environment unless [COOP/COEP] headers are correctly set." `-sPROXY_TO_PTHREAD` runs `main()` on a worker to keep the UI thread free; `Atomics.wait` is unavailable on the main thread so Emscripten busy-waits (affects `pthread_join`, `usleep`, `pthread_mutex_lock`), and errors if `ALLOW_BLOCKING_ON_MAIN_THREAD=0`; `pthread_create` needs a return to the event loop unless `PTHREAD_POOL_SIZE` pre-creates workers (can be set to `navigator.hardwareConcurrency`); DOM/WebGL operations must be proxied to the main thread; `ALLOW_MEMORY_GROWTH` + pthreads is "especially tricky" and makes JS access to Wasm memory slower; Firefox Nightly's default worker cap is 20 per domain (`dom.workers.maxPerDomain`). — [Emscripten pthreads](https://emscripten.org/docs/porting/pthreads.html)
- SharedArrayBuffer availability: Chrome 68, Edge 79, Firefox 79, Safari 15.2 (macOS and iOS); global usage 96.94%. — [caniuse](https://caniuse.com/sharedarraybuffer)
- Cross-origin isolation is required for SharedArrayBuffer, `performance.measureUserAgentSpecificMemory()` and high-resolution timers; COEP `require-corp` blocks cross-origin resources lacking CORP/CORS headers (ads, iframes, CDN assets, fonts) unless `COEP: credentialless` is used, which has narrower support. — [web.dev cross-origin isolation guide](https://web.dev/cross-origin-isolation-guide); [Wasmer COOP/COEP how-to](https://docs.wasmer.io/javascript-sdk/how-to/coop-coep-headers)
- GitHub Pages does not allow custom response headers; GitHub said custom headers are "a scenario they would support" with no ETA; `<meta>` tags do not work for COOP/COEP. — [GitHub Community discussion #13309](https://github.com/orgs/community/discussions/13309); [three.js forum](https://discourse.threejs.org/t/sharedarraybuffer-availability/28956)
- `coi-serviceworker` (gzuidhof) injects COOP/COEP via a service worker; it must be served from your origin, un-bundled, over HTTPS/localhost; it reloads the page on first visit; options `coepCredentialless`, `shouldRegister`, `doReload`, `quiet`. — [coi-serviceworker repo](https://github.com/gzuidhof/coi-serviceworker); [Wasmer guide](https://docs.wasmer.io/javascript-sdk/how-to/coop-coep-headers)
- Godot's web export: "Thread Support" is an export toggle; threaded builds need COOP/COEP; enabling the PWA option applies a service-worker workaround "that simulates them"; the single-threaded build "works well on macOS and iOS, where multithreaded exports had compatibility issues". — [Godot docs](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html); Godot reintroduced single-threaded web builds in 4.3 (GH-85939) because cross-origin isolation was hard to meet on itch.io/CrazyGames and conflicted with ads/payments. — [Godot 4.3 progress report](https://godotengine.org/article/progress-report-web-export-in-4-3/); community thread notes SharedArrayBuffer "had serious issues causing the browser to freeze" on macOS/iOS. — [Godot forum](https://forum.godotengine.org/t/godot-4-3-will-finally-fix-web-builds-no-sharedarraybuffers-required/38885)
- Unity Web: C# managed threads unsupported (no multithreaded GC in Wasm); native C/C++ multithreading is an experimental Player setting requiring COOP, COEP and CORP headers. — [Unity technical overview](https://docs.unity3d.com/6000.2/Documentation/Manual/webgl-technical-overview.html)
- OffscreenCanvas: Chrome 69, Edge 79, Firefox 105, Safari 17.0 (16.2–16.6 partial); global 96.76%. — [caniuse](https://caniuse.com/offscreencanvas)
- Asyncify: transforms Wasm so it can pause/resume; code "much larger" and runtime overhead "something like 50% or so" (build with `-O3`); JSPI (`-sJSPI`) uses the VM's Promise integration with no code-size increase but requires explicit `JSPI_IMPORTS`/`JSPI_EXPORTS` (Embind: `emscripten::async()`); Asyncify limitations: indirect calls defeat analysis (`ASYNCIFY_IGNORE_INDIRECT`, `ASYNCIFY_ONLY/ADD/REMOVE`), suspending imports must be listed in `ASYNCIFY_IMPORTS`, never start a second async op while one is in flight, `ASYNCIFY_STACK_SIZE` for stack overflow; `emscripten_sleep()` yields to the event loop. — [Emscripten Asyncify](https://emscripten.org/docs/porting/asyncify.html)
- JSPI shipping: Chrome 137, Firefox 153, Safari 27 (WebAssembly feature table). — [features.json](https://raw.githubusercontent.com/WebAssembly/website/main/features.json); Chrome shipped without flag in 137 (May 2025); Mozilla's intent-to-ship shows Nightly-only from Fx152 and default-on in Firefox 153; Safari 27 beta listed. — [OpenReplay blog](https://blog.openreplay.com/jspi-javascript-wasm-bridge/); [Chromium intent to ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/w_jCD4gf7Bc); Safari 27 beta (2026-06-08) explicitly lists JSPI as newly supported ("lets synchronous-looking WebAssembly code suspend and wait for JavaScript Promises"). — [WebKit blog](https://webkit.org/blog/17967/news-from-wwdc26-webkit-in-safari-27-beta/)
- Background tabs: Chrome has not fired `requestAnimationFrame` for hidden pages since 2011; background timers aligned to ~1/sec (Chrome 11); budget-based throttling after 10 s in background with 0.01 s/s regeneration (Chrome 57); pages playing audible audio are exempt; long tasks can be throttled up to 100× their duration. — [Chrome: Background tabs](https://developer.chrome.com/blog/background_tabs); Chrome 88 added intensive throttling of chained timers on hidden pages. — [Chrome 88 timer throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)
- The 2019 Doom 3 (idTech 4) WebAssembly port was single-threaded because "multithreading is not yet ready on the Web (mostly due to Spectre/Meltdown)"; 7 weeks full-time effort, full WebGL renderer backend. — [InfoQ](https://www.infoq.com/news/2019/07/doom3-web-assembly-port/); [d3wasm repo](https://github.com/gabrielcuvillier/d3wasm)
- Emscripten port anecdotes: refactoring to `emscripten_set_main_loop` "proved too much effort" for one Commander Keen port (fell back to the slower Emterpreter, Asyncify's predecessor); every third-party library needs its own Wasm build; timing functions return different units (`performance.now()`). — [Commander Keen port](https://www.jamesfmackenzie.com/projects/porting-commander-keen-to-webassembly/); [Domino Demon devlog](https://vanyle0.itch.io/domino-demon/devlog/662625/the-challenges-of-porting-games-to-webassembly)

### Inferences
- An MMO client with a blocking network thread and a blocking render loop has three viable shapes: (a) single-threaded, loop converted to `emscripten_set_main_loop`/rAF (most portable, works on itch.io/GitHub Pages without isolation); (b) `PROXY_TO_PTHREAD` + OffscreenCanvas with pthreads (best fidelity to the original architecture; requires isolation headers, so hosting choice is constrained, and Safari has a history of SAB issues); (c) JSPI to keep blocking semantics on a single thread (Chrome/Safari 27 now; Firefox 153 pending — needs Asyncify fallback until then).
- Godot's reversal to single-threaded-by-option is strong evidence that an MMO aiming at broad distribution should make the no-threads build the baseline and treat threads as a progressive enhancement.
- Because rAF stops in background tabs but a persistent game connection must keep answering keepalives, the network pump must not depend on rAF (use a worker or `setInterval` and expect ~1 Hz throttling; audible audio lifts timer throttling).

### Gaps
- Emscripten's `OFFSCREENCANVAS_SUPPORT`/`OFFSCREEN_FRAMEBUFFER` docs page was not fetched; exact behaviour of GL proxying from pthreads is not documented here.
- Firefox 153's actual ship date for JSPI (relative to Oct 2026) unverified; features.json records "153" but no release note was fetched.
- Safari's behaviour for Web Worker timer throttling in background tabs not researched.

---

## 3. Memory: 4 GB Wasm32 limit, Memory64, per-tab ceilings, WasmGC, keeping a 1–2 GB asset game under budget

### Takeaway
Wasm32 is capped at 4 GB (and in practice far less on mobile: iOS kills the tab under system pressure without a clean OOM, reloads can shrink available memory to tens of MB); Memory64 shipped in Chrome 133/Firefox 134 but is flag-only in Safari (STP 251) and costs 10–100% in load/store performance, so the design must stream and evict assets rather than rely on a large heap.

### Cited Findings
- Memory64 shipped in Firefox 134 and Chrome 133; the JS API caps memories at 16 GB; 32-bit Wasm reserves 4 GB of address space per module to elide bounds checks, whereas Memory64 needs explicit bounds checks on every access, with measured slowdowns "roughly 10% to over 100% (about 2x)" depending on workload; recommendation: use it only if you need >4 GB. — [SpiderMonkey blog, 2025-01-15](https://spidermonkey.dev/blog/2025/01/15/is-memory64-actually-worth-using.html)
- WebAssembly feature table: memory64 Chrome 133, Firefox 134, Safari "flag" (note: Safari Technology Preview 251), Node 24; gc Chrome 119 / Firefox 120 / Safari 18.2; threads Chrome 74 / Firefox 79 / Safari 14.1 (iOS 14.5); exnref exceptions Chrome 137 / Firefox 131 / Safari 18.4; SIMD Chrome 91 / Firefox 89 / Safari 16.4; relaxed SIMD Chrome 114 / Firefox 145 / Safari flag; multi-memory Chrome 120 / Firefox 125 / Safari none; tail-call Chrome 112 / Firefox 121 / Safari 18.2. — [features.json](https://raw.githubusercontent.com/WebAssembly/website/main/features.json)
- WebKit Memory64 work: tracking bug opened Oct 2025; interpreter-tier (IPInt) support committed Dec 2025; a Feb 2026 comment calls Memory64 "the only left WASM feature to be supported for parity with Chromium and Firefox on Phase 5 features"; OMG-tier `memory.grow`/`memory.size` committed April 2026. Not confirmed closed. — [WebKit bug 300538](https://bugs.webkit.org/show_bug.cgi?id=300538); [WebKit bug 311449](https://bugs.webkit.org/show_bug.cgi?id=311449)
- WasmGC: on by default in Chrome 119, Firefox 120, Safari 18.2 (Dec 2024 completes all major browsers). — [Chrome Developers WasmGC](https://developer.chrome.com/blog/wasmgc)
- iOS Safari memory: per WebKit bug 221530, Firefox enforced a 2 GB ceiling and Chrome allowed 4 GB on desktop but "about 500–700 MB in practice on mobile"; Safari does not fail `memory.grow()` — iOS kills and reloads the tab based on system pressure (WebKit maintainer comment), so apps cannot handle OOM gracefully. — [WebKit bug 221530](https://bugs.webkit.org/show_bug.cgi?id=221530)
- Repeated reloads shrink available Wasm memory on iOS (observed ~1 GB → 300 MB → 28 MB across back-to-back reloads; Unity users reported it as Safari "crashing"). — [WebKit bug 269777](https://www2.webkit.org/show_bug.cgi?id=269777); iOS 17.2/17.3 allocation failures at 200–800 MB after reload until browser restart, possibly fixed by iOS 17.6/18 betas. — [WebKit bug 222097](https://bugs.webkit.org/show_bug.cgi?id=222097)
- Shared-memory (`-pthread`) builds hit allocation failures depending on `MAXIMUM_MEMORY` in Safari (Emscripten issue). — [emscripten #19374](https://github.com/emscripten-core/emscripten/issues/19374)
- Unity Web GC "runs only once at the end of every frame" rather than incrementally; no C# threads. — [Unity technical overview](https://docs.unity3d.com/6000.2/Documentation/Manual/webgl-technical-overview.html)
- A SciChart write-up (secondary) describes Chromium full Memory64 support from Chrome 133 with no flag and says Safari lags. — [SciChart](https://www.scichart.com/blog/memory64-unlocking-webassemblys-true-potential-with-16gb-of-in-browser-memory/)

### Inferences
- Plan for a working set well under 1 GB on desktop and ~300–500 MB on mobile Safari/Android Chrome; the 1–2 GB asset tree must live in storage (OPFS/Cache) and be paged into the Wasm heap on demand, with aggressive release of zone assets on area transitions.
- Set `INITIAL_MEMORY` conservatively and prefer `ALLOW_MEMORY_GROWTH` without pthreads (growth + pthreads is documented as problematic); on iOS, the only "OOM handler" is a page reload, so persist session state frequently.
- Do not depend on Memory64 (Safari flag-only, performance cost); it is not needed if asset streaming is done properly.
- For a Java-sourced client, a managed runtime compiled to Wasm (TeaVM/CheerpJ-style) adds GC-heap overhead on top of asset memory; WasmGC-targeting toolchains let the browser GC manage objects but this was not researched here (see Gaps).

### Gaps
- No authoritative per-tab memory ceiling numbers for Android Chrome in 2025–2026 (only a 2021 bug comment with 500–700 MB).
- Safari's stable release ship date for Memory64 is unconfirmed; Safari 27 beta notes do not mention it.
- No source fetched on TeaVM/CheerpJ/JWebAssembly memory behaviour or WasmGC backends for Java.

---

## 4. Storage and asset delivery: OPFS, IndexedDB, Cache API, quotas, File System Access API, range requests, compression, how big web games package data, PWA persistence

### Takeaway
Per-origin quota is generous on desktop (Chrome ≈60% of disk, Firefox 10%/10 GiB best-effort or 50% persistent, Safari ≈60% since macOS 14/iOS 17) and OPFS/IndexedDB/Cache share it, but Safari's 7-day no-interaction eviction for non-installed sites and silent LRU eviction mean a 1–2 GB local cache must be treated as rebuildable from a CDN; use OPFS sync access handles in a worker for the asset store, Brotli (universal) with zstd as an optional extra, and a Chrome-only "pick your install folder" fast path.

### Cited Findings

**Quotas and eviction**
- Chrome/Chromium: up to 60% of total disk per origin (persistent and best-effort); browser-wide cap 80% of disk after which best-effort origins are LRU-evicted; `storage.persist()` auto-approved/denied by engagement, no prompt. Firefox: best-effort = min(10% of disk, 10 GiB group limit per site); persistent up to 50% of disk (max 8 TiB); `persist()` shows a user prompt. Safari (macOS 14/iOS 17+): ≈60% of disk per origin for browser apps and Home-Screen web apps, ≈15% for embedded WKWebView; overall caps 80%/20%; earlier Safari gave 1 GiB then asked the user; `persist()` auto-decided; 7-day proactive eviction of script-created data when the origin had no click/tap interaction in the last 7 days of use (only with cross-site tracking prevention on). IndexedDB, Cache API and OPFS share one per-origin quota and throw `QuotaExceededError`; eviction is all-or-nothing per origin; persistent origins are skipped by LRU eviction. Web Storage (`localStorage`) is capped at ~5 MiB. Page last modified 2026-01-05. — [MDN: Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- Safari's 7-day cap began in iOS/iPadOS 13.4 and Safari 13.1 and covers IndexedDB, service worker registrations and the Cache API; installed Home-Screen web apps are exempt; the wipe is silent. — [web.dev: Storage for the web](https://web.dev/articles/storage-for-the-web); [browser-storage.com iOS 7-day workaround](https://www.browser-storage.com/browser-storage-fundamentals-quotas/storage-quotas-eviction-policies/ios-safari-7-day-storage-eviction-workaround/)
- OPFS: origin-private, not user-visible, "highly optimized for performance," in-place writes; `createSyncAccessHandle()` (synchronous `read/write/truncate/flush/getSize/close`) is available only in Web Workers; File System Access API writes go through a temp file and are "fairly slow" for large updates; OPFS is Baseline widely available since March 2023, secure contexts only, subject to the normal quota; clearing site data deletes it. — [MDN OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)

**Letting the user point at a local install folder**
- `window.showDirectoryPicker()` (read by default, `{mode:'readwrite'}` for write) is supported in Chrome/Edge 86+ and most Chromium browsers (Windows/macOS/ChromeOS/Linux/Android); Brave behind a flag; Firefox and Safari not supported for the pickers; permissions "are not always persisted between sessions" — re-check with `queryPermission()`/`requestPermission()`; handles are serializable into IndexedDB; drag-and-drop yields handles via `DataTransferItem.getAsFileSystemHandle()`; OS core folders may be blocked; fallback is `<input type="file" webkitdirectory>`. — [Chrome Developers: File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access); web.dev's directory guide lists `showDirectoryPicker` as Chrome/Edge 86 and "not supported" in Firefox/Safari, with `webkitdirectory` supported since Firefox 50 and Safari 11.1. — [web.dev: Open a directory](https://web.dev/articles/files/open-a-directory)

**Compression / Content-Encoding**
- zstd: Chrome 123, Edge 123 (118–122 disabled by default), Firefox 126, Safari macOS 26.0 partial (no full support through 27.1 TP), Safari iOS 26.3 full (26.0–26.2 partial), global 85.6% (83.13% full). — [caniuse zstd](https://caniuse.com/zstd); Firefox 126.0.1 advertised zstd only over HTTPS. — [Mozilla bug 1871963](https://bugzilla.mozilla.org/show_bug.cgi?id=1871963); a Cloudflare community report describes zero-byte responses when zstd was negotiated — test the CDN. — [Cloudflare community](https://community.cloudflare.com/t/zstd-empty/728017)
- MDN lists `gzip`, `br`, `zstd`, `dcb`, `dcz` as Content-Encoding values; the header is Baseline since July 2015 (per-encoding versions in the live compat table, not extracted). — [MDN Content-Encoding](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Encoding)
- Godot: serve `.wasm` as `application/wasm` (other MIME types prevent start-up optimisations); `.wasm` gzips to ~¼ size; Brotli precompression suggested; GitHub Pages gzips on the fly, itch.io does not compress on the fly, GitLab Pages supports only manual gzip precompression. — [Godot docs](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)
- itch.io serves `.gz`/`.br` pre-compressed files with the matching Content-Encoding and auto-gzips html/js/css/svg/wasm/wav/glb/pck. — [itch.io HTML5 docs](https://itch.io/docs/creators/html5)

**How shipped web games package/cache data**
- Unity Web: asset data (`.data`, Addressables, AssetBundles) is cached in the browser cache; Unity's Build-and-Run server does not support data caching. — [Unity technical overview](https://docs.unity3d.com/6000.2/Documentation/Manual/webgl-technical-overview.html)
- Godot Web: a `.pck` plus `.wasm`, both "usually large"; custom export templates with unused features disabled shrink the Wasm payload. — [Godot docs](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)
- Eaglercraft: every build ships `assets.epk`, a compiled copy of the game resources; third-party format guides describe asset EPKs as gzip/zlib-compressed archives with an `EAGPKG$` signature and CRC32 checks (another guide says some EPKs are renamed ZIPs) — sources conflict; `epkcompiler` builds a new `assets.epk` from a resources folder. — [docs.fileformat.com EPK](https://docs.fileformat.com/game/epk); [minecraftmaps.com](https://www.minecraftmaps.com/minecraft-epk-files)
- Flyff Universe: a blog observer describes assets as "downloaded and cached on the fly" in the HTML5 client (unofficial). — [richardorilla.website](https://www.richardorilla.website/browser-gaming.html)
- Doom 3 web port shipped the full demo data to the browser (single-threaded, WebGL backend). — [d3wasm](https://github.com/gabrielcuvillier/d3wasm)

**CDN economics**
- Cloudflare R2: no egress fee; standard storage listed at $0.015/GB-month with a free tier of 10 GB storage, 1M Class A and 10M Class B operations (third-party pricing summary, 2026). — [Spendbase (secondary)](https://www.spendbase.co/?p=35561)
- Bunny CDN listed at $0.01/GB standard, $0.005/GB high-volume (secondary; another aggregator notes an April 2026 price change with garbled figures). — [Toolradar](https://toolradar.com/tools/bunnycdn/pricing); [CostBench changelog](https://costbench.com/changelog/bunnycdn-price-increase-2026-04/)

### Inferences
- Architecture that fits the quotas: a content-addressed asset store in OPFS written from a worker with sync access handles (fastest path), fronted by an in-memory LRU, fed by HTTP range requests or per-asset fetches from an egress-free bucket (R2) behind a CDN. Treat the local store as a cache: validate a manifest hash on start and re-fetch anything missing (Safari may have evicted it).
- Request `navigator.storage.persist()` at first launch and push PWA install on iOS to escape the 7-day eviction; do not rely on it being granted.
- Offer "Locate existing Spiral Knights install" via `showDirectoryPicker()` on Chromium (persist the handle in IndexedDB, re-prompt for permission per session) and `webkitdirectory` drag/drop elsewhere; this can save most of the initial multi-GB download for returning desktop users, but cannot be the only path.
- Precompress with Brotli (universal) and optionally zstd (Chrome/Firefox/iOS 26.3+); GPU textures in KTX2 need no extra HTTP compression beyond their supercompression.

### Gaps
- No primary source for HTTP range-request behaviour of specific CDNs or for maximum OPFS single-file size; MDN mentions no 2 GB per-file limit either way.
- Unity/PlayCanvas documentation on exact packaging (e.g., PlayCanvas asset streaming, Unity's `.data` vs Addressables sizing guidance) not fetched.
- Official Cloudflare R2 / Bunny pricing pages were not fetched; numbers above are from aggregators.
- Eaglercraft's EPK format details are from third-party file-format sites, not the Eaglercraft repository.

---

## 5. Networking: no raw sockets; WebSocket proxies, WebTransport status, WebRTC DataChannel, TLS, and how browser MMOs do it

### Takeaway
Browsers still expose no raw TCP/UDP; a legacy TCP game server needs either native WebSocket support added server-side or a WebSocket↔TCP bridge (websockify, Node `ws`, or a proxy plugin like Eaglercraft's), served as `wss://` from an HTTPS page. WebTransport (HTTP/3/QUIC, reliable streams + unreliable datagrams) became Baseline when Safari 26.4 shipped it in March 2026 (Chrome 97, Edge 98, Firefox 114), making it a viable second transport for latency-sensitive traffic.

### Cited Findings
- Unity Web: "Browsers don't allow direct IP socket access"; `System.Net` and ICMP ping unsupported. — [Unity technical overview](https://docs.unity3d.com/6000.2/Documentation/Manual/webgl-technical-overview.html)
- websockify: WebSocket-to-TCP proxy (originally noVNC's wsproxy); implementations in Python (primary), Node.js (websockify-js), and C/Clojure/Ruby (websockify-other); since 0.5.0 only RFC 6455 binary framing; `wss://` via `--cert/--key` (auto-detects TLS by sniffing the first byte; `--ssl-only`); `--token-plugin`/`--token-source`/`--host-token` route one instance to multiple pre-configured TCP targets; no latency/buffering guidance given. — [novnc/websockify](https://github.com/novnc/websockify)
- Eaglercraft architecture: the browser client connects over `wss://` to a BungeeCord/Velocity proxy running the EaglerXServer plugin, which translates WebSocket traffic into the Minecraft TCP protocol the backend expects; the static client site (HTML/JS/asset bundles) is hosted separately. — [Sealos: Eaglercraft client/server/gateway](https://sealos.io/blog/eaglercraft-client-server-gateway/); [Sealos: Eaglercraft server guide](https://sealos.io/blog/eaglercraft-server)
- WebTransport: Chrome 97, Edge 98, Firefox 114, Safari 26.4 (macOS and iOS), Samsung Internet 18; global usage 91.64%; Chrome 91–94 flag-only. — [caniuse WebTransport](https://caniuse.com/webtransport)
- Safari 26.4 (2026-03-24): WebTransport over HTTP/3+QUIC with reliable and unreliable delivery mixable on one connection, bidirectional/unidirectional streams, datagrams, backpressure; falls back to HTTP/2 over TCP with the same API when QUIC is unavailable. — [WebKit: Safari 26.4](https://webkit.org/blog/17862/webkit-features-in-safari-26-4/)
- Analysis (2026-04-23): WebTransport ≈ "WebSockets with QUIC replacing TCP" plus multiplexed streams and reliable/unreliable choice; WebRTC needs ICE/STUN/TURN and signaling and is peer-to-peer oriented, while WebTransport suits client-server; WebTransport lacks built-in congestion control comparable to WebRTC's. — [WebRTC.ventures](https://webrtc.ventures/2026/04/webtransport-is-now-baseline-what-it-means-for-real-time-media/)
- An NPS paper frames WebSockets as TCP connections from browser to server "without the overhead or latency of HTTP polling" and WebGL as plugin-free hardware 3D. — [NPS Calhoun](https://calhoun.nps.edu/entities/publication/0d7d20f4-f4e8-4f38-9d4f-44dc4526d34c)
- itch.io: external requests from embedded HTML5 games must use HTTPS, no exceptions. — [itch.io HTML5 docs](https://itch.io/docs/creators/html5)

**Browser-MMO precedents**
- RuneScape HTML5/WebGL client: announced March 2013 as RuneScape 3's client, closed beta April 2013 ("first browser game of its size and complexity using this technology"); excluded from the July 2013 RS3 launch; Jagex admitted at RuneFest 2013 the HTML5 promise "couldn't be realised in the current generation of web browsers" due to performance/stability; replaced by the native C++ NXT client released 18 April 2016, which carried over much of the HTML5 client's architecture. — [RuneScape Wiki: HTML5](https://runescape.wiki/w/HTML5); [RuneScape Wiki: RuneTek 5](https://runescape.wiki/w/RuneTek_5); [Game Developer](https://gamedeveloper.com/business/jagex-turns-to-html5-for-i-runescape-3-i-)
- Realm of the Mad God Exalt is the Unity port created because the Flash engine lost Adobe support after 2020; sources do not describe its transport. — [RealmEye wiki](https://www.realmeye.com/wiki/realm-of-the-mad-god-exalt/1)
- Flyff Universe (Gala Lab) relaunched 15 June 2022 as a browser 3D MMORPG on PC/Mac/mobile with no download; coverage cites an "all-new graphics engine," antialiasing, advanced shaders and post-processing; no transport/engine details published. — [MMOs.com](https://mmos.com/news/flyff-universe-global-cross-platform-relaunch)
- "Realm of Echoes" (2025–26 indie) is a real-time browser MMORPG built with three.js and Rust/Wasm. — [three.js forum](https://discourse.threejs.org/t/realm-of-echoes-a-real-time-browser-mmorpg-built-with-three-js-and-rust-wasm/93006)

### Inferences
- For Spiral Knights' persistent TCP protocol, the lowest-risk path is a thin WebSocket gateway that frames the existing byte stream 1:1 (websockify-style or a purpose-built Node/Go/Java bridge) terminating TLS, then later adding native WebSocket acceptance to the game server to remove a hop. WebSocket preserves TCP ordering/reliability semantics the protocol already assumes, so client logic needs no redesign.
- WebTransport datagrams are attractive for movement/position updates but require HTTP/3 infrastructure and a new server endpoint; with Safari support only since 26.4 (March 2026), keep WebSocket as the mandatory fallback. WebRTC DataChannel (unreliable mode) is the alternative for pre-26.4 Safari, at the cost of ICE/STUN/TURN complexity.
- Latency: a WebSocket hop adds one proxy traversal; TLS is mandatory from HTTPS pages (`wss://`), so certificates/terminators are part of the deployment, not optional.

### Gaps
- No sources found describing Drakensang Online's, Agar.io's, Torn's or Albion's browser transport.
- No documentation fetched on nginx `stream`/WebSocket configurations for TCP bridging (nginx proxies WebSocket→WebSocket; a protocol translator is still required — this is background knowledge, not a cited finding).
- WebRTC DataChannel unreliable-mode specifics and WebTransport server implementations (e.g., Go/Rust libraries) were not researched.

---

## 6. Audio: Web Audio API as OpenAL replacement, streaming, autoplay policy, latency, AudioWorklet

### Takeaway
Emscripten ships an OpenAL 1.1 implementation on Web Audio (`-lopenal`) with HRTF/float32/loop-point extensions and automatic resume on the first click/keypress, which covers a 2011-era OpenAL soundscape; the hard constraints are the autoplay policy (AudioContext starts suspended until a user gesture) and the fact that low-latency, fully featured mixing on the web generally needs threads/AudioWorklet (Godot's single-threaded mode drops effects/reverb/Doppler).

### Cited Findings
- Emscripten OpenAL: own OpenAL 1.1 implementation with Web Audio backend; `-lopenal` required; extensions `ALC_SOFT_pause_device`, `ALC_SOFT_HRTF`, `AL_EXT_float32`, `AL_SOFT_loop_points`, `AL_SOFT_source_length`, `AL_EXT_source_distance_model`, `AL_SOFT_source_spatialize`; audio processing requires yielding to the JS main loop (poll once per `emscripten_set_main_loop` iteration; busy-waiting blocks forever); browsers block audio until user input — the OpenAL and SDL1 layers listen for a click/keypress on document/canvas and resume; AudioContext sample rate is browser/hardware-set (typically 44100 or 48000 Hz) with simple linear resampling. — [Emscripten Audio](https://emscripten.org/docs/porting/Audio.html)
- Chrome autoplay policy (Web Audio covered since Chrome 71): an AudioContext created before a user gesture starts `suspended`; call `resume()` (or `start()` on a node) from a click handler; check `AudioContext.state`/`statechange`; `"click"` is the recommended activation event; cross-origin iframes need the `autoplay` permissions policy; policy explicitly affects web games. — [Chrome Developers: Autoplay](https://developer.chrome.com/blog/autoplay)
- Godot web (4.3+): default "Sample" playback is low-latency without threads but lacks AudioEffects, reverb, Doppler and procedural audio, and positional audio "may behave inconsistently"; "Stream" playback has full features but more latency, especially without threads; prompt the player to click/press a key because browsers may block autoplay. — [Godot docs](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html); Godot's 4.3 report framed the threads decision as good audio with threads vs worse audio single-threaded. — [Godot 4.3 progress report](https://godotengine.org/article/progress-report-web-export-in-4-3/)
- Unity Web uses a custom Web Audio back end that "supports only basic audio functionality". — [Unity technical overview](https://docs.unity3d.com/6000.2/Documentation/Manual/webgl-technical-overview.html)
- itch.io: disabling "Click to Play" auto-starts the game, "which may mute audio in some browsers". — [itch.io HTML5 docs](https://itch.io/docs/creators/html5)
- Audible audio exempts a page from Chrome's background timer throttling (silent audio does not). — [Chrome: Background tabs](https://developer.chrome.com/blog/background_tabs)

### Inferences
- Keep OpenAL calls and link Emscripten's implementation for SFX/3D positional audio; gate the whole client start behind a "Play" click so the AudioContext is created in a user gesture (this also satisfies Pointer Lock and fullscreen gesture requirements).
- For streamed OGG music, prefer `<audio>`/MediaElementSource (browser-side streaming decode) over `decodeAudioData` on whole files (which decodes fully into memory and competes with the asset budget); a custom AudioWorklet mixer is the route if the engine's mixer must be preserved, and it benefits from (but does not strictly require) shared memory.

### Gaps
- Emscripten's Wasm Audio Worklets page and AudioWorklet latency figures were not fetched.
- No source retrieved comparing `decodeAudioData` vs MediaElement memory/latency in 2025–2026; the inference above is from general knowledge.
- Safari-specific Web Audio quirks (e.g., sample-rate switching, interruption on route change) not researched.

---

## 7. Input: Pointer Lock, keyboard/reserved shortcuts and Keyboard Lock, Gamepad, touch, IME/text chat

### Takeaway
Pointer Lock works everywhere relevant but is gesture-gated and Escape-exits; the browser owns shortcuts like Ctrl/Cmd+W unless the page is fullscreen with Keyboard Lock, which Chromium has had since 68 and Safari gained in 26.4 via a different API shape (`requestFullscreen({keyboardLock:"browser"})`), while Firefox has neither.

### Cited Findings
- Pointer Lock: `element.requestPointerLock()` is called from a click handler; after the user exits via the default unlock gesture (ESC listed as a trigger) an engagement gesture is required before re-locking; `{unadjustedMovement: true}` disables OS mouse acceleration, may throw `NotSupportedError` on some platforms (fall back to plain lock); `movementX/Y` keep reporting while `clientX/Y` freeze; sandboxed iframes need `allow-pointer-lock`; one iframe locked at a time; MDN rates the API "Limited availability" (not Baseline). — [MDN Pointer Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API)
- Keyboard Lock (`navigator.keyboard.lock([codes])`): captures keys the OS allows, secure context, needs transient user activation, each call replaces the prior lock; still "Experimental/limited availability". — [MDN Keyboard.lock](https://developer.mozilla.org/en-US/docs/Web/API/Keyboard/lock); support: Chrome 68+, Edge 79+, Firefox none (through 160), Safari none through 27.2 (for this API shape); global 76.63%. — [caniuse mdn-api_keyboard_lock](https://caniuse.com/mdn-api_keyboard_lock)
- Safari 26.4 added Fullscreen Keyboard Lock: `element.requestFullscreen({ keyboardLock: "browser" })` lets a page capture keys the browser normally handles while fullscreen; a game can use Escape for its menu, and users exit fullscreen by holding Escape 1.5 s; lock releases on fullscreen exit or tab switch; HTTPS only. — [WebKit: Safari 26.4](https://webkit.org/blog/17862/webkit-features-in-safari-26-4/)
- Gamepad: Safari 27 beta fixes `gamepadconnected` firing on visionOS without prior permission (indicating permission gating exists there). — [WebKit: Safari 27 beta](https://webkit.org/blog/17967/news-from-wwdc26-webkit-in-safari-27-beta/)
- Unity forum users reported WebGL reliability issues on mobile including keyboard input problems (user reports, not Unity confirmation). — [Unity Discussions](https://discussions.unity.com/t/web-runtime-updates-are-here-take-your-browser-to-the-next-level/934582)
- itch.io forces fullscreen click-to-launch on mobile regardless of desktop embed settings. — [itch.io HTML5 docs](https://itch.io/docs/creators/html5)

### Inferences
- For a third-person action MMO (Spiral Knights uses mouse-aim/WASD), Pointer Lock with `unadjustedMovement` on desktop and a fullscreen+keyboard-lock path on Chromium/Safari 26.4+ gives near-native control; design the UI so ESC-to-menu works even where keyboard lock is unavailable (Firefox) and never bind critical actions to browser-reserved combos (Ctrl+W/T/N, Cmd+Q).
- In-game chat with IME (CJK) is best done with a real DOM `<input>`/`<textarea>` overlaid on the canvas rather than canvas-side key handling; this was not researched beyond Unity's mobile keyboard complaints and should be prototyped on iOS early.

### Gaps
- Gamepad API and Touch Events compatibility tables were not fetched (both are long-standing, but per-browser specifics such as Safari's gamepad permission gating are not documented here).
- No source on IME composition handling for canvas games.
- MDN's Pointer Lock compatibility table (exact versions, mobile status) was not rendered in the fetch.

---

## 8. Distribution and hosting: static hosts and headers, itch.io limits, CDN cost, Steam, Chrome Web Store, PWAs

### Takeaway
The threads decision and the hosting decision are the same decision: GitHub Pages cannot set COOP/COEP (service-worker shim only), Cloudflare Pages/Netlify can via `_headers`, itch.io caps HTML5 games at 500 MB extracted / 200 MB per file / 1,000 files (raise by request), Steam requires a native wrapper (Electron/NW.js), and the Chrome Web Store stopped hosting apps on desktop in 2017; a multi-GB MMO should be its own HTTPS origin with a CDN and an installable PWA.

### Cited Findings
- itch.io HTML5: ZIP only; max 500 MB extracted total, 200 MB per extracted file, 1,000 files, 240-char paths; case-sensitive; relative paths only; folder requests return 403; external requests must be HTTPS; HTML5 games can only accept donations (paid access requires "Downloadable"); contact support for raised limits. The docs page does not mention SharedArrayBuffer/COOP/COEP. — [itch.io HTML5 docs](https://itch.io/docs/creators/html5); an itch.io admin: regular accounts have a 1 GB per-file upload limit but HTML5 has separate limits. — [itch.io forum](https://itch.io/t/1925786/what-is-the-maximum-file-size-you-can-put-in-itchio); community reports and Godot's progress report say itch.io exposes a SharedArrayBuffer toggle that sets the isolation headers (secondary). — [Godot 4.3 report](https://godotengine.org/article/progress-report-web-export-in-4-3/); [summerengine guide](https://www.summerengine.com/de/blog/godot-web-export-guide)
- Cloudflare Pages: `_headers` file in the output directory; path patterns with `*`/`:name`; up to 100 header rules; 2,000 chars per line; headers not applied to Pages Functions responses. — [Cloudflare Pages headers](https://developers.cloudflare.com/pages/configuration/headers/)
- GitHub Pages: no custom headers (see §2); Netlify/Cloudflare suggested as alternatives. — [GitHub Community #13309](https://github.com/orgs/community/discussions/13309)
- Steam: "Steam does not take a URL" — every build is files in a depot with a launch option pointing at an executable; HTML5 games ship inside Electron or NW.js; Steamworks has no Electron/JS support, so Greenworks or steamworks.js bridges are used; CrossCode shipped on Steam in NW.js and Vampire Survivors reached 1.0 on Steam on Phaser. — [Summer Engine: three.js on Steam](https://www.summerengine.com/make-great-games/threejs-game-on-steam); [Cocos: exporting to Steam](https://cocos.com/en/post/f1eba978f8a36c92875063b46fd7e3a1); [Drawize blog](https://www.drawize.com/blog/tech-how-to-release-html5-game-on-steam)
- Chrome Web Store removed the Apps and Games sections for Windows/macOS/Linux in December 2017; extensions and themes remain; Chrome Apps were supported through June 2021 on desktop; Google pointed developers to PWAs. — [9to5Google](https://9to5google.com/2017/12/06/google-chrome-apps-dead-web-store/); [Laptop Mag](https://www.laptopmag.com/news/google-is-killing-chrome-apps-what-it-means-for-you)
- PWA/persistence: Home-Screen/Dock web apps get the browser-app quota (~60% of disk) in Safari and are exempt from the 7-day eviction; Chrome grants `persist()` based on engagement. — [MDN quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria); [web.dev storage](https://web.dev/articles/storage-for-the-web)
- Unity 6 offers a PWA template and WebView embedding for mobile. — [Unity browser compatibility](https://docs.unity3d.com/6000.2/Documentation/Manual/webgl-browsercompatibility.html)
- Godot: enabling the PWA export option applies a service-worker header workaround; GitHub Pages gzips on the fly, itch.io does not. — [Godot docs](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)
- CDN: R2 egress-free; Bunny ≈$0.01/GB (secondary sources, see §4). — [Spendbase](https://www.spendbase.co/?p=35561); [Toolradar](https://toolradar.com/tools/bunnycdn/pricing)

### Inferences
- itch.io's 500 MB extracted cap rules it out for the full asset tree; it could host only a bootstrap client that streams assets from an external HTTPS CDN (allowed, since external HTTPS requests are permitted), and only if the asset CDN sends CORP/CORS headers when the threaded build is used.
- A dedicated origin (Cloudflare Pages/Netlify static front + R2/S3-class bucket + CDN) is the only configuration that supports all of: COOP/COEP, Brotli/zstd precompression, range requests, multi-GB storage and PWA installability.
- Steam is a wrapper-only channel; if a Steam build is desired, the web client doubles as an Electron/NW.js desktop client, which also sidesteps browser memory ceilings.

### Gaps
- Netlify `_headers` documentation was not fetched (GitHub discussion mentions Netlify as a host that supports custom headers).
- itch.io's official stance on SharedArrayBuffer (the toggle) was not found in itch.io's own docs; only secondary mentions.
- Cloudflare Pages per-file size and file-count limits were not on the headers page and were not fetched.

---

## 9. Reference points: Flyff Universe, Unity/Godot maturity, Wasm game ports, Eaglercraft, RuneScape HTML5

### Takeaway
Flyff Universe (Gala Lab, relaunched 15 June 2022) proves a 2005-era 3D MMO can run in any browser on PC/Mac/mobile and be commercially successful (2M+ registrations, turned Gala profitable), but no official technical write-up exists—coverage only confirms "HTML5," an all-new graphics engine with AA/shaders/post-processing, and a developer credit to Sniegu Technologies; the cautionary precedent is RuneScape's 2013 HTML5 client, which never left beta on that browser generation.

### Cited Findings
- Flyff Universe relaunched 15 June 2022; runs in any browser on PC, Mac or mobile with no download; "advanced shaders, antialiasing, and post-processing"; "hundreds of quality-of-life improvements". — [MMOs.com](https://mmos.com/news/flyff-universe-global-cross-platform-relaunch)
- Gala describes it as an HTML5 game; registrations passed 1.5M then 2M in 2022; Gala's Q3 FY2022 results credit it with +604% revenue and a return to operating profit (¥350M). — [gamebiz 200万人](https://gamebiz.jp/news/362367); [gamebiz Q3 results](https://gamebiz.jp/news/364251); [gamebiz 150万人](https://gamebiz.jp/news/357793)
- MMOBomb's listing credits "Developer SNIEGU Technologies" for Flyff Universe (Gala Lab is the publisher/IP holder in all other coverage); launch coverage mentions an "all-new graphics engine". — [MMOBomb review](https://www.mmobomb.com/review/flyff-universe); [MassivelyOP](https://massivelyop.com/?p=392294)
- Unofficial technical observations: a hobbyist blog calls it an HTML5 port "via web assembly" with assets "downloaded and cached on the fly"; a RaGEZONE poster describes a *separate* project that compiled the original C++ client with Emscripten and translated Direct3D 9 calls to WebGL2 (not evidence about the official client); the RaGEZONE "Flyff Universe Rendering Pipeline" thread returned HTTP 403 and could not be read. — [richardorilla.website](https://www.richardorilla.website/browser-gaming.html); [RaGEZONE thread (inaccessible)](https://forum.ragezone.com/threads/flyff-universe-rendering-pipeline.1268605/)
- Gala Lab and Wemade Connect began a follow-up browser MMO, "Ragnarok Universe," on the Gravity IP (2025). — [gamebiz](https://gamebiz.jp/news/416913)
- Unity 6: Android and iOS browser support, WebView embedding, PWA template; WebGPU backend (6.0/6.1, sources conflict); Instant Games (Meta) in 6.1. — [Unity Discussions: Unity 6 updates for platforms](https://discussions.unity.com/t/unity-6-updates-for-platforms/1529798); [Unity web solutions](https://unity.com/solutions/web)
- Godot 4: web export is Compatibility renderer (WebGL2) only, no WebGPU, no C#, threads optional with isolation headers, audio trade-offs. — [Godot docs](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)
- Doom 3 (idTech 4) Wasm port, 2019: 7 weeks, single-threaded, full WebGL backend, intended to show both "present performance potential and the missing parts" for heavyweight games. — [InfoQ](https://www.infoq.com/news/2019/07/doom3-web-assembly-port/)
- 2025 CS:GO-engine browser port described by its author as "slow, janky, and held together with duct tape and hope but it runs". — [dev.to](https://dev.to/vbspexe/i-ported-csgo-to-the-browser-with-webassembly-2445)
- Eaglercraft: browser Minecraft client joining real 1.5.2 servers via a Bungee/Velocity proxy plugin; ships `assets.epk`. — [Sealos](https://sealos.io/blog/eaglercraft-server); [docs.fileformat.com](https://docs.fileformat.com/game/epk)
- RuneScape HTML5 client (2013) stalled on browser performance and was superseded by native NXT (2016). — [RuneScape Wiki](https://runescape.wiki/w/HTML5)
- Realm of the Mad God Exalt moved from Flash to Unity (not a browser client) when Flash support ended. — [RealmEye](https://www.realmeye.com/wiki/realm-of-the-mad-god-exalt/1)

### Inferences
- The 2013→2022 contrast (RuneScape HTML5 failing; Flyff Universe succeeding) tracks the arrival of WebAssembly, WebGL2 and ubiquitous mobile GPUs; a 2026 port starts from a far stronger baseline than either, including JSPI, OPFS and WebTransport.
- Flyff Universe's "all-new graphics engine" and the Sniegu credit suggest a rewrite of the rendering layer rather than a straight transpile, consistent with the §1 recommendation to rebuild the renderer backend as shader-only WebGL2 while porting game logic mechanically.
- For a Java client specifically, Eaglercraft is the closest precedent in *language* (a Java game running in-browser against TCP servers through a WebSocket proxy); its toolchain (commonly described as TeaVM Java→JS/Wasm) was not confirmed by a fetched source and belongs to the toolchain researcher's scope.

### Gaps
- No official Gala Lab/Sniegu technical description of Flyff Universe (language, Wasm vs JS, WebGL1/2, asset pipeline, mobile frame rates) was found; RaGEZONE threads with community reverse-engineering were inaccessible (403).
- No 2024–2026 postmortems for Quake 3, OpenRCT2, Minetest/Luanti or Factorio web ports were found in searches.
- Eaglercraft's compiler toolchain (TeaVM) and EPK format details are not confirmed from the project's own repository.
- Google Earth/Figma Wasm lessons were not researched (out of time budget).
