import React, { useEffect, useRef } from 'react';
import { latLonToCartesian, createOrGetLunarTextureCanvases, lunarTextureCache, computeBodyFixedDirection } from '../lib/lunarGlobeMath';
import type { SiteData } from '../lib/orbitalPhysics';
import * as THREE from 'three';
// Note: avoid direct typed import of three/examples jsm modules to keep build simple

type MoonTextureRuntimeCache = {
  loader?: THREE.TextureLoader;
  texture: THREE.Texture | null;
  loadPromise: Promise<THREE.Texture | null> | null;
};

function markTextureAsSrgb(texture: THREE.Texture) {
  try {
    (texture as any).colorSpace = (THREE as any).SRGBColorSpace ?? THREE.SRGBColorSpace;
  } catch {
    // ignore color-space assignment failures in restricted test environments
  }
  texture.needsUpdate = true;
}

function getMoonTextureRuntimeCache(): MoonTextureRuntimeCache {
  const root = globalThis as any;
  if (!root.__selene_moon_texture_runtime_cache) {
    let loader: THREE.TextureLoader | undefined;
    try {
      loader = new THREE.TextureLoader();
    } catch {
      loader = undefined;
    }
    root.__selene_moon_texture_runtime_cache = {
      loader,
      texture: null,
      loadPromise: null,
    } as MoonTextureRuntimeCache;
  }
  return root.__selene_moon_texture_runtime_cache as MoonTextureRuntimeCache;
}

function getLoadedMoonTexture(): THREE.Texture | null {
  return getMoonTextureRuntimeCache().texture;
}

function ensureMoonTextureLoad(): Promise<THREE.Texture | null> {
  const cache = getMoonTextureRuntimeCache();
  if (cache.texture) {
    return Promise.resolve(cache.texture);
  }
  if (cache.loadPromise) {
    return cache.loadPromise;
  }
  if (!cache.loader) {
    return Promise.resolve(null);
  }

  cache.loadPromise = new Promise((resolve) => {
    try {
      const pendingTexture = cache.loader!.load(
        '/textures/moon_1024.jpg',
        (loadedTexture) => {
          markTextureAsSrgb(loadedTexture);
          cache.texture = loadedTexture;
          resolve(loadedTexture);
        },
        undefined,
        () => {
          cache.loadPromise = null;
          resolve(null);
        },
      );
      markTextureAsSrgb(pendingTexture);
    } catch {
      cache.loadPromise = null;
      resolve(null);
    }
  });

  return cache.loadPromise;
}

interface Props {
  sites: SiteData[];
  selectedSiteId: string;
  onSiteSelect: (id: string) => void;
  customLat?: number;
  customLon?: number;
  timelineIdx?: number;
  telemetryPoints?: any[];
}

export const LunarOrbitalGlobe: React.FC<Props> = ({ sites, selectedSiteId, onSiteSelect, customLat, customLon, timelineIdx = 0, telemetryPoints = [] }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  // expose preset setter to header buttons outside the renderer effect
  const setCameraPresetRef = useRef<(p: 'south' | 'global') => void>(() => {});

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // Safe WebGL detection (wrap getContext in try/catch to avoid jsdom errors)
    function safeHasWebGL(): boolean {
      try {
        const testCanvas = document.createElement('canvas');
        const gl = testCanvas.getContext && (testCanvas.getContext('webgl') || testCanvas.getContext('experimental-webgl'));
        return !!gl;
      } catch (e) {
        return false;
      }
    }

    const hasWebGL = safeHasWebGL();
    if (!hasWebGL) {
      // No WebGL: fallback handled by JSX below
      return;
    }

    const width = mount!.clientWidth || 480;
    const height = Math.max(320, mount!.clientHeight || 320);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    mount.appendChild(renderer.domElement);

    const R = 2.0; // sphere radius per requirements
    const scene = new THREE.Scene();
    // dark space background for contrast
    scene.background = new THREE.Color('#060911');
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    // initial camera matches South Pole Focus per requirement
    camera.position.set(0, -4.6, 3.8);
    camera.lookAt(0, -0.35, 0);
    let mounted = true;

    // Simple pointer-based orbit controls (no external dependency)
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };
    let azimuth = 0;
    let polar = 0.5; // tilt
    const distance = { value: 3.5 };
    let isCameraTransitioning = true;
    // spherical target for presets
    const cameraTarget = { az: azimuth, pol: polar, dist: distance.value };

    function updateCamera() {
      const r = distance.value;
      const x = r * Math.cos(polar) * Math.sin(azimuth);
      const y = r * Math.sin(polar);
      const z = r * Math.cos(polar) * Math.cos(azimuth);
      camera.position.set(x, y, z);
      camera.lookAt(0, 0, 0);
    }
    updateCamera();

    function setCameraPreset(preset: 'south' | 'global') {
      if (preset === 'south') {
        // South Pole Focus target cartesian
        const tx = 0, ty = -4.6, tz = 3.8;
        const r = Math.sqrt(tx * tx + ty * ty + tz * tz);
        cameraTarget.az = Math.atan2(tx, tz);
        cameraTarget.pol = Math.asin(ty / r);
        cameraTarget.dist = r;
      } else {
        // Global View [0,0.8,6.2]
        const tx = 0, ty = 0.8, tz = 6.2;
        const r = Math.sqrt(tx * tx + ty * ty + tz * tz);
        cameraTarget.az = Math.atan2(tx, tz);
        cameraTarget.pol = Math.asin(ty / r);
        cameraTarget.dist = r;
      }
      isCameraTransitioning = true;
    }
    // expose to header
    setCameraPresetRef.current = setCameraPreset;

    function onPointerDown(e: PointerEvent) {
      isDragging = true;
      previousMousePosition = { x: e.clientX, y: e.clientY };
      // cancel any active camera transition on user interaction
      isCameraTransitioning = false;
    }
    function onPointerMove(e: PointerEvent) {
      if (!isDragging) return;
      const deltaX = (e.clientX - previousMousePosition.x) * 0.005;
      const deltaY = (e.clientY - previousMousePosition.y) * 0.005;
      azimuth += deltaX;
      polar = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, polar + deltaY));
      previousMousePosition = { x: e.clientX, y: e.clientY };
      updateCamera();
    }
    function onPointerUp() { isDragging = false; }
    function onWheel(e: WheelEvent) {
      distance.value = Math.max(1.8, Math.min(12, distance.value + e.deltaY * 0.01));
      // cancel preset transition on zoom
      isCameraTransitioning = false;
      updateCamera();
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: true });

    // Use deterministic cached lunar textures (1024x512 equirectangular) so switching sites is instant
    let proceduralAlbedo: THREE.Texture | undefined;
    let proceduralBump: THREE.Texture | undefined;
    try {
      const canvases = createOrGetLunarTextureCanvases(1337, 1024, 512);
      // if three.js textures were created previously, reuse them
      if ((lunarTextureCache as any).threeAlbedo && (lunarTextureCache as any).threeBump) {
        proceduralAlbedo = (lunarTextureCache as any).threeAlbedo as THREE.Texture;
        proceduralBump = (lunarTextureCache as any).threeBump as THREE.Texture;
      } else {
        const canvTex = new THREE.CanvasTexture(canvases.albedo as HTMLCanvasElement);
        const canvBump = new THREE.CanvasTexture(canvases.bump as HTMLCanvasElement);
        markTextureAsSrgb(canvTex);
        canvBump.needsUpdate = true;
        proceduralAlbedo = canvTex;
        proceduralBump = canvBump;
        (lunarTextureCache as any).threeAlbedo = proceduralAlbedo;
        (lunarTextureCache as any).threeBump = proceduralBump;
      }
    } catch {
      proceduralAlbedo = undefined;
      proceduralBump = undefined;
    }

    // Use cached NASA texture when available; keep deterministic procedural fallback for offline/test environments.
    const cachedMoonTexture = getLoadedMoonTexture();
    const mapTexture = cachedMoonTexture ?? proceduralAlbedo;
    const bumpTexture = cachedMoonTexture ?? proceduralBump;

    const sphereGeom = new THREE.SphereGeometry(R, 128, 128);
    const sphereMat = new THREE.MeshStandardMaterial({
      map: mapTexture,
      bumpMap: bumpTexture,
      bumpScale: 0.055,
      roughness: 0.92,
      metalness: 0.02,
    });
    const moon = new THREE.Mesh(sphereGeom, sphereMat);
    scene.add(moon);

    if (!cachedMoonTexture) {
      void ensureMoonTextureLoad().then((loadedTexture) => {
        if (!mounted || !loadedTexture) return;
        sphereMat.map = loadedTexture;
        sphereMat.bumpMap = loadedTexture;
        sphereMat.needsUpdate = true;
      });
    }

    // realistic day/night terminator lighting per requirements
    const sun = new THREE.DirectionalLight('#FFF9ED', 3.2);
    sun.position.set(10, 6, 3);
    scene.add(sun);
    const hemi2 = new THREE.HemisphereLight('#334155', '#0F172A', 0.35);
    scene.add(hemi2);
    const ambient2 = new THREE.AmbientLight('#1E293B', 0.28);
    scene.add(ambient2);

    // rim glow: a slightly larger layered sphere with a simple shader that highlights the terminator
    const rimUniforms = {
      sunDir: { value: new THREE.Vector3().copy(new THREE.Vector3(10, 6, 3)).normalize() },
      color: { value: new THREE.Color(0x060911) },
      intensity: { value: 0.85 },
    };
    const rimMat = new THREE.ShaderMaterial({
      uniforms: rimUniforms,
      vertexShader: `varying vec3 vNormal; varying vec3 vPos; void main(){ vNormal = normalMatrix * normal; vPos = (modelViewMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 sunDir; uniform vec3 color; uniform float intensity; varying vec3 vNormal; void main(){ float nd = dot(normalize(vNormal), normalize(-sunDir)); float t = smoothstep(-0.15, 0.25, nd); float rim = (1.0 - t) * intensity; vec3 c = color * rim; gl_FragColor = vec4(c, clamp(rim,0.0,0.9)); }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    });
    const rimSphere = new THREE.Mesh(new THREE.SphereGeometry(R * 1.012, 64, 64), rimMat);
    scene.add(rimSphere);

    // site markers
    const markerGroup = new THREE.Group();
    scene.add(markerGroup);

    // HUD overlay for 2D projected labels
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '10';
    mount.appendChild(overlay);

    const hudContainer = document.createElement('div');
    hudContainer.style.position = 'absolute';
    hudContainer.style.left = '0';
    hudContainer.style.top = '0';
    hudContainer.style.width = '100%';
    hudContainer.style.height = '100%';
    hudContainer.style.pointerEvents = 'none';
    overlay.appendChild(hudContainer);

    function buildMarkers() {
      markerGroup.clear();
      while (hudContainer.firstChild) hudContainer.removeChild(hudContainer.firstChild);
      const allSites = sites.slice();
      if (customLat !== undefined && customLon !== undefined && !isNaN(customLat) && !isNaN(customLon)) {
        allSites.push({ id: 'custom', name: 'Custom', category: 'Custom', lat: customLat, lon: customLon, alt_km: 0, max_slope_deg: 0, psr_distance_km: 0, description: '', horizon_profile_deg: [] } as unknown as SiteData);
      }
      for (const s of allSites) {
        const col = s.id === selectedSiteId ? 0x10b981 : (s.id === 'apollo-11' ? 0x06b6d4 : (s.max_slope_deg > 15 ? 0xef4444 : 0xf59e0b));
        // create elevated beacon: cylinder + sphere + pulsing ring (simple scaling animation)
        const pin = new THREE.Group();
        const cylGeom = new THREE.CylinderGeometry(0.01, 0.01, 0.25, 6);
        const cylMat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.4, roughness: 0.6 });
        const cyl = new THREE.Mesh(cylGeom, cylMat);
        cyl.position.set(0, 0.125, 0);
        pin.add(cyl);
        const sph = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.9 }));
        sph.position.set(0, 0.28, 0);
        pin.add(sph);
        const pos = latLonToCartesian(s.lat, s.lon, R);
        pin.position.set(pos.x, pos.y, pos.z);
        // orient pin to surface normal
        const normal = new THREE.Vector3(pos.x, pos.y, pos.z).normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const q = new THREE.Quaternion().setFromUnitVectors(up, normal);
        pin.quaternion.copy(q);
        (pin as any).siteId = s.id;
        markerGroup.add(pin);

        // add ground ring for pulsing effect
        const ringGeom = new THREE.RingGeometry(0.055, 0.11, 32);
        const ringMat2 = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
        const surfaceRing = new THREE.Mesh(ringGeom, ringMat2);
        surfaceRing.rotation.x = Math.PI / 2;
        surfaceRing.position.set(0, 0.01, 0);
        surfaceRing.renderOrder = 999;
        pin.add(surfaceRing);

        // 2D HUD label for this site
        const label = document.createElement('div');
        label.innerText = s.name.split(' ').slice(0, 2).join(' ');
        label.style.position = 'absolute';
        label.style.pointerEvents = 'auto';
        label.style.padding = '4px 6px';
        label.style.background = '#090D16';
        label.style.border = '1px solid #1E293B';
        label.style.color = '#E2E8F0';
        label.style.fontSize = '12px';
        label.style.borderRadius = '6px';
        label.style.transform = 'translate(-50%, -140%)';
        label.style.cursor = 'pointer';
        label.onclick = () => onSiteSelect(s.id);
        hudContainer.appendChild(label);
        (pin as any).hudLabel = label;
      }
    }

    buildMarkers();

    // Raycaster for clicks
    const raycaster = new THREE.Raycaster();
    function onClick(ev: MouseEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
      const hits = raycaster.intersectObjects(markerGroup.children as any);
      if (hits.length > 0) {
        const obj = hits[0].object as any;
        if (obj.siteId) onSiteSelect(obj.siteId);
      }
    }
    renderer.domElement.addEventListener('click', onClick);

    // create graticule (lat/lon lines every 15°)
    const graticule = new THREE.Group();
    const lineMat = new THREE.LineBasicMaterial({ color: 0x233447, transparent: true, opacity: 0.6 });
    for (let lat = -75; lat <= 75; lat += 15) {
      const points: THREE.Vector3[] = [];
        for (let lon = -180; lon <= 180; lon += 5) {
        const p = latLonToCartesian(lat, lon, R * 1.0005);
        points.push(new THREE.Vector3(p.x, p.y, p.z));
      }
      const geom = new THREE.BufferGeometry().setFromPoints(points);
      graticule.add(new THREE.Line(geom, lineMat));
    }
      for (let lon = -180; lon <= 180; lon += 15) {
      const points: THREE.Vector3[] = [];
      for (let lat = -90; lat <= 90; lat += 2) {
        const p = latLonToCartesian(lat, lon, R * 1.0005);
        points.push(new THREE.Vector3(p.x, p.y, p.z));
      }
      const geom = new THREE.BufferGeometry().setFromPoints(points);
      graticule.add(new THREE.Line(geom, lineMat));
    }
    scene.add(graticule);

    // Artemis South Pole ring (-85 to -90 S approximate ring at -85)
    const ringLat = -85;
    const ringPoints: THREE.Vector3[] = [];
    for (let lon = -180; lon <= 180; lon += 4) {
      const p = latLonToCartesian(ringLat, lon, R * 1.0015);
      ringPoints.push(new THREE.Vector3(p.x, p.y, p.z));
    }
    const ringGeom = new THREE.BufferGeometry().setFromPoints(ringPoints);
    const ringMat = new THREE.LineDashedMaterial({ color: 0x06b6d4, dashSize: 0.02, gapSize: 0.02, transparent: true, opacity: 0.9 });
    const ring = new THREE.Line(ringGeom, ringMat);
    ring.computeLineDistances();
    scene.add(ring);

    // group for directional rays (sun / earth) and HUD label updates
    const raysGroup = new THREE.Group();
    scene.add(raysGroup);

    // helper: placeholder earth direction (approximate) - will be animated/updated if telemetry provides better data
    let earthDir = new THREE.Vector3(-0.3, 0.05, 0.95).normalize();
    // animation loop
    function animate() {
      if (!mounted) return;
      requestAnimationFrame(animate);
      // update sun direction based on current telemetry if provided
      // simple: rotate light slowly or align with telemetry
        if (telemetryPoints && telemetryPoints.length > 0) {
          const idx = Math.min(Math.max(0, timelineIdx), telemetryPoints.length - 1);
          const p = telemetryPoints[idx];
          if (p) {
            // Determine site coords: prefer selectedSiteId from markerGroup, fallback to custom props
            const site = sites.find((s) => s.id === selectedSiteId) ?? (typeof customLat === 'number' && typeof customLon === 'number' ? { lat: customLat, lon: customLon } as SiteData : undefined);
            if (site) {
              try {
                const sd = computeBodyFixedDirection(site.lat, site.lon, p.sun_az, p.sun_el);
                sun.position.copy(new THREE.Vector3(sd.x, sd.y, sd.z).multiplyScalar(12));
                rimUniforms.sunDir.value.copy(new THREE.Vector3(sd.x, sd.y, sd.z)).normalize();
                const ed = computeBodyFixedDirection(site.lat, site.lon, p.earth_az, p.earth_el);
                earthDir = new THREE.Vector3(ed.x, ed.y, ed.z).normalize();
              } catch (err) {
                // fallback: gentle rotation
                const sunDir = new THREE.Vector3(0.5, 0.5, 0.5).normalize();
                sun.position.copy(sunDir.multiplyScalar(10));
                rimUniforms.sunDir.value.copy(sun.position).normalize();
              }
            }
          }
        }
        // smooth camera lerp toward preset target only when transitioning
        if (isCameraTransitioning) {
          azimuth += (cameraTarget.az - azimuth) * 0.06;
          polar += (cameraTarget.pol - polar) * 0.06;
          distance.value += (cameraTarget.dist - distance.value) * 0.06;
          // compute target cam pos from spherical target
          const tr = cameraTarget.dist;
          const tx = tr * Math.cos(cameraTarget.pol) * Math.sin(cameraTarget.az);
          const ty = tr * Math.sin(cameraTarget.pol);
          const tz = tr * Math.cos(cameraTarget.pol) * Math.cos(cameraTarget.az);
          const targetCamPos = new THREE.Vector3(tx, ty, tz);
          if (camera.position.distanceTo(targetCamPos) < 0.02) {
            isCameraTransitioning = false;
          }
        }
       // simple auto-rotation when not interacting (blend with preset)
       if (!isDragging) {
         azimuth += 0.0006;
       }
       updateCamera();

       // animate pulsing of beacons and rings, update HUD labels
       const t = performance.now() * 0.001;
       markerGroup.children.forEach((c, idx) => {
         const g = c as THREE.Group & { hudLabel?: HTMLDivElement };
         const top = g.children[1];
         if (top) {
           const s = 1 + 0.08 * Math.sin(t * 3 + idx);
           top.scale.setScalar(s);
         }
         // pulse surface ring (child at end)
         const ring = g.children.find((ch) => (ch as THREE.Mesh).geometry && (ch as THREE.Mesh).geometry.type === 'RingGeometry') as THREE.Mesh | undefined;
         if (ring) {
           const scale = 1 + 0.12 * Math.abs(Math.sin(t * 2 + idx));
           ring.scale.set(scale, scale, scale);
           (ring.material as THREE.Material).opacity = 0.35 + 0.2 * Math.abs(Math.sin(t * 2 + idx));
         }

         // update HUD label projection
         try {
           if (g.hudLabel) {
             const worldPos = new THREE.Vector3();
             g.getWorldPosition(worldPos);
             const projected = worldPos.clone().project(camera);
             const x = (projected.x * 0.5 + 0.5) * renderer.domElement.clientWidth;
             const y = (-projected.y * 0.5 + 0.5) * renderer.domElement.clientHeight;
             g.hudLabel.style.left = `${x}px`;
             g.hudLabel.style.top = `${y}px`;
             // hide labels behind the globe
             const visible = projected.z <= 1.0 && Math.abs(projected.x) <= 1.2 && Math.abs(projected.y) <= 1.2;
             g.hudLabel.style.display = visible ? 'block' : 'none';
           }
         } catch (err) {
           // ignore projection errors in odd contexts
         }
       });

        // update rim shader sun direction
        rimUniforms.sunDir.value.copy(sun.position).normalize();
       // update directional rays for the active site
       try {
         raysGroup.clear();
         const sel = markerGroup.children.find((m) => (m as any).siteId === selectedSiteId) as THREE.Object3D | undefined;
         if (sel) {
           const world = new THREE.Vector3();
           sel.getWorldPosition(world);
            const sunDir = sun.position.clone().normalize();
            const sunPts = [world.clone(), world.clone().add(sunDir.clone().multiplyScalar(1.9))];
            const sunGeom = new THREE.BufferGeometry().setFromPoints(sunPts);
            const sunMat = new THREE.LineBasicMaterial({ color: 0xF59E0B, linewidth: 2, transparent: true, opacity: 0.95 });
            const sunLine = new THREE.Line(sunGeom, sunMat);
            raysGroup.add(sunLine);

            const earthPts = [world.clone(), world.clone().add(earthDir.clone().multiplyScalar(1.9))];
            const earthGeom = new THREE.BufferGeometry().setFromPoints(earthPts);
            const earthMat = new THREE.LineBasicMaterial({ color: 0x06B6D4, linewidth: 2, transparent: true, opacity: 0.95 });
            const earthLine = new THREE.Line(earthGeom, earthMat);
            raysGroup.add(earthLine);
         }
       } catch (err) {
         // ignore
       }

       renderer.render(scene, camera);
    }
    animate();

    // handle resize
    const onResize = () => {
      const w = mount.clientWidth || 480;
      const h = Math.max(320, mount.clientHeight || 320);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    return () => {
      mounted = false;
      renderer.domElement.removeEventListener('click', onClick);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      try { mount.removeChild(renderer.domElement); } catch {}
      try { mount.removeChild(overlay); } catch {}
      // Do not dispose cached textures (they are kept for instant reuse). Dispose only materials we created here.
      try { sphereMat.dispose(); } catch {}
      try { rimMat.dispose(); } catch {}
    };
  }, [sites, selectedSiteId, onSiteSelect, customLat, customLon, timelineIdx, telemetryPoints]);

  // Fallback SVG rendering when WebGL is not available (jsdom / headless)
  // Safe WebGL detection for fallback rendering (avoid calling getContext in jsdom)
  let hasWebGL = false;
  try {
    const _c = document.createElement('canvas');
    hasWebGL = !!(_c.getContext && (_c.getContext('webgl') || _c.getContext('experimental-webgl')));
  } catch (e) {
    hasWebGL = false;
  }

  if (!hasWebGL) {
    // SVG projection: simple equirectangular mapping inside circle
    const width = 420;
    const height = 420;
    const radius = 200;
    const centerX = width / 2;
    const centerY = height / 2;

    const project = (lat: number, lon: number) => {
      // orthographic-ish: x = cos(lat)*sin(lon), y = sin(lat)
      const latR = (lat * Math.PI) / 180;
      const lonR = (lon * Math.PI) / 180;
      const x = Math.cos(latR) * Math.sin(lonR);
      const y = Math.sin(latR);
      // map into circle
      return { x: centerX + x * radius * 0.95, y: centerY - y * radius * 0.95 };
    };

    return (
      <div style={{ background: '#131B2E', border: '1px solid #1E293B', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: '#131B2E', borderBottom: '1px solid #1E293B' }}>
          <div style={{ color: '#F8FAFC', fontWeight: 700 }}>3D LUNAR ORBITAL TWIN</div>
          <div style={{ display: 'flex', gap: 8, zIndex: 10 }}>
            <button onClick={() => setCameraPresetRef.current('south')} style={{ background: '#090D16', border: '1px solid #1E293B', color: '#E2E8F0', padding: '6px 8px', borderRadius: 8 }}>South Pole Focus</button>
            <button onClick={() => setCameraPresetRef.current('global')} style={{ background: '#090D16', border: '1px solid #1E293B', color: '#E2E8F0', padding: '6px 8px', borderRadius: 8 }}>Global View</button>
          </div>
        </div>
        <div ref={mountRef} style={{ width: '100%', height: 420, position: 'relative' }}>
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Lunar globe (fallback)">
            <defs>
              <radialGradient id="moonGrad"><stop offset="0%" stopColor="#666"/><stop offset="100%" stopColor="#111"/></radialGradient>
            </defs>
            <circle cx={centerX} cy={centerY} r={radius} fill="url(#moonGrad)" stroke="#1E293B" />
            {sites.map((s) => {
              const p = project(s.lat, s.lon);
              const color = s.id === selectedSiteId ? '#10B981' : (s.id === 'apollo-11' ? '#06B6D4' : (s.max_slope_deg > 15 ? '#EF4444' : '#F59E0B'));
              return (
                <g key={s.id} onClick={() => onSiteSelect(s.id)} style={{ cursor: 'pointer' }}>
                  <circle cx={p.x} cy={p.y} r={6} fill={color} stroke="#000" />
                  <text x={p.x + 8} y={p.y + 4} fontSize={10} fill="#F8FAFC">{s.name.split(' ').slice(0,2).join(' ')}</text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: '#131B2E', border: '1px solid #1E293B', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: '#131B2E', borderBottom: '1px solid #1E293B' }}>
        <div style={{ color: '#F8FAFC', fontWeight: 700 }}>3D LUNAR ORBITAL TWIN</div>
        <div style={{ display: 'flex', gap: 8, zIndex: 10 }}>
          <button onClick={() => setCameraPresetRef.current('south')} style={{ background: '#090D16', border: '1px solid #1E293B', color: '#E2E8F0', padding: '6px 8px', borderRadius: 8 }}>South Pole Focus</button>
          <button onClick={() => setCameraPresetRef.current('global')} style={{ background: '#090D16', border: '1px solid #1E293B', color: '#E2E8F0', padding: '6px 8px', borderRadius: 8 }}>Global View</button>
        </div>
      </div>
      <div ref={mountRef} style={{ width: '100%', height: 380, position: 'relative' }} />
    </div>
  );
};

export default LunarOrbitalGlobe;
