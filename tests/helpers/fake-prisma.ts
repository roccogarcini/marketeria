import { randomUUID } from "node:crypto";

/**
 * Doble en memoria de PrismaClient para los tests unitarios: la app no tiene
 * Postgres disponible en CI y lo que queremos verificar es la LÓGICA (dedupe,
 * reutilización de Source, registro de AIExecution), no el motor SQL.
 *
 * Soporta el subconjunto de la API de Prisma que usan los módulos bajo prueba:
 * create / findFirst / findUnique / findMany / update / upsert / count, con
 * `where` de igualdad y operadores `in` / `equals` / `not` / `gte`.
 * Cualquier operador no soportado LANZA, para que un test nunca pase por
 * silencio del doble.
 *
 * Emula además los índices ÚNICOS relevantes con la semántica de Postgres
 * (NULL nunca colisiona) y lanza un error con `code = "P2002"`, igual que
 * Prisma, para poder ejercitar el camino de violación de unicidad.
 */

export type Row = Record<string, unknown>;

export class FakeUniqueViolation extends Error {
  code = "P2002";
  meta: { target: string[] };
  constructor(target: string[]) {
    super(`Unique constraint failed on the fields: (${target.join(",")})`);
    this.name = "PrismaClientKnownRequestError";
    this.meta = { target };
  }
}

/** Índices únicos que emulamos, por modelo (nombre Prisma del delegado). */
const UNIQUES: Record<string, string[][]> = {
  finding: [["sourceId", "url"]],
  source: [["externalKey"]],
  lLMProvider: [["userId", "displayName"]],
};

/** Campos que rellenamos solos al crear, por modelo. */
const DEFAULTS: Record<string, (seq: number) => Row> = {
  finding: (seq) => ({ status: "NEW", fetchedAt: new Date(1_800_000_000_000 + seq) }),
  source: (seq) => ({ isActive: true, createdAt: new Date(1_800_000_000_000 + seq) }),
  aIExecution: (seq) => ({ status: "RUNNING", createdAt: new Date(1_800_000_000_000 + seq) }),
  lLMProvider: (seq) => ({ isActive: true, createdAt: new Date(1_800_000_000_000 + seq) }),
};

function isPlainCondition(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !(v instanceof Date) && !Array.isArray(v);
}

function matchesWhere(row: Row, where: Row | undefined, model: string): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (isPlainCondition(value)) {
      if ("in" in value) return (value.in as unknown[]).includes(row[key]);
      if ("equals" in value) return row[key] === value.equals;
      if ("not" in value) return row[key] !== value.not;
      if ("gte" in value) return (row[key] as number) >= (value.gte as number);
      throw new Error(
        `fake-prisma(${model}): operador no soportado en where.${key} → ${JSON.stringify(value)}`,
      );
    }
    return row[key] === value;
  });
}

function sortRows(rows: Row[], orderBy: unknown): Row[] {
  if (!orderBy) return rows;
  const spec = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out = [...rows];
  for (const s of [...spec].reverse()) {
    const [field, dir] = Object.entries(s as Record<string, string>)[0];
    out.sort((a, b) => {
      const av = a[field] as number | string | Date | null | undefined;
      const bv = b[field] as number | string | Date | null | undefined;
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = av < bv ? -1 : 1;
      return dir === "desc" ? -cmp : cmp;
    });
  }
  return out;
}

type Args = {
  where?: Row;
  data?: Row;
  create?: Row;
  update?: Row;
  orderBy?: unknown;
  take?: number;
  select?: unknown;
  by?: string[];
  _sum?: Record<string, boolean>;
  _count?: Record<string, boolean> | boolean;
};

function makeModel(model: string, state: { seq: number }) {
  const rows: Row[] = [];
  const uniques = UNIQUES[model] ?? [];

  const assertUnique = (candidate: Row, ignoreId?: unknown) => {
    for (const fields of uniques) {
      // Semántica Postgres: si algún campo del índice es NULL, no colisiona.
      if (fields.some((f) => candidate[f] === null || candidate[f] === undefined)) continue;
      const clash = rows.some(
        (r) => r.id !== ignoreId && fields.every((f) => r[f] === candidate[f]),
      );
      if (clash) throw new FakeUniqueViolation(fields);
    }
  };

  const create = async ({ data }: Args) => {
    const row: Row = {
      id: randomUUID(),
      ...(DEFAULTS[model]?.(state.seq++) ?? {}),
      ...(data ?? {}),
    };
    assertUnique(row);
    rows.push(row);
    return { ...row };
  };

  const findMany = async ({ where, orderBy, take }: Args = {}) => {
    const found = sortRows(
      rows.filter((r) => matchesWhere(r, where, model)),
      orderBy,
    );
    return (take ? found.slice(0, take) : found).map((r) => ({ ...r }));
  };

  const findFirst = async ({ where, orderBy }: Args = {}) => {
    const found = sortRows(
      rows.filter((r) => matchesWhere(r, where, model)),
      orderBy,
    );
    return found[0] ? { ...found[0] } : null;
  };

  const findUnique = async ({ where }: Args) => findFirst({ where });

  const update = async ({ where, data }: Args) => {
    const row = rows.find((r) => matchesWhere(r, where, model));
    if (!row) {
      const err = new Error("An operation failed because it depends on one or more records that were required but not found.");
      (err as Error & { code?: string }).code = "P2025";
      throw err;
    }
    const next = { ...row, ...(data ?? {}) };
    assertUnique(next, row.id);
    Object.assign(row, next);
    return { ...row };
  };

  const upsert = async ({ where, create: createData, update: updateData }: Args) => {
    const row = rows.find((r) => matchesWhere(r, where, model));
    if (row) return update({ where: { id: row.id }, data: updateData ?? {} });
    return create({ data: { ...(where ?? {}), ...(createData ?? {}) } });
  };

  const count = async ({ where }: Args = {}) =>
    rows.filter((r) => matchesWhere(r, where, model)).length;

  /**
   * Agregado tipo `groupBy` de Prisma: agrupa por los campos de `by` y
   * devuelve `_sum` / `_count` de cada grupo. Lo usa el corte de presupuesto,
   * que suma los tokens del mes SIN traerse las filas de AIExecution.
   */
  const groupBy = async ({ by, where, _sum, _count }: Args) => {
    if (!by || by.length === 0) {
      throw new Error(`fake-prisma(${model}): groupBy necesita 'by'`);
    }
    const sumFields = Object.entries(_sum ?? {})
      .filter(([, v]) => v)
      .map(([k]) => k);
    const groups = new Map<string, { key: Row; rows: Row[] }>();
    for (const r of rows.filter((row) => matchesWhere(row, where, model))) {
      const key: Row = {};
      for (const f of by) key[f] = r[f] ?? null;
      const id = JSON.stringify(by.map((f) => key[f]));
      const g = groups.get(id) ?? { key, rows: [] };
      g.rows.push(r);
      groups.set(id, g);
    }
    return [...groups.values()].map((g) => {
      const out: Row = { ...g.key };
      if (sumFields.length > 0) {
        const sums: Row = {};
        for (const f of sumFields) {
          const vals = g.rows.map((r) => r[f]).filter((v) => typeof v === "number") as number[];
          sums[f] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) : null;
        }
        out._sum = sums;
      }
      if (_count) out._count = { _all: g.rows.length };
      return out;
    });
  };

  return {
    __rows: rows,
    create,
    findMany,
    findFirst,
    findUnique,
    update,
    upsert,
    count,
    groupBy,
  };
}

export type FakePrisma = {
  prisma: Record<string, ReturnType<typeof makeModel>>;
  /** Filas actuales de un modelo (por su nombre de delegado Prisma). */
  rows(model: string): Row[];
  /** Inserta filas directamente, sin pasar por create (para preparar el estado). */
  seed(model: string, ...rows: Row[]): void;
  reset(): void;
};

export function createFakePrisma(): FakePrisma {
  const state = { seq: 0 };
  let models: Record<string, ReturnType<typeof makeModel>> = {};

  const prisma = new Proxy({} as Record<string, ReturnType<typeof makeModel>>, {
    get(_target, prop: string) {
      if (prop === "then") return undefined; // no somos un thenable
      if (prop === "$transaction") {
        return async (arg: unknown) =>
          typeof arg === "function"
            ? (arg as (tx: unknown) => unknown)(prisma)
            : Promise.all(arg as Promise<unknown>[]);
      }
      models[prop] ??= makeModel(prop, state);
      return models[prop];
    },
  });

  return {
    prisma,
    rows: (model) => (models[model]?.__rows ?? []).map((r) => ({ ...r })),
    seed: (model, ...rows) => {
      models[model] ??= makeModel(model, state);
      models[model].__rows.push(
        ...rows.map((r) => ({ id: randomUUID(), ...(DEFAULTS[model]?.(state.seq++) ?? {}), ...r })),
      );
    },
    reset: () => {
      models = {};
      state.seq = 0;
    },
  };
}
