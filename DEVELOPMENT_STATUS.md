# Estado do desenvolvimento (handoff)

Data: 2026-11-15
Projeto: Selene Vector 301

## 1) Snapshot rapido

- Branch atual: `main`
- Ultima verificacao local: `npm test && npm run build` concluido com sucesso (exit 0)
- Observacao: ruido de `HTMLCanvasElement.getContext` em `jsdom` foi removido via mock global; fallback SVG continua coberto nos testes de UI.

## 2) O que ja esta implementado

### Requisitos e documentacao

- `REQUIREMENTS.md` atualizado com especificacao formal completa:
  - `REQ-SCI-01..05`
  - `REQ-FUNC-01..04`
  - `REQ-VIS-01..04`
  - `REQ-UX-01..03`
- `README.md` em ingles com:
  - link da app (`https://selene-vector-301.vercel.app/`)
  - visao geral da solucao
  - pipeline de dados (JPL Horizons AIRLESS, LRO LOLA, CSA veto, AHP-TOPSIS, 3D twin)
  - comandos locais (`npm install`, `npm test`, `npm run build`)

### 3D Moon, terminator e iluminacao

- `src/lib/lunarGlobeMath.ts`
  - helper puro `computeBodyFixedDirection(latDeg, lonDeg, azDeg, elDeg)` usando base ENU:
    - `N = normalize(Y - (Y.U)U)`
    - `E = normalize(N x U)`
    - `dir = cos(el)cos(az)N + cos(el)sin(az)E + sin(el)U`
- `src/components/LunarOrbitalGlobe.tsx`
  - Sun/Earth rays dirigidos por efemeride do site/timestamp ativo (`sun_az/el`, `earth_az/el`)
  - `DirectionalLight('#FFF9ED', 3.2)` em `sunDir * 12`
  - `AmbientLight('#1E293B', 0.28)`
  - `HemisphereLight('#334155', '#0F172A', 0.35)`
  - textura externa `/textures/moon_1024.jpg` via `THREE.TextureLoader` singleton cacheado em modulo
  - textura externa com `THREE.SRGBColorSpace`, reaproveitada como `map` e `bumpMap` (`bumpScale: 0.055`)
  - fallback procedural mantido (CanvasTexture) quando textura externa nao estiver disponivel
  - fallback SVG para ambiente sem WebGL preservado (importante para testes)
  - material ajustado: `bumpScale: 0.055`, `roughness: 0.92`, `metalness: 0.02`
- `src/lib/lunarGlobeMath.ts`
  - alinhamento longitudinal de `latLonToCartesian` ajustado para casar com UV de `THREE.SphereGeometry`
  - validado com Apollo 11 (Mare Tranquillitatis) e polos Artemis no eixo `-Y`

### Dados e fisica orbital

- `src/data/sites.json`
  - expandido para 10 sites (5 existentes + 5 Artemis III):
    - `connecting-ridge`
    - `peak-near-shackleton`
    - `de-gerlache-rim-2`
    - `haworth`
    - `faustini-rim-a` (slope > 15, aciona veto CSA)
- `src/lib/orbitalPhysics.ts`
  - fallback para sites de polo sul (`lat < -60`) sem efemeride dedicada:
    - usa efemeride de `shackleton-rim`
    - mantem horizonte e metadados fisicos do proprio site

### UX / app

- `src/App.tsx`
  - campo de busca compacto para filtrar sites
  - lista de sites com scroll: `max-h-[290px] overflow-y-auto`

### Testes

- `src/lib/__tests__/lunarGlobeMath.test.ts`
  - `REQ-VIS-02`: validacao de alinhamento UV/longitude (Apollo 11) com `SphereGeometry`
  - validacao de `computeBodyFixedDirection`:
    - `el=90` coincide com vetor zenith local `U`
    - `el=0` ortogonal a `U`
  - validacao de carga de 10 sites
- `src/lib/__tests__/orbitalPhysics.test.ts`
  - `REQ-SCI-05`: `connecting-ridge` e `faustini-rim-a` herdam vetores Sun/Earth de `shackleton-rim`
  - preservacao de `horizon_profile_deg` proprio por site durante fallback de efemeride
  - `REQ-UX-02`: validacao explicita de veto CSA para `faustini-rim-a` (`max_slope_deg > 15`)

## 3) Validacao executada hoje

Comando executado:

```bash
npm test && npm run build
```

Resultado:

- Testes: `5 files`, `29 tests`, todos passando
- Build: sucesso, bundle gerado em `dist/`
- Aviso de performance conhecido: chunk JS principal > 500 kB (apenas warning)

## 4) Pontos de atencao para amanha

1. ✅ Concluido: remover ruido `HTMLCanvasElement.getContext` em `jsdom` sem quebrar fallback SVG.
2. ✅ Concluido: cobertura especifica para fallback de efemeride de sites sul sem chave dedicada.
3. Opcional: quebrar bundle para reduzir warning de chunk grande (code-splitting/manualChunks).

## 5) Como retomar rapido amanha

```bash
npm install
npm test
npm run build
npm run dev
```

Checklist de retomada:

- confirmar que o site selecionado no globe atualiza raios Sun/Earth conforme timeline
- validar visual da textura `public/textures/moon_1024.jpg` no navegador
- revisar UX da busca na sidebar com os 10 sites
