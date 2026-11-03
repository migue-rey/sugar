# Exposición deliberada e inventario de red

Preparación del issue #10. No aplica firewall ni modifica servicios del host. Toda comprobación de la VPS y cualquier cambio real requieren una nueva orden de producción. Los ensayos crean un proyecto Compose aleatorio con servicios sintéticos, sin datos, volúmenes reales ni puertos públicos; se retira al finalizar.

## Política prevista

| Servicio | Redes de producción | Entrada deliberada |
| --- | --- | --- |
| Proxy HTTPS del host | Host | HTTP/HTTPS públicos; mantener SSH y demás servicios aprobados en inventario |
| Web Sugar | front y application | Solo `127.0.0.1:18088` desde el proxy del host; application conecta con API |
| API | application, database y egress | Puerto 3000 sin publicación; web es su cliente interno |
| PostgreSQL | database | Puerto 5432 sin publicación; solo API comparte su red |

`application` y `database` son internas. API conserva salida para DNS/HTTPS a GitHub y DeepSeek mediante egress; no se comparten redes externas con otras aplicaciones. El host y quien controla Docker siguen siendo parte de la frontera de confianza: estas redes no aíslan frente a root ni frente al daemon. Usar nombres de servicio, no IP de contenedores. El Compose de la raíz es desarrollo; su puerto ahora usa loopback por defecto y conserva APP_PORT explícito para accesos LAN deliberados.

La matriz de ensayo permite host-loopback→web→API, API→DB y API→un servicio de salida controlado. Rechaza web→DB, DB→salida y conexiones directas a web/API/DB desde otro bridge, incluyendo el puerto publicado visto desde la puerta de enlace de esa red. Se comprueba con tráfico real y las reglas de aislamiento creadas por Docker, sin editar las reglas del host. El servicio de salida es un sustituto local: no demuestra conectividad real con los proveedores ni seguridad frente a todos los tipos de tráfico externo.

## Inventario privado antes de intervenir

Desde una sesión administrativa verificada y con umask 077, guardar fuera del repositorio/issue un inventario con: servicio/propietario, puerto/protocolo, direcciones IPv4/IPv6, publicación de Docker, red, finalidad, clientes permitidos, regla de firewall/proveedor y método de recuperación. Recoger únicamente lo necesario con `ss -lntup`, listado de puertos de Docker, redes y campos específicos de NetworkSettings; no compartir un docker inspect completo que incluya secretos. Incluir los servicios de **otras aplicaciones** y cada acceso deliberado; no cerrarlos por inferencia.

Revisar versión/opciones del daemon, firewall del proveedor, UFW/firewalld y backend iptables/nftables. Guardar una copia privada de la política vigente para reversión. Tener consola y segunda sesión SSH comprobadas según #9. Este inventario real no se hizo en esta entrega y no deben publicarse sus direcciones ni reglas.

## Docker y firewall: verificaciones obligatorias

Docker instala reglas para puertos y bridges. Un bloqueo UFW de INPUT no prueba que un puerto publicado esté bloqueado: el tráfico puede pasar antes por NAT/forwarding. No vaciar cadenas, desactivar iptables/ip6tables de Docker ni reemplazar políticas globales para arreglar Sugar. Para restricciones adicionales, preparar reglas acotadas al tráfico de Sugar usando el mecanismo correcto del backend (por ejemplo DOCKER-USER en iptables), con aceptación explícita de accesos deliberados y rollback. No copiar reglas iptables a nftables a ciegas.

Docker documenta que versiones **anteriores a 28.0.0** pueden permitir acceso desde el mismo segmento L2 a puertos publicados en localhost. Verificar la versión del servidor real y resolver ese riesgo antes de confiar en loopback; no se actualizó el motor del host en esta preparación. El ensayo TCP entre bridges no reproduce ese bypass L2 y no sustituye dicha comprobación. Revisar también IPv6, direct routing y opciones de bridge: no activar nat-unprotected ni rutas directas hacia backends privados.

Referencias primarias: [filtrado y firewalls](https://docs.docker.com/engine/network/packet-filtering-firewalls/), [publicación de puertos y limitación L2](https://docs.docker.com/engine/network/port-publishing/), [redes Compose](https://docs.docker.com/compose/how-tos/networking/).

## Validación, aplicación y reversión autorizadas

1. Inventariar y respaldar configuración, verificar acceso alternativo y backup recuperable. Comparar el Compose renderizado sin mostrar valores: `config --quiet` para uso diario; el validador de esta carpeta consume JSON privado sin imprimir su contenido.
2. Elegir redes sin colisiones con otras aplicaciones. La configuración evita subredes fijas y redes externas compartidas. Durante la liberación identificar las redes nuevas y ajustar TRUSTED_PROXIES (#7) a la cadena efectiva; recrear redes puede cambiar sus rangos.
3. Con nueva orden, recrear **solo** servicios Sugar, conservando el volumen y archivos anteriores. No usar down -v, system prune ni borrar redes/volúmenes de otras aplicaciones. Se interrumpen conexiones y la API debe recuperar su conexión con DB.
4. Probar HTTPS y login, API→DB, resolución DNS y salida HTTPS sin enviar credenciales ni ejecutar consultas facturables. Desde una máquina externa autorizada comprobar que solo se ven los accesos aprobados; comprobar IPv4/IPv6 y, si corresponde, otra máquina del segmento L2. Repetir pruebas de los demás servicios del inventario. No escanear equipos ajenos.
5. Ante fallo, restaurar el Compose anterior y únicamente las reglas específicas que se cambiaron; recrear Sugar conservando el mismo volumen y verificar todos los accesos aprobados. El rollback de imágenes de deploy.sh **no** revierte redes ni firewall. Mantener abierta la sesión de recuperación hasta completar esta validación.

## Ensayo reproducible

```sh
python3 -m unittest discover -s deploy/network -p 'test_*.py'
docker build -f deploy/network/Dockerfile.test -t sugar-network-probe .
python3 deploy/network/smoke.py
```

El script renderiza exclusivamente `deploy/compose.yaml` con valores sintéticos y sin cargar .env. Verifica política, crea redes/contenedores propios, prueba desde dentro y desde una red ajena y limpia su proyecto sin tocar el volumen real. CI ejecuta el mismo ensayo. No hay manipulación manual de firewall, host networking, contenedores privilegiados ni socket Docker montado. La comprobación pública y las reglas concretas de la VPS quedan pendientes de autorización e inventario privado.
