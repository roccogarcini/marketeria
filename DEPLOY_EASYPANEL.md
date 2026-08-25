# Desplegar Marketería en EasyPanel

Guía self-service para montar tu propia instancia de Marketería. No hace falta ser
programador. Sigue los pasos en orden.

Marketería se despliega como **un solo servicio de tipo Compose** que levanta dos
contenedores:

| Servicio | Qué es                   | Imagen / build              |
|----------|--------------------------|-----------------------------|
| `db`     | Base de datos PostgreSQL | `postgres:16`               |
| `app`    | Marketería (Next.js)        | build desde el `Dockerfile` |

Todo eso ya está descrito en el fichero **`docker-compose.easypanel.yml`** de la
raíz del repositorio. No hay que crear la base de datos aparte: el compose la
levanta, la conecta con la app y le pasa la contraseña él solo.

El dominio se asigna al servicio **`app`**, puerto **3000**. La base de datos no
se expone a internet.

La app arranca **sin claves de IA**: las de OpenAI, Apify, YouTube y demás NO van
en variables de entorno. Se añaden después desde el panel de admin y se guardan
cifradas en la base de datos.

---

## 1. Antes de empezar

Necesitas:

- Un servidor con **EasyPanel** instalado.
- El proyecto de Marketería en un repositorio de **GitHub** (tuyo).
- Un **dominio o subdominio** apuntando a ese servidor, p. ej.
  `marketeria.tudominio.com`. Si aún no lo tienes, vale el dominio automático que
  asigna EasyPanel.
- (Para después) una clave de OpenAI u otro proveedor. No hace falta al
  desplegar.

---

## 2. Genera los secretos

Abre una terminal (la de tu ordenador vale) y ejecuta estos tres comandos.
Guarda cada resultado: los pegarás en EasyPanel en el paso 4.

```bash
# NEXTAUTH_SECRET — firma de las sesiones
openssl rand -base64 32

# ENCRYPTION_KEY — cifra las claves de proveedores en la base de datos
openssl rand -base64 32

# DB_PASSWORD — contraseña de la base de datos (ojo: -hex, no -base64)
openssl rand -hex 24
```

> **Por qué la de la base de datos se genera con `-hex`:** esa contraseña viaja
> dentro de la URL de conexión a Postgres, y `-base64` mete símbolos como `+` o
> `/` que la rompen. El síntoma es `P1000 Authentication failed` y la app
> reiniciándose en bucle. Con `-hex` solo salen números y letras.
>
> Los otros dos secretos (`NEXTAUTH_SECRET` y `ENCRYPTION_KEY`) **no** van dentro
> de ninguna URL, así que ahí base64 está bien.

> **Pon `DB_PASSWORD` antes del primer despliegue.** Postgres fija su contraseña
> la primera vez que arranca y después ignora la variable. Si la cambias más
> tarde, el servicio de base de datos vuelve a sincronizarla en el siguiente
> despliegue (está preparado para eso), pero es una vuelta que te ahorras
> teniéndola desde el principio.

Decide también el **email y la contraseña del administrador inicial**
(`ADMIN_EMAIL` y `ADMIN_PASSWORD`). La contraseña necesita **8 caracteres como
mínimo** o el arranque falla.

> **Guarda la `ENCRYPTION_KEY` en un sitio seguro.** Si la pierdes, las claves de
> proveedores guardadas en el panel quedan ilegibles y hay que volver a meterlas
> todas.

---

## 3. Crea el servicio en EasyPanel

1. En EasyPanel: **Create Project** → ponle un nombre, p. ej. `marketeria`.
2. Dentro del proyecto: **Add Service → Compose**. Tipo **Compose**, no App.
3. En **Source**, pestaña **Git**, pon la dirección de tu repositorio y la rama
   `main`.
4. En **Compose File**, escribe exactamente:
   **`docker-compose.easypanel.yml`**
5. Guarda. Todavía **no despliegues**: primero las variables (paso 4).

> **El error más habitual.** Dejar el fichero por defecto (`docker-compose.yml`).
> Ese es el de desarrollo: publica la app en un puerto del host y no sirve para
> producción. Tiene que ser `docker-compose.easypanel.yml`.

> **Si tu repositorio es privado, lee esto.** Los servicios de tipo *Compose* no
> tienen la pestaña "GitHub" que sí tienen los de tipo *App*: se descargan el
> repositorio a pelo, sin usar el token de GitHub que hayas guardado en los
> ajustes de EasyPanel. Con un repositorio privado por HTTPS verás
> **"Cannot access repository"**. Dos salidas:
>
> - **Repositorio público** (lo más simple si el código no es sensible): pega la
>   dirección `https://github.com/tu-usuario/tu-repo.git` y listo.
> - **Repositorio privado por SSH**: pon la dirección en formato
>   `git@github.com:tu-usuario/tu-repo.git`, guarda, y en el servicio pulsa
>   **Generate SSH Key**. Copia la clave pública que te da y pégala en GitHub,
>   en tu repositorio → **Settings → Deploy keys → Add deploy key**, con permiso
>   de **solo lectura**. Después ya puedes desplegar.

---

## 4. Configura las variables de entorno

En el servicio Compose, pestaña **Environment**. Pega este bloque y sustituye lo
que está en mayúsculas por tus valores del paso 2:

```
DB_PASSWORD=EL-OPENSSL-HEX
NEXTAUTH_SECRET=EL-PRIMER-OPENSSL-BASE64
ENCRYPTION_KEY=EL-SEGUNDO-OPENSSL-BASE64
NEXTAUTH_URL=https://marketeria.tudominio.com
ADMIN_EMAIL=tu@correo.com
ADMIN_PASSWORD=MINIMO-8-CARACTERES
```

Qué es cada una:

| Variable          | Qué poner                                                                       |
|-------------------|----------------------------------------------------------------------------------|
| `DB_PASSWORD`     | El `openssl rand -hex 24` del paso 2. Interna: no la usarás nunca a mano         |
| `NEXTAUTH_SECRET` | El primer `openssl rand -base64 32`. Firma las sesiones                          |
| `ENCRYPTION_KEY`  | El segundo `openssl rand -base64 32`. Cifra las claves de proveedores. **No la pierdas** |
| `NEXTAUTH_URL`    | Tu URL pública, con `https://` y **sin barra final**                             |
| `ADMIN_EMAIL`     | Email del primer administrador                                                   |
| `ADMIN_PASSWORD`  | Su contraseña, **mínimo 8 caracteres**                                           |

Opcionales, con valor por defecto razonable (solo si quieres cambiarlas):

| Variable             | Por defecto     | Para qué                                                     |
|----------------------|-----------------|---------------------------------------------------------------|
| `CRON_TZ`            | `Europe/Madrid` | Zona horaria con la que se leen las tareas programadas        |
| `TRUSTED_PROXY_HOPS` | `1`             | Proxies delante de la app. En EasyPanel hay uno; déjalo en 1  |

> **`DATABASE_URL` no se pone.** El compose la construye él solo a partir de
> `DB_PASSWORD`, apuntando al servicio `db`. Un solo canal, una sola contraseña:
> así la app y la base de datos no pueden desincronizarse. Si la declaras a mano,
> te la estás jugando a que las dos coincidan.

> **`NODE_ENV` y `STORAGE_UPLOAD_PATH` tampoco.** Los fija el compose.

> Ojo: **pega el bloque de arriba ya relleno, no el `.env.example` tal cual.** En
> ese fichero los secretos vienen vacíos a propósito. Si lo pegas sin rellenar, el
> despliegue se para diciendo `required variable DB_PASSWORD is missing a value`.

> Las **claves de IA NO van aquí.** Marketería arranca sin ellas (modo degradado) y
> las configuras después desde el panel (paso 7).

`ADMIN_EMAIL` y `ADMIN_PASSWORD` solo actúan en el **primer arranque**, si la base
de datos está vacía. Después no pisan nada; puedes borrarlas del servicio tras el
primer login.

---

## 5. Asigna el dominio y despliega

1. Dentro del servicio Compose, entra en el servicio **`app`** → **Domains**.
2. Deja el dominio automático de EasyPanel o añade el tuyo, apuntando al
   **puerto 3000**.
3. Deja **HTTPS** activado (el certificado lo gestiona EasyPanel).
4. Pulsa **Deploy**.

El primer despliegue tarda unos minutos porque compila la aplicación. En los logs
verás, en este orden:

1. `[db] Contraseña de spaider sincronizada con DB_PASSWORD.` → base de datos
   lista. (El usuario interno de Postgres se sigue llamando `spaider`: no es un
   resto del rebrand sin hacer, es que renombrarlo dejaría cualquier copia ya
   hecha sin poder restaurarse.)
2. `[entrypoint] aplicando migraciones...` → prepara las tablas.
3. `[bootstrap-admin] ADMIN creado: tu@correo.com` → crea tu administrador.
4. `[entrypoint] arrancando el servidor...` → la app está en marcha.

Si algo falla en las migraciones, el arranque se para y escribe en los logs qué ha
pasado y qué tocar (contraseña de la base de datos, servicio `db` que aún no está
en pie…). No hace falta interpretar el código de error de Prisma.

No tienes que ejecutar nada por consola: migraciones y admin van solos en cada
arranque y nunca pisan datos existentes.

La app expone un healthcheck en `/api/health`. Sabrás que está lista cuando los
dos servicios estén en verde (**healthy**).

---

## 6. Primer login

1. Abre `https://marketeria.tudominio.com`.
2. Entra con `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
3. **Cambia la contraseña** desde **Perfil**. Hecho esto, puedes borrar
   `ADMIN_EMAIL` y `ADMIN_PASSWORD` de las variables del servicio.

---

## 7. Conecta tus proveedores

Marketería funciona sin claves, pero para investigar y producir contenido necesita
al menos un proveedor de IA:

1. Ve a **Admin → Proveedores**.
2. Pega la clave del proveedor que uses (OpenAI, etc.).
3. Se guarda **cifrada** con tu `ENCRYPTION_KEY`; no hace falta redeploy.

Cada integración se configura desde su pantalla del panel de admin. Hasta que
añadas una clave, las funciones que la necesitan te avisan en lugar de romperse.

---

## 8. Entrada de WhatsApp (opcional)

Esta es la parte que **solo funciona ya desplegado**: Meta tiene que poder
llamar a tu servidor desde internet, y `localhost` no le vale.

1. En Marketería: **Admin → Ajustes → WhatsApp (entrada)**.
2. Copia la **URL de devolución de llamada** que te muestra ahí. Es
   `https://tu-dominio/api/webhooks/whatsapp`.
3. Inventa un **token de verificación** (una cadena larga cualquiera) y pégalo
   en el campo. Copia el **App Secret** de Meta → tu app → Configuración →
   Básica y pégalo en el suyo. Enciende el interruptor y **Guarda**.
4. En Meta → tu app → **WhatsApp → Configuración → Webhook**: pega la URL, pega
   el MISMO token de verificación, y **Verificar y guardar**.
5. Suscríbete al campo **`messages`**.

A partir de ahí, cada mensaje que llegue a tu número de WhatsApp Business
aparece en la bandeja de hallazgos, con quién escribe, cuándo y qué dijo.

Los dos secretos se guardan **cifrados** con tu `ENCRYPTION_KEY`, igual que las
claves de IA. La pantalla nunca los vuelve a enseñar: solo dice si están puestos.

> **Si Meta dice "The callback URL or verify token couldn't be validated"**, es
> una de tres: el interruptor está en Inactivo, el token no es idéntico a los
> dos lados, o el dominio todavía no resuelve. El webhook falla cerrado a
> propósito: mientras le falte cualquiera de las dos piezas, rechaza todo.

> **De los adjuntos se guarda la referencia, no el fichero.** De una foto queda
> su pie de texto y el id del adjunto en Meta, no la imagen. Descargarla
> exigiría un token de Graph y guardar binarios de terceros en tu servidor.

---

## 9. Copias de seguridad

- Desde **Admin → Copias** gestionas las copias de la base de datos (la app
  incluye `pg_dump` para volcarla).
- La base de datos vive en el volumen `spaider_db` y tus ficheros en
  `spaider_uploads` (`/app/storage/uploads`). En EasyPanel, activa los **backups
  de volumen** de ambos para tener copia a nivel de infraestructura.
- Y otra vez: **guarda tu `ENCRYPTION_KEY`**. Sin ella, una copia restaurada
  tendrá las claves de proveedores ilegibles.

> **Postgres 16, no más nuevo.** La app trae el cliente `pg_dump` 17 para las
> copias; con un servidor más nuevo que ese cliente, las copias fallan. El
> compose ya fija `postgres:16`: no lo cambies.

---

## ⚠️ Una sola réplica (no lo cambies sin leer esto)

El servicio `app` tiene que quedarse en **1 réplica**. Los cron de las
automatizaciones viven dentro del propio servidor web, y los rate limits y locks
son contadores en la memoria del proceso.

Con dos réplicas, sin ningún error visible en los logs:

- los topes de intentos de login y de la API se multiplican por dos,
- las copias de seguridad pueden solaparse,
- el refresco de precios LLM se ejecuta dos veces,
- las exportaciones PNG pueden abrir el doble de Chromium.

Las automatizaciones programadas SÍ están protegidas: antes de ejecutar, cada
tick reserva su turno en la base de datos, así que una investigación programada
no se ejecuta dos veces aunque haya varias réplicas.

Si se queda corto, **sube CPU y RAM del contenedor** (escalado vertical).
Escalar de verdad (crons en un worker aparte, contadores en Postgres/Redis) es
una decisión de arquitectura, no un cambio de configuración. Lo mismo está
resumido en el README, en «Dos avisos que conviene leer».

---

## Actualizar

Cuando haya versión nueva en `main`, pulsa **Deploy** en el servicio. Las
migraciones se aplican solas al arrancar y tus datos se conservan (viven en los
volúmenes, no en la imagen).

---

## Problemas frecuentes

| Síntoma                                            | Causa / solución                                                                 |
|----------------------------------------------------|----------------------------------------------------------------------------------|
| `required variable DB_PASSWORD is missing a value` (o `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, `NEXTAUTH_URL`) | Pegaste el `.env.example` sin rellenar: los secretos vienen vacíos a propósito. Genera los del paso 2 y vuelve a pegar el bloque del paso 4. |
| `Cannot access repository` al desplegar            | Repositorio privado en un servicio *Compose*: no usa el token de GitHub de los ajustes. Dirección SSH + *deploy key* de solo lectura (paso 3). |
| `P1000 Authentication failed` en los logs de `app` | La contraseña con la que la app llama a su base de datos no coincide con la guardada. El servicio `db` la sincroniza sola en cada arranque, así que **normalmente basta con volver a desplegar**. Si insiste, comprueba que `DB_PASSWORD` no tiene símbolos raros (`+`, `/`): genérala con `openssl rand -hex 24`. En último caso, borra el volumen `spaider_db` y despliega otra vez (empieza vacía). |
| EasyPanel no encuentra el compose                  | O el nombre no es `docker-compose.easypanel.yml`, o el repositorio tiene una carpeta de más en la raíz. |
| El arranque falla con `ADMIN_PASSWORD debe tener al menos 8 caracteres` | Pon una contraseña de admin de 8 caracteres o más y redespliega.                 |
| El log avisa `la base de datos NO tiene usuarios y ADMIN_EMAIL/ADMIN_PASSWORD no están definidos` | Faltan esas dos variables en el primer arranque. Ponlas y redespliega: nadie puede entrar hasta entonces. |
| Entras y te saca al momento                        | `NEXTAUTH_URL` no coincide con la dirección por la que entras. Tiene que ser idéntica, con `https://` y sin barra final. |
| Las claves de proveedores dejan de funcionar tras mover la instancia | Cambió la `ENCRYPTION_KEY`. Recupera la original; si la perdiste, vuelve a pegar las claves en Admin → Proveedores. |
| El servicio no pasa a *healthy*                    | Mira `/api/health`: si devuelve `db: error`, el problema es la conexión a la base de datos. |
| Los ficheros subidos desaparecen al desplegar      | El volumen `spaider_uploads` no está montado. Lo define el compose: comprueba que estás usando `docker-compose.easypanel.yml`. |
| Las copias de seguridad fallan por versión         | El servidor Postgres es más nuevo que el cliente 17. Usa `postgres:16`, que es lo que fija el compose. |
| Las tareas programadas van a otra hora             | Revisa `CRON_TZ`. El contenedor va en UTC; esa variable dice cómo se leen las horas de los cron. |
