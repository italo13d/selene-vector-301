import React, { useEffect, useRef, useState } from 'react';
import { latLonToCartesian, createOrGetLunarTextureCanvases, lunarTextureCache, computeBodyFixedDirection } from '../lib/lunarGlobeMath';
import type { SiteData } from '../lib/orbitalPhysics';
import * as THREE from 'three';
// Note: avoid direct typed import of three/examples jsm modules to keep build simple

type MoonTextureRuntimeCache = {
  loader?: THREE.TextureLoader;
  texture: THREE.Texture | null;
  loadPromise: Promise<THREE.Texture | null> | null;
};

type PinnedSiteStyle = {
  haloHex: number;
  haloCss: string;
  labelBackground: string;
  labelBorder: string;
  labelText: string;
};

const PINNED_SITE_STYLES: readonly PinnedSiteStyle[] = [
  {
    haloHex: 0x06b6d4,
    haloCss: '#06B6D4',
    labelBackground: '#042430',
    labelBorder: '#06B6D4AA',
    labelText: '#67E8F9',
  },
  {
    haloHex: 0xf59e0b,
    haloCss: '#F59E0B',
    labelBackground: '#2F1D05',
    labelBorder: '#F59E0BAA',
    labelText: '#FCD34D',
  },
];

const PRESET_CAMERA_DISTANCE = 8.0;
const SOUTH_POLE_PRESET = { x: 0, y: -4.6, z: 3.8 } as const;
const GLOBAL_PRESET = { x: 0, y: 0.8, z: 6.2 } as const;
const SITE_FOCUS_MIN_DISTANCE = 8.0;
const MIN_CAMERA_DISTANCE = 4.8;
const MAX_CAMERA_DISTANCE = 16;
const CAMERA_TRANSITION_LERP = 0.06;
const BODY_VECTOR_LERP = 0.14;
const NOMINAL_FRAME_DT = 1 / 60;
const SUN_LIGHT_DISTANCE = 12;
const VECTOR_INDICATOR_LENGTH = 1.9;
const MIN_DIRECTION_LENGTH_SQ = 1e-6;

type BodyDirectionVector = {
  x: number;
  y: number;
  z: number;
};

type TelemetryDirectionPoint = {
  sun_az: number;
  sun_el: number;
  earth_az: number;
  earth_el: number;
  sun_visible?: boolean;
  earth_visible?: boolean;
};

function markTextureAsSrgb(texture: THREE.Texture) {
  try {
    (texture as any).colorSpace = (THREE as any).SRGBColorSpace ?? THREE.SRGBColorSpace;
  } catch {
    // ignore color-space assignment failures in restricted test environments
  }
  texture.needsUpdate = true;
}

function isDirectionValid(vector: THREE.Vector3): boolean {
  return Number.isFinite(vector.x)
    && Number.isFinite(vector.y)
    && Number.isFinite(vector.z)
    && vector.lengthSq() > MIN_DIRECTION_LENGTH_SQ;
}

function sanitizeDirection(vector: THREE.Vector3, fallback: THREE.Vector3): THREE.Vector3 {
  if (!isDirectionValid(vector)) {
    return vector.copy(fallback);
  }
  vector.normalize();
  return vector;
}

function scaleVectorToDistance(x: number, y: number, z: number, distance: number): BodyDirectionVector {
  const magnitude = Math.sqrt(x * x + y * y + z * z) || 1;
  const scale = distance / magnitude;
  return {
    x: x * scale,
    y: y * scale,
    z: z * scale,
  };
}

function computeBodyDirectionForTelemetry(
  siteLat: number,
  siteLon: number,
  azDeg: number,
  elDeg: number,
): BodyDirectionVector | null {
  try {
    const direction = computeBodyFixedDirection(siteLat, siteLon, azDeg, elDeg);
    return { x: direction.x, y: direction.y, z: direction.z };
  } catch {
    return null;
  }
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
  comparedSiteIds?: string[];
  onSiteSelect: (id: string) => void;
  onPinnedSiteFocus?: (id: string) => void;
  focusedSite?: SiteData | null;
  customLat?: number;
  customLon?: number;
  currentStep?: number;
  sunVisible?: boolean;
  earthVisible?: boolean;
  sunDirection?: BodyDirectionVector | null;
  earthDirection?: BodyDirectionVector | null;
  timelineIdx?: number;
  telemetryPoints?: TelemetryDirectionPoint[];
}

export const LunarOrbitalGlobe: React.FC<Props> = ({
  sites,
  selectedSiteId,
  comparedSiteIds = [],
  onSiteSelect,
  onPinnedSiteFocus,
  focusedSite,
  customLat,
  customLon,
  currentStep,
  sunVisible,
  earthVisible,
  sunDirection,
  earthDirection,
  timelineIdx = 0,
  telemetryPoints = [],
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  // expose preset setter to header buttons outside the renderer effect
  const setCameraPresetRef = useRef<(p: 'south' | 'global') => void>(() => {});
  const focusCameraOnSiteRef = useRef<(site: SiteData | null) => void>(() => {});
  const sitesRef = useRef<SiteData[]>(sites);
  const selectedSiteIdRef = useRef(selectedSiteId);
  const comparedSiteIdsRef = useRef<string[]>(comparedSiteIds);
  const customLatRef = useRef<number | undefined>(customLat);
  const customLonRef = useRef<number | undefined>(customLon);
  const onSiteSelectRef = useRef(onSiteSelect);
  const onPinnedSiteFocusRef = useRef(onPinnedSiteFocus);
  const timelineIdxRef = useRef(0);
  const telemetryPointsRef = useRef<TelemetryDirectionPoint[]>(telemetryPoints);
  const sunVisibleRef = useRef(false);
  const earthVisibleRef = useRef(false);
  const sunDirectionRef = useRef<BodyDirectionVector | null>(null);
  const earthDirectionRef = useRef<BodyDirectionVector | null>(null);
  const [webglUnavailable, setWebglUnavailable] = useState(false);

  const canAttemptWebGL = typeof window !== 'undefined'
    && (
      typeof (window as any).WebGLRenderingContext !== 'undefined'
      || typeof (window as any).WebGL2RenderingContext !== 'undefined'
    );
  const shouldUseSvgFallback = webglUnavailable || !canAttemptWebGL;

  const resolvedCurrentStep = Number.isFinite(currentStep ?? timelineIdx)
    ? Math.max(0, Math.floor(currentStep ?? timelineIdx))
    : 0;
  const activeTelemetryPoint = telemetryPoints.length > 0
    ? telemetryPoints[Math.min(resolvedCurrentStep, telemetryPoints.length - 1)]
    : undefined;
  const activeTelemetrySite = sites.find((site) => site.id === selectedSiteId)
    ?? (typeof customLat === 'number' && typeof customLon === 'number'
      ? ({ lat: customLat, lon: customLon } as SiteData)
      : null);

  let resolvedSunDirection = sunDirection ?? null;
  let resolvedEarthDirection = earthDirection ?? null;

  if (activeTelemetryPoint && activeTelemetrySite) {
    if (!resolvedSunDirection) {
      resolvedSunDirection = computeBodyDirectionForTelemetry(
        activeTelemetrySite.lat,
        activeTelemetrySite.lon,
        activeTelemetryPoint.sun_az,
        activeTelemetryPoint.sun_el,
      );
    }
    if (!resolvedEarthDirection) {
      resolvedEarthDirection = computeBodyDirectionForTelemetry(
        activeTelemetrySite.lat,
        activeTelemetrySite.lon,
        activeTelemetryPoint.earth_az,
        activeTelemetryPoint.earth_el,
      );
    }
  }

  const resolvedSunVisible = typeof sunVisible === 'boolean'
    ? sunVisible
    : (typeof activeTelemetryPoint?.sun_visible === 'boolean'
      ? activeTelemetryPoint.sun_visible
      : false);
  const resolvedEarthVisible = typeof earthVisible === 'boolean'
    ? earthVisible
    : (typeof activeTelemetryPoint?.earth_visible === 'boolean'
      ? activeTelemetryPoint.earth_visible
      : false);

  sitesRef.current = sites;
  selectedSiteIdRef.current = selectedSiteId;
  comparedSiteIdsRef.current = comparedSiteIds;
  customLatRef.current = customLat;
  customLonRef.current = customLon;
  onSiteSelectRef.current = onSiteSelect;
  onPinnedSiteFocusRef.current = onPinnedSiteFocus;

  timelineIdxRef.current = resolvedCurrentStep;
  telemetryPointsRef.current = telemetryPoints;
  sunVisibleRef.current = resolvedSunVisible;
  earthVisibleRef.current = resolvedEarthVisible;
  sunDirectionRef.current = resolvedSunDirection;
  earthDirectionRef.current = resolvedEarthDirection;

  const handleSiteInteraction = (siteId: string, isPinned: boolean) => {
    if (isPinned) {
      onPinnedSiteFocus?.(siteId);
      return;
    }
    onSiteSelect(siteId);
  };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    if (shouldUseSvgFallback) {
      return;
    }

    const initialWidth = Math.max(1, Math.round(mount.clientWidth || 480));
    const initialHeight = Math.max(320, Math.round(mount.clientHeight || 320));

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      setWebglUnavailable(true);
      return;
    }

    renderer.setSize(initialWidth, initialHeight);
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    mount.appendChild(renderer.domElement);

    const R = 2.0; // sphere radius per requirements
    const scene = new THREE.Scene();
    // dark space background for contrast
    scene.background = new THREE.Color('#060911');
    const camera = new THREE.PerspectiveCamera(45, initialWidth / initialHeight, 0.1, 1000);
    let lastAppliedWidth = initialWidth;
    let lastAppliedHeight = initialHeight;

    const initialSouthCameraPosition = scaleVectorToDistance(
      SOUTH_POLE_PRESET.x,
      SOUTH_POLE_PRESET.y,
      SOUTH_POLE_PRESET.z,
      PRESET_CAMERA_DISTANCE,
    );
    const initialSouthX = initialSouthCameraPosition.x;
    const initialSouthY = initialSouthCameraPosition.y;
    const initialSouthZ = initialSouthCameraPosition.z;
    const initialSouthDistance = Math.sqrt(
      initialSouthX * initialSouthX
      + initialSouthY * initialSouthY
      + initialSouthZ * initialSouthZ,
    ) || 1;

    camera.position.set(initialSouthX, initialSouthY, initialSouthZ);
    camera.lookAt(0, 0, 0);
    let mounted = true;
    let rafId = 0;
    let isDisposed = false;

    // Simple pointer-based orbit controls (no external dependency)
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };
    let azimuth = Math.atan2(initialSouthX, initialSouthZ);
    let polar = Math.asin(initialSouthY / initialSouthDistance);
    const distance = { value: initialSouthDistance };
    let isCameraTransitioning = false;
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

    function applyCameraTargetFromCartesian(tx: number, ty: number, tz: number) {
      const r = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
      cameraTarget.az = Math.atan2(tx, tz);
      cameraTarget.pol = Math.asin(ty / r);
      cameraTarget.dist = r;
    }

    function setCameraPreset(preset: 'south' | 'global') {
      const presetVector = preset === 'south' ? SOUTH_POLE_PRESET : GLOBAL_PRESET;
      const presetCameraPosition = scaleVectorToDistance(
        presetVector.x,
        presetVector.y,
        presetVector.z,
        PRESET_CAMERA_DISTANCE,
      );
      applyCameraTargetFromCartesian(
        presetCameraPosition.x,
        presetCameraPosition.y,
        presetCameraPosition.z,
      );
      isCameraTransitioning = true;
    }

    function focusCameraOnSite(site: SiteData | null) {
      if (!site || Number.isNaN(site.lat) || Number.isNaN(site.lon)) return;

      const siteVector = latLonToCartesian(site.lat, site.lon, 1);
      const siteRadius = Math.sqrt(
        siteVector.x * siteVector.x
        + siteVector.y * siteVector.y
        + siteVector.z * siteVector.z,
      ) || 1;

      cameraTarget.az = Math.atan2(siteVector.x, siteVector.z);
      cameraTarget.pol = Math.max(
        -Math.PI / 2 + 0.1,
        Math.min(Math.PI / 2 - 0.1, Math.asin(siteVector.y / siteRadius)),
      );
      cameraTarget.dist = Math.max(SITE_FOCUS_MIN_DISTANCE, Math.min(MAX_CAMERA_DISTANCE, distance.value));
      isCameraTransitioning = true;
    }

    // expose to header
    setCameraPresetRef.current = setCameraPreset;
    focusCameraOnSiteRef.current = focusCameraOnSite;

    if (focusedSite) {
      focusCameraOnSite(focusedSite);
    } else {
      setCameraPreset('south');
    }

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
      distance.value = Math.max(MIN_CAMERA_DISTANCE, Math.min(MAX_CAMERA_DISTANCE, distance.value + e.deltaY * 0.01));
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
      emissive: '#1e293b',
      emissiveIntensity: 0.2,
    });
    const moon = new THREE.Mesh(sphereGeom, sphereMat);
    moon.frustumCulled = false;
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

    const pinnedStyleBySiteId = new Map<string, PinnedSiteStyle>();
    const pinnedSiteIds = new Set<string>();
    let markerSitesSnapshot = sitesRef.current;
    let markerSelectedSiteIdSnapshot = selectedSiteIdRef.current;
    let markerComparedSiteIdsSnapshot = comparedSiteIdsRef.current.slice();
    let markerCustomLatSnapshot = customLatRef.current;
    let markerCustomLonSnapshot = customLonRef.current;

    function comparedSiteIdsMatch(left: readonly string[], right: readonly string[]) {
      if (left.length !== right.length) return false;
      for (let i = 0; i < left.length; i += 1) {
        if (left[i] !== right[i]) return false;
      }
      return true;
    }

    function rebuildPinnedStyles(selectedId: string, comparedIds: readonly string[]) {
      pinnedStyleBySiteId.clear();
      comparedIds.forEach((siteId, idx) => {
        const style = PINNED_SITE_STYLES[idx];
        if (!style || siteId === selectedId) return;
        pinnedStyleBySiteId.set(siteId, style);
      });
    }

    const handleMarkerInteraction = (siteId: string) => {
      if (!siteId) return;
      const isPinned = pinnedSiteIds.has(siteId);
      if (isPinned) {
        onPinnedSiteFocusRef.current?.(siteId);
        return;
      }
      onSiteSelectRef.current(siteId);
    };

    function buildMarkers() {
      markerGroup.clear();
      while (hudContainer.firstChild) hudContainer.removeChild(hudContainer.firstChild);
      pinnedSiteIds.clear();
      rebuildPinnedStyles(markerSelectedSiteIdSnapshot, markerComparedSiteIdsSnapshot);

      const allSites = markerSitesSnapshot.slice();
      if (
        markerCustomLatSnapshot !== undefined
        && markerCustomLonSnapshot !== undefined
        && !Number.isNaN(markerCustomLatSnapshot)
        && !Number.isNaN(markerCustomLonSnapshot)
      ) {
        allSites.push({
          id: 'custom',
          name: 'Custom',
          category: 'Custom',
          lat: markerCustomLatSnapshot,
          lon: markerCustomLonSnapshot,
          alt_km: 0,
          max_slope_deg: 0,
          psr_distance_km: 0,
          description: '',
          horizon_profile_deg: [],
        } as unknown as SiteData);
      }
      for (const s of allSites) {
        const isSelected = s.id === markerSelectedSiteIdSnapshot;
        const pinnedStyle = pinnedStyleBySiteId.get(s.id);
        const isPinned = !isSelected && Boolean(pinnedStyle);
        if (isPinned) {
          pinnedSiteIds.add(s.id);
        }
        const col = isSelected
          ? 0x10b981
          : (pinnedStyle?.haloHex ?? (s.id === 'apollo-11' ? 0x06b6d4 : (s.max_slope_deg > 15 ? 0xef4444 : 0xf59e0b)));
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
        surfaceRing.userData.baseOpacity = isPinned ? 0.45 : 0.32;
        surfaceRing.userData.opacityAmplitude = isPinned ? 0.28 : 0.18;
        surfaceRing.userData.scaleAmplitude = isPinned ? 0.2 : 0.12;
        surfaceRing.userData.pulseSpeed = isPinned ? 2.5 : 2;
        pin.add(surfaceRing);

        if (isPinned && pinnedStyle) {
          const haloRing = new THREE.Mesh(
            new THREE.RingGeometry(0.13, 0.24, 40),
            new THREE.MeshBasicMaterial({
              color: pinnedStyle.haloHex,
              transparent: true,
              opacity: 0.22,
              side: THREE.DoubleSide,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
            }),
          );
          haloRing.rotation.x = Math.PI / 2;
          haloRing.position.set(0, 0.012, 0);
          haloRing.renderOrder = 1000;
          haloRing.userData.baseOpacity = 0.18;
          haloRing.userData.opacityAmplitude = 0.3;
          haloRing.userData.scaleAmplitude = 0.22;
          haloRing.userData.pulseSpeed = 1.6;
          haloRing.userData.pulsePhase = 0.7;
          pin.add(haloRing);

          const haloRingOuter = new THREE.Mesh(
            new THREE.RingGeometry(0.25, 0.35, 40),
            new THREE.MeshBasicMaterial({
              color: pinnedStyle.haloHex,
              transparent: true,
              opacity: 0.12,
              side: THREE.DoubleSide,
              depthWrite: false,
              blending: THREE.AdditiveBlending,
            }),
          );
          haloRingOuter.rotation.x = Math.PI / 2;
          haloRingOuter.position.set(0, 0.013, 0);
          haloRingOuter.renderOrder = 1001;
          haloRingOuter.userData.baseOpacity = 0.1;
          haloRingOuter.userData.opacityAmplitude = 0.2;
          haloRingOuter.userData.scaleAmplitude = 0.15;
          haloRingOuter.userData.pulseSpeed = 1.2;
          haloRingOuter.userData.pulsePhase = 1.3;
          pin.add(haloRingOuter);
        }

        const shouldShowLabel = isSelected || isPinned;
        if (shouldShowLabel) {
          const label = document.createElement('div');
          label.innerText = isPinned ? `PINNED: ${s.name}` : `ACTIVE: ${s.name}`;
          label.style.position = 'absolute';
          label.style.pointerEvents = 'auto';
          label.style.padding = '4px 10px';
          label.style.background = isPinned ? pinnedStyle!.labelBackground : '#043024';
          label.style.border = `1px solid ${isPinned ? pinnedStyle!.labelBorder : '#10B981AA'}`;
          label.style.color = isPinned ? pinnedStyle!.labelText : '#A7F3D0';
          label.style.fontSize = '11px';
          label.style.fontFamily = 'JetBrains Mono, monospace';
          label.style.letterSpacing = '0.02em';
          label.style.borderRadius = '999px';
          label.style.whiteSpace = 'nowrap';
          label.style.transform = 'translate(-50%, -150%)';
          label.style.boxShadow = isPinned
            ? `0 0 16px ${pinnedStyle!.haloCss}55`
            : '0 0 12px #10B98155';
          label.style.cursor = 'pointer';
          label.onclick = () => handleMarkerInteraction(s.id);
          hudContainer.appendChild(label);
          (pin as any).hudLabel = label;
        }
      }
    }

    function syncMarkers(force = false) {
      const nextSites = sitesRef.current;
      const nextSelectedSiteId = selectedSiteIdRef.current;
      const nextComparedSiteIds = comparedSiteIdsRef.current;
      const nextCustomLat = customLatRef.current;
      const nextCustomLon = customLonRef.current;

      const shouldRebuild = force
        || markerSitesSnapshot !== nextSites
        || markerSelectedSiteIdSnapshot !== nextSelectedSiteId
        || markerCustomLatSnapshot !== nextCustomLat
        || markerCustomLonSnapshot !== nextCustomLon
        || !comparedSiteIdsMatch(markerComparedSiteIdsSnapshot, nextComparedSiteIds);

      if (!shouldRebuild) return;

      markerSitesSnapshot = nextSites;
      markerSelectedSiteIdSnapshot = nextSelectedSiteId;
      markerComparedSiteIdsSnapshot = nextComparedSiteIds.slice();
      markerCustomLatSnapshot = nextCustomLat;
      markerCustomLonSnapshot = nextCustomLon;
      buildMarkers();
    }

    syncMarkers(true);

    // Raycaster for clicks
    const raycaster = new THREE.Raycaster();

    function resolveSiteId(object: THREE.Object3D | null): string | null {
      let current: THREE.Object3D | null = object;
      while (current) {
        const candidate = (current as any).siteId;
        if (typeof candidate === 'string') return candidate;
        current = current.parent;
      }
      return null;
    }

    function onClick(ev: MouseEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
      const hits = raycaster.intersectObjects(markerGroup.children as any, true);
      if (hits.length > 0) {
        const siteId = resolveSiteId(hits[0].object);
        if (siteId) handleMarkerInteraction(siteId);
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

    const sunRay = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xF59E0B, linewidth: 2, transparent: true, opacity: 0.95 }),
    );
    const earthRay = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0x06B6D4, linewidth: 2, transparent: true, opacity: 0.95 }),
    );

    const sunIndicator = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xF59E0B, transparent: true, opacity: 0.95 }),
    );
    const earthIndicator = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x06B6D4, transparent: true, opacity: 0.95 }),
    );

    const sunRayMaterial = sunRay.material as THREE.LineBasicMaterial;
    const earthRayMaterial = earthRay.material as THREE.LineBasicMaterial;
    const sunIndicatorMaterial = sunIndicator.material as THREE.MeshBasicMaterial;
    const earthIndicatorMaterial = earthIndicator.material as THREE.MeshBasicMaterial;

    sunRay.frustumCulled = false;
    earthRay.frustumCulled = false;
    sunIndicator.frustumCulled = false;
    earthIndicator.frustumCulled = false;

    raysGroup.add(sunRay);
    raysGroup.add(earthRay);
    raysGroup.add(sunIndicator);
    raysGroup.add(earthIndicator);

    const fallbackSunDir = new THREE.Vector3(0.5, 0.5, 0.5).normalize();
    const fallbackEarthDir = new THREE.Vector3(-0.3, 0.05, 0.95).normalize();
    const lastValidSunDir = fallbackSunDir.clone();
    const lastValidEarthDir = fallbackEarthDir.clone();
    const targetSunDir = sanitizeDirection(sun.position.clone(), lastValidSunDir);
    const smoothedSunDir = targetSunDir.clone();
    const targetEarthDir = lastValidEarthDir.clone();
    const smoothedEarthDir = targetEarthDir.clone();
    const cameraTargetPosition = new THREE.Vector3();
    const activeSiteWorldPosition = new THREE.Vector3();
    const sunRayEnd = new THREE.Vector3();
    const earthRayEnd = new THREE.Vector3();

    function setLinePoints(line: THREE.Line, start: THREE.Vector3, end: THREE.Vector3) {
      const position = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      position.setXYZ(0, start.x, start.y, start.z);
      position.setXYZ(1, end.x, end.y, end.z);
      position.needsUpdate = true;
    }

    function applyRendererSize(nextWidth: number, nextHeight: number, force = false) {
      const roundedWidth = Math.max(1, Math.round(nextWidth));
      const roundedHeight = Math.max(320, Math.round(nextHeight));
      if (
        !force
        && Math.abs(roundedWidth - lastAppliedWidth) < 2
        && Math.abs(roundedHeight - lastAppliedHeight) < 2
      ) {
        return;
      }
      lastAppliedWidth = roundedWidth;
      lastAppliedHeight = roundedHeight;
      renderer.setSize(lastAppliedWidth, lastAppliedHeight);
      camera.aspect = lastAppliedWidth / lastAppliedHeight;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    }

    let previousTimelineStep: number | null = null;
    let previousTelemetryLength = telemetryPointsRef.current.length;
    let lastFrameTimeSeconds = performance.now() * 0.001;

    // animation loop
    function animate() {
      if (isDisposed) return;
      if (!mounted) return;
      rafId = requestAnimationFrame(animate);
      const frameTimeSeconds = performance.now() * 0.001;
      const rawDt = Math.max(0, frameTimeSeconds - lastFrameTimeSeconds);
      const clampedDt = Math.min(rawDt, 0.05);
      lastFrameTimeSeconds = frameTimeSeconds;
      const frameScale = clampedDt / NOMINAL_FRAME_DT;
      const bodyLerpAlpha = Math.min(1, Math.max(0, BODY_VECTOR_LERP * frameScale));
      const cameraLerpAlpha = Math.min(1, Math.max(0, CAMERA_TRANSITION_LERP * frameScale));
      const autoRotateStep = 0.0006 * frameScale;

      const activeTelemetryPoints = telemetryPointsRef.current;
      const telemetryLength = activeTelemetryPoints.length;
      let shouldSnapDirections = false;
      if (telemetryLength > 0) {
        const idx = Math.min(Math.max(0, timelineIdxRef.current), telemetryLength - 1);
        const telemetryLengthChanged = telemetryLength !== previousTelemetryLength;
        if (telemetryLengthChanged) {
          previousTimelineStep = null;
          previousTelemetryLength = telemetryLength;
          shouldSnapDirections = true;
        }

        if (previousTimelineStep !== null) {
          const stepDelta = idx - previousTimelineStep;
          const wrappedTimeline = stepDelta < 0
            && previousTimelineStep >= telemetryLength - 2
            && idx <= 1;
          const jumpedSteps = Math.abs(stepDelta) > 4;
          if (wrappedTimeline || jumpedSteps) {
            shouldSnapDirections = true;
          }
        } else {
          shouldSnapDirections = true;
        }
        previousTimelineStep = idx;
      } else {
        previousTimelineStep = null;
        previousTelemetryLength = 0;
      }

      const nextSunDirection = sunDirectionRef.current;
      if (nextSunDirection) {
        sanitizeDirection(targetSunDir.set(nextSunDirection.x, nextSunDirection.y, nextSunDirection.z), lastValidSunDir);
        lastValidSunDir.copy(targetSunDir);
      } else {
        targetSunDir.copy(lastValidSunDir);
      }

      const nextEarthDirection = earthDirectionRef.current;
      if (nextEarthDirection) {
        sanitizeDirection(targetEarthDir.set(nextEarthDirection.x, nextEarthDirection.y, nextEarthDirection.z), lastValidEarthDir);
        lastValidEarthDir.copy(targetEarthDir);
      } else {
        targetEarthDir.copy(lastValidEarthDir);
      }

      sanitizeDirection(targetSunDir, lastValidSunDir);
      sanitizeDirection(targetEarthDir, lastValidEarthDir);

      syncMarkers();

      if (shouldSnapDirections) {
        smoothedSunDir.copy(targetSunDir);
        sanitizeDirection(smoothedSunDir, lastValidSunDir);
        lastValidSunDir.copy(smoothedSunDir);

        smoothedEarthDir.copy(targetEarthDir);
        sanitizeDirection(smoothedEarthDir, lastValidEarthDir);
        lastValidEarthDir.copy(smoothedEarthDir);
      } else {
        smoothedSunDir.lerp(targetSunDir, bodyLerpAlpha);
        sanitizeDirection(smoothedSunDir, lastValidSunDir);
        lastValidSunDir.copy(smoothedSunDir);

        smoothedEarthDir.lerp(targetEarthDir, bodyLerpAlpha);
        sanitizeDirection(smoothedEarthDir, lastValidEarthDir);
        lastValidEarthDir.copy(smoothedEarthDir);
      }

      sun.position.copy(smoothedSunDir).multiplyScalar(SUN_LIGHT_DISTANCE);
      rimUniforms.sunDir.value.copy(smoothedSunDir);

        // smooth camera lerp toward preset target only when transitioning
        if (isCameraTransitioning) {
          azimuth += (cameraTarget.az - azimuth) * cameraLerpAlpha;
          polar += (cameraTarget.pol - polar) * cameraLerpAlpha;
          distance.value += (cameraTarget.dist - distance.value) * cameraLerpAlpha;
          // compute target cam pos from spherical target
          const tr = cameraTarget.dist;
          const tx = tr * Math.cos(cameraTarget.pol) * Math.sin(cameraTarget.az);
          const ty = tr * Math.sin(cameraTarget.pol);
          const tz = tr * Math.cos(cameraTarget.pol) * Math.cos(cameraTarget.az);
          cameraTargetPosition.set(tx, ty, tz);
          if (camera.position.distanceTo(cameraTargetPosition) < 0.02) {
            isCameraTransitioning = false;
          }
        }
       // simple auto-rotation when not interacting (blend with preset)
       if (!isDragging && !isCameraTransitioning) {
         azimuth += autoRotateStep;
       }
       updateCamera();

       // animate pulsing of beacons and rings, update HUD labels
       const t = frameTimeSeconds;
       markerGroup.children.forEach((c, idx) => {
         const g = c as THREE.Group & { hudLabel?: HTMLDivElement };
         const top = g.children[1];
         if (top) {
           const s = 1 + 0.08 * Math.sin(t * 3 + idx);
           top.scale.setScalar(s);
         }
         // pulse surface ring (child at end)
          g.children.forEach((child, ringIdx) => {
            const ring = child as THREE.Mesh;
            const geometry = (ring as any).geometry as THREE.BufferGeometry | undefined;
            if (!geometry || geometry.type !== 'RingGeometry') return;

            const pulseSpeed = typeof ring.userData.pulseSpeed === 'number' ? ring.userData.pulseSpeed : 2;
            const pulsePhase = typeof ring.userData.pulsePhase === 'number' ? ring.userData.pulsePhase : 0;
            const scaleAmplitude = typeof ring.userData.scaleAmplitude === 'number' ? ring.userData.scaleAmplitude : 0.12;
            const baseOpacity = typeof ring.userData.baseOpacity === 'number' ? ring.userData.baseOpacity : 0.32;
            const opacityAmplitude = typeof ring.userData.opacityAmplitude === 'number' ? ring.userData.opacityAmplitude : 0.2;

            const pulse = Math.abs(Math.sin(t * pulseSpeed + idx + ringIdx * 0.35 + pulsePhase));
            const scale = 1 + scaleAmplitude * pulse;
            ring.scale.set(scale, scale, scale);

            const material = ring.material as THREE.Material;
            material.opacity = Math.min(0.95, baseOpacity + opacityAmplitude * pulse);
          });

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

       const activeSunVisible = sunVisibleRef.current;
       const activeEarthVisible = earthVisibleRef.current;
       sunRayMaterial.opacity = activeSunVisible ? 0.95 : 0.32;
       sunIndicatorMaterial.opacity = activeSunVisible ? 0.95 : 0.32;
       earthRayMaterial.opacity = activeEarthVisible ? 0.95 : 0.32;
       earthIndicatorMaterial.opacity = activeEarthVisible ? 0.95 : 0.32;

       // update directional rays for the active site
       try {
         const activeSelectedSiteId = selectedSiteIdRef.current;
         const sel = markerGroup.children.find((m) => (m as any).siteId === activeSelectedSiteId) as THREE.Object3D | undefined;
         if (sel) {
            sel.getWorldPosition(activeSiteWorldPosition);

            sunRayEnd.copy(smoothedSunDir).multiplyScalar(VECTOR_INDICATOR_LENGTH).add(activeSiteWorldPosition);
            earthRayEnd.copy(smoothedEarthDir).multiplyScalar(VECTOR_INDICATOR_LENGTH).add(activeSiteWorldPosition);

           setLinePoints(sunRay, activeSiteWorldPosition, sunRayEnd);
           setLinePoints(earthRay, activeSiteWorldPosition, earthRayEnd);

           sunIndicator.position.copy(sunRayEnd);
           earthIndicator.position.copy(earthRayEnd);

           sunRay.visible = true;
           earthRay.visible = true;
           sunIndicator.visible = true;
           earthIndicator.visible = true;
         } else {
           sunRay.visible = false;
           earthRay.visible = false;
           sunIndicator.visible = false;
           earthIndicator.visible = false;
         }
       } catch {
         sunRay.visible = false;
         earthRay.visible = false;
         sunIndicator.visible = false;
         earthIndicator.visible = false;
       }

       renderer.render(scene, camera);
    }
    animate();

    // handle resize
    const onResize = () => {
      applyRendererSize(mount.clientWidth || 480, mount.clientHeight || 320);
    };
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        applyRendererSize(entry.contentRect.width, entry.contentRect.height);
      });
      resizeObserver.observe(mount);
    }
    window.addEventListener('resize', onResize);

    return () => {
      isDisposed = true;
      mounted = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }

      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('click', onClick);
      window.removeEventListener('resize', onResize);
      resizeObserver?.disconnect();

      const sharedTextures = new Set<THREE.Texture>();
      const loadedMoonTexture = getLoadedMoonTexture();
      const sharedAlbedo = (lunarTextureCache as any).threeAlbedo as THREE.Texture | undefined;
      const sharedBump = (lunarTextureCache as any).threeBump as THREE.Texture | undefined;
      if (loadedMoonTexture) sharedTextures.add(loadedMoonTexture);
      if (sharedAlbedo) sharedTextures.add(sharedAlbedo);
      if (sharedBump) sharedTextures.add(sharedBump);

      const disposedTextures = new Set<THREE.Texture>();
      const disposedMaterials = new Set<THREE.Material>();
      const disposedGeometries = new Set<THREE.BufferGeometry>();

      const disposeTexture = (texture: THREE.Texture | null | undefined) => {
        if (!texture || sharedTextures.has(texture) || disposedTextures.has(texture)) return;
        disposedTextures.add(texture);
        try { texture.dispose(); } catch {}
      };

      const disposeMaterial = (material: THREE.Material | THREE.Material[] | null | undefined) => {
        if (!material) return;
        const materials = Array.isArray(material) ? material : [material];
        const textureKeys: readonly string[] = [
          'map',
          'alphaMap',
          'aoMap',
          'bumpMap',
          'displacementMap',
          'emissiveMap',
          'envMap',
          'lightMap',
          'metalnessMap',
          'normalMap',
          'roughnessMap',
          'specularMap',
          'gradientMap',
        ];

        materials.forEach((mat) => {
          if (disposedMaterials.has(mat)) return;
          disposedMaterials.add(mat);
          textureKeys.forEach((key) => {
            disposeTexture((mat as any)[key] as THREE.Texture | null | undefined);
          });
          try { mat.dispose(); } catch {}
        });
      };

      const disposeObject3D = (object: THREE.Object3D | null | undefined) => {
        if (!object) return;
        object.traverse((child) => {
          const geometry = (child as any).geometry as THREE.BufferGeometry | undefined;
          if (geometry && !disposedGeometries.has(geometry)) {
            disposedGeometries.add(geometry);
            try { geometry.dispose(); } catch {}
          }
          disposeMaterial((child as any).material as THREE.Material | THREE.Material[] | undefined);
        });
      };

      disposeObject3D(markerGroup);
      disposeObject3D(graticule);
      disposeObject3D(ring);
      disposeObject3D(raysGroup);
      disposeObject3D(moon);
      disposeObject3D(rimSphere);

      (renderer as any).renderLists?.dispose?.();
      try { (renderer as any).forceContextLoss?.(); } catch {}
      renderer.dispose();

      try { mount.removeChild(renderer.domElement); } catch {}
      try { mount.removeChild(overlay); } catch {}
      focusCameraOnSiteRef.current = () => {};
    };
  }, []);

  useEffect(() => {
    if (focusedSite && !Number.isNaN(focusedSite.lat) && !Number.isNaN(focusedSite.lon)) {
      focusCameraOnSiteRef.current(focusedSite);
      return;
    }

    const activeSite = sites.find((site) => site.id === selectedSiteId)
      ?? (typeof customLat === 'number' && typeof customLon === 'number'
        ? ({ lat: customLat, lon: customLon } as SiteData)
        : null);
    focusCameraOnSiteRef.current(activeSite);
  }, [focusedSite?.id, selectedSiteId, sites, customLat, customLon]);

  // Fallback SVG rendering when WebGL is not available (jsdom / headless)
  if (shouldUseSvgFallback) {
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
              const pinnedIdx = comparedSiteIds.findIndex((id) => id === s.id);
              const pinnedStyle = pinnedIdx >= 0 && s.id !== selectedSiteId ? PINNED_SITE_STYLES[pinnedIdx] : undefined;
              const isPinned = Boolean(pinnedStyle);
              const isSelected = s.id === selectedSiteId;
              const color = isSelected
                ? '#10B981'
                : (pinnedStyle?.haloCss ?? (s.id === 'apollo-11' ? '#06B6D4' : (s.max_slope_deg > 15 ? '#EF4444' : '#F59E0B')));

              const labelText = isSelected
                ? `ACTIVE: ${s.name}`
                : (isPinned ? `PINNED: ${s.name}` : '');
              const labelWidth = Math.max(120, labelText.length * 7.1 + 14);

              return (
                <g key={s.id} onClick={() => handleSiteInteraction(s.id, isPinned)} style={{ cursor: 'pointer' }}>
                  {isPinned && pinnedStyle && (
                    <>
                      <circle cx={p.x} cy={p.y} r={11} fill="none" stroke={pinnedStyle.haloCss} strokeOpacity={0.8} strokeWidth={2} />
                      <circle cx={p.x} cy={p.y} r={15} fill="none" stroke={pinnedStyle.haloCss} strokeOpacity={0.4} strokeWidth={2} />
                    </>
                  )}
                  <circle cx={p.x} cy={p.y} r={6} fill={color} stroke="#000" />
                  {(isSelected || isPinned) && (
                    <g transform={`translate(${p.x - labelWidth / 2}, ${p.y - 26})`}>
                      <rect
                        width={labelWidth}
                        height={16}
                        rx={8}
                        ry={8}
                        fill={isPinned ? pinnedStyle!.labelBackground : '#043024'}
                        stroke={isPinned ? pinnedStyle!.labelBorder : '#10B981AA'}
                      />
                      <text
                        x={labelWidth / 2}
                        y={11}
                        textAnchor="middle"
                        fontSize={9.5}
                        style={{ fontFamily: 'JetBrains Mono, monospace' }}
                        fill={isPinned ? pinnedStyle!.labelText : '#A7F3D0'}
                      >
                        {labelText}
                      </text>
                    </g>
                  )}
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
      <div ref={mountRef} className="relative h-[380px] w-full sm:h-[420px]" />
    </div>
  );
};

export default LunarOrbitalGlobe;
