# Nesting Studio

App de escritorio (Tauri + React) para planear el nesting de paneles con **tus reglas internas**, antes de montarlo en el software de Salvagnini.

1. Le das la carpeta del release: lee todos los **STEP** (los desdobla) y los **BOM .xls/.xlsx**.
2. Defines reglas: *"si un panel tiene borde 04, no puede ir arriba a la izquierda"*, *"horizontales con A a lo largo de X"*, etc.
3. Calcula la mejor configuración respetando esas reglas y te muestra **lámina por lámina** cómo queda, agrupando las láminas idénticas (×N).
4. Mueves o rotas piezas a mano, cambias reglas o cantidades y ves el efecto en vivo; vuelves a optimizar respetando lo que fijaste.
5. Exportas coordenadas (CSV) o DXF para replicarlo en Salvagnini.

---

## Instalar en Windows (una sola vez)

Abre **PowerShell** y ejecuta:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Rustlang.Rustup
winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Cierra y vuelve a abrir la terminal (para que tome el PATH). WebView2 ya viene con Windows 10/11.

## Usar

- **`iniciar.bat`**: instala dependencias la primera vez y abre la app en modo desarrollo (recarga al editar el código).
- **`compilar.bat`**: genera el instalador `.exe` en `src-tauri\target\release\bundle\nsis\`. Instálalo y ya tienes "Nesting Studio" en el menú de inicio.

O a mano:

```bash
npm install
npm run tauri dev      # desarrollo
npm run tauri build    # instalador
npm run build:web      # versión navegador en un solo HTML (dist-web/index.html)
npm run test:core      # prueba de núcleo con los archivos de /samples
```

También puedes abrir una carpeta directo: `"Nesting Studio.exe" "C:\ruta\al\release"`.

---

## Cómo lee tus archivos

**BOM (.xls/.xlsx)**: la hoja *Project* da job, release, material, aleación, espesor y color. Cada hoja de panel (`125-FLAT_01A-02A-03A-03A_AL-08`) da `DEPTH "Z"`, `TYPE`, bordes `T B L R`, `MTL`, `THK`, y la tabla `PANEL MARK / QUANTITY / A / B / (C, X, Y) / Z / (Z1) / GRAIN / NOTES / OPTIONS`. Las columnas se buscan por nombre, así que los tipos con columnas distintas (CORN, FASF, TTFL…) funcionan igual.

**STEP**: se ligan al BOM por la marca al final del nombre (`…-AL-08_2005.step` → marca 2005) y se verifica que tipo y bordes coincidan.

**Desdoblado**: se toma la cara plana más grande (la cara del panel), se recorre la "piel" de la lámina cruzando sólo las uniones tangentes y cada doblez cilíndrico se desenrolla con el radio neutro `r_interior + K·espesor`. El espesor se detecta del modelo. Sale el contorno real (corte, dobleces, perforaciones) y el **blank** (rectángulo envolvente) con el que se anida.

**Paneles sin STEP**: el blank se estima como A×B (CORN: A+B × C; FASF: A × B+C) más una **holgura por condición de borde** que la app *aprende* de los STEP que sí tienes (Ajustes → Holgura de desarrollo). Puedes escribir valores manuales.

## Reglas

Una regla es **Cuando** (condiciones) → **Entonces** (acciones).

**Campos disponibles**: cualquier borde, borde T/B/L/R, bordes laterales, orientación H/V (A≥B = horizontal, configurable), A, B, C, Z, desarrollo ancho/alto/lado largo/corto, área, tipo, depth, marca, cantidad, job, grain, options, notes, material, calibre, color, hoja del BOM, si tiene STEP.

**Operadores**: igual, distinto, empieza con, termina en, contiene, en lista (`04A, 04E`), mayor/menor, entre, vacío, regex. Los grupos permiten combinar con *todas* / *alguna* e invertir (NO).

**Expresión avanzada** (JavaScript) para casos raros:
```js
L.startsWith('04') && blankW > 40
edges.some(e => fam(e) === '04') && orientation === 'V'
```

**Acciones**:

| Acción | Qué hace |
|---|---|
| Lado hacia una dirección | Gira el panel para que el lado con ese código (p. ej. 04) quede arriba/abajo/izq./der. |
| Lado no puede ir en el borde | Ese lado no puede quedar contra el filo de la lámina (a menos de X"). |
| Lado dentro / fuera de una zona | Ese lado tiene que quedar (o no) en una zona, p. ej. la mitad inferior. |
| Lado sin common line | Ese lado no comparte línea de corte: se deja separación con el vecino. |
| Pegar hacia un borde | El panel busca quedar pegado arriba/abajo/izq./der. |
| Prohibir zona | El panel no puede tocar (o quedar dentro de) una zona: esquinas, centros, franjas o rectángulo propio, en pulgadas. |
| Obligar / preferir zona | Debe tocar o quedar dentro de la zona. |
| Orientación | A en X, A en Y, lado largo en X/Y o libre. |
| Separación extra | Holgura adicional alrededor de esas piezas. |
| Prioridad | Se colocan antes (más alto = primero). |
| Limitar tamaños de lámina | Sólo puede ir en ciertas láminas. |
| Separar láminas por campo | Valores distintos no comparten lámina (p. ej. por tipo). |
| Máximo por lámina | Tope de piezas de esa regla por lámina. |
| Ajustar desarrollo | Suma o resta al blank. |
| Excluir | No se anida. |

Cada acción de zona u orientación puede ser **Obligatoria** (nunca se rompe) o **Preferencia** con un peso (se respeta si no cuesta láminas; a más peso, más se esfuerza).

Las reglas se pueden exportar e importar en JSON para compartirlas.

### Reglas del taller (vienen cargadas)

Cada regla dice si aplica a paneles **horizontales**, **verticales** o **ambos** (A ≥ B = horizontal).

1. Los lados 02 no van en los bordes de la lámina. *(ambos)*
2. La condición 04 hacia abajo. *(verticales)*
3. Ningún lateral 04 pasa de la mitad hacia arriba. *(verticales)*
4. Common line, excepto lados 04 y 08 (separación 0.5", ajustable). *(ambos)*
5. Pegados arriba. *(horizontales)* — Pegados abajo. *(verticales)*
6. La condición 01 hacia arriba. *(horizontales)*
7. Sólo se anidan paneles FLAT (CORN, FASF, TTFL… quedan excluidos). *(ambos)*
8. No mezclar horizontales y verticales en una lámina. *(ambos)*
9. Verticales acostados: B a lo largo de la lámina. *(verticales)*
10. Las 01 hacia la derecha — preferencia. *(ambos)*

En la tarjeta **Reglas de la lámina**: márgenes (0.3" lados y abajo, 2" arriba), common line, **repetir láminas iguales** y **filas del mismo alto**.

Si una pieza no se puede ubicar, la app dice qué regla lo impide.

### Láminas y cantidades

En **Láminas → Láminas de este nesting** eliges los tamaños del menú (48 × 78 … 60 × 130) y la cantidad disponible de cada uno. Si las cantidades no alcanzan, aparece un aviso con la sugerencia de cuántas láminas agregar y de qué tamaño; puedes cambiar el tamaño y la cantidad antes de aplicarla.

## Optimizador

- Nesting rectangular por blank con espacio libre tipo *MaxRects*, llenando lámina por lámina desde la esquina que elijas.
- En cada lámina prueba cada tamaño habilitado (respetando stock y material) y se queda con el de mejor aprovechamiento.
- Búsqueda multi-arranque: 5 órdenes × 4 heurísticas, y luego búsqueda local sobre el orden durante el tiempo que configures.
- Paneles con "techo" (p. ej. el retorno 04 no puede pasar de la mitad): prueba armar la lámina con una fila baja abajo y los paneles altos encima, que arrancan bajo la mitad y suben hacia la parte libre.
- Láminas cuadriculadas: para cada lámina busca primero un acomodo en filas de paneles del mismo alto (cortes limpios), respetando todas las reglas; sólo si no conviene usa acomodos mixtos. Deslizador "Láminas cuadriculadas" en Optimización.
- Con cantidades máximas de lámina, ubicar todas las piezas es lo primero: si faltan, sigue buscando hasta 6× el tiempo configurado (máx. 45 s).
- Costo: piezas sin ubicar ≫ área de lámina usada > preferencias rotas > número de layouts distintos > compacidad de la última lámina (para dejar retal útil).
- Las láminas idénticas quedan consecutivas y agrupadas (×N): las programas una vez en Salvagnini.

## Edición manual

En **Láminas**: arrastra piezas (con imán a bordes y separaciones; `Shift` sin imán), `R` rota, `L` fija, `Supr` retira, flechas mueven 1/8" (`Shift` = 1"), `Ctrl+Z / Ctrl+Y`. Las infracciones se marcan en rojo al instante. Lo que mueves queda **fijado** y "Optimizar" reacomoda el resto alrededor.

## Exportar

- **CSV**: una fila por pieza con lámina, layout, repeticiones, marca, bordes, X, Y, ancho, alto, rotación (0/90/180/270, antihoraria) y qué código queda arriba y abajo. Origen inferior o superior izquierdo (Ajustes). Rotación 0 = A a lo largo de X.
- **DXF** (R12, pulgadas): capas `LAMINA`, `MARGEN`, `BLANK`, `CORTE`, `DOBLEZ`, `TEXTO`; todas las láminas o la actual.
- **Configuración**: reglas + láminas + ajustes en JSON.

## Límites

- Se anida el rectángulo envolvente del desarrollo, no el contorno real (igual que en el ejemplo de Salvagnini con paneles en rejilla).
- Caras B-spline del STEP (raras en estos paneles) no se desdoblan; se ignoran y no afectan el blank salvo en esas zonas.
- El factor K por defecto (0.40) es un supuesto: compáralo con el desarrollo de Salvagnini y ajústalo en Ajustes.
- La app no escribe programas de la máquina; te da la configuración para replicarla.

## Estructura

```
src/core/step.ts      lector STEP (B-rep) sin dependencias
src/core/unfold.ts    desdoblado de lámina
src/core/bom.ts       lector de BOM (SheetJS)
src/core/panels.ts    unión BOM + STEP, holguras, campos para reglas
src/core/rules.ts     evaluación de reglas, zonas, validación de layouts
src/core/nest.ts      optimizador
src/core/worker.ts    hilo de cálculo (desdoblado y nesting)
src/store.ts          estado de la app, edición, deshacer
src/ui/*              vistas (Archivos, Láminas, Reglas, Paneles, Ajustes)
src-tauri/            backend Rust: escanear carpeta, leer/escribir archivos
```
