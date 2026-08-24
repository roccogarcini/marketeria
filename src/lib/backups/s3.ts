import crypto from "node:crypto";

/**
 * Cliente S3 mínimo con firma AWS Signature V4 sobre `fetch` (sin dependencias).
 * Cubre lo que necesita el sistema de copias: PUT/GET/DELETE de objetos y
 * ListObjectsV2 con prefijo. Compatible con Cloudflare R2, Amazon S3 y
 * cualquier servicio S3-compatible (MinIO, etc.) usando path-style.
 */

export interface S3Config {
  endpoint: string; // URL base, p. ej. https://<account>.r2.cloudflarestorage.com
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export interface S3Object {
  key: string;
  size: number;
  lastModified: string; // ISO
}

const sha256Hex = (data: crypto.BinaryLike) =>
  crypto.createHash("sha256").update(data).digest("hex");
const hmac = (key: crypto.BinaryLike, data: string) =>
  crypto.createHmac("sha256", key).update(data).digest();

/** Percent-encoding estilo AWS (RFC 3986 estricto). */
function awsEncode(s: string): string {
  return encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Región para la firma: se deduce del endpoint (R2 usa "auto"). */
function regionFor(host: string): string {
  if (/\.r2\.cloudflarestorage\.com$/i.test(host)) return "auto";
  const aws = /(?:^|\.)s3[.-]([a-z0-9-]+)\.amazonaws\.com$/i.exec(host);
  if (aws) return aws[1];
  return "us-east-1";
}

function xmlDecode(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export class S3RequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "S3RequestError";
  }
}

export class S3Client {
  private readonly url: URL;
  private readonly region: string;

  constructor(private readonly cfg: S3Config) {
    this.url = new URL(cfg.endpoint);
    this.region = regionFor(this.url.hostname);
  }

  /** Petición firmada (SigV4, path-style). Devuelve la Response sin consumir. */
  private async request(
    method: string,
    key: string,
    opts: { query?: Record<string, string>; body?: Buffer } = {},
  ): Promise<Response> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); // YYYYMMDDTHHMMSSZ
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(opts.body ?? "");

    // Path-style: <endpoint>/<bucket>/<key>. Cada segmento del key se codifica.
    const basePath = this.url.pathname.replace(/\/+$/, "");
    const keyPath = key ? `/${key.split("/").map(awsEncode).join("/")}` : "";
    const canonicalUri = `${basePath}/${awsEncode(this.cfg.bucket)}${keyPath}` || "/";

    const queryEntries = Object.entries(opts.query ?? {}).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const canonicalQuery = queryEntries
      .map(([k, v]) => `${awsEncode(k)}=${awsEncode(v)}`)
      .join("&");

    const host = this.url.host;
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");
    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join(
      "\n",
    );

    const kDate = hmac(`AWS4${this.cfg.secretAccessKey}`, dateStamp);
    const kRegion = hmac(kDate, this.region);
    const kService = hmac(kRegion, "s3");
    const kSigning = hmac(kService, "aws4_request");
    const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

    const authorization = `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const requestUrl = `${this.url.origin}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ""}`;

    return fetch(requestUrl, {
      method,
      headers: {
        Authorization: authorization,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
        ...(opts.body ? { "Content-Length": String(opts.body.length) } : {}),
      },
      body: opts.body as BodyInit | undefined,
      signal: AbortSignal.timeout(120_000),
    });
  }

  private async ensureOk(res: Response, action: string): Promise<void> {
    if (res.ok) return;
    const text = await res.text().catch(() => "");
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
    const msg = /<Message>([^<]+)<\/Message>/.exec(text)?.[1];
    throw new S3RequestError(
      res.status,
      `${action} falló (HTTP ${res.status}${code ? ` ${code}` : ""}${msg ? `: ${xmlDecode(msg)}` : ""})`,
    );
  }

  async putObject(key: string, body: Buffer): Promise<void> {
    const res = await this.request("PUT", key, { body });
    await this.ensureOk(res, "PUT del objeto");
    await res.arrayBuffer().catch(() => undefined); // drenar
  }

  /** Descarga un objeto. Devuelve null si no existe (404). */
  async getObject(key: string): Promise<Buffer | null> {
    const res = await this.request("GET", key);
    if (res.status === 404) {
      await res.arrayBuffer().catch(() => undefined);
      return null;
    }
    await this.ensureOk(res, "GET del objeto");
    return Buffer.from(await res.arrayBuffer());
  }

  async deleteObject(key: string): Promise<void> {
    const res = await this.request("DELETE", key);
    // DELETE es idempotente: 404 también vale.
    if (res.status !== 404) await this.ensureOk(res, "DELETE del objeto");
    await res.arrayBuffer().catch(() => undefined);
  }

  /** ListObjectsV2 con prefijo (pagina hasta traerlo todo). */
  async listObjects(prefix: string): Promise<S3Object[]> {
    const out: S3Object[] = [];
    let token: string | undefined;
    do {
      const query: Record<string, string> = { "list-type": "2", prefix, "max-keys": "1000" };
      if (token) query["continuation-token"] = token;
      const res = await this.request("GET", "", { query });
      await this.ensureOk(res, "Listado del bucket");
      const xml = await res.text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const c = m[1];
        const key = /<Key>([\s\S]*?)<\/Key>/.exec(c)?.[1];
        if (!key) continue;
        out.push({
          key: xmlDecode(key),
          size: Number(/<Size>(\d+)<\/Size>/.exec(c)?.[1] ?? 0),
          lastModified: /<LastModified>([^<]+)<\/LastModified>/.exec(c)?.[1] ?? "",
        });
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
        ? (/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] ?? undefined)
        : undefined;
    } while (token);
    return out;
  }
}
