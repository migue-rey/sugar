# Sugar naranja — revisión visual

final result: passed

## Fuentes y capturas

- Referencia seleccionada y corregida: `design/reference-orange.png` (1487 × 1058).
- Implementación: `design/implementation-orange-final.jpg` (1425 × 1013), navegador integrado, viewport solicitado 1440 × 1024; captura del área cliente con barras de desplazamiento excluidas, densidad 1.
- Comparación conjunta: `design/comparison-final.png`. Se normalizó la referencia al área de captura solo para comparar; los activos originales se conservan.
- Estado comparable: tema claro, español, proyecto de demostración v6 y controlador seleccionado. Las ediciones posteriores del usuario no se sobrescribieron; la comprobación móvil final refleja su v8.
- Evidencia adicional: `design/mobile-orange.jpg`, `design/implementation-dark.jpg`, `design/icon-picker-en.jpg`, `design/shared-icons.jpg`.
- No hizo falta otro recorte de marca: la comparación conjunta muestra completos el logo, navbar y selección lateral; se verificaron también sus límites en el DOM y borde izquierdo de 0 px.

## Comparación e iteraciones

1. Se detectó escala de bloques pequeña y elevación excesiva respecto a la referencia. Se aumentó el bloque a 220 px, encabezados a 14 px, ajustó el encuadre y retiraron sombras. Evidencia inicial: `design/comparison-initial.png`; resultado: `design/comparison-final.png`.
2. [P2 resuelto] En móvil la barra de acciones excedía el ancho y recortaba Guardar revisión. Ahora ocupa una fila flexible y el botón pasa a otra línea. Ancho cliente y scroll medidos: 375 px; marca completa desde x12, y12. Evidencia: `design/mobile-orange.jpg`.
3. [P2 resuelto] La pizarra compartida tenía altura interna cero. Se ajustó Vue Flow al contenedor absoluto; se verificó una altura real de 600 px y nodos visibles. Evidencia: `design/shared-icons.jpg`.
4. [P2 resuelto] Las etiquetas de conexión perdían su color al exportar en oscuro. Se asignó un color explícito al texto de BaseEdge. El SVG descargado conserva `fill: rgb(242, 236, 229)` en las tres etiquetas; PNG descargado y abierto correctamente.
5. Revisión final: sin P0/P1/P2 pendientes. La selección lateral usa relleno naranja suave, sin borde izquierdo ni pseudoindicadores; el foco de teclado conserva un contorno accesible.

## Superficies revisadas

- Tipografía: DM Sans y Space Grotesk; jerarquía de encabezados, formularios, marca y bloques. El ajuste automático de la pizarra escala sus textos según el encuadre, manteniendo el zoom del editor.
- Espaciado: navbar continuo de 72 px, marca independiente del plegado lateral, biblioteca/pizarra/inspector y ajuste móvil sin desbordamiento horizontal.
- Colores: blanco cálido #FAF8F5, naranja #C95016, tema grafito con naranja y colores explícitos de puertos preservados.
- Activos: logo PNG con alpha real, nombre Sugar como texto y símbolos Heroicons. No se sustituyó la marca por un dibujo CSS/SVG improvisado.
- Contenido: se conservaron los modelos y puertos reales, incluidos SPI/UART/BME280, en lugar de los textos inventados por ImageGen. Se conservaron las posiciones y conexiones persistidas del usuario.

## Interacciones y comprobaciones

- Crear categoría: botón deshabilitado sin icono; búsqueda sin acentos y selección Batería; guardado correcto en instalación aislada.
- Categorías/subcategorías: herencia, cambio de icono, compatibilidad con peticiones antiguas, validación y restricciones de Admin probadas con PostgreSQL y autenticación reales.
- Proyectos: iconos actualizados sin generar versiones/revisiones. La instalación principal conservó sus documentos y las ediciones concurrentes del usuario.
- Compartidos: metadatos limitados a categorías utilizadas, un icono heredado y una imagen propia visibles; conexión roja explícita conservada (rgb255,0,0), sin acciones de IA.
- Español/inglés, selección de iconos y temas claro/oscuro revisados; marca visible al expandir y plegar navegación.
- Exportación SVG y PNG descargada mediante Chrome porque el navegador integrado no notificó el evento de descarga. SVG analizado: incluye nodos, iconos SVG y colores explícitos de etiquetas; PNG abierto y revisado.
- Consola de implementación principal: sin errores durante la revisión.
- 35 pruebas API correctas, cuatro pruebas frontend de iconos correctas y prueba de integración de categorías correcta. Las integraciones opcionales no se ejecutan en la suite ordinaria sin su URL de prueba.
- Compilación TypeScript/Vite y reconstrucción Docker Compose correctas.

## Diferencias aceptadas / refinamientos P3

- La imagen generada sirve de referencia visual: se conservan las funciones existentes (IA, configuración y navegación plegable), datos y coordenadas auténticas, aunque ImageGen simplificara algunos controles o cambiara puertos.
- El símbolo de temperatura es el disponible en el catálogo Heroicons; el administrador puede elegir cualquiera de los 16 símbolos o heredar del padre.
- Las capturas del navegador integrado tienen compresión JPEG; los componentes y el logo se renderizan con sus fuentes y activo originales.

## Entrega

Implementación publicada en localhost:8088. Cuenta usada para la entrega en tema claro; las demás preferencias no se migraron. Instalación y base de pruebas retiradas al finalizar. Prompts de los dos activos: `design/asset-prompts.md` (ImageGen integrado).
