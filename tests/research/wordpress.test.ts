import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPostsUrl,
  mapWordPressPost,
  normalizeConfig,
  parsePostsResponse,
} from "../../src/lib/research/wordpress.ts";

/**
 * WordPress como fuente de investigación.
 *
 * Lo que se prueba es lo que rompe en un WordPress de verdad: los campos
 * llegan como HTML con entidades, `date_gmt` viene sin zona horaria (y si se
 * lee como local, la fecha de publicación se va horas), y un sitio con la REST
 * API cerrada responde HTML o un objeto de error en vez de una lista — ahí
 * hace falta un mensaje que diga qué pasa, no "0 hallazgos".
 */

test("la URL pide las entradas más recientes y lleva _links (sin él, _embed no trae autor)", () => {
  const url = new URL(buildPostsUrl("https://miblog.com/", { perPage: 5 }));
  assert.equal(url.origin + url.pathname, "https://miblog.com/wp-json/wp/v2/posts");
  assert.equal(url.searchParams.get("per_page"), "5");
  assert.equal(url.searchParams.get("order"), "desc");
  assert.equal(url.searchParams.get("_embed"), "author");
  assert.ok(url.searchParams.get("_fields")?.includes("_links"));
});

test("la barra final del sitio no duplica la barra del endpoint", () => {
  assert.ok(buildPostsUrl("https://miblog.com///", null).startsWith("https://miblog.com/wp-json/"));
});

test("un sitio sin URL no se intenta: se dice, no se pide a un host vacío", () => {
  assert.throws(() => buildPostsUrl("   ", null), /no tiene URL/i);
});

test("perPage se acota a 1-100 y lo que no es número cae al valor por defecto", () => {
  assert.equal(normalizeConfig({ perPage: 500 }).perPage, 100);
  assert.equal(normalizeConfig({ perPage: 0 }).perPage, 1);
  assert.equal(normalizeConfig({ perPage: 7.9 }).perPage, 7);
  assert.equal(normalizeConfig(null).perPage, 10);
  assert.equal(normalizeConfig({ perPage: NaN }).perPage, 10);
});

test("search y categories en blanco no viajan en la URL", () => {
  const url = new URL(buildPostsUrl("https://miblog.com", { search: "   ", categories: "" }));
  assert.equal(url.searchParams.get("search"), null);
  assert.equal(url.searchParams.get("categories"), null);
});

const POST = {
  id: 12,
  link: "https://miblog.com/estrategia-territorial",
  title: { rendered: "Territorio &amp; escucha: lo que la calle dice" },
  excerpt: { rendered: "<p>Un resumen con <strong>negritas</strong>.</p>" },
  content: { rendered: "<p>Primer párrafo.</p><p>Segundo p&aacute;rrafo.</p>" },
  date_gmt: "2026-08-20T09:30:00",
  _embedded: { author: [{ name: "Rocco Garcini" }] },
};

test("una entrada se mapea con el título sin entidades ni etiquetas", () => {
  const f = mapWordPressPost(POST)!;
  assert.equal(f.title, "Territorio & escucha: lo que la calle dice");
  assert.equal(f.url, "https://miblog.com/estrategia-territorial");
  assert.equal(f.snippet, "Un resumen con negritas.");
  assert.equal(f.author, "Rocco Garcini");
});

test("el cuerpo llega completo y en texto plano: no hay que volver a descargar la página", () => {
  const f = mapWordPressPost(POST)!;
  assert.equal(f.fullContent, "Primer párrafo.\nSegundo párrafo.");
});

test("date_gmt se lee como UTC — sin la Z se interpretaría como hora local", () => {
  const f = mapWordPressPost(POST)!;
  assert.equal(f.publishedAt?.toISOString(), "2026-08-20T09:30:00.000Z");
});

test("sin extracto se usa el principio del cuerpo, no se queda vacío", () => {
  const f = mapWordPressPost({ ...POST, excerpt: null })!;
  assert.equal(f.snippet, "Primer párrafo.\nSegundo párrafo.");
});

test("una fecha inservible deja publishedAt a null en vez de un Invalid Date", () => {
  assert.equal(mapWordPressPost({ ...POST, date_gmt: "ayer" })!.publishedAt, null);
  assert.equal(mapWordPressPost({ ...POST, date_gmt: undefined })!.publishedAt, null);
});

test("sin autor embebido el hallazgo se crea igual, solo que sin firmar", () => {
  assert.equal(mapWordPressPost({ ...POST, _embedded: {} })!.author, null);
  assert.equal(mapWordPressPost({ ...POST, _embedded: { author: [] } })!.author, null);
});

test("una entrada sin título ni enlace se descarta: en la bandeja no le sirve a nadie", () => {
  assert.equal(mapWordPressPost({ id: 1 }), null);
  assert.equal(mapWordPressPost(null), null);
  assert.equal(mapWordPressPost("no soy un objeto"), null);
});

test("una entrada sin título pero con enlace usa el enlace como título", () => {
  const f = mapWordPressPost({ link: "https://miblog.com/x", title: null })!;
  assert.equal(f.title, "https://miblog.com/x");
});

test("una lista de entradas se convierte entera y salta las inservibles", () => {
  const findings = parsePostsResponse(JSON.stringify([POST, { id: 2 }, POST]));
  assert.equal(findings.length, 2);
});

test("si el sitio devuelve HTML, el error dice que la REST API no está abierta", () => {
  assert.throws(
    () => parsePostsResponse("<!doctype html><html>404</html>"),
    /REST API/i,
  );
});

test("un error de WordPress se repite tal cual en vez de contarse como 0 hallazgos", () => {
  assert.throws(
    () =>
      parsePostsResponse(
        JSON.stringify({ code: "rest_no_route", message: "No se ha encontrado la ruta" }),
      ),
    /No se ha encontrado la ruta/,
  );
});
