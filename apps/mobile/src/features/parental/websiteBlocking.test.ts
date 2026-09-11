import { test } from "node:test";
import assert from "node:assert/strict";
import { extractHost, isHostBlocked } from "./websiteBlocking.ts";

// --- extractHost ---------------------------------------------------------

test("extractHost: bare host", () => {
  assert.equal(extractHost("g1.com.br"), "g1.com.br");
});

test("extractHost: full https URL with path", () => {
  assert.equal(extractHost("https://www.g1.com.br/politica/noticia.html"), "www.g1.com.br");
});

test("extractHost: http URL with query string", () => {
  assert.equal(extractHost("http://g1.com.br/busca?q=teste"), "g1.com.br");
});

test("extractHost: strips port", () => {
  assert.equal(extractHost("g1.com.br:8080/path"), "g1.com.br");
});

test("extractHost: strips userinfo", () => {
  assert.equal(extractHost("user:pass@g1.com.br"), "g1.com.br");
});

test("extractHost: a typed search query with no dot is not a host", () => {
  assert.equal(extractHost("melhores memes 2026"), null);
});

test("extractHost: empty/placeholder bar", () => {
  assert.equal(extractHost(""), null);
  assert.equal(extractHost(null), null);
  assert.equal(extractHost(undefined), null);
});

test("extractHost: a single word with a dot but a space is still a search, not a URL", () => {
  assert.equal(extractHost("g1.com.br notícias"), null);
});

test("extractHost: uppercase input is normalized", () => {
  assert.equal(extractHost("HTTPS://WWW.G1.COM.BR"), "www.g1.com.br");
});

// --- isHostBlocked ---------------------------------------------------------

test("isHostBlocked: exact match", () => {
  assert.equal(isHostBlocked("g1.com.br", ["g1.com.br"]), true);
});

test("isHostBlocked: www. subdomain matches the bare domain", () => {
  assert.equal(isHostBlocked("www.g1.com.br", ["g1.com.br"]), true);
});

test("isHostBlocked: an arbitrary subdomain matches", () => {
  assert.equal(isHostBlocked("m.g1.com.br", ["g1.com.br"]), true);
});

test("isHostBlocked: a deeper subdomain matches", () => {
  assert.equal(isHostBlocked("noticias.esportes.g1.com.br", ["g1.com.br"]), true);
});

test("isHostBlocked: a domain that merely CONTAINS the string does NOT match", () => {
  assert.equal(isHostBlocked("naog1.com.br", ["g1.com.br"]), false);
});

test("isHostBlocked: an unrelated domain does not match", () => {
  assert.equal(isHostBlocked("uol.com.br", ["g1.com.br"]), false);
});

test("isHostBlocked: the blocked domain itself stored with a www. prefix still matches bare host", () => {
  assert.equal(isHostBlocked("g1.com.br", ["www.g1.com.br"]), true);
});

test("isHostBlocked: case-insensitive", () => {
  assert.equal(isHostBlocked("WWW.G1.COM.BR", ["g1.com.br"]), true);
});

test("isHostBlocked: empty blocklist never matches", () => {
  assert.equal(isHostBlocked("g1.com.br", []), false);
});

test("isHostBlocked: empty host never matches", () => {
  assert.equal(isHostBlocked("", ["g1.com.br"]), false);
});

test("isHostBlocked: a longer domain that ends with the blocked one but not on a label boundary does not match", () => {
  // "outrog1.com.br" ends with "g1.com.br" as a raw substring, but the char
  // right before it is "o", not a "." — must not match.
  assert.equal(isHostBlocked("outrog1.com.br", ["g1.com.br"]), false);
});
